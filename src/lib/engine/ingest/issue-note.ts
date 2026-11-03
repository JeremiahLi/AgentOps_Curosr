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
  /**
   * 一句话结论。点明组件、配置项、数据 span 或这次判断，并带上 spanId。
   * 界面上会加「结论：」前缀。
   */
  conclusion: string;
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
const NOTE_VERSION = "conclusion-v4";
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
    conclusion: caused,
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
  const conclusion = spanId
    ? `落在数据 span ${spanId} 的字段 error=${observed}。这条失败没有失败原因原文。`
    : `落在数据字段 error=${observed}。证据里没有 spanId，先把失败 span 采上来。`;
  return {
    sessionId,
    spanId,
    field: "error",
    observed,
    conclusion,
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
  const modelConclusion = text(record.conclusion).slice(0, 400);
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

  const grain = /组件|配置项|数据|判断/.test(modelConclusion) && modelConclusion.includes(spanId);
  const conclusion = grain
    ? modelConclusion
    : `落在数据 span ${spanId} 的字段 ${field}=${observed}。`;
  return {
    sessionId,
    spanId,
    field,
    observed,
    conclusion,
    action,
    verify,
    layer: resolvedLayer,
    grounded: true,
    caused: action,
    where: observed,
    basis: field,
  };
}

export interface RecordedSpan {
  sessionId: string;
  spanId: string;
  kind: string;
  name: string;
  model: string;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  outputChars: number;
  error: string;
}

const QUOTA_RE = /402|429|quota|insufficient[_\s-]*balance|余额|额度不足|rate limit/i;

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

function isEmptyRecord(span: RecordedSpan): boolean {
  return span.duration < 1000 && span.inputTokens === 0 && span.outputTokens === 0 && span.outputChars === 0;
}

function missingText(error: string): boolean {
  const textValue = error.trim();
  return !textValue || textValue === NO_ERROR_TEXT;
}

/**
 * 用 span 上已经测到的字段写结论。
 * 额度只在 error 原文出现 402 / quota / 余额时才写。空记录和零 token 的调用分开说。
 */
export function explainRecordedIssue(spans: RecordedSpan[]): IssueNote | null {
  const facts = spans.filter((span) => span.spanId);
  if (facts.length === 0) return null;

  const quota = facts.find((span) => QUOTA_RE.test(span.error));
  if (quota) {
    const observed = quota.error.replace(/\s+/g, " ").trim().slice(0, 80);
    const model = quota.model || "空";
    const action = `把 span ${quota.spanId} 的 model 从 ${model} 换成仍有额度的模型。error 当前是 ${observed}。`;
    return {
      sessionId: quota.sessionId,
      spanId: quota.spanId,
      field: "error",
      observed,
      conclusion: `落在配置项 model=${model} 的额度。数据 span ${quota.spanId} 的 error 含「${QUOTA_RE.exec(quota.error)?.[0] || observed}」。`,
      action,
      verify: `再打开 span ${quota.spanId}，error 里不再出现这段额度原文。`,
      layer: "env",
      grounded: true,
      caused: action,
      where: observed,
      basis: "error",
    };
  }

  const empty = facts.filter(isEmptyRecord);
  const real = facts.filter((span) => !isEmptyRecord(span));
  const allMissing = facts.every((span) => missingText(span.error));

  if (allMissing && real.length === 0) {
    const sample = empty[0];
    const models = [...new Set(empty.map((span) => span.model).filter(Boolean))];
    const observed = sample.error.trim() || NO_ERROR_TEXT;
    const modelList = models.length > 0 ? models.join("、") : "空";
    const action = `把 span ${sample.spanId} 从失败回答里去掉，或把它的 error 写成真实失败原因。当前 error=${observed}，duration=${sample.duration}ms，inputTokens=0，outputTokens=0。`;
    return {
      sessionId: sample.sessionId,
      spanId: sample.spanId,
      field: "error",
      observed,
      conclusion: `落在数据 span ${sample.spanId}：duration=${sample.duration}ms，inputTokens=0，outputTokens=0，output 为空，配置项 model=${sample.model || "空"}。同组 ${empty.length} 条都是这样的空记录，模型是 ${modelList}。error、output 里没有 402、quota、余额。`,
      action,
      verify: `再打开 span ${sample.spanId}，它不再被记成失败回答，或 error 不再是 ${observed}。`,
      layer: "insufficient",
      grounded: true,
      caused: action,
      where: observed,
      basis: "error",
    };
  }

  if (allMissing && real.length > 0) {
    const sample = [...real].sort((a, b) => b.duration - a.duration)[0];
    const observed = sample.error.trim() || NO_ERROR_TEXT;
    const model = sample.model || "空";
    const shell = empty[0];
    const shellModels = [...new Set(empty.map((span) => span.model).filter(Boolean))];
    const shellText = shell
      ? `另外 ${empty.length} 条是空记录，模型是 ${shellModels.join("、") || "空"}，例如 span ${shell.spanId}（duration=${shell.duration}ms）。`
      : "";
    const action = `把 span ${sample.spanId} 的 error 写成这次调用返回的失败原因。当前是 ${observed}。`;
    return {
      sessionId: sample.sessionId,
      spanId: sample.spanId,
      field: "error",
      observed,
      conclusion: `落在组件 model=${model} 的这次判断。数据 span ${sample.spanId}：耗时 ${fmtMs(sample.duration)}，inputTokens=${sample.inputTokens}，outputTokens=${sample.outputTokens}，output ${sample.outputChars} 字，error=${observed}。${shellText}error、output 里没有 402、quota、余额。`,
      action,
      verify: `再打开 span ${sample.spanId}，error 不再是 ${observed}。`,
      layer: "env",
      grounded: true,
      caused: action,
      where: observed,
      basis: "model",
    };
  }

  const sample = facts.find((span) => !missingText(span.error)) ?? facts[0];
  const observed = sample.error.replace(/\s+/g, " ").trim().slice(0, 120);
  const component = sample.kind === "tool_call" || sample.kind === "command" ? sample.name || "工具" : sample.model || sample.name || "span";
  const action = `修改 span ${sample.spanId} 里触发这段 error 的入参。error 当前是 ${observed}。`;
  return {
    sessionId: sample.sessionId,
    spanId: sample.spanId,
    field: "error",
    observed,
    conclusion: `落在组件 ${component}。数据 span ${sample.spanId} 的 error=${observed}。这次判断失败对应的就是这段原文。`,
    action,
    verify: `再打开 span ${sample.spanId}，error 不再是这段原文。`,
    layer: sample.kind === "tool_call" || sample.kind === "command" ? "tool" : "env",
    grounded: true,
    caused: action,
    where: observed,
    basis: "error",
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
    const model = corpus.match(/字段:\s*model=([^\n]*)/)?.[1]?.trim() || "";
    return {
      sessionId,
      spanId,
      field: "outputTokens",
      observed: outputTokens,
      conclusion: `落在配置项 outputTokens=${outputTokens}。数据 span ${spanId}${model ? `，组件 model=${model}` : ""}。这次请求的 max_tokens 打满了这个值。`,
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
    if (!record.action || !record.spanId || !record.field || !record.conclusion) return null;
    return {
      sessionId: record.sessionId || "",
      spanId: record.spanId,
      field: record.field,
      observed: record.observed || "",
      conclusion: record.conclusion,
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
