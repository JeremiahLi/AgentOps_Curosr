import { createHash } from "node:crypto";
import { NO_ERROR_TEXT } from "./span-record";

export type NoteLayer = "prompt" | "skill" | "tool" | "env" | "insufficient";

export interface IssueNote {
  sessionId: string;
  spanId: string;
  /** 证据里的字段名，例如 outputTokens、error、path */
  field: string;
  /** 该字段在证据里的原值 */
  observed: string;
  /** 可执行的一处修改，必须点名 field 和 observed */
  action: string;
  /** 改完后回到同一个 span 看哪个字段 */
  verify: string;
  layer: NoteLayer;
  grounded: boolean;
  /** 模型没有写成这条时，说明原因。空字符串表示动作来自模型。 */
  modelError?: string;
  /** 与 action 相同，留给还在读旧字段的界面 */
  caused: string;
  where: string;
  basis: string;
}

const LAYERS = new Set<NoteLayer>(["prompt", "skill", "tool", "env", "insufficient"]);
const NOTE_VERSION = "span-field-v2";
const VAGUE = /推理能力|能力不足|不够聪明|体验|优化提示词|整体优化|建议关注|需要进一步|加强一下/;
const OUTPUT_CAPS = new Set(["1024", "2048", "4096", "8192", "16384", "32768", "65536"]);

export function evidenceHash(signature: string, corpus: string): string {
  return createHash("sha256").update(`${NOTE_VERSION}\n${signature}\n${corpus}`).digest("hex").slice(0, 32);
}

export function isMissingErrorSignature(signature: string): boolean {
  return signature.includes(NO_ERROR_TEXT);
}

function blank(caused: string, grounded: boolean): IssueNote {
  return {
    sessionId: "",
    spanId: "",
    field: "",
    observed: "",
    action: "",
    verify: "",
    layer: "insufficient",
    grounded,
    caused,
    where: "",
    basis: "",
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function idsOf(corpus: string, label: "sessionId" | "spanId"): string[] {
  return [...corpus.matchAll(new RegExp(`${label}:\\s*(\\S+)`, "g"))].map((match) => match[1]);
}

/** 失败 span 没有 error 时，修复动作就是把这个 span 的 error 写上。 */
export function missingErrorNote(sessionId = "", spanId = ""): IssueNote {
  const observed = NO_ERROR_TEXT;
  const action = spanId
    ? `把 span ${spanId} 的 error 写成失败原因原文，当前是 ${observed}。`
    : `失败的 error 是 ${observed}，证据里没有 spanId，先把失败 span 采上来。`;
  const verify = spanId ? `打开 span ${spanId}，error 不再是 ${observed}。` : "";
  return {
    sessionId,
    spanId,
    field: "error",
    observed,
    action,
    verify,
    layer: "insufficient",
    grounded: true,
    caused: action,
    where: observed,
    basis: "error",
  };
}

/**
 * 模型结论必须落到证据里的 sessionId、spanId、字段名和原值。
 * 动作里再出现「推理能力不足」这类还要继续推理的话，整条丢掉。
 */
export function groundIssueNote(raw: unknown, corpus: string): IssueNote {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const layer = text(record.layer);
  const resolvedLayer = LAYERS.has(layer as NoteLayer) ? (layer as NoteLayer) : "insufficient";
  const caused = text(record.caused).slice(0, 200);
  if (resolvedLayer === "insufficient") {
    return { ...blank(caused || "证据不足，无法指定要改的字段", true), layer: "insufficient" };
  }

  const sessionId = text(record.sessionId);
  const spanId = text(record.spanId);
  const field = text(record.field);
  const observed = text(record.observed);
  const action = text(record.action).slice(0, 300);
  const verify = text(record.verify).slice(0, 300);
  const sessions = idsOf(corpus, "sessionId");
  const spans = idsOf(corpus, "spanId");

  if (!sessions.includes(sessionId) || !spans.includes(spanId)) {
    return blank("模型给出的 sessionId 或 spanId 不在证据里", false);
  }
  if (!field || !observed || !corpus.includes(`字段: ${field}=`) || !corpus.includes(observed)) {
    return blank("模型点名的字段或原值对不上原文", false);
  }
  if (!action.includes(field) || !action.includes(observed) || !action.includes(spanId) || VAGUE.test(action)) {
    return blank("修复动作没有落到这个 span 的字段原值上", false);
  }
  if (!verify.includes(spanId) || !verify.includes(field)) {
    return blank("验证步骤没有回到这个 span 的同一字段", false);
  }

  return {
    sessionId,
    spanId,
    field,
    observed,
    action,
    verify,
    layer: resolvedLayer,
    grounded: true,
    caused: action,
    where: observed,
    basis: field,
  };
}

/** 模型没给出可核对的动作时，用证据里已经写明的字段做一条修复。 */
export function fallbackFix(corpus: string): IssueNote | null {
  const sessionId = idsOf(corpus, "sessionId")[0] || "";
  const spanId = idsOf(corpus, "spanId")[0] || "";
  if (!sessionId || !spanId) return null;

  const outputTokens = corpus.match(/字段:\s*outputTokens=(\d+)/)?.[1];
  if (outputTokens && OUTPUT_CAPS.has(outputTokens)) {
    const action = `把 span ${spanId} 的 outputTokens 从 ${outputTokens} 下调：这次请求的 max_tokens 改为小于 ${outputTokens}。`;
    const verify = `再看 span ${spanId} 的 outputTokens，应小于 ${outputTokens}。`;
    return {
      sessionId,
      spanId,
      field: "outputTokens",
      observed: outputTokens,
      action,
      verify,
      layer: "env",
      grounded: true,
      caused: action,
      where: outputTokens,
      basis: "outputTokens",
    };
  }

  const error = corpus.match(/字段:\s*error=([^\n]*)/)?.[1]?.trim() ?? "";
  if (!error || error === NO_ERROR_TEXT) return missingErrorNote(sessionId, spanId);
  return null;
}

export function serializeNote(note: IssueNote): string {
  return JSON.stringify(note);
}

/** 旧结论没有 session / span / 动作时视为失效，下次打开会重新生成。 */
export function readStoredNote(raw: string): IssueNote | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as IssueNote;
    if (!record || !LAYERS.has(record.layer)) return null;
    if (!record.action || !record.spanId || !record.field) return null;
    return {
      sessionId: record.sessionId || "",
      spanId: record.spanId,
      field: record.field,
      observed: record.observed || "",
      action: record.action,
      verify: record.verify || "",
      layer: record.layer,
      grounded: record.grounded !== false,
      caused: record.caused || record.action,
      where: record.where || record.observed || "",
      basis: record.basis || record.field,
      modelError: record.modelError || "",
    };
  } catch {
    return null;
  }
}
