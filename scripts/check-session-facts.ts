/**
 * 过程事实的回归检查。没有测试运行器，用这段脚本锁住口径。
 *
 *   npx tsx scripts/check-session-facts.ts
 */
import { analyzeSessionFacts } from "../src/lib/engine/ingest/session-facts";
import { normalizeSpanRecord } from "../src/lib/engine/ingest/span-record";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const norm = normalizeSpanRecord({
  status: "error",
  kind: "tool_call",
  output: "boom at E:\\a\\b.ts:1",
});
assert(norm.status === "failed", "status error 应收成 failed");
assert(norm.error?.includes("boom"), "工具失败应留下 output 里的错误文本");

const missing = normalizeSpanRecord({
  status: "failed",
  kind: "answer",
  isError: false,
  output: "好的，让我用脚本文件方式完成剩余页面。",
  error: null,
});
assert(missing.error === "（无错误文本）", "回答正文不能当成错误原因");

const toolErr = normalizeSpanRecord({ status: "failed", kind: "tool_call", output: "exit 1" });
assert(toolErr.error === "exit 1", "工具失败应把 output 当作错误文本");

const cleared = normalizeSpanRecord({ status: "success", isError: false, error: "stale" });
assert(cleared.error === null, "成功 span 不应残留 error");

const fromFlag = normalizeSpanRecord({ status: "success", isError: true, output: "tool exploded" });
assert(fromFlag.status === "failed" && fromFlag.error === "tool exploded", "isError 应提升为 failed");

const recovered = analyzeSessionFacts([
  { id: "u", kind: "user", status: "success", input: "修一下测试", roundIndex: 0, turnId: 0 },
  { id: "llm", kind: "llm_thinking", status: "success", output: "我来跑测试", roundIndex: 0, turnId: 1 },
  { id: "bad", kind: "tool_call", name: "bash", status: "failed", input: "npm test", output: "exit 1", roundIndex: 0, turnId: 2 },
  { id: "ok", kind: "tool_call", name: "bash", status: "success", input: "npm test", output: "pass", roundIndex: 0, turnId: 3 },
  { id: "ans", kind: "answer", status: "success", output: "测试已通过", roundIndex: 0, turnId: 4 },
]);
assert(!recovered.hasAnomaly, "重试成功不应进入根因");
assert(recovered.recoveredCount === 1, "应有一条已恢复");
assert(recovered.findings[0].evidence.precedingModelOutput.includes("我来跑测试"), "证据应带上前一条模型输出");
assert(recovered.findings[0].evidence.userText.includes("修一下测试"), "证据应带用户原话");
assert(recovered.findings[0].signature.startsWith("tool:bash|err:"), "签名应含工具名和归一化错误");

const loop = analyzeSessionFacts([
  { id: "u", kind: "user", status: "success", input: "跑命令", roundIndex: 0, turnId: 0 },
  { id: "a", kind: "command", name: "bash", status: "error", input: "ls /missing", output: "No such file E:\\missing", roundIndex: 0, turnId: 1 },
  { id: "m", kind: "llm_thinking", status: "success", output: "再试一次", roundIndex: 0, turnId: 2 },
  { id: "b", kind: "command", name: "bash", status: "failed", input: "ls /missing", error: "No such file E:\\missing", roundIndex: 0, turnId: 3 },
  { id: "ans", kind: "answer", status: "success", output: "仍然失败，但有回答", roundIndex: 0, turnId: 4 },
]);
assert(loop.candidates.length === 1 && loop.candidates[0].kind === "loop", "同一错误连续出现应记为循环");
assert(loop.candidates[0].repeatCount === 2, "循环次数应为 2");
assert(loop.candidates[0].signature.includes("<path>"), "签名应抹掉绝对路径");
assert(!loop.candidates[0].recovered, "没有同名成功则循环未恢复");

const order = analyzeSessionFacts([
  { id: "fail", kind: "tool_call", name: "bash", status: "failed", output: "nope", roundIndex: 0, turnId: 2 },
  { id: "late-success", kind: "tool_call", name: "bash", status: "success", output: "ok", roundIndex: 0, turnId: 1 },
  { id: "ans", kind: "answer", status: "success", output: "done", roundIndex: 0, turnId: 3 },
]);
assert(order.candidates.some((item) => item.kind === "unrecovered"), "排序必须按 turn，而不能把更晚的成功当成补救");

const parent = analyzeSessionFacts([
  { id: "llm", kind: "llm_thinking", status: "success", output: "父模型决定", roundIndex: 0, turnId: 5 },
  { id: "earlier", kind: "llm_thinking", status: "success", output: "更早的模型", roundIndex: 0, turnId: 1 },
  { id: "bad", kind: "tool_call", name: "read", status: "failed", output: "denied", parentId: "llm", roundIndex: 0, turnId: 2 },
  { id: "ans", kind: "answer", status: "success", output: "ok", roundIndex: 0, turnId: 6 },
]);
assert(parent.candidates[0]?.evidence.precedingModelOutput === "父模型决定", "有父 span 时用父模型输出");

const none = analyzeSessionFacts([
  { id: "u", kind: "user", status: "success", input: "hi", roundIndex: 0, turnId: 0 },
]);
assert(none.candidates.some((item) => item.kind === "no_delivery"), "没有回答应记未交付");

const branch = analyzeSessionFacts([
  { id: "bad", kind: "tool_call", name: "bash", status: "failed", output: "branch fail", branchId: "b1", roundIndex: 0, turnId: 1 },
  { id: "ok", kind: "tool_call", name: "bash", status: "success", output: "main ok", roundIndex: 0, turnId: 2 },
  { id: "ans", kind: "answer", status: "success", output: "done", roundIndex: 0, turnId: 3 },
]);
assert(branch.candidates.some((item) => item.kind === "unrecovered"), "别的分支上的成功不能把这条失败标成已恢复");

console.log("session facts ok");
