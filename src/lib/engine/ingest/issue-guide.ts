import type { PrismaClient } from "@prisma/client";
import { callLlmAsJson, getActiveLlmConfig } from "../experiment/judge-llm";
import { loadSlowCallReport } from "../stats/slow-call";
import {
  evidenceHash,
  groundIssueNote,
  isMissingErrorSignature,
  missingErrorNote,
  readStoredNote,
  serializeNote,
  type IssueNote,
  type NoteLayer,
} from "./issue-note";

type Db = PrismaClient;

export interface GuideItem {
  issueId: string;
  title: string;
  signature: string;
  hitCount: number;
  sessionId: string;
  spanId: string;
  note: IssueNote;
}

export interface AgentGuide {
  blocked: boolean;
  blockedReason: string;
  pending: number;
  groups: { layer: NoteLayer; items: GuideItem[] }[];
  /** 按问题列表的 id 取结论。慢调用的 id 固定是 slow-span。 */
  notes: Record<string, IssueNote>;
}

const LAYER_ORDER: NoteLayer[] = ["prompt", "skill", "tool", "env", "insufficient"];
const CALL_CAP = 8;

interface CacheSlot {
  hash: string;
  note: string;
}

export async function buildAgentGuide(
  db: Db,
  agentName: string,
  startMs: number,
  rangeKey: string,
): Promise<AgentGuide | null> {
  const agent = await db.agent.findUnique({
    where: { name: agentName },
    select: { id: true, analysisCache: true },
  });
  if (!agent) return null;
  const issues = await db.issue.findMany({
    where: { agentId: agent.id, status: { in: ["open", "confirmed"] } },
    orderBy: { hitCount: "desc" },
    include: { evidence: { orderBy: { createdAt: "desc" }, take: 3 } },
  });
  const spanIds = issues.flatMap((issue) => issue.evidence.map((item) => item.spanId).filter(Boolean));
  const spans = spanIds.length
    ? await db.span.findMany({
        where: { id: { in: spanIds } },
        select: { id: true, name: true, input: true, output: true, error: true, details: true },
      })
    : [];
  const byId = new Map(spans.map((span) => [span.id, span]));
  const config = await getActiveLlmConfig();
  const budget = { calls: 0 };
  let pending = 0;
  const items: GuideItem[] = [];
  const notes: Record<string, IssueNote> = {};
  let cacheRaw = agent.analysisCache || "";

  const slow = await loadSlowCallReport(db, agent.id, startMs);
  if (slow) {
    const slot = `slow:${rangeKey}`;
    const hashed = evidenceHash(slot, slow.corpus);
    const cached = readCache(cacheRaw)[slot];
    let note = cached?.hash === hashed ? readStoredNote(cached.note) : null;
    if (note && note.grounded === false) note = null;
    if (!note) {
      const before = budget.calls;
      note = await conclude(config, budget, slow.issue.title, slot, slow.corpus);
      if (!note && before >= CALL_CAP) pending += 1;
      if (note && note.grounded !== false) cacheRaw = await writeCache(db, agent.id, cacheRaw, slot, hashed, note);
    }
    if (note) {
      notes["slow-span"] = note;
      const link = slow.issue.links[0];
      items.push({
        issueId: "slow-span",
        title: slow.issue.title,
        signature: slot,
        hitCount: 1,
        sessionId: link?.sessionId || "",
        spanId: link?.spanId || "",
        note,
      });
    }
  }

  for (const issue of issues) {
    const parts: string[] = [];
    for (const item of issue.evidence) {
      const span = byId.get(item.spanId);
      if (!span) continue;
      parts.push([span.name, span.input, span.error, span.output, span.details].filter(Boolean).join("\n"));
    }
    if (issue.sampleError) parts.push(issue.sampleError);
    const corpus = parts.join("\n").slice(0, 4000);
    const hash = evidenceHash(issue.signature, corpus);
    let note = issue.llmNoteHash === hash ? readStoredNote(issue.llmNote) : null;

    if (!note) {
      if (isMissingErrorSignature(issue.signature) || corpus.trim().length < 12) {
        note = missingErrorNote();
      } else if (!config) {
        note = unconfiguredNote();
      } else if (budget.calls >= CALL_CAP) {
        pending += 1;
        continue;
      } else {
        note = await conclude(config, budget, issue.title, issue.signature, corpus);
      }
      if (note && note.grounded !== false) {
        await db.issue.update({
          where: { id: issue.id },
          data: { llmNote: serializeNote(note), llmNoteHash: hash },
        });
      }
    }

    if (!note) continue;
    notes[issue.id] = note;
    const evidence = issue.evidence[0];
    items.push({
      issueId: issue.id,
      title: issue.title,
      signature: issue.signature,
      hitCount: issue.hitCount,
      sessionId: evidence?.sessionId || "",
      spanId: evidence?.spanId || "",
      note,
    });
  }

  const failureItems = items.filter((item) => item.issueId !== "slow-span");
  const missing = failureItems.filter((item) => isMissingErrorSignature(item.signature)).length;
  const blocked = failureItems.length > 0 && missing * 2 >= failureItems.length;
  const groups = LAYER_ORDER.map((layer) => ({
    layer,
    items: items.filter((item) => item.note.layer === layer),
  })).filter((group) => group.items.length > 0);

  return {
    blocked,
    blockedReason: blocked
      ? `${missing} / ${failureItems.length} 条已打开的失败问题没有错误文本。这些失败先补采集。慢调用仍按测到的模型和 token 分析。`
      : "",
    pending,
    groups,
    notes,
  };
}

function unconfiguredNote(): IssueNote {
  return {
    where: "",
    caused: "未配置裁判模型，下面只保留测到的事实",
    layer: "insufficient",
    basis: "",
    grounded: true,
  };
}

async function conclude(
  config: Awaited<ReturnType<typeof getActiveLlmConfig>>,
  budget: { calls: number },
  title: string,
  signature: string,
  corpus: string,
): Promise<IssueNote | null> {
  if (!config) return unconfiguredNote();
  if (budget.calls >= CALL_CAP) return null;
  budget.calls += 1;
  return askNote(config, title, signature, corpus);
}

function readCache(raw: string): Record<string, CacheSlot> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, CacheSlot>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCache(db: Db, agentId: string, raw: string, slot: string, hash: string, note: IssueNote): Promise<string> {
  const cache = readCache(raw);
  cache[slot] = { hash, note: serializeNote(note) };
  const next = JSON.stringify(cache);
  await db.agent.update({ where: { id: agentId }, data: { analysisCache: next } });
  return next;
}

async function askNote(
  config: NonNullable<Awaited<ReturnType<typeof getActiveLlmConfig>>>,
  title: string,
  signature: string,
  corpus: string,
): Promise<IssueNote> {
  try {
    const raw = await callLlmAsJson<unknown>(
      [
        {
          role: "system",
          content: [
            "你是 Agent 开发教练。只根据给定证据说明这一条问题，告诉开发者发生了什么、该改哪一层。",
            "输出 JSON：where, caused, layer, basis。",
            "layer 只能是 prompt、skill、tool、env、insufficient。",
            "prompt 是提示词，skill 是技能说明，tool 是工具参数，env 是运行环境或模型调用参数，insufficient 是证据不够。",
            "where 和 basis 必须是证据里的连续子串。证据不够时 layer 用 insufficient，where 和 basis 用空字符串。",
            "不要编路径，不要建议重写整份提示词。caused 只用一句话，写清发生了什么。",
          ].join("\n"),
        },
        { role: "user", content: `问题：${title}\n签名：${signature}\n证据：\n${corpus}` },
      ],
      config,
      { temperature: 0, maxTokens: 600 },
    );
    return groundIssueNote(raw, corpus);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const caused = /402|insufficient[_\s-]*balance/i.test(message)
      ? "裁判模型余额不足，这次没有生成分析。先看上面测到的事实。"
      : "裁判模型没有返回可用结论";
    return {
      where: "",
      caused,
      layer: "insufficient",
      basis: "",
      grounded: false,
    };
  }
}
