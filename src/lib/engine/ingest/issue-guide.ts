import type { PrismaClient } from "@prisma/client";
import { callLlmAsJson, getActiveLlmConfig } from "../experiment/judge-llm";
import { loadSlowCallReport } from "../stats/slow-call";
import {
  evidenceHash,
  fallbackFix,
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
        select: {
          id: true,
          name: true,
          input: true,
          output: true,
          error: true,
          details: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
        },
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
      if (note && note.grounded !== false && !note.modelError) cacheRaw = await writeCache(db, agent.id, cacheRaw, slot, hashed, note);
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
      parts.push(formatSpanEvidence(item.sessionId, span));
    }
    if (issue.sampleError) parts.push(`字段: sampleError=${issue.sampleError.slice(0, 200)}`);
    const corpus = parts.join("\n").slice(0, 4000);
    const hash = evidenceHash(issue.signature, corpus);
    let note = issue.llmNoteHash === hash ? readStoredNote(issue.llmNote) : null;

    if (!note) {
      const evidence = issue.evidence[0];
      if (isMissingErrorSignature(issue.signature) || corpus.trim().length < 12) {
        note = missingErrorNote(evidence?.sessionId || "", evidence?.spanId || "");
      } else if (!config) {
        note = unconfiguredNote();
      } else if (budget.calls >= CALL_CAP) {
        pending += 1;
        continue;
      } else {
        note = await conclude(config, budget, issue.title, issue.signature, corpus);
      }
      if (note && note.grounded !== false && !note.modelError) {
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
    sessionId: "",
    spanId: "",
    field: "",
    observed: "",
    action: "",
    verify: "",
    where: "",
    caused: "未配置裁判模型，下面只保留测到的事实",
    basis: "",
    layer: "insufficient",
    grounded: true,
  };
}

function formatSpanEvidence(
  sessionId: string,
  span: {
    id: string;
    name: string;
    input: string | null;
    output: string | null;
    error: string | null;
    details: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
  },
): string {
  const clip = (value: string | null, max: number) => (value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return [
    `sessionId: ${sessionId}`,
    `spanId: ${span.id}`,
    `字段: name=${span.name || ""}`,
    `字段: model=${span.model || ""}`,
    `字段: inputTokens=${span.inputTokens}`,
    `字段: outputTokens=${span.outputTokens}`,
    `字段: error=${clip(span.error, 400)}`,
    `字段: input=${clip(span.input, 400)}`,
    `字段: output=${clip(span.output, 400)}`,
    span.details ? `字段: details=${clip(span.details, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  return askNote(config, budget, title, signature, corpus);
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
  budget: { calls: number },
  title: string,
  signature: string,
  corpus: string,
): Promise<IssueNote> {
  const instruction = [
    "你是轨迹诊断员。只根据证据给出最后一步根因，必须可验证、可修复。",
    "输出 JSON：sessionId, spanId, field, observed, layer, action, verify。",
    "sessionId 和 spanId 必须原样复制证据里的 sessionId: 和 spanId: 后面的值。",
    "field 必须是证据里某一行「字段: 名字=原值」的名字。observed 必须是该行等号后的原值，且是证据里的连续子串。",
    "layer 只能是 prompt、skill、tool、env。prompt 是某一段提示词，skill 是技能说明，tool 是工具参数，env 是模型请求参数或运行环境。",
    "action 只写一处修改，必须同时包含 spanId、field、observed。例如：把 span span-1 的 outputTokens 对应的 max_tokens 从 16384 改小。",
    "outputTokens 的值若是 1024、2048、4096、8192、16384、32768、65536，动作就是修改该 span 这次请求的 max_tokens，改到小于 observed。",
    "error 为空或是（无错误文本）时，动作是把该 span 的 error 写成失败原因。",
    "工具错误里出现了 input 中的 path 或 command 时，动作是修改该 span 的这个参数值。",
    "verify 必须回到同一个 spanId 和同一个 field，写明改完后这个字段应变成什么。",
    "禁止：推理能力不足、模型不够聪明、优化提示词、加强校验、建议关注。这些都不是可修复的事实。",
    "一条结论只选一个字段。",
  ].join("\n");
  try {
    const raw = await callLlmAsJson<unknown>(
      [
        { role: "system", content: instruction },
        { role: "user", content: `问题：${title}\n签名：${signature}\n证据：\n${corpus}` },
      ],
      config,
      { temperature: 0, maxTokens: 700 },
    );
    let note = groundIssueNote(raw, corpus);
    if (!note.grounded && budget.calls < CALL_CAP) {
      budget.calls += 1;
      const retry = await callLlmAsJson<unknown>(
        [
          { role: "system", content: instruction },
          {
            role: "user",
            content: `上次作废：${note.caused}\n请按格式重写一条。\n问题：${title}\n证据：\n${corpus}`,
          },
        ],
        config,
        { temperature: 0, maxTokens: 700 },
      );
      note = groundIssueNote(retry, corpus);
    }
    if (note.grounded && note.action) return note;
    const fallback = fallbackFix(corpus);
    if (fallback) {
      return { ...fallback, modelError: `${note.caused}。下面的动作按该 span 的字段原值写成。` };
    }
    return note;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const modelError = /402|insufficient[_\s-]*balance/i.test(message)
      ? `裁判模型 ${config.model} 余额不足，下面的动作按该 span 的字段原值写成。`
      : `裁判模型没有返回可用结论，下面的动作按该 span 的字段原值写成。`;
    const fallback = fallbackFix(corpus);
    if (fallback) return { ...fallback, modelError };
    return {
      sessionId: "",
      spanId: "",
      field: "",
      observed: "",
      action: "",
      verify: "",
      where: "",
      caused: modelError,
      basis: "",
      layer: "insufficient",
      grounded: false,
      modelError,
    };
  }
}
