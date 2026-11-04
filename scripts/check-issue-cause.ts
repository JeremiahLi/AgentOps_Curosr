/**
 *   npx tsx scripts/check-issue-cause.ts
 */
import { buildToolSceneIssues, classifyFailure, describeFailureCluster, invocationTarget } from "../src/lib/engine/ingest/issue-cause";
import { renderIssuesMarkdown } from "../src/lib/engine/stats/issue-markdown";
import type { IssueSample } from "../src/lib/engine/ingest/issue-cause";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function sample(partial: Partial<IssueSample> & Pick<IssueSample, "error">): IssueSample {
  return {
    sessionId: "sess-1",
    spanId: "span-1",
    kind: "llm_thinking",
    name: "LLM 思考",
    model: "demo",
    duration: 1000,
    inputTokens: 10,
    outputTokens: 0,
    input: "",
    ...partial,
  };
}

const quota = classifyFailure(sample({ error: "HTTP 402 insufficient balance", model: "openrouter/free" }));
assert(quota.label === "额度不足", "402 应归为额度不足");
assert(quota.proof.includes("不是断连"), "额度结论要和断连分开");

const silent = classifyFailure(
  sample({ error: "模型调用失败", duration: 30_002, inputTokens: 0, outputTokens: 0, model: "doubao" }),
);
assert(silent.label === "超时或连接中断", "长时间 0 token 且只有包装句，应是超时或断连");
assert(silent.proof.includes("没有 402"), "没有额度原文时要写明");
assert(/不要按额度/.test(silent.suggestion), "这种形态不要按额度处理");

const empty = classifyFailure(sample({ error: "模型调用失败", duration: 0, inputTokens: 0, outputTokens: 0 }));
assert(empty.label === "调用没有发出", "0ms 且 0 token 不是超时");

const disconnect = classifyFailure(sample({ error: "fetch failed: ECONNRESET" }));
assert(disconnect.label === "连接中断", "ECONNRESET 是断连");

const cluster = describeFailureCluster(
  [
    sample({ spanId: "a", error: "模型调用失败", duration: 30_000, inputTokens: 0, outputTokens: 0 }),
    sample({ spanId: "b", error: "模型调用失败", duration: 0, inputTokens: 0, outputTokens: 0 }),
    sample({ spanId: "c", error: "模型调用失败", duration: 45_000, inputTokens: 0, outputTokens: 0 }),
  ],
  { title: "回答失败：模型调用失败", signature: "answer|err:模型调用失败", hitCount: 9 },
);
assert(cluster?.title.includes("超时或连接中断"), "多数样例是超时/断连时标题要写出来");
assert(cluster?.conclusion.includes("没有 402"), "聚类结论要排除额度");
assert(cluster?.evidence.some((line) => line.includes("调用没有发出")), "少数空调用也要列出来");

assert(invocationTarget('{"command":"python renderer/merge.py --out a.pptx"}') === "merge.py", "python 脚本取文件名");

const toolSamples: IssueSample[] = [
  ...Array.from({ length: 7 }, (_, index) =>
    sample({
      spanId: `bash-${index}`,
      kind: "tool_call",
      name: "bash",
      model: "",
      error: 'Traceback (most recent call last):\nFile "E:\\\\renderer\\\\merge.py", line 12, in <module>\nModuleNotFoundError: No module named \'pptx\'',
      input: '{"command":"python renderer/merge.py"}',
    }),
  ),
  sample({
    spanId: "bash-del",
    kind: "tool_call",
    name: "bash",
    model: "",
    error: "(no output) Command exited with code 1",
    input: '{"command":"del /q out.pptx"}',
  }),
];
const scenes = buildToolSceneIssues(toolSamples, [{ name: "bash", calls: 40, failed: 12, avgFailDuration: 1200 }]);
assert(scenes.length === 1, "过阈值的工具应合成一条");
assert(scenes[0].title.includes("bash 失败 12 次"), "标题写失败次数");
assert(scenes[0].title.includes("merge.py"), "集中的脚本要出现在标题里");
assert(scenes[0].evidence.some((line) => line.includes("运行时异常") && line.includes("ModuleNotFoundError")), "要写异常类型");
assert(scenes[0].evidence.some((line) => line.includes("命令失败")), "退出码单独归类");
assert(scenes[0].conclusion.includes("不是模型调用"), "工具问题不要说成模型调用");
assert(scenes[0].report.samples.length === 8, "下载样例有上限");
assert(scenes[0].report.samples[0].error.includes("ModuleNotFoundError"), "样例保留错误原文");

const below = buildToolSceneIssues(
  [sample({ kind: "tool_call", name: "edit", error: "Permission denied", input: '{"path":"a.json"}' })],
  [{ name: "edit", calls: 100, failed: 3, avgFailDuration: 10 }],
);
assert(below.length === 0, "不到 5 次或 10% 的工具不进列表");

const markdown = renderIssuesMarkdown({
  agentName: "pptagent1022",
  range: "近 30 天",
  totals: {
    sessions: 3,
    successRate: 16.7,
    spans: 129,
    failedSpans: 11,
    spanFailRate: 8.5,
    toolCalls: 99,
    toolFailed: 21,
    toolFailRate: 21.2,
  },
  issues: scenes,
});
assert(markdown.includes("## 1. 严重 · 工具失败"), "下载文档带严重级别和场景");
assert(markdown.includes("sessionId: `sess-1`"), "下载文档带 sessionId");
assert(markdown.includes("ModuleNotFoundError"), "下载文档带错误原文");
assert(markdown.includes("口径："), "下载文档写明计数口径");

console.log("issue cause ok");
