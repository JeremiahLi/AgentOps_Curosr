/**
 *   npx tsx scripts/check-feedback.ts
 */
import { summarizeFeedback } from "../src/lib/engine/stats/feedback";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const summary = summarizeFeedback(
  [
    { userName: "甲", kind: "up", sessionId: "s1" },
    { userName: "甲", kind: "report", sessionId: "s1" },
    { userName: "乙", kind: "down", sessionId: "s2" },
    { userName: "乙", kind: "up", sessionId: "" },
  ],
  4,
);

assert(summary.total === 4, "反馈按条数计");
assert(summary.up === 2 && summary.down === 1 && summary.reports === 1, "三种反馈分开计");
assert(summary.sessionsWithFeedback === 2, "同一会话的多条反馈只算一个会话");
assert(summary.responseRate === 50, "响应率是有反馈的会话占窗口会话的比例");
assert(summary.rank[0]?.name === "甲" && summary.rank[0]?.count === 2, "提出人按条数排");
assert(summarizeFeedback([], 0).responseRate === 0, "没有会话时响应率是 0");

console.log("feedback ok");
