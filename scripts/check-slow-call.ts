/**
 *   npx tsx scripts/check-slow-call.ts
 */
import { describeSlowCall } from "../src/lib/engine/stats/slow-call";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const report = describeSlowCall(
  [
    {
      id: "answer-1",
      sessionId: "s1",
      name: "最终回答",
      kind: "answer",
      duration: 311_000,
      status: "success",
      at: "",
      model: "spark-x2.6-4b",
      inputTokens: 41155,
      outputTokens: 16384,
      cacheReadTokens: 192,
      thinkMs: 4002,
      replyMs: 311_000,
      inputHead: "",
      outputChars: 0,
      error: "",
    },
    {
      id: "think-1",
      sessionId: "s1",
      name: "LLM 思考",
      kind: "llm_thinking",
      duration: 311_200,
      status: "success",
      at: "",
      model: "spark-x2.6-4b",
      inputTokens: 41155,
      outputTokens: 16384,
      cacheReadTokens: 192,
      thinkMs: 4002,
      replyMs: 311_000,
      inputHead: "Let me continue. I've read the input document",
      outputChars: 0,
      error: "",
    },
  ],
  26_000,
  351,
  10,
);
assert(report, "应生成慢调用说明");
assert(report!.spans.length === 1, "同一次调用不应拆成两条");
assert(report!.issue.evidence.some((line) => line.includes("16384")), "证据要写出输出 token");
assert(report!.issue.evidence.some((line) => line.includes("同一次调用")), "要说明思考和回答是同一次");
assert(report!.issue.evidence.some((line) => line.includes("没有入库")), "正文缺失要写明");
assert(report!.issue.suggestion.includes("max_tokens"), "打满输出上限时动作是改 max_tokens");
assert(report!.issue.suggestion.includes("think-1"), "动作要落到这次 span");
assert(report!.issue.evidence.some((line) => line.startsWith("sessionId:")), "证据要带 sessionId");
assert(!report!.issue.suggestion.includes("超时设置"), "不要再用固定的超时模板");
assert(report!.corpus.includes("spark-x2.6-4b"), "给模型的证据里要有模型名");

console.log("slow call ok");
