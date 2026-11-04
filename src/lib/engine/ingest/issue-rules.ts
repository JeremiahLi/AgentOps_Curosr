import { analyzeSessionFacts, type FactSpan } from "./session-facts";
import { NO_ERROR_TEXT } from "./span-record";

/** 与 Agent 详情里原来的工具失败阈值一致：至少 5 次，且占该工具调用的 10% */
export const TOOL_FAIL_MIN_COUNT = 5;
export const TOOL_FAIL_RATE_THRESHOLD = 10;
/** 非工具错误：至少 3 次，且占该 Agent 失败 span 的 5% */
export const CLUSTER_MIN_COUNT = 3;
export const CLUSTER_MIN_SHARE = 5;

export type StoredIssueKind = "tool_failure" | "error_cluster" | "answer_wrong";
export type StoredIssueStatus = "candidate" | "open" | "confirmed" | "dismissed" | "fixed";
export type IssueSeverity = "critical" | "warning" | "info";

export interface IssueHit {
  signature: string;
  kind: StoredIssueKind;
  spanId: string;
  errorSummary: string;
}

export function toolNameOf(signature: string): string | null {
  const match = /^tool:([^|]*)\|err:/.exec(signature);
  return match ? match[1] : null;
}

export function errorPatternOf(signature: string): string {
  const idx = signature.indexOf("|err:");
  return idx >= 0 ? signature.slice(idx + 5) : signature;
}

export function issueTitle(signature: string): string {
  if (signature === "session|no_delivery") return "没有交付回答";
  if (signature.startsWith("answer|wrong:")) {
    const pattern = signature.slice("answer|wrong:".length);
    return `回答有误：${pattern || "未给出原文"}`;
  }
  const tool = toolNameOf(signature);
  if (tool) return `${tool}：${errorPatternOf(signature) || NO_ERROR_TEXT}`;
  if (signature.startsWith("llm|err:")) return `模型调用失败：${errorPatternOf(signature)}`;
  if (signature.startsWith("answer|err:")) return `回答失败：${errorPatternOf(signature)}`;
  return errorPatternOf(signature) || signature;
}

export function missingError(signature: string): boolean {
  return errorPatternOf(signature) === NO_ERROR_TEXT || signature.includes(NO_ERROR_TEXT);
}

/**
 * 这次会话要记入问题库的命中。
 * 已恢复的失败不算。有别的失败时，未交付只是后果，不单开一条。
 * 非工具失败如果和本会话某条工具失败是同一个错误文本，只保留工具那条。
 */
export function selectIssueHits(spans: FactSpan[]): IssueHit[] {
  const facts = analyzeSessionFacts(spans);
  const others = facts.candidates.filter((item) => item.kind !== "no_delivery");
  const toolPatterns = new Set(
    others.filter((item) => item.signature.startsWith("tool:")).map((item) => errorPatternOf(item.signature)),
  );
  const chosen = facts.candidates.filter((item) => {
    if (item.kind === "no_delivery") return others.length === 0;
    if (item.signature.startsWith("tool:")) return true;
    return !toolPatterns.has(errorPatternOf(item.signature));
  });

  const hits: IssueHit[] = [];
  const seen = new Set<string>();
  for (const finding of chosen) {
    const spanIds = finding.spanIds.length > 0 ? finding.spanIds : [""];
    for (const spanId of spanIds) {
      const key = `${finding.signature}\0${spanId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        signature: finding.signature,
        kind: finding.signature.startsWith("tool:") ? "tool_failure" : "error_cluster",
        spanId,
        errorSummary: finding.evidence.errorSummary,
      });
    }
  }
  return hits;
}

export function toolOpened(hitCount: number, toolCalls: number): boolean {
  if (hitCount < TOOL_FAIL_MIN_COUNT || toolCalls <= 0) return false;
  return (hitCount / toolCalls) * 100 >= TOOL_FAIL_RATE_THRESHOLD;
}

export function clusterOpened(hitCount: number, failedSpans: number): boolean {
  if (hitCount < CLUSTER_MIN_COUNT || failedSpans <= 0) return false;
  return (hitCount / failedSpans) * 100 >= CLUSTER_MIN_SHARE;
}

/** 只有 candidate 会在跨过阈值后变成 open。忽略、确认、已修复都保持原状态。 */
export function nextIssueStatus(current: string, opened: boolean): StoredIssueStatus {
  if (current === "candidate" && opened) return "open";
  if (
    current === "open" ||
    current === "confirmed" ||
    current === "dismissed" ||
    current === "fixed" ||
    current === "candidate"
  ) {
    return current;
  }
  return "candidate";
}

export function issueSeverity(signature: string, hitCount: number, rate: number): IssueSeverity {
  if (missingError(signature)) return "info";
  if (hitCount >= 20 || rate >= 20) return "critical";
  return "warning";
}
