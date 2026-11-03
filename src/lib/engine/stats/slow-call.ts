import type { PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

type Db = PrismaClient;

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
}

export interface SlowCallIssue {
  id: "slow-span";
  severity: "warning" | "info";
  kind: "slow_span";
  title: string;
  evidence: string[];
  suggestion: string;
  links: { sessionId: string; label: string; spanId?: string }[];
}

export interface SlowCallReport {
  p95Duration: number;
  sampleCount: number;
  issue: SlowCallIssue;
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
}

const OUTPUT_CAPS = new Set([1024, 2048, 4096, 8192, 16384, 32768, 65536]);

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

export function describeSlowCall(
  spans: SlowFact[],
  p95Duration: number,
  sampleCount: number,
  aboveCount: number,
): SlowCallReport | null {
  if (p95Duration <= 0 || spans.length === 0) return null;
  const groups = groupSlowFacts(spans);
  const worst = groups[0];
  if (!worst) return null;
  const span = worst.primary;
  const ratio = span.duration / p95Duration;
  const who = span.model || span.name;
  const record = [
    `sessionId: ${span.sessionId}`,
    `spanId: ${span.id}`,
    `字段: model=${who}`,
    `字段: outputTokens=${span.outputTokens}`,
    `字段: inputTokens=${span.inputTokens}`,
    `字段: llmThinkDuration=${span.thinkMs}`,
    `字段: agentReplyDuration=${span.replyMs}`,
    `字段: output.length=${span.outputChars}`,
    span.inputHead ? `字段: input=${span.inputHead}` : "字段: input=",
    span.error ? `字段: error=${clip(span.error, 120)}` : "字段: error=",
  ].join("\n");
  const evidence = [
    `sessionId: ${span.sessionId}`,
    `spanId: ${span.id}`,
    `最慢一次是 ${who}，耗时 ${fmtDuration(span.duration)}，状态 ${span.status}`,
    `思考 ${fmtDuration(span.thinkMs)}，回复生成 ${fmtDuration(span.replyMs)}`,
    `输入 ${span.inputTokens} token，输出 ${span.outputTokens} token，缓存读 ${span.cacheReadTokens} token`,
    worst.names.length > 1 ? `同一次调用被记成了 ${worst.names.join("、")}` : "",
    span.outputChars === 0 ? "生成正文没有入库" : `生成正文 ${span.outputChars} 字`,
    span.inputHead ? `输入开头：${span.inputHead}` : "这次没有采到输入正文",
    span.error ? `错误：${clip(span.error, 120)}` : "",
    `span 耗时 P95 = ${fmtDuration(p95Duration)}（样本 ${sampleCount} 个），超过 P95 的 span 有 ${aboveCount} 条，去重后 ${groups.length} 次调用`,
  ].filter(Boolean);

  const hitCap = OUTPUT_CAPS.has(span.outputTokens) && span.replyMs > Math.max(span.thinkMs, 1) * 3;
  const suggestion = hitCap
    ? `把 span ${span.id} 的 outputTokens 从 ${span.outputTokens} 下调：这次请求的 max_tokens 改为小于 ${span.outputTokens}。`
    : span.kind === "tool_call" || span.kind === "command"
      ? `修改 span ${span.id} 的入参。这次慢的是 ${span.name}，耗时 ${fmtDuration(span.duration)}。`
      : `先看 span ${span.id} 的 model=${who}，输入 ${span.inputTokens} token，回复用了 ${fmtDuration(span.replyMs || span.duration)}。`;

  return {
    p95Duration,
    sampleCount,
    corpus: [record, ...evidence, suggestion].join("\n"),
    issue: {
      id: "slow-span",
      severity: ratio >= 2 ? "warning" : "info",
      kind: "slow_span",
      title: `${who} ${fmtDuration(span.duration)}，是 P95 的 ${ratio.toFixed(1)} 倍`,
      evidence,
      suggestion,
      links: [
        {
          sessionId: span.sessionId,
          spanId: span.id,
          label: worst.names.length > 1 ? worst.names.join(" / ") : span.name,
        },
      ],
    },
    spans: groups.slice(0, 10).map((group) => ({
      id: group.primary.id,
      sessionId: group.primary.sessionId,
      name: group.names.join(" / ") || group.primary.name,
      kind: group.primary.kind,
      duration: group.primary.duration,
      status: group.primary.status,
      at: group.primary.at,
      model: group.primary.model,
      inputTokens: group.primary.inputTokens,
      outputTokens: group.primary.outputTokens,
      thinkMs: group.primary.thinkMs,
      replyMs: group.primary.replyMs,
    })),
  };
}

export async function loadSlowCallReport(db: Db, agentId: string, startMs: number): Promise<SlowCallReport | null> {
  const p95Rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH ranked AS (
      SELECT sp.duration AS v,
             ROW_NUMBER() OVER (ORDER BY sp.duration) AS rn,
             COUNT(*) OVER () AS cnt
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.duration > 0
    )
    SELECT MAX(cnt) AS cnt,
           CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95
    FROM ranked
  `;
  const p95 = p95Rows.length > 0 ? normalizeRow(p95Rows[0]) : null;
  const p95Duration = Number(p95?.p95 ?? 0);
  const sampleCount = Number(p95?.cnt ?? 0);
  if (p95Duration <= 0) return null;

  const [rawRows, countRows] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.id AS id, sp.sessionId AS sessionId, sp.name AS name, sp.kind AS kind,
             sp.duration AS duration, sp.status AS status, sp.createdAt AS createdAt,
             COALESCE(sp.model, '') AS model,
             sp.inputTokens AS inputTokens, sp.outputTokens AS outputTokens,
             sp.cacheReadTokens AS cacheReadTokens,
             COALESCE(sp.llmThinkDuration, 0) AS thinkMs,
             COALESCE(sp.agentReplyDuration, 0) AS replyMs,
             substr(COALESCE(sp.input, ''), 1, 160) AS inputHead,
             length(COALESCE(sp.output, '')) AS outputChars,
             substr(COALESCE(sp.error, ''), 1, 160) AS error
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.duration > ${p95Duration}
      ORDER BY sp.duration DESC
      LIMIT 24
    `,
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS cnt
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.duration > ${p95Duration}
    `,
  ]);

  const spans = rawRows.map((raw) => {
    const row = normalizeRow(raw);
    const atMs = Number(row.createdAt) || 0;
    return {
      id: String(row.id),
      sessionId: String(row.sessionId),
      name: String(row.name || "(未命名)"),
      kind: String(row.kind),
      duration: Number(row.duration),
      status: String(row.status),
      at: atMs > 0 ? new Date(atMs).toISOString() : "",
      model: String(row.model || ""),
      inputTokens: Number(row.inputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      cacheReadTokens: Number(row.cacheReadTokens) || 0,
      thinkMs: Number(row.thinkMs) || 0,
      replyMs: Number(row.replyMs) || 0,
      inputHead: clip(String(raw.inputHead ?? row.inputHead ?? ""), 80),
      outputChars: Number(row.outputChars) || 0,
      error: String(raw.error ?? row.error ?? ""),
    };
  });
  const aboveCount = Number(normalizeRow(countRows[0] ?? {}).cnt ?? spans.length);
  return describeSlowCall(spans, p95Duration, sampleCount, aboveCount);
}
