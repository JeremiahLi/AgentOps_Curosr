import { computeOutcome } from "./derive";
import { normalizeError } from "./normalize-error";
import { NO_ERROR_TEXT, compareSpanOrder, isFailedStatus, normalizeSpanRecord } from "./span-record";

/** 证据包里单段文本的上限，避免一条会话的事实把详情接口撑满 */
const EVIDENCE_LIMIT = 500;

export type FindingKind =
  | "recovered"
  | "unrecovered"
  | "loop"
  | "model_failure"
  | "answer_failure"
  | "no_delivery";

export interface FindingEvidence {
  /** 首条用户原话 */
  userText: string;
  /** 这条事实对应的 span；未交付且没有任何回答时为空串 */
  spanId: string;
  spanName: string;
  /** 失败 span 的入参（回答失败时是该回答的输出） */
  input: string;
  /** 原始错误摘要，不是归一化后的签名 */
  errorSummary: string;
  /** 紧挨着的前一条模型输出；父 span 是 llm_thinking 时优先用父 span */
  precedingModelOutput: string;
  recovered: boolean;
}

export interface SessionFinding {
  kind: FindingKind;
  /** 未恢复、循环、模型失败、回答失败、未交付进入后续根因；已恢复只作背景 */
  candidate: boolean;
  /** tool:{name}|err:{normalized} / llm|err:… / answer|err:… / session|no_delivery */
  signature: string;
  /** 同一签名在恢复前连续出现的次数。循环 ≥ 2 */
  repeatCount: number;
  spanIds: string[];
  recovered: boolean;
  evidence: FindingEvidence;
}

export interface SessionFacts {
  findings: SessionFinding[];
  /** findings 里 candidate 的稳定子集，顺序与 findings 一致 */
  candidates: SessionFinding[];
  recoveredCount: number;
  hasAnomaly: boolean;
}

export interface FactSpan {
  id: string;
  kind?: string | null;
  name?: string | null;
  status?: string | null;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  details?: string | null;
  content?: string | null;
  roundIndex?: number | null;
  turnId?: number | null;
  parentId?: string | null;
  branchId?: string | null;
  isError?: boolean;
}

interface PreparedSpan {
  id: string;
  kind: string;
  name: string;
  status: string;
  input: string;
  output: string;
  error: string;
  details: string;
  content: string;
  roundIndex: number;
  turnId: number;
  parentId: string | null;
  branchId: string | null;
  failed: boolean;
}

function clip(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= EVIDENCE_LIMIT) return text;
  return text.slice(0, EVIDENCE_LIMIT) + "…";
}

function isToolKind(kind: string): boolean {
  return kind === "tool_call" || kind === "command";
}

function modelText(span: PreparedSpan): string {
  return span.output || span.content || span.details || "";
}

function prepare(spans: FactSpan[]): PreparedSpan[] {
  const prepared = spans.map((span) => {
    const norm = normalizeSpanRecord(span);
    return {
      id: span.id,
      kind: span.kind || "",
      name: span.name || "",
      status: norm.status,
      input: span.input || "",
      output: span.output || "",
      error: norm.error || "",
      details: span.details || "",
      content: span.content || "",
      roundIndex: span.roundIndex ?? 0,
      turnId: span.turnId ?? 0,
      parentId: span.parentId || null,
      branchId: span.branchId || null,
      failed: isFailedStatus(norm.status),
    };
  });
  prepared.sort(compareSpanOrder);
  return prepared;
}

function signatureOf(kind: "tool" | "llm" | "answer" | "span", name: string, error: string): string {
  const pattern = normalizeError(error) || NO_ERROR_TEXT;
  if (kind === "tool") return `tool:${name || "(unnamed)"}|err:${pattern}`;
  if (kind === "llm") return `llm|err:${pattern}`;
  if (kind === "answer") return `answer|err:${pattern}`;
  return `span:${name || kind}|err:${pattern}`;
}

function scopeOf(span: PreparedSpan): string {
  return span.branchId ?? "";
}

/**
 * 从一次运行的 span 列出过程事实。
 *
 * 工具失败按「同一分支、同一工具名」成串：中间的模型输出不会把串打断，
 * 同名工具成功或换成另一种错误才会结束这一串。
 * 串长 ≥ 2 记为循环（进入根因，即便最后一次被补救）；
 * 串长 = 1 且之后有同名成功记为已恢复；否则记为未恢复。
 */
export function analyzeSessionFacts(spans: FactSpan[]): SessionFacts {
  const ordered = prepare(spans);
  const byId = new Map(ordered.map((span) => [span.id, span]));
  const userText = clip(
    ordered.find((span) => (span.kind === "user" || span.kind === "input") && span.input)?.input || "",
  );

  const findings: Array<SessionFinding & { order: number }> = [];

  function precedingModelOutput(span: PreparedSpan): string {
    if (span.parentId) {
      const parent = byId.get(span.parentId);
      if (parent && parent.kind === "llm_thinking") return clip(modelText(parent));
    }
    const scope = scopeOf(span);
    const index = ordered.indexOf(span);
    for (let i = index - 1; i >= 0; i--) {
      const prev = ordered[i];
      if (scopeOf(prev) !== scope) continue;
      if (prev.kind === "llm_thinking") return clip(modelText(prev));
    }
    return "";
  }

  function evidenceFor(span: PreparedSpan, recovered: boolean, errorSummary: string, input: string): FindingEvidence {
    return {
      userText,
      spanId: span.id,
      spanName: span.name,
      input: clip(input),
      errorSummary: clip(errorSummary),
      precedingModelOutput: precedingModelOutput(span),
      recovered,
    };
  }

  interface OpenStreak {
    signature: string;
    spans: PreparedSpan[];
    order: number;
  }
  const open = new Map<string, OpenStreak>();

  function emitStreak(streak: OpenStreak, recovered: boolean) {
    const head = streak.spans[0];
    const loop = streak.spans.length >= 2;
    const kind: FindingKind = loop ? "loop" : recovered ? "recovered" : "unrecovered";
    findings.push({
      kind,
      candidate: kind !== "recovered",
      signature: streak.signature,
      repeatCount: streak.spans.length,
      spanIds: streak.spans.map((span) => span.id),
      recovered,
      evidence: evidenceFor(head, recovered, head.error, head.input),
      order: streak.order,
    });
  }

  function flush(toolName: string, scope: string, recovered: boolean) {
    const key = `${scope}\0${toolName}`;
    const streak = open.get(key);
    if (!streak) return;
    open.delete(key);
    emitStreak(streak, recovered);
  }

  ordered.forEach((span, index) => {
    if (isToolKind(span.kind)) {
      if (span.failed) {
        const signature = signatureOf("tool", span.name, span.error);
        const key = `${scopeOf(span)}\0${span.name}`;
        const current = open.get(key);
        if (current && current.signature === signature) {
          current.spans.push(span);
        } else {
          flush(span.name, scopeOf(span), false);
          open.set(key, { signature, spans: [span], order: index });
        }
      } else {
        flush(span.name, scopeOf(span), true);
      }
      return;
    }

    if (!span.failed) return;

    if (span.kind === "llm_thinking") {
      findings.push({
        kind: "model_failure",
        candidate: true,
        signature: signatureOf("llm", span.name, span.error),
        repeatCount: 1,
        spanIds: [span.id],
        recovered: false,
        evidence: evidenceFor(span, false, span.error, span.input),
        order: index,
      });
      return;
    }

    if (span.kind === "answer") {
      findings.push({
        kind: "answer_failure",
        candidate: true,
        signature: signatureOf("answer", span.name, span.error),
        repeatCount: 1,
        spanIds: [span.id],
        recovered: false,
        evidence: evidenceFor(span, false, span.error, span.output || span.input),
        order: index,
      });
      return;
    }

    findings.push({
      kind: "unrecovered",
      candidate: true,
      signature: signatureOf("span", `${span.kind}:${span.name}`, span.error),
      repeatCount: 1,
      spanIds: [span.id],
      recovered: false,
      evidence: evidenceFor(span, false, span.error, span.input),
      order: index,
    });
  });

  for (const key of [...open.keys()]) {
    const sep = key.indexOf("\0");
    flush(key.slice(sep + 1), key.slice(0, sep), false);
  }

  const outcome = computeOutcome(
    ordered.map((span) => ({
      kind: span.kind,
      name: span.name,
      status: span.status,
      input: span.input,
      output: span.output,
      roundIndex: span.roundIndex,
      turnId: span.turnId,
    })),
  );

  if (outcome.outcome === "failed") {
    const answers = ordered.filter((span) => span.kind === "answer");
    const last = answers[answers.length - 1];
    const summary = !last
      ? "没有任何回答"
      : last.failed
        ? last.error || NO_ERROR_TEXT
        : "末条回答没有输出";
    findings.push({
      kind: "no_delivery",
      candidate: true,
      signature: "session|no_delivery",
      repeatCount: 1,
      spanIds: last ? [last.id] : [],
      recovered: false,
      evidence: {
        userText,
        spanId: last?.id ?? "",
        spanName: last?.name || "answer",
        input: clip(last ? last.output || last.input : ""),
        errorSummary: clip(summary),
        precedingModelOutput: last ? precedingModelOutput(last) : "",
        recovered: false,
      },
      order: last ? ordered.indexOf(last) : ordered.length,
    });
  }

  findings.sort((a, b) => a.order - b.order || a.signature.localeCompare(b.signature));
  const listed = findings.map(({ order: _order, ...finding }) => finding);
  const candidates = listed.filter((finding) => finding.candidate);
  return {
    findings: listed,
    candidates,
    recoveredCount: listed.filter((finding) => finding.kind === "recovered").length,
    hasAnomaly: candidates.length > 0,
  };
}
