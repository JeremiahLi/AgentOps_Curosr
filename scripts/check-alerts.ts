/**
 *   npx tsx scripts/check-alerts.ts
 */
import { alertSignature, ruleMatches, severityMeets } from "../src/lib/engine/stats/alert-rules";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(alertSignature({ type: "error", severity: "critical", message: "2 个" }) === "error", "错误会话用类型做签名");
assert(
  alertSignature({
    type: "agent_error",
    severity: "critical",
    message: "2 个",
    details: [{ agentName: "b" }, { agentName: "a" }],
  }) === "agent_error:a,b",
  "Agent 错误按名字排序后签名稳定",
);
assert(severityMeets("warning", "critical"), "警告门槛包含严重");
assert(severityMeets("warning", "warning"), "警告门槛包含警告");
assert(!severityMeets("critical", "warning"), "严重门槛不推警告");
assert(ruleMatches({ minSeverity: "critical", types: [] }, { type: "token", severity: "critical" }), "空类型表示全部");
assert(!ruleMatches({ minSeverity: "warning", types: ["error"] }, { type: "token", severity: "critical" }), "指定类型时其余不推");

console.log("alerts ok");
