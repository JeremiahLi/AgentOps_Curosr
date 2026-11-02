import type { PrismaClient } from "@prisma/client";
import { getEvaluatorById, runEvaluator } from "../experiment/evaluators";
import { assembleContext } from "../experiment/judge-assembly";
import { extractSessionData } from "../experiment/session-data";

type Db = PrismaClient;

export class RegressionInputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 首条用户话收成对照用的分桶键：去掉空白、路径和长数字。 */
export function taskKeyOf(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "")
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function requirePassCriteria(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (!value) throw new RegressionInputError("通过标准不能为空");
  return value;
}

/** 裁判看到的参考文本。通过标准始终在，参考答案有才附上。 */
export function judgeReference(passCriteria: string, referenceOutput: string): string {
  const parts = [`通过标准：\n${passCriteria.trim()}`];
  if (referenceOutput.trim()) parts.push(`参考答案：\n${referenceOutput.trim()}`);
  return parts.join("\n\n");
}

function parseIdList(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

function parseConfig(raw: string): Record<string, Record<string, unknown>> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, Record<string, unknown>>;
  } catch {
    return {};
  }
}

export async function createRegressionCase(
  db: Db,
  input: {
    issueId: string;
    passCriteria?: string | null;
    referenceOutput?: string | null;
    hypothesis?: string | null;
    evaluatorIds?: string[];
    evaluatorConfig?: Record<string, Record<string, unknown>>;
    sourceSessionId?: string | null;
  },
) {
  const passCriteria = requirePassCriteria(input.passCriteria);
  const evaluatorIds = [...new Set((input.evaluatorIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (evaluatorIds.length === 0) throw new RegressionInputError("至少选一个判定器");
  for (const id of evaluatorIds) {
    if (!getEvaluatorById(id)) throw new RegressionInputError(`未知判定器 ${id}`);
  }

  const issue = await db.issue.findUnique({
    where: { id: input.issueId },
    include: { regressionCase: { select: { id: true } }, evidence: { select: { sessionId: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!issue) throw new RegressionInputError("问题不存在", 404);
  if (issue.status !== "open" && issue.status !== "confirmed") {
    throw new RegressionInputError("只有待确认或已确认的问题可以钉成回归用例");
  }
  if (issue.regressionCase) throw new RegressionInputError("这条问题已经有回归用例", 409);

  const sourceSessionId = (input.sourceSessionId || issue.evidence[0]?.sessionId || "").trim();
  if (!sourceSessionId) throw new RegressionInputError("没有可冻结输入的来源会话");
  const source = await db.session.findUnique({
    where: { id: sourceSessionId },
    select: { id: true, agentId: true },
  });
  if (!source || source.agentId !== issue.agentId) {
    throw new RegressionInputError("来源会话不属于这个 Agent");
  }

  const extracted = await extractSessionData(sourceSessionId);
  const created = await db.regressionCase.create({
    data: {
      issueId: issue.id,
      agentId: issue.agentId,
      sourceSessionId,
      frozenInput: extracted.input,
      passCriteria,
      referenceOutput: (input.referenceOutput ?? "").trim(),
      evaluatorIds: JSON.stringify(evaluatorIds),
      evaluatorConfig: JSON.stringify(input.evaluatorConfig ?? {}),
      hypothesis: (input.hypothesis ?? "").trim(),
    },
  });
  if (issue.status !== "confirmed") {
    await db.issue.update({ where: { id: issue.id }, data: { status: "confirmed" } });
  }
  return created;
}

/**
 * 把一条已入库的会话绑到用例上，并按用例里的判定器各写一条 RegressionRun。
 * 不重跑 Agent。upload 侧 rerun=false，避免增量上传反复调用裁判。
 */
export async function bindRegressionSession(
  db: Db,
  input: { caseId: string; sessionId: string; rerun?: boolean },
) {
  const regressionCase = await db.regressionCase.findUnique({ where: { id: input.caseId } });
  if (!regressionCase) throw new RegressionInputError("回归用例不存在", 404);
  const session = await db.session.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      agentId: true,
      releaseId: true,
      regressionCaseId: true,
      totalDuration: true,
      totalInputTokens: true,
      totalOutputTokens: true,
    },
  });
  if (!session) throw new RegressionInputError("会话不存在", 404);
  if (session.agentId !== regressionCase.agentId) {
    throw new RegressionInputError("会话不属于这个 Agent");
  }
  if (session.regressionCaseId && session.regressionCaseId !== regressionCase.id) {
    throw new RegressionInputError("这条会话已经绑在别的回归用例上", 409);
  }
  if (!session.regressionCaseId) {
    await db.session.update({
      where: { id: session.id },
      data: { regressionCaseId: regressionCase.id },
    });
  }

  const evaluatorIds = parseIdList(regressionCase.evaluatorIds);
  const config = parseConfig(regressionCase.evaluatorConfig);
  const existing = await db.regressionRun.findMany({
    where: { caseId: regressionCase.id, sessionId: session.id },
    select: { evaluatorId: true },
  });
  const have = new Set(existing.map((row) => row.evaluatorId));
  if (!input.rerun && evaluatorIds.every((id) => have.has(id))) {
    return db.regressionRun.findMany({ where: { caseId: regressionCase.id, sessionId: session.id } });
  }

  const reference = judgeReference(regressionCase.passCriteria, regressionCase.referenceOutput);
  const context = await assembleContext(session.id, regressionCase.frozenInput, "", reference);
  const runs = [];
  for (const evaluatorId of evaluatorIds) {
    const run = await db.regressionRun.upsert({
      where: {
        caseId_evaluatorId_sessionId: {
          caseId: regressionCase.id,
          evaluatorId,
          sessionId: session.id,
        },
      },
      update: { status: "pending", errorMessage: "", releaseId: session.releaseId },
      create: {
        caseId: regressionCase.id,
        evaluatorId,
        sessionId: session.id,
        releaseId: session.releaseId,
        status: "pending",
      },
    });
    try {
      const output = await runEvaluator(evaluatorId, context, config[evaluatorId] ?? {});
      const saved = await db.regressionRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          verdict: output.verdict,
          score: output.score,
          summary: (output.summary || "").slice(0, 2000),
          evidenceJson: JSON.stringify(output.evidence ?? {}).slice(0, 8000),
          errorMessage: "",
          durationMs: session.totalDuration,
          inputTokens: session.totalInputTokens,
          outputTokens: session.totalOutputTokens,
          releaseId: session.releaseId,
        },
      });
      runs.push(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const saved = await db.regressionRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          errorMessage: message.slice(0, 500),
          durationMs: session.totalDuration,
          inputTokens: session.totalInputTokens,
          outputTokens: session.totalOutputTokens,
          releaseId: session.releaseId,
        },
      });
      runs.push(saved);
    }
  }
  return runs;
}
