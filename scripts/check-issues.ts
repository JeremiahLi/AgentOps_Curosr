/**
 *   npx tsx scripts/check-issues.ts
 */
import { analyzeSessionFacts } from "../src/lib/engine/ingest/session-facts";
import {
  clusterOpened,
  issueSeverity,
  nextIssueStatus,
  selectIssueHits,
  toolOpened,
} from "../src/lib/engine/ingest/issue-rules";
import type { FactSpan } from "../src/lib/engine/ingest/session-facts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function span(partial: FactSpan): FactSpan {
  return {
    status: "success",
    input: "",
    output: "",
    error: null,
    roundIndex: 0,
    turnId: 0,
    ...partial,
  };
}

const recovered = selectIssueHits([
  span({ id: "u", kind: "user", name: "user", input: "你好", turnId: 1 }),
  span({ id: "t1", kind: "tool_call", name: "bash", status: "failed", error: "Permission denied", turnId: 2 }),
  span({ id: "t2", kind: "tool_call", name: "bash", status: "success", output: "ok", turnId: 3 }),
  span({ id: "a", kind: "answer", name: "answer", status: "success", output: "完成", turnId: 4 }),
]);
assert(recovered.length === 0, "已恢复的工具失败不应进入问题库");

const both = selectIssueHits([
  span({ id: "u", kind: "user", name: "user", input: "改文件", turnId: 1 }),
  span({
    id: "e1",
    kind: "tool_call",
    name: "edit_file",
    status: "failed",
    error: "Permission denied",
    turnId: 2,
  }),
  span({
    id: "m1",
    kind: "llm_thinking",
    name: "llm",
    status: "failed",
    error: "Permission denied",
    turnId: 3,
  }),
  span({ id: "a", kind: "answer", name: "answer", status: "failed", error: "模型调用失败", turnId: 4 }),
]);
assert(
  both.some((hit) => hit.signature === "tool:edit_file|err:Permission denied"),
  "工具失败保留自己的签名",
);
assert(
  !both.some((hit) => hit.signature.includes("llm|err:Permission denied")),
  "和工具失败相同的错误文本不再单开一条",
);
assert(
  both.some((hit) => hit.signature.startsWith("answer|err:")),
  "不同的错误文本仍然单独成条",
);

const facts = analyzeSessionFacts([
  span({ id: "u", kind: "user", name: "user", input: "写", turnId: 1 }),
  span({ id: "t", kind: "tool_call", name: "bash", status: "failed", error: "", turnId: 2 }),
]);
assert(facts.candidates[0]?.signature.includes("（无错误文本）"), "空错误文本有稳定签名");
assert(issueSeverity(facts.candidates[0].signature, 30, 40) === "info", "没有错误文本时严重度封顶为 info");

assert(toolOpened(4, 10) === false, "不到 5 次不打开");
assert(toolOpened(5, 100) === false, "失败率不足 10% 不打开");
assert(toolOpened(5, 40) === true, "5 次且超过 10% 才打开");
assert(clusterOpened(2, 10) === false, "聚类不到 3 次不打开");
assert(clusterOpened(3, 100) === false, "聚类占比不足 5% 不打开");
assert(clusterOpened(3, 40) === true, "3 次且超过 5% 才打开");
assert(nextIssueStatus("candidate", true) === "open", "跨过阈值后 candidate 变为 open");
assert(nextIssueStatus("dismissed", true) === "dismissed", "忽略之后不再打回 open");
assert(nextIssueStatus("confirmed", true) === "confirmed", "已确认保持已确认");
assert(nextIssueStatus("open", false) === "open", "已经打开的问题不因本次数下降而退回");

console.log("issues ok");
