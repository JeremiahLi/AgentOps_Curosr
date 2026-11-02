import { prisma } from "@/lib/prisma";
import { getActiveLlmConfig, callLlmAsJson, type LlmConfig } from "./judge-llm";
import { RULE_EVALUATORS } from "./rule-evaluators";
import type { EvalOutput, EvaluatorContext, Evaluator, LlmEvaluator } from "./evaluator-types";

export type { EvalOutput, EvaluatorContext, Evaluator, ToolCall, ContextStats } from "./evaluator-types";


/**
 * 无参考答案时对 LLM 评估结果降级：
 * - verdict 不判 fail（最多 warn）——没有基准时低分大概率是评审模型的猜测
 * - summary 追加"仅供参考"提示，前端展示时可识别
 */
function downgradeWithoutReference<T extends { verdict: string; summary: string; evidence: Record<string, unknown> }>(
  parsed: T
): T {
  if (parsed.evidence?.noReference !== true) return parsed;
  const out = { ...parsed };
  if (out.verdict === "fail") out.verdict = "warn";
  if (!out.summary.includes("无参考答案")) {
    out.summary = `${out.summary}（无参考答案，评分仅供参考）`;
  }
  return out;
}

const EVALUATORS: Evaluator[] = [  {
    id: "accuracy",
    name: "准确性",
    description: "对比参考答案评估输出正确性",
    type: "llm",
    category: "结果",
    needsReference: false,
    systemPrompt: `你是一个精确的评测专家。你的任务是评估"实际输出"的准确性。

重要规则：
- 如果"参考答案"不为空，则对比参考答案评估实际输出的准确性
- 如果"参考答案"为空或显示"（未提供参考答案）"，则基于以下维度独立评估：
  1. 输出的事实是否合理、可信
  2. 逻辑是否自洽
  3. 是否存在明显的错误或矛盾
  4. 是否完整回答了用户的问题

评判标准（有参考答案时）：
1. 核心事实是否正确
2. 关键观点是否与参考答案一致
3. 是否存在错误或误导性信息

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "correctPoints": ["正确点1", "正确点2"],
    "incorrectPoints": ["错误点1"],
    "missingPoints": ["遗漏点1"],
    "noReference": <true/false>,
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自实际输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `参考答案：
${ctx.referenceOutput || "（未提供参考答案）"}

实际输出：
${ctx.actualOutput}

用户问题：
${ctx.input || "（未知）"}

请评估实际输出的准确性。如果没有参考答案，请基于输出本身的合理性、逻辑性和完整性进行评估。`,
    parseResponse: (r) => {
      const res = r as any;
      return downgradeWithoutReference({
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          ...(res.evidence ?? {}),
        },
      });
    },
  },
  {
    id: "answer-quality",
    name: "答案质量",
    description: "评估输出的相关性、完整性和连贯性",
    type: "llm",
    category: "结果",
    needsReference: false,
    systemPrompt: `你是一个专业的答案质量评估专家。请从以下维度评估答案质量：

1. 相关性（0-100）：答案是否切题，是否回答了用户的问题
2. 完整性（0-100）：答案是否全面，是否覆盖了必要的方面
3. 连贯性（0-100）：答案是否逻辑清晰，表述是否流畅

最终分数 = 相关性×0.3 + 完整性×0.5 + 连贯性×0.2

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "relevance": <0-100>,
    "completeness": <0-100>,
    "coherence": <0-100>,
    "analysis": "<详细分析>",
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自实际输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `用户问题：
${ctx.input}

实际输出：
${ctx.actualOutput}

请从相关性、完整性、连贯性三个维度评估答案质量。`,
    parseResponse: (r) => {
      const res = r as any;
      return {
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          ...(res.evidence ?? {}),
        },
      };
    },
  },
  {
    id: "faithfulness",
    name: "忠实度",
    description: "验证输出是否可被执行轨迹证据支撑",
    type: "llm",
    category: "轨迹",
    needsReference: false,
    systemPrompt: `你是一个严谨的事实核查专家。你的任务是验证"实际输出"中的主张是否有"执行轨迹"中的证据支撑。

评判步骤：
1. 从实际输出中提取关键主张（claims）
2. 在执行轨迹中查找支持或反驳每个主张的证据
3. 判定每个主张的状态：supported（有证据支持）、contradicted（与证据矛盾）、not_covered（无相关证据）

分数 = supported主张数 / 总主张数 × 100

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "claims": [
      {"text": "<主张>", "status": "supported|contradicted|not_covered", "evidence": "<支撑证据>"}
    ],
    "totalClaims": <总数>,
    "supportedClaims": <支持数>,
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自实际输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `执行轨迹（工具调用记录）：
${ctx.trace.map((t, i) => `[${i + 1}] ${t.name}\n输入: ${t.input}\n输出: ${t.output}${t.error ? "\n错误: " + t.error : ""}`).join("\n\n") || "（无工具调用轨迹）"}

实际输出：
${ctx.actualOutput}

请验证实际输出中的主张是否有执行轨迹证据支撑。`,
    parseResponse: (r) => {
      const res = r as any;
      return {
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          ...(res.evidence ?? {}),
        },
      };
    },
  },
  {
    id: "instruction-adherence",
    name: "指令遵循",
    description: "检查输出是否遵循系统指令和用户要求",
    type: "llm",
    category: "结果",
    needsReference: false,
    systemPrompt: `你是指令遵循评估专家。你的任务是检查"实际输出"是否遵循了"系统指令"和"用户要求"。

评判步骤：
1. 从用户问题和系统指令中提取所有约束条件
2. 逐条检查实际输出是否满足每个约束
3. 判定每个约束的状态：met（满足）、not_met（未满足）、not_applicable（不适用）

分数 = met约束数 / 适用约束数 × 100

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "constraints": [
      {"text": "<约束>", "status": "met|not_met|not_applicable"}
    ],
    "metCount": <满足数>,
    "applicableCount": <适用数>,
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自实际输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `用户问题/指令：
${ctx.input}

实际输出：
${ctx.actualOutput}

请检查实际输出是否遵循了用户指令中的所有约束条件。`,
    parseResponse: (r) => {
      const res = r as any;
      return {
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          ...(res.evidence ?? {}),
        },
      };
    },
  },
  {
    id: "trajectory-quality",
    name: "轨迹质量",
    description: "分析执行轨迹的完整性、工具选择和冗余度",
    type: "llm",
    category: "轨迹",
    needsReference: false,
    systemPrompt: `你是执行轨迹质量评估专家。请从以下维度评估 Agent 的执行轨迹：

1. 完整性（权重 0.45）：执行步骤是否完整，是否完成了所有必要操作
2. 工具选择（权重 0.35）：工具选择是否合理，是否使用了正确的工具
3. 冗余度（权重 0.20）：是否存在不必要的重复操作或无效调用

每个维度使用三档锚定：1.0（优秀）/ 0.5（一般）/ 0.0（差）

分数 = (完整性×0.45 + 工具选择×0.35 + (1-冗余度)×0.20) × 100

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "completeness": <0-100>,
    "toolChoice": <0-100>,
    "redundancy": <0-100>,
    "analysis": "<详细分析>",
    "exploredTargets": [{"target": "<探索的目录/文件/资源>", "action": "读取|列出|搜索", "purpose": "<目的>"}],
    "duplicateCalls": [{"tool": "<工具名>", "args": "<参数摘要>", "count": <重复次数>, "note": "<说明>"}],
    "invalidCalls": [{"tool": "<工具名>", "args": "<参数摘要>", "issue": "<失败/无效原因>"}],
    "knowledgeOnlyClaims": [{"claim": "<依赖模型自带知识而非轨迹实证的主张>", "reason": "<为什么判定无轨迹支撑>"}],
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：
- exploredTargets / duplicateCalls / invalidCalls / knowledgeOnlyClaims 必须从执行轨迹中逐条提取，不得凭空编造；某类为空时输出空数组。
- knowledgeOnlyClaims 用于标注"最终输出中依赖模型自带知识、在轨迹中找不到依据"的主张，并说明判定原因。
- outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自最终输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `执行轨迹（按时间顺序）：
${ctx.trace.map((t, i) => `[${i + 1}] 工具: ${t.name}\n输入: ${t.input}\n输出: ${t.output}${t.error ? "\n错误: " + t.error : ""}`).join("\n\n") || "（无执行轨迹）"}

最终输出：
${ctx.actualOutput}

请评估执行轨迹的质量。`,
    parseResponse: (r) => {
      const res = r as any;
      return {
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          exploredTargets: [],
          duplicateCalls: [],
          invalidCalls: [],
          knowledgeOnlyClaims: [],
          ...(res.evidence ?? {}),
        },
      };
    },
  },
  {
    id: "task-completion",
    name: "任务完成度",
    description: "评估任务关键观点的覆盖程度",
    type: "llm",
    category: "结果",
    needsReference: true,
    systemPrompt: `你是任务完成度评估专家。你的任务是评估"实际输出"对用户任务的完成程度。

重要规则：
- 如果"参考答案"不为空，则从参考答案中提取关键观点，评估实际输出的覆盖程度
- 如果"参考答案"为空，则根据"用户问题"推断关键完成点，评估实际输出是否完成了这些要点

评判步骤（有参考答案时）：
1. 从参考答案中提取关键观点（key points）
2. 逐条检查实际输出是否覆盖了每个关键观点
3. 判定覆盖度：covered（完整覆盖）、partial（部分覆盖）、missing（未覆盖）、wrong（错误覆盖）

评判步骤（无参考答案时）：
1. 从用户问题中推断关键完成点
2. 逐条检查实际输出是否完成了这些要点
3. 判定完成度

分数 = covered×1.0 + partial×0.5 + wrong×0 / 总关键观点数 × 100

请输出 JSON 格式：
{
  "score": <0-100>,
  "confidence": <0-1>,
  "verdict": "pass|warn|fail",
  "summary": "<一句话结论>",
  "evidence": {
    "keyPoints": [
      {"text": "<关键观点>", "status": "covered|partial|missing|wrong", "analysis": "<分析>"}
    ],
    "coveredCount": <覆盖数>,
    "totalCount": <总数>,
    "noReference": <true/false>,
    "outputSummary": "<对实际输出的客观摘要，100-200字，不得添加原文没有的信息>",
    "reasoning": "<评分推理：为什么给出这个分数，关键判断依据逐条说明>",
    "issues": [{"quote": "<从实际输出逐字摘录的问题片段，必须是原文精确子串>", "problem": "<该片段存在什么问题>", "suggestion": "<修改建议>"}]
  }
}

要求：outputSummary 与 reasoning 必填；issues[].quote 必须逐字摘自实际输出原文（精确子串），没有明显问题时 issues 为空数组。`,
    buildUserPrompt: (ctx) => `参考答案（关键观点来源）：
${ctx.referenceOutput || "（未提供参考答案，请根据用户问题推断关键完成点）"}

用户问题：
${ctx.input || "（未知）"}

实际输出：
${ctx.actualOutput}

请评估实际输出对任务关键观点的覆盖程度。如果没有参考答案，请根据用户问题推断关键完成点并评估。`,
    parseResponse: (r) => {
      const res = r as any;
      return downgradeWithoutReference({
        score: Math.min(100, Math.max(0, res.score ?? 0)),
        confidence: Math.min(1, Math.max(0, res.confidence ?? 0.8)),
        verdict: res.verdict || "warn",
        summary: res.summary || "评估完成",
        evidence: {
          outputSummary: "",
          reasoning: "",
          issues: [],
          ...(res.evidence ?? {}),
        },
      });
    },
  },
];

export function getEvaluatorById(id: string): Evaluator | undefined {
  return ALL_EVALUATORS.find((e) => e.id === id);
}

export function getAllEvaluators(): Evaluator[] {
  return ALL_EVALUATORS;
}

const ALL_EVALUATORS: Evaluator[] = [...EVALUATORS, ...RULE_EVALUATORS];

export async function runEvaluator(
  evaluatorId: string,
  context: EvaluatorContext,
  ruleConfig?: Record<string, unknown>
): Promise<EvalOutput> {
  const evaluator = getEvaluatorById(evaluatorId);
  if (!evaluator) {
    throw new Error(`Unknown evaluator: ${evaluatorId}`);
  }

  // 规则评估器：纯同步确定性计算，不依赖 LLM 配置
  if (evaluator.type === "rule") {
    return evaluator.evaluate(context, ruleConfig ?? {});
  }

  const llmEvaluator = evaluator as LlmEvaluator;
  const config = await getActiveLlmConfig();
  if (!config) {
    throw new Error("No LLM config available. Please configure in Settings.");
  }

  const messages = [
    { role: "system" as const, content: llmEvaluator.systemPrompt },
    { role: "user" as const, content: llmEvaluator.buildUserPrompt(context) },
  ];

  const response = await callLlmAsJson(messages, config);
  return llmEvaluator.parseResponse(response);
}
