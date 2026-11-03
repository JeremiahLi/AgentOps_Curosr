/**
 *   npx tsx scripts/check-issue-note.ts
 */
import { explainRecordedIssue, fallbackFix, groundIssueNote, isMissingErrorSignature, missingErrorNote } from "../src/lib/engine/ingest/issue-note";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const corpus = [
  "sessionId: sess-1",
  "spanId: span-1",
  "字段: path=E:\\data\\a.txt",
  "字段: error=Permission denied: E:\\data\\a.txt",
].join("\n");

const ok = groundIssueNote(
  {
    sessionId: "sess-1",
    spanId: "span-1",
    field: "path",
    observed: "E:\\data\\a.txt",
    layer: "tool",
    action: "把 span span-1 的 path 从 E:\\data\\a.txt 改到运行身份可写的路径。",
    verify: "再打开 span span-1，path 不再是 E:\\data\\a.txt。",
  },
  corpus,
);
assert(ok.grounded && ok.layer === "tool", "落到证据字段上的动作应保留");
assert(ok.spanId === "span-1" && ok.field === "path", "保留 span 和字段");
assert(ok.conclusion.includes("span-1") && /组件|配置项|数据|判断/.test(ok.conclusion), "结论要点明粒度和 span");

const vague = groundIssueNote(
  {
    sessionId: "sess-1",
    spanId: "span-1",
    field: "path",
    observed: "E:\\data\\a.txt",
    layer: "prompt",
    action: "span span-1 的 path 是 E:\\data\\a.txt，因为推理能力不足。",
    verify: "再看 span span-1 的 path。",
  },
  corpus,
);
assert(!vague.grounded, "需要再推理的结论要丢掉");

const forged = groundIssueNote(
  {
    sessionId: "sess-9",
    spanId: "span-9",
    field: "path",
    observed: "E:\\data\\a.txt",
    layer: "env",
    action: "把 span span-9 的 path 从 E:\\data\\a.txt 改掉。",
    verify: "再看 span span-9 的 path。",
  },
  corpus,
);
assert(!forged.grounded, "证据里没有的 span 要丢掉");

const slowCorpus = [
  "sessionId: sess-1",
  "spanId: span-slow",
  "字段: outputTokens=16384",
  "字段: output.length=0",
].join("\n");
const fallback = fallbackFix(slowCorpus);
assert(fallback?.field === "outputTokens" && fallback.observed === "16384", "打满输出上限时回退到这个字段");
assert(fallback?.action.includes("max_tokens") && fallback.action.includes("span-slow"), "回退动作要写明改哪个 span 的参数");
assert(fallback?.verify.includes("outputTokens"), "验证要回到同一字段");

assert(isMissingErrorSignature("answer|err:（无错误文本）"), "无错误文本签名要识别出来");
const missing = missingErrorNote("sess-1", "span-1");
assert(missing.field === "error" && missing.action.includes("span-1"), "没有错误文本时动作是补这个 span 的 error");
assert(missing.conclusion.includes("span-1"), "没有错误文本时结论也要落到这条 span");

const mixed = explainRecordedIssue([
  {
    sessionId: "sess-1",
    spanId: "empty-1",
    kind: "answer",
    name: "最终回答",
    model: "openrouter/free",
    duration: 1,
    inputTokens: 0,
    outputTokens: 0,
    outputChars: 0,
    error: "（无错误文本）",
  },
  {
    sessionId: "sess-1",
    spanId: "real-1",
    kind: "llm_thinking",
    name: "LLM 思考",
    model: "spark-x2.6-4b",
    duration: 91_452,
    inputTokens: 0,
    outputTokens: 0,
    outputChars: 0,
    error: "（无错误文本）",
  },
]);
assert(mixed?.conclusion.includes("spark-x2.6-4b"), "结论要点名这次判断用的模型");
assert(mixed?.conclusion.includes("real-1"), "结论要落到有耗时的那条 span");
assert(mixed?.conclusion.includes("empty-1"), "空记录要单独点出 span");
assert(mixed?.conclusion.includes("openrouter/free"), "空记录要带上它们的模型名");
assert(!/额度不足|配额耗尽/.test(mixed?.conclusion || ""), "原文没有额度字样时不要写成额度问题");
assert(mixed?.conclusion.includes("402"), "要写明查过的字段里没有额度原文");

const quota = explainRecordedIssue([
  {
    sessionId: "sess-1",
    spanId: "quota-1",
    kind: "llm_thinking",
    name: "LLM 思考",
    model: "openrouter/free",
    duration: 1200,
    inputTokens: 10,
    outputTokens: 0,
    outputChars: 0,
    error: "HTTP 402 insufficient balance",
  },
]);
assert(quota?.conclusion.includes("额度") && quota.conclusion.includes("openrouter/free"), "error 写了 402 时结论是这个模型的额度");
assert(quota?.spanId === "quota-1", "额度结论落到这条 span");

console.log("issue note ok");
