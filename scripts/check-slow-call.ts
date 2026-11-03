/**
 *   npx tsx scripts/check-slow-call.ts
 */
import { describeSlowCall } from "../src/lib/engine/stats/slow-call";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const twin = {
  sessionId: "s1",
  status: "success" as const,
  at: "",
  model: "spark-x2.6-4b",
  inputTokens: 41155,
  outputTokens: 16384,
  cacheReadTokens: 192,
  thinkMs: 4002,
  replyMs: 311_000,
  outputChars: 0,
  error: "",
  modelP95: 311_000,
  modelSamples: 6,
};

const within = describeSlowCall([
  {
    ...twin,
    id: "answer-1",
    name: "最终回答",
    kind: "answer",
    duration: 311_000,
    inputHead: "",
  },
  {
    ...twin,
    id: "think-1",
    name: "LLM 思考",
    kind: "llm_thinking",
    duration: 311_200,
    inputHead: "Let me continue. I've read the input document",
  },
]);
assert(within, "应生成按模型汇总的耗时");
assert(within!.issue === null, "不超过该模型自身 P95 的 2 倍时，不记为慢调用");
assert(within!.spans.length === 1, "同一次调用不应拆成两条，每个模型只留最慢一次");
assert(within!.spans[0].ratio < 2, "倍数对照的是 spark 自身 P95");
assert(within!.spans[0].baselineCount === 6, "基线样本数是该模型自己的调用数");

const outlier = describeSlowCall([
  {
    ...twin,
    id: "think-1",
    name: "LLM 思考",
    kind: "llm_thinking",
    duration: 311_000,
    inputHead: "Let me continue",
    modelP95: 26_000,
    modelSamples: 40,
  },
]);
assert(outlier?.issue, "达到自身 P95 的 2 倍才记为慢调用");
assert(outlier!.issue!.title.includes("自身 P95"), "标题要写明是这个模型自己的 P95");
assert(!outlier!.issue!.title.includes("是 P95 的"), "不要再和全部 span 的 P95 比");
assert(outlier!.issue!.conclusion.includes("spark-x2.6-4b"), "结论要点名这个模型组件");
assert(outlier!.issue!.conclusion.includes("think-1"), "结论要落到这次 span");
assert(outlier!.issue!.conclusion.includes("outputTokens=16384"), "打满输出上限时结论写配置项");
assert(outlier!.issue!.suggestion.includes("max_tokens"), "打满输出上限时动作是改 max_tokens");
assert(outlier!.issue!.suggestion.includes("think-1"), "动作要落到这次 span");
assert(outlier!.corpus.includes("字段: modelP95=26000"), "证据里要有该模型自身 P95");

console.log("slow call ok");
