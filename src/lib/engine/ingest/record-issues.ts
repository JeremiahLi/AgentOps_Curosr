import type { PrismaClient } from "@prisma/client";
import {
  clusterOpened,
  issueSeverity,
  issueTitle,
  nextIssueStatus,
  selectIssueHits,
  toolNameOf,
  toolOpened,
  type IssueHit,
} from "./issue-rules";
import { NO_ERROR_TEXT } from "./span-record";

type Db = PrismaClient;

const SPAN_SELECT = {
  id: true,
  kind: true,
  name: true,
  status: true,
  input: true,
  output: true,
  error: true,
  details: true,
  content: true,
  roundIndex: true,
  turnId: true,
  parentId: true,
  branchId: true,
} as const;

/**
 * 把这一次会话的未恢复失败记到问题库。
 * 同一签名只 upsert 一条；证据按 span 去重。忽略过的签名不会被新证据打回 open。
 * 不扫描该 Agent 的其它会话来重算问题列表，分母只用计数。
 */
export async function recordSessionIssues(
  db: Db,
  input: {
    agentId: string;
    sessionId: string;
    releaseId: string | null;
    source: "upload" | "backfill";
  },
): Promise<{ signatures: number; evidenceAdded: number }> {
  const spans = await db.span.findMany({
    where: { sessionId: input.sessionId },
    select: SPAN_SELECT,
  });
  const hits = selectIssueHits(spans);
  const desired = new Map<string, IssueHit[]>();
  for (const hit of hits) {
    const list = desired.get(hit.signature) ?? [];
    list.push(hit);
    desired.set(hit.signature, list);
  }

  await retractOtherAgents(db, input.sessionId, input.agentId);

  const prior = await db.issueEvidence.findMany({
    where: { sessionId: input.sessionId, issue: { agentId: input.agentId } },
    select: { issue: { select: { signature: true } } },
  });
  const signatures = new Set<string>([...desired.keys(), ...prior.map((row) => row.issue.signature)]);
  if (signatures.size === 0) return { signatures: 0, evidenceAdded: 0 };

  const toolNames = [...signatures].map(toolNameOf).filter((name): name is string => !!name);
  const toolCalls = await countToolCalls(db, input.agentId, toolNames);
  const needsCluster = [...signatures].some((signature) => !signature.startsWith("tool:"));
  const failedSpans = needsCluster ? await countFailedSpans(db, input.agentId) : 0;

  let evidenceAdded = 0;
  for (const signature of signatures) {
    evidenceAdded += await syncSignature(db, input, signature, desired.get(signature) ?? [], toolCalls, failedSpans);
  }
  return { signatures: signatures.size, evidenceAdded };
}

async function retractOtherAgents(db: Db, sessionId: string, agentId: string) {
  const foreign = await db.issueEvidence.findMany({
    where: { sessionId, issue: { agentId: { not: agentId } } },
    select: { id: true, issueId: true },
  });
  if (foreign.length === 0) return;
  const counts = new Map<string, number>();
  for (const row of foreign) counts.set(row.issueId, (counts.get(row.issueId) ?? 0) + 1);
  await db.issueEvidence.deleteMany({ where: { id: { in: foreign.map((row) => row.id) } } });
  for (const [issueId, removed] of counts) {
    const issue = await db.issue.findUnique({ where: { id: issueId }, select: { hitCount: true } });
    if (!issue) continue;
    await db.issue.update({
      where: { id: issueId },
      data: { hitCount: Math.max(0, issue.hitCount - removed) },
    });
  }
}

async function countToolCalls(db: Db, agentId: string, names: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  const rows = await db.span.groupBy({
    by: ["name"],
    where: {
      name: { in: unique },
      kind: { in: ["tool_call", "command"] },
      session: { agentId },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.name, row._count._all]));
}

async function countFailedSpans(db: Db, agentId: string): Promise<number> {
  return db.span.count({
    where: { status: { in: ["failed", "error"] }, session: { agentId } },
  });
}

async function syncSignature(
  db: Db,
  input: { agentId: string; sessionId: string; releaseId: string | null; source: "upload" | "backfill" },
  signature: string,
  hits: IssueHit[],
  toolCalls: Map<string, number>,
  failedSpans: number,
): Promise<number> {
  const sample = hits.find((hit) => hit.errorSummary && hit.errorSummary !== NO_ERROR_TEXT)?.errorSummary ?? "";
  const kind = signature.startsWith("tool:") ? "tool_failure" : "error_cluster";
  const found = await db.issue.findUnique({
    where: { agentId_signature: { agentId: input.agentId, signature } },
  });
  if (!found && hits.length === 0) return 0;
  const existing =
    found ??
    (await db.issue.create({
      data: {
        agentId: input.agentId,
        signature,
        kind,
        title: issueTitle(signature),
        status: "candidate",
        severity: "info",
        sampleError: sample.slice(0, 200),
      },
    }));

  const prior = await db.issueEvidence.findMany({
    where: { issueId: existing.id, sessionId: input.sessionId },
    select: { id: true, spanId: true },
  });
  const wanted = new Set(hits.map((hit) => hit.spanId));
  const have = new Set(prior.map((row) => row.spanId));
  const removeIds = prior.filter((row) => !wanted.has(row.spanId)).map((row) => row.id);
  const add = hits.filter((hit) => !have.has(hit.spanId));
  if (removeIds.length > 0) {
    await db.issueEvidence.deleteMany({ where: { id: { in: removeIds } } });
  }
  if (add.length > 0) {
    await db.issueEvidence.createMany({
      data: add.map((hit) => ({
        issueId: existing.id,
        sessionId: input.sessionId,
        spanId: hit.spanId,
        releaseId: input.releaseId,
        source: input.source,
      })),
    });
  }

  const hitCount = Math.max(0, existing.hitCount - removeIds.length + add.length);
  const toolName = toolNameOf(signature);
  const calls = toolName ? toolCalls.get(toolName) ?? 0 : 0;
  const opened = toolName ? toolOpened(hitCount, calls) : clusterOpened(hitCount, failedSpans);
  const rate = toolName
    ? calls > 0
      ? (hitCount / calls) * 100
      : 0
    : failedSpans > 0
      ? (hitCount / failedSpans) * 100
      : 0;
  await db.issue.update({
    where: { id: existing.id },
    data: {
      hitCount,
      title: issueTitle(signature),
      kind,
      status: nextIssueStatus(existing.status, opened),
      severity: issueSeverity(signature, hitCount, rate),
      lastSeenAt: add.length > 0 || removeIds.length > 0 ? new Date() : existing.lastSeenAt,
      ...(existing.sampleError || !sample ? {} : { sampleError: sample.slice(0, 200) }),
    },
  });
  return add.length;
}
