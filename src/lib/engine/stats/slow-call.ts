import type { PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

type Db = PrismaClient;

/** 慢调用只跟同一个模型的 LLM 调用比。工具 span 和别的模型不进这条基线。 */
const OUTLIER_RATIO = 2;

export interface SlowSpanView {
  id: string;
  sessionId: string;
  name: string;
  kind: string;
  duration: number;
  status: string;
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkMs: number;
  replyMs: number;
  /** 该模型自身的 LLM 调用 P95（ms） */
  baselineMs: number;
  baselineCount: number;
  /** duration / 该模型自身 P95 */
  ratio: number;
}

export interface SlowCallIssue {
  id: "slow-span";
  severity: "warning" | "info";
  kind: "slow_span";
  title: string;
  /** 点明组件、配置项、数据 span 或这次判断 */
  conclusion: string;
  evidence: string[];
  suggestion: string;
  field: string;
  observed: string;
  verify: string;
  links: { sessionId: string; label: string; spanId?: string }[];
}

export interface ModelBaseline {
  model: string;
  p95Duration: number;
  sampleCount: number;
}

export interface SlowCallReport {
  baselines: ModelBaseline[];
  /** 没有任何模型调用达到自身 P95 的 2 倍时为空 */
  issue: SlowCallIssue | null;
  /** 每个模型最慢的一次，已按模型自己的 P95 算倍数 */
  spans: SlowSpanView[];
  /** 给裁判模型的证据。结论里的依据必须是这里的连续子串。 */
  corpus: string;
}

interface SlowFact {
  id: string;
  sessionId: string;
  name: string;
  kind: string;
  duration: number;
  status: string;
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  thinkMs: number;
  replyMs: number;
  inputHead: string;
  outputChars: number;
  error: string;
  modelP95: number;
  modelSamples: number;
}

const OUTPUT_CAPS = new Set([1024, 2048, 4096, 8192, 16384, 32768, 65536]);
const QUOTA_RE = /402|429|quota|insufficient[_\s-]*balance|余额|额度不足|rate limit/i;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function callKey(span: SlowFact): string {
  return [span.sessionId, Math.round(span.duration / 1000), span.inputTokens, span.outputTokens, span.model].join("\0");
}

/** 同一次模型调用会写成「LLM 思考」和「最终回答」两条，耗时和 token 相同。 */
export function groupSlowFacts(spans: SlowFact[]): { primary: SlowFact; names: string[] }[] {
  const groups = new Map<string, SlowFact[]>();
  for (const span of spans) {
    const key = callKey(span);
    const list = groups.get(key);
    if (list) list.push(span);
    else groups.set(key, [span]);
  }
  return [...groups.values()].map((members) => ({
    primary: members.reduce((best, item) => (item.inputHead.length > best.inputHead.length ? item : best)),
    names: [...new Set(members.map((item) => item.name).filter(Boolean))],
  }));
}

function ratioOf(span: SlowFact): number {
  return span.modelP95 > 0 ? span.duration / span.modelP95 : 0;
}

export function describeSlowCall(spans: SlowFact[]): SlowCallReport | null {
  const usable = spans.filter((span) => span.model && span.modelP95 > 0 && span.duration > 0);
  if (usable.length === 0) return null;
  const groups = groupSlowFacts(usable);
  const worstByModel = new Map<string, { primary: SlowFact; names: string[] }>();
  for (const group of groups) {
    const prev = worstByModel.get(group.primary.model);
    if (!prev || group.primary.duration > prev.primary.duration) worstByModel.set(group.primary.model, group);
  }
  const rows = [...worstByModel.values()].sort((a, b) => ratioOf(b.primary) - ratioOf(a.primary));
  const baselines = [...worstByModel.values()].map((group) => ({
    model: group.primary.model,
    p95Duration: group.primary.modelP95,
    sampleCount: group.primary.modelSamples,
  }));
  const views = rows.map((group) => toView(group));
  const outlier = rows.find((group) => ratioOf(group.primary) >= OUTLIER_RATIO);
  if (!outlier) {
    return { baselines, issue: null, spans: views, corpus: "" };
  }
  const built = buildIssue(outlier);
  return { baselines, issue: built.issue, spans: views, corpus: built.corpus };
}

function toView(group: { primary: SlowFact; names: string[] }): SlowSpanView {
  const span = group.primary;
  return {
    id: span.id,
    sessionId: span.sessionId,
    name: group.names.join(" / ") || span.name,
    kind: span.kind,
    duration: span.duration,
    status: span.status,
    at: span.at,
    model: span.model,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    thinkMs: span.thinkMs,
    replyMs: span.replyMs,
    baselineMs: span.modelP95,
    baselineCount: span.modelSamples,
    ratio: ratioOf(span),
  };
}

function buildIssue(group: { primary: SlowFact; names: string[] }): { issue: SlowCallIssue; corpus: string } {
  const span = group.primary;
  const ratio = ratioOf(span);
  const who = span.model;
  const hitCap = OUTPUT_CAPS.has(span.outputTokens) && span.replyMs > Math.max(span.thinkMs, 1) * 3;
  const quota = QUOTA_RE.exec(span.error)?.[0] || "";
  const field = quota ? "error" : hitCap ? "outputTokens" : "model";
  const observed = quota ? clip(span.error, 80) : hitCap ? String(span.outputTokens) : who;
  const record = [
    `sessionId: ${span.sessionId}`,
    `spanId: ${span.id}`,
    `字段: model=${who}`,
    `字段: outputTokens=${span.outputTokens}`,
    `字段: inputTokens=${span.inputTokens}`,
    `字段: llmThinkDuration=${span.thinkMs}`,
    `字段: agentReplyDuration=${span.replyMs}`,
    `字段: output.length=${span.outputChars}`,
    `字段: modelP95=${span.modelP95}`,
    `字段: modelSamples=${span.modelSamples}`,
    span.inputHead ? `字段: input=${span.inputHead}` : "字段: input=",
    span.error ? `字段: error=${clip(span.error, 120)}` : "字段: error=",
  ].join("\n");
  const evidence = [
    `sessionId: ${span.sessionId}`,
    `spanId: ${span.id}`,
    `组件 model=${who}，这次耗时 ${fmtDuration(span.duration)}，状态 ${span.status}`,
    `${who} 自身 P95 = ${fmtDuration(span.modelP95)}（该模型 ${span.modelSamples} 次 LLM 调用），这次是自身的 ${ratio.toFixed(1)} 倍`,
    `思考 ${fmtDuration(span.thinkMs)}，回复生成 ${fmtDuration(span.replyMs)}`,
    `输入 ${span.inputTokens} token，输出 ${span.outputTokens} token，缓存读 ${span.cacheReadTokens} token`,
    group.names.length > 1 ? `同一次调用被记成了 ${group.names.join("、")}` : "",
    span.outputChars === 0 ? "生成正文没有入库" : `生成正文 ${span.outputChars} 字`,
    span.inputHead ? `输入开头：${span.inputHead}` : "这次没有采到输入正文",
    span.error ? `错误：${clip(span.error, 120)}` : "",
  ].filter(Boolean);

  const conclusion = quota
    ? `落在配置项 model=${who} 的额度。数据 span ${span.id} 的 error 含「${quota}」，这次耗时是 ${who} 自身 P95 ${fmtDuration(span.modelP95)}（${span.modelSamples} 次）的 ${ratio.toFixed(1)} 倍。`
    : hitCap
      ? `落在配置项 outputTokens=${span.outputTokens}。组件 model=${who}，数据 span ${span.id} 耗时 ${fmtDuration(span.duration)}，是该模型自身 P95 ${fmtDuration(span.modelP95)}（${span.modelSamples} 次 LLM 调用）的 ${ratio.toFixed(1)} 倍，生成正文 ${span.outputChars} 字。`
      : `落在组件 model=${who}。数据 span ${span.id} 耗时 ${fmtDuration(span.duration)}，是该模型自身 P95 ${fmtDuration(span.modelP95)}（${span.modelSamples} 次 LLM 调用）的 ${ratio.toFixed(1)} 倍。`;

  const suggestion = quota
    ? `把 span ${span.id} 的 model 从 ${who} 换成仍有额度的模型。error 当前是 ${clip(span.error, 80)}。`
    : hitCap
      ? `把 span ${span.id} 的 outputTokens 从 ${span.outputTokens} 下调：这次请求的 max_tokens 改为小于 ${span.outputTokens}。`
      : `先看 span ${span.id} 的 model=${who}。这次 ${fmtDuration(span.duration)} 已经是 ${who} 自身 P95 的 ${ratio.toFixed(1)} 倍。`;

  const verify = `再打开 span ${span.id}，对照 ${who} 自身 P95，字段 ${field} 不再是 ${observed}。`;

  return {
    corpus: [record, ...evidence, conclusion, suggestion].join("\n"),
    issue: {
      id: "slow-span",
      severity: "warning",
      kind: "slow_span",
      title: `${who} ${fmtDuration(span.duration)}，是 ${who} 自身 P95 的 ${ratio.toFixed(1)} 倍`,
      conclusion,
      evidence,
      suggestion,
      field,
      observed,
      verify,
      links: [
        {
          sessionId: span.sessionId,
          spanId: span.id,
          label: group.names.length > 1 ? group.names.join(" / ") : span.name,
        },
      ],
    },
  };
}

export async function loadSlowCallReport(db: Db, agentId: string, startMs: number): Promise<SlowCallReport | null> {
  const baselineRows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH calls AS (
      SELECT sp.model AS model, sp.duration AS v
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId}
        AND s.startTime >= ${startMs}
        AND sp.duration > 0
        AND sp.kind = 'llm_thinking'
        AND sp.model IS NOT NULL
        AND sp.model != ''
    ),
    ranked AS (
      SELECT model, v,
             ROW_NUMBER() OVER (PARTITION BY model ORDER BY v) AS rn,
             COUNT(*) OVER (PARTITION BY model) AS cnt
      FROM calls
    )
    SELECT model AS model,
           MAX(cnt) AS cnt,
           CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95
    FROM ranked
    GROUP BY model
  `;
  const baselines = new Map<string, { p95: number; count: number }>();
  for (const raw of baselineRows) {
    const row = normalizeRow(raw);
    const model = String(row.model || "");
    const p95 = Number(row.p95) || 0;
    if (!model || p95 <= 0) continue;
    baselines.set(model, { p95, count: Number(row.cnt) || 0 });
  }
  if (baselines.size === 0) return null;

  const rawRows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH marked AS (
      SELECT sp.id AS id, sp.sessionId AS sessionId, sp.name AS name, sp.kind AS kind,
             sp.duration AS duration, sp.status AS status, sp.createdAt AS createdAt,
             sp.model AS model,
             sp.inputTokens AS inputTokens, sp.outputTokens AS outputTokens,
             sp.cacheReadTokens AS cacheReadTokens,
             COALESCE(sp.llmThinkDuration, 0) AS thinkMs,
             COALESCE(sp.agentReplyDuration, 0) AS replyMs,
             substr(COALESCE(sp.input, ''), 1, 160) AS inputHead,
             length(COALESCE(sp.output, '')) AS outputChars,
             substr(COALESCE(sp.error, ''), 1, 160) AS error,
             ROW_NUMBER() OVER (PARTITION BY sp.model ORDER BY sp.duration DESC) AS rn
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId}
        AND s.startTime >= ${startMs}
        AND sp.duration > 0
        AND sp.kind IN ('llm_thinking', 'answer')
        AND sp.model IS NOT NULL
        AND sp.model != ''
    )
    SELECT * FROM marked WHERE rn <= 4
  `;

  const spans = rawRows.map((raw) => {
    const row = normalizeRow(raw);
    const model = String(row.model || "");
    const baseline = baselines.get(model);
    const atMs = Number(row.createdAt) || 0;
    return {
      id: String(row.id),
      sessionId: String(row.sessionId),
      name: String(row.name || "(未命名)"),
      kind: String(row.kind),
      duration: Number(row.duration),
      status: String(row.status),
      at: atMs > 0 ? new Date(atMs).toISOString() : "",
      model,
      inputTokens: Number(row.inputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      cacheReadTokens: Number(row.cacheReadTokens) || 0,
      thinkMs: Number(row.thinkMs) || 0,
      replyMs: Number(row.replyMs) || 0,
      inputHead: clip(String(raw.inputHead ?? row.inputHead ?? ""), 80),
      outputChars: Number(row.outputChars) || 0,
      error: String(raw.error ?? row.error ?? ""),
      modelP95: baseline?.p95 ?? 0,
      modelSamples: baseline?.count ?? 0,
    };
  });
  return describeSlowCall(spans);
}
