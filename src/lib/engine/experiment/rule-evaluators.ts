import Ajv from "ajv";
import type {
  EvaluatorContext,
  EvalOutput,
  RuleEvaluator,
  FieldDescriptor,
} from "./evaluator-types";

const RULE_CATEGORY = "规则";

function pass(summary: string, evidence: Record<string, unknown>): EvalOutput {
  return { score: 100, confidence: 1, verdict: "pass", summary, evidence };
}

function fail(summary: string, evidence: Record<string, unknown>): EvalOutput {
  return { score: 0, confidence: 1, verdict: "fail", summary, evidence };
}

function cfgStr(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function cfgNum(config: Record<string, unknown>, key: string): number | undefined {
  const v = config[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function cfgBool(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true || config[key] === "true";
}

function cfgStrArr(config: Record<string, unknown>, key: string): string[] {
  const v = config[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.trim() !== "") {
    // 兼容换行分隔的字符串
    return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function normalize(text: string, caseSensitive: boolean, trimWhitespace: boolean): string {
  let t = text;
  if (trimWhitespace) t = t.trim();
  if (!caseSensitive) t = t.toLowerCase();
  return t;
}

// 按码点计算的 Levenshtein 编辑距离（中文/emoji 安全）
export function levenshtein(a: string, b: string): number {
  const sa = Array.from(a);
  const sb = Array.from(b);
  const m = sa.length;
  const n = sb.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

export function similarity(a: string, b: string): { similarity: number; distance: number } {
  const distance = levenshtein(a, b);
  const maxLen = Math.max(Array.from(a).length, Array.from(b).length);
  const sim = maxLen === 0 ? 1 : 1 - distance / maxLen;
  return { similarity: Math.max(0, Math.min(1, sim)), distance };
}

// ---------- configSchema（元数据单一数据源，/api/evaluators 直接透出） ----------

const exactMatchSchema: FieldDescriptor[] = [
  { key: "expectedOutput", label: "期望输出", type: "textarea", required: false, placeholder: "留空则使用用例的参考答案", helpText: "优先级高于用例的参考答案" },
  { key: "caseSensitive", label: "区分大小写", type: "boolean", default: false },
  { key: "trimWhitespace", label: "忽略首尾空格", type: "boolean", default: true },
];

const containsSchema: FieldDescriptor[] = [
  { key: "patterns", label: "关键词列表", type: "textarea", required: true, placeholder: "每行一个关键词", helpText: "检查实际输出中是否包含这些关键词" },
  { key: "mode", label: "匹配模式", type: "select", default: "all", options: [{ label: "全部出现（all）", value: "all" }, { label: "任一出现（any）", value: "any" }] },
  { key: "caseSensitive", label: "区分大小写", type: "boolean", default: false },
];

const fuzzyMatchSchema: FieldDescriptor[] = [
  { key: "threshold", label: "相似度阈值", type: "number", default: 0.8, min: 0, max: 1, step: 0.01, helpText: "与参考答案的最小相似度（0-1）" },
];

const regexMatchSchema: FieldDescriptor[] = [
  { key: "pattern", label: "正则表达式", type: "text", required: true, placeholder: "例如：\\d{8}" },
  { key: "flags", label: "正则 flags", type: "text", default: "", placeholder: "例如：i 或 gi" },
  { key: "matchMode", label: "匹配方式", type: "select", default: "partial", options: [{ label: "包含匹配（partial）", value: "partial" }, { label: "整串匹配（full）", value: "full" }] },
];

const jsonSchemaField: FieldDescriptor[] = [
  { key: "schema", label: "JSON Schema", type: "json", required: true, placeholder: '{"type":"object","required":["name"]}', helpText: "标准 JSON Schema，校验实际输出（必须是合法 JSON）" },
];

const toolSequenceSchema: FieldDescriptor[] = [
  { key: "mustCall", label: "必须调用", type: "textarea", placeholder: "每行一个工具名", helpText: "名单内每个工具至少被调用一次" },
  { key: "forbidCall", label: "禁止调用", type: "textarea", placeholder: "每行一个工具名", helpText: "名单内任一工具出现即违规" },
  { key: "callOrder", label: "调用顺序", type: "textarea", placeholder: "每行一个工具名，按期望顺序", helpText: "按子序列校验：允许穿插其他调用，但相对顺序不能乱" },
  { key: "minCalls", label: "最少调用次数", type: "number", min: 0 },
  { key: "maxCalls", label: "最多调用次数", type: "number", min: 0, helpText: "总调用次数上限" },
];

const thresholdSchema: FieldDescriptor[] = [
  { key: "maxTotalTokens", label: "总 token 上限", type: "number", min: 0 },
  { key: "maxInputTokens", label: "输入 token 上限", type: "number", min: 0 },
  { key: "maxOutputTokens", label: "输出 token 上限", type: "number", min: 0 },
  { key: "maxDurationMs", label: "总耗时上限（毫秒）", type: "number", min: 0 },
];

// ---------- 7 类规则评估器 ----------

const RULE_EVALUATORS: RuleEvaluator[] = [
  {
    id: "exact-match",
    name: "精确匹配",
    description: "实际输出必须与期望输出一字不差",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: exactMatchSchema,
    evaluate: (ctx, config) => {
      const caseSensitive = cfgBool(config, "caseSensitive");
      const trimWhitespace = config.trimWhitespace === undefined ? true : cfgBool(config, "trimWhitespace");
      const expectedRaw = cfgStr(config, "expectedOutput") ?? ctx.referenceOutput ?? "";
      if (!expectedRaw) {
        return fail("缺少期望输出（未配置 expectedOutput 且用例无参考答案）", { reason: "missing_expected" });
      }
      const expected = normalize(expectedRaw, caseSensitive, trimWhitespace);
      const actual = normalize(ctx.actualOutput, caseSensitive, trimWhitespace);
      const ok = expected === actual;
      return ok
        ? pass("实际输出与期望输出完全一致", { expected: expectedRaw, actual: ctx.actualOutput })
        : fail("实际输出与期望输出不一致", { expected: expectedRaw, actual: ctx.actualOutput, caseSensitive, trimWhitespace });
    },
  },
  {
    id: "contains",
    name: "关键词包含",
    description: "实际输出必须包含指定关键词（全部或任一）",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: containsSchema,
    evaluate: (ctx, config) => {
      const patterns = cfgStrArr(config, "patterns");
      if (patterns.length === 0) {
        return fail("未配置匹配关键词", { reason: "missing_config" });
      }
      const mode = config.mode === "any" ? "any" : "all";
      const caseSensitive = cfgBool(config, "caseSensitive");
      const text = caseSensitive ? ctx.actualOutput : ctx.actualOutput.toLowerCase();
      const matches = patterns.map((p) => {
        const needle = caseSensitive ? p : p.toLowerCase();
        return { pattern: p, hit: text.includes(needle) };
      });
      const ok = mode === "all" ? matches.every((m) => m.hit) : matches.some((m) => m.hit);
      const summary = ok
        ? mode === "all"
          ? `全部 ${patterns.length} 个关键词均出现`
          : `关键词已出现（${matches.filter((m) => m.hit).length}/${patterns.length}）`
        : mode === "all"
          ? `缺少关键词：${matches.filter((m) => !m.hit).map((m) => m.pattern).join("、")}`
          : `所有关键词均未出现`;
      return ok ? pass(summary, { mode, matches }) : fail(summary, { mode, matches });
    },
  },
  {
    id: "fuzzy-match",
    name: "模糊匹配",
    description: "与参考答案的字面相似度达到阈值即通过",
    category: RULE_CATEGORY,
    type: "rule",
    needsReference: true,
    configSchema: fuzzyMatchSchema,
    evaluate: (ctx, config) => {
      const reference = ctx.referenceOutput;
      if (!reference) {
        return fail("缺少参考答案，无法计算相似度", { reason: "missing_reference" });
      }
      const threshold = Math.min(1, Math.max(0, cfgNum(config, "threshold") ?? 0.8));
      const { similarity: sim, distance } = similarity(ctx.actualOutput, reference);
      const score = Math.round(sim * 100);
      const summary = `相似度 ${(sim * 100).toFixed(1)}%（阈值 ${(threshold * 100).toFixed(0)}%，编辑距离 ${distance}）`;
      const evidence = { similarity: Number(sim.toFixed(4)), threshold, distance, actualLength: Array.from(ctx.actualOutput).length, referenceLength: Array.from(reference).length };
      if (sim >= threshold) return pass(summary, evidence);
      if (sim >= threshold - 0.05) {
        return { score, confidence: 1, verdict: "warn", summary, evidence };
      }
      return fail(summary, evidence);
    },
  },
  {
    id: "regex-match",
    name: "正则匹配",
    description: "实际输出匹配指定正则表达式",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: regexMatchSchema,
    evaluate: (ctx, config) => {
      const pattern = cfgStr(config, "pattern");
      if (!pattern) {
        return fail("未配置正则表达式", { reason: "missing_config" });
      }
      const flags = cfgStr(config, "flags") ?? "";
      const matchMode = config.matchMode === "full" ? "full" : "partial";
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch (err) {
        throw new Error(`非法正则表达式: ${err instanceof Error ? err.message : String(err)}`);
      }
      const matched = ctx.actualOutput.match(re);
      const ok = matchMode === "full" ? matched !== null && matched[0] === ctx.actualOutput : matched !== null;
      const summary = ok
        ? `正则命中（${matchMode === "full" ? "整串" : "包含"}匹配）`
        : "正则未命中";
      return ok ? pass(summary, { pattern, flags, matchMode, matched: matched?.[0] }) : fail(summary, { pattern, flags, matchMode, matched: null });
    },
  },
  {
    id: "json-schema",
    name: "JSON 结构校验",
    description: "实际输出必须是合法 JSON 且符合给定 Schema",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: jsonSchemaField,
    evaluate: (ctx, config) => {
      const schema = config.schema;
      if (schema === undefined || schema === null || schema === "") {
        return fail("未配置 JSON Schema", { reason: "missing_config" });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(ctx.actualOutput);
      } catch (err) {
        return fail(`实际输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}`, { parseError: String(err instanceof Error ? err.message : err), actualPreview: ctx.actualOutput.slice(0, 500) });
      }
      let schemaObj: unknown = schema;
      if (typeof schemaObj === "string") {
        try {
          schemaObj = JSON.parse(schemaObj);
        } catch {
          return fail("配置的 Schema 不是合法 JSON", { reason: "invalid_schema" });
        }
      }
      let validate: ReturnType<Ajv["compile"]>;
      try {
        const ajv = new Ajv({ allErrors: true });
        validate = ajv.compile(schemaObj as object);
      } catch (err) {
        throw new Error(`Schema 编译失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      const ok = validate(parsed);
      if (ok) return pass("输出符合 JSON Schema", { valid: true });
      return fail("输出不符合 JSON Schema", { valid: false, errors: validate.errors });
    },
  },
  {
    id: "tool-sequence",
    name: "工具轨迹断言",
    description: "校验工具调用的名单、顺序与次数（must/forbid/order/min/max）",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: toolSequenceSchema,
    evaluate: (ctx, config) => {
      const mustCall = cfgStrArr(config, "mustCall");
      const forbidCall = cfgStrArr(config, "forbidCall");
      const callOrder = cfgStrArr(config, "callOrder");
      const minCalls = cfgNum(config, "minCalls");
      const maxCalls = cfgNum(config, "maxCalls");
      if (mustCall.length === 0 && forbidCall.length === 0 && callOrder.length === 0 && minCalls === undefined && maxCalls === undefined) {
        return fail("未配置任何轨迹断言", { reason: "missing_config" });
      }

      const names = ctx.trace.map((t) => t.name);
      const counts = new Map<string, number>();
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
      const violations: string[] = [];

      for (const tool of mustCall) {
        if (!counts.has(tool)) violations.push(`必须调用的工具未调用: ${tool}`);
      }
      for (const tool of forbidCall) {
        const c = counts.get(tool);
        if (c !== undefined) violations.push(`禁止调用的工具被调用: ${tool}（${c} 次）`);
      }
      if (callOrder.length > 0) {
        let pointer = 0;
        for (const n of names) {
          if (pointer < callOrder.length && n === callOrder[pointer]) pointer++;
        }
        if (pointer < callOrder.length) {
          violations.push(`调用顺序不满足（子序列校验）: 期望 ${callOrder.join(" → ")}`);
        }
      }
      if (minCalls !== undefined && names.length < minCalls) {
        violations.push(`总调用次数 ${names.length} 低于下限 ${minCalls}`);
      }
      if (maxCalls !== undefined && names.length > maxCalls) {
        violations.push(`总调用次数 ${names.length} 超过上限 ${maxCalls}`);
      }

      const actualCalls = Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
      const evidence = { violations, actualCalls, totalCalls: names.length };
      if (violations.length > 0) return fail(`轨迹断言不满足（${violations.length} 项违规）`, evidence);
      return pass("轨迹断言全部满足", evidence);
    },
  },
  {
    id: "threshold",
    name: "性能阈值",
    description: "会话 token 与耗时不超过配置上限",
    category: RULE_CATEGORY,
    type: "rule",
    configSchema: thresholdSchema,
    evaluate: (ctx, config) => {
      if (!ctx.stats) {
        throw new Error("无会话统计数据（用例未关联 session），threshold 评估器无法执行");
      }
      const limits: { key: string; label: string; actual: number; limit: number }[] = [];
      const entries: [string, string, number][] = [
        ["maxTotalTokens", "总 token", ctx.stats.totalTokens],
        ["maxInputTokens", "输入 token", ctx.stats.inputTokens],
        ["maxOutputTokens", "输出 token", ctx.stats.outputTokens],
        ["maxDurationMs", "总耗时(ms)", ctx.stats.durationMs],
      ];
      for (const [key, label, actual] of entries) {
        const limit = cfgNum(config, key);
        if (limit !== undefined) limits.push({ key, label, actual, limit });
      }
      if (limits.length === 0) {
        return fail("未配置任何阈值", { reason: "missing_config" });
      }
      const metrics = limits.map((m) => ({ ...m, exceeded: m.actual > m.limit }));
      const exceeded = metrics.filter((m) => m.exceeded);
      const evidence = { metrics, stats: ctx.stats };
      if (exceeded.length > 0) {
        return fail(`超出预算：${exceeded.map((m) => `${m.label} ${m.actual} > ${m.limit}`).join("，")}`, evidence);
      }
      return pass("全部指标在预算内", evidence);
    },
  },
];

export { RULE_EVALUATORS };
