/**
 *   npx tsx scripts/check-answer-review.ts
 */
import { answerWrongSignature, quoteFromEvidence, reviewNeedsConfirm } from "../src/lib/engine/ingest/answer-review";
import { issueTitle } from "../src/lib/engine/ingest/issue-rules";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(reviewNeedsConfirm({ verdict: "fail", score: 90, issueCount: 0 }), "fail 要等人确认");
assert(reviewNeedsConfirm({ verdict: "warn", score: 80, issueCount: 1 }), "带摘录的 warn 要等人确认");
assert(reviewNeedsConfirm({ verdict: "warn", score: 40, issueCount: 0 }), "低分 warn 要等人确认");
assert(!reviewNeedsConfirm({ verdict: "warn", score: 80, issueCount: 0 }), "没有摘录的高分 warn 不进待确认");
assert(!reviewNeedsConfirm({ verdict: "pass", score: 20, issueCount: 0 }), "pass 不进问题库");

const signature = answerWrongSignature('文件在 "E:\\tmp\\a.ts" 的第 12000 行写错了');
assert(signature.startsWith("answer|wrong:"), "回答问题有稳定前缀");
assert(!signature.includes("E:\\tmp"), "签名抹掉路径");
assert(answerWrongSignature(signature.slice("answer|wrong:".length)) === signature, "同一段原文签成同一条");
assert(issueTitle(signature).startsWith("回答有误："), "标题能从签名读出来");

assert(quoteFromEvidence({ issues: [{ quote: "  原文片段  " }] }) === "原文片段", "摘录去掉空白");
assert(quoteFromEvidence({}) === "", "没有摘录时为空");

console.log("answer review ok");
