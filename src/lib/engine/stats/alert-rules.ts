export interface AlertSnapshot {
  type: string;
  severity: "critical" | "warning";
  message: string;
  details?: { sessionId?: string; agentName?: string }[];
}

const RANK: Record<string, number> = { warning: 1, critical: 2 };

/** 同一类异常用稳定签名，避免每次打开页面都新插一行。 */
export function alertSignature(anomaly: AlertSnapshot): string {
  if (anomaly.type === "agent_error") {
    const names = (anomaly.details ?? [])
      .map((item) => (item.agentName || "").trim())
      .filter(Boolean)
      .sort();
    return `agent_error:${names.join(",") || "unknown"}`;
  }
  return anomaly.type;
}

/** minSeverity=warning 时警告和严重都推；critical 时只推严重。 */
export function severityMeets(minSeverity: string, actual: string): boolean {
  return (RANK[actual] ?? 0) >= (RANK[minSeverity] ?? RANK.warning);
}

export function parseAlertTypes(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

export function ruleMatches(
  rule: { minSeverity: string; types: string[] },
  alert: { type: string; severity: string },
): boolean {
  if (!severityMeets(rule.minSeverity, alert.severity)) return false;
  if (rule.types.length === 0) return true;
  return rule.types.includes(alert.type);
}
