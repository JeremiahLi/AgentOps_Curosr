import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * LLM 看板聚合（成本 / 性能 / 缓存效率视角）。
 *
 * 回答两件事：
 *   1. 钱花在哪 —— 模型维度的 Token 构成、成本指数、缓存读取量
 *   2. 谁慢谁错 —— 单次调用的耗时分位与失败调用
 *
 * 口径铁律（与 session-board.ts 同源）：
 * - 时间过滤一律用 **Session.startTime**（发生时间），禁用 Span.createdAt（入库时间，
 *   全库都落在最近几天）。Span 级统计必须 JOIN Session 再按 s.startTime 过滤。
 * - 成本不按「input + output」算（那是 session-board 的可计费口径）。实测全库 cacheRead
 *   是 input 的 11 倍，缓存型模型的成本几乎全在 cacheRead 上，沿用旧口径会把它们排到
 *   腰部以下。本模块用**相对权重成本指数**，权重是假设（见 COST_WEIGHTS），不是真实单价。
 * - 缓存命中率 = cacheRead / (input + cacheRead)。实测 78% 的 span 满足
 *   total = input + output + cacheRead + cacheWrite，即 inputTokens 不含 cache。
 *   cacheWrite 不是命中候选，不进分母。
 * - SQLite 的 AVG 返回 REAL，Prisma 反序列化会抛错，所有 AVG 必须 CAST(... AS INTEGER)；
 *   比率一律在 SQL 内不除，回到 TS 侧算。
 *
 * 数据可信度闸门（踩过的坑）：
 * 采集端/构造数据里 duration 可能是写死的占位值 —— 实测 gpt-4o / deepseek-v3 /
 * claude-sonnet-4.5 / qwen-max / glm-4.6 的 llm_thinking span **100% 等于 1500ms**。
 * 不加闸门会得出「gpt-4o 比 LongCat 快 9 倍」的错误结论。因此按 `distinct(duration)`
 * 判定耗时是否可信，不可信的模型不参与耗时排名，全局 P50/P90 也只统计可信模型。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 趋势图最多展示天数（all 档跨度大时只画最近 60 天） */
const SERIES_MAX_DAYS = 60;
/** 调用量趋势图最多画几条模型曲线 */
const TOP_MODELS_IN_TREND = 6;
/** 轮次曲线的最大轮次，超出合并为 "9+" */
const MAX_ROUND = 9;
/** Token 突增：当日总量下限，低于此值不报（小样本噪声） */
const SPIKE_MIN_TOKENS = 50_000;
/** Token 突增：相对前 7 日中位数的倍数阈值 */
const SPIKE_RATIO = 3;
/** Token 突增：基准至少需要几个有数据的天 */
const SPIKE_MIN_BASELINE_DAYS = 3;
/** 耗时可信判定：有效样本下限 */
const TRUST_MIN_CALLS = 10;
/** 耗时可信判定：不同取值占比下限（低于此值说明是占位/硬编码） */
const TRUST_MIN_DISTINCT_RATIO = 0.05;
/** 失败调用列表条数上限 */
const TOP_FAILED_CALLS = 20;

/**
 * 成本相对权重（假设，非真实计价）：以 input 为 1。
 * output 生成成本普遍是输入的 3~5 倍；cacheRead 约为输入的 0.1；cacheWrite 约 1.25。
 * 前端必须把「相对权重、非实际金额」写在图注/列头里，不得伪装成金额。
 */
export const COST_WEIGHTS = {
  input: 1,
  output: 4,
  cacheRead: 0.1,
  cacheWrite: 1.25,
} as const;

/* ------------------------------- 类型 ------------------------------- */

export interface LlmTokenMix {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmBoardKpi extends LlmTokenMix {
  calls: number;
  callsPrev: number | null;
  /** 窗口内有 LLM 调用的会话数 */
  sessions: number;
  /** 涉及 Agent 数 */
  agents: number;
  /** 有调用的模型数 */
  models: number;

  costIndex: number;
  costIndexPrev: number | null;

  /** cacheRead / (input + cacheRead) */
  cacheHitRate: number;
  cacheHitRatePrev: number | null;
  /** 每次调用平均缓存读取量，缓存型成本的直观指标 */
  cacheReadPerCall: number;

  /** 单次调用耗时（仅统计耗时可信的模型） */
  durationP50: number;
  durationP90: number;
  /** 参与耗时计算的调用数 */
  durationSamples: number;

  failedCalls: number;
  /** 终态失败的会话数（按模型去重前，会话维度） */
  failedSessions: number;

  timingTrustedModels: number;
  timingUntrustedModels: number;
}

export interface LlmModelRow extends LlmTokenMix {
  model: string;
  calls: number;
  /** 调用占比 % */
  callShare: number;
  sessions: number;
  agents: number;
  /** (input + output) / calls */
  avgTokensPerCall: number;
  avgCacheReadPerCall: number;
  cacheHitRate: number;
  costIndex: number;
  /** 成本指数占比 % */
  costShare: number;
  /** 单次调用耗时分位 */
  p50: number;
  p90: number;
  /** false = 耗时不可信（distinct(duration) 过少，典型为采集端占位值） */
  timingTrusted: boolean;
  distinctDurations: number;
  failedCalls: number;
  /** 该模型参与的会话中终态失败的条数（多模型会话会计入每个模型） */
  failedSessions: number;
  /** ISO；无记录为 null */
  lastUsedAt: string | null;
}

export interface LlmSpike {
  model: string;
  /** YYYY-MM-DD */
  date: string;
  tokens: number;
  /** 前 7 日的中位数 */
  baseline: number;
  ratio: number;
  calls: number;
}

export interface LlmFailedCall {
  spanId: string;
  sessionId: string;
  sessionTitle: string;
  agentName: string;
  model: string;
  status: string;
  error: string;
  /** 会话开始时间（ISO） */
  time: string;
}

export interface LlmSeries {
  labels: string[];
  series: { name: string; data: number[] }[];
}

export interface LlmBoard {
  range: string;
  rangeKey: string;
  spanDays: number;
  meta: {
    costWeights: typeof COST_WEIGHTS;
    /** 成本口径的一句话说明，前端直接展示 */
    costNote: string;
    /** 耗时闸门说明 */
    timingNote: string;
    seriesDays: number;
    topModelsInTrend: number;
    spikeMinTokens: number;
    spikeRatio: number;
  };
  kpi: LlmBoardKpi;
  callTrend: LlmSeries;
  tokenTrend: LlmSeries;
  roundCurve: LlmSeries;
  models: LlmModelRow[];
  spikes: LlmSpike[];
  failedCalls: LlmFailedCall[];
}

export interface LlmBoardOptions {
  startMs: number;
  /** 区间跨度天数，用于上期窗口；all 档传实际数据跨度 */
  spanDays: number;
}

/* ------------------------------- 工具 ------------------------------- */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? s[lo] : Math.round((s[lo] + s[hi]) / 2);
}

function costOf(t: LlmTokenMix): number {
  return (
    t.inputTokens * COST_WEIGHTS.input +
    t.outputTokens * COST_WEIGHTS.output +
    t.cacheReadTokens * COST_WEIGHTS.cacheRead +
    t.cacheWriteTokens * COST_WEIGHTS.cacheWrite
  );
}

/** 缓存命中率 %：cacheRead / (input + cacheRead)，分母为 0 时返回 0 */
function hitRateOf(t: LlmTokenMix): number {
  const denom = t.inputTokens + t.cacheReadTokens;
  return denom > 0 ? (t.cacheReadTokens / denom) * 100 : 0;
}

/** 统一的时间过滤条件：Span 汇总一律 JOIN Session 按 startTime 过滤 */
function windowCondition(fromMs: number, toMs: number): Prisma.Sql {
  return Prisma.sql`sp.kind = 'llm_thinking' AND s.startTime >= ${fromMs} AND s.startTime < ${toMs}`;
}

/** 补零的连续日序列：all 档从最早数据日起，最多回溯 SERIES_MAX_DAYS 天 */
function buildDayKeys(observed: string[], startMs: number, nowMs: number): string[] {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  let fromMs: number;
  if (startMs > 0) {
    fromMs = startMs;
  } else {
    const sorted = [...observed].sort();
    if (sorted.length === 0) return [];
    fromMs = new Date(`${sorted[0]}T00:00:00`).getTime();
  }
  const startOfFrom = new Date(fromMs);
  startOfFrom.setHours(0, 0, 0, 0);
  const earliest = Math.max(
    startOfFrom.getTime(),
    today.getTime() - (SERIES_MAX_DAYS - 1) * DAY_MS,
  );
  const count = Math.max(1, Math.round((today.getTime() - earliest) / DAY_MS) + 1);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ymdLocal(new Date(earliest + i * DAY_MS)));
  return out;
}

/* ------------------------------ 主函数 ------------------------------ */

export async function getLlmBoard(
  prisma: PrismaClient,
  opts: LlmBoardOptions,
): Promise<LlmBoard> {
  const now = Date.now();
  // 留一天余量，避免采集端时钟偏移导致最新 span 落在窗口外
  const toMs = now + DAY_MS;
  const { startMs, spanDays } = opts;
  const prevStartMs = startMs > 0 && spanDays > 0 ? startMs - spanDays * DAY_MS : 0;
  const prevToMs = startMs;

  // 趋势/突增需要的日粒度序列窗口：all 档只取最近 60 天，但多回溯 7 天给突增做基准
  const seriesFromMs = Math.max(startMs, now - SERIES_MAX_DAYS * DAY_MS);

  const [
    modelRowsRaw,
    modelDurRaw,
    dailyModelRaw,
    roundRowsRaw,
    totalsRaw,
    prevRaw,
    failedRaw,
  ] = await Promise.all([
    /* 1. 模型维度汇总（含会话/Agent 去重、失败调用、终态失败会话） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(NULLIF(sp.model, ''), '(未标注)')            AS modelName,
             COUNT(*)                                              AS calls,
             COUNT(DISTINCT sp.sessionId)                          AS sessions,
             COUNT(DISTINCT s.agentId)                             AS agents,
             COALESCE(SUM(sp.inputTokens), 0)                      AS inputTokens,
             COALESCE(SUM(sp.outputTokens), 0)                     AS outputTokens,
             COALESCE(SUM(sp.cacheReadTokens), 0)                  AS cacheReadTokens,
             COALESCE(SUM(sp.cacheWriteTokens), 0)                 AS cacheWriteTokens,
             SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failedCalls,
             COUNT(DISTINCT CASE WHEN s.outcome = 'failed' THEN s.id END)     AS failedSessions,
             COUNT(DISTINCT CASE WHEN sp.duration > 0 THEN sp.duration END)   AS distinctDurations,
             MAX(sp.createdAt)                                     AS lastUsedAt
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${windowCondition(startMs, toMs)}
      GROUP BY modelName
      ORDER BY calls DESC
    `,
    /* 2. 模型维度耗时分位（p50/p90，最近秩法，与 session-board 同源） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH d AS (
        SELECT COALESCE(NULLIF(sp.model, ''), '(未标注)') AS model,
               sp.duration                                AS dur,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(NULLIF(sp.model, ''), '(未标注)')
                 ORDER BY sp.duration
               )                                          AS rn,
               COUNT(*) OVER (
                 PARTITION BY COALESCE(NULLIF(sp.model, ''), '(未标注)')
               )                                          AS cnt
        FROM Span sp
        JOIN Session s ON s.id = sp.sessionId
        WHERE ${windowCondition(startMs, toMs)} AND sp.duration > 0
      )
      SELECT model,
             MAX(cnt) AS cnt,
             CAST(AVG(CASE WHEN rn IN ((cnt+1)/2, (cnt+2)/2) THEN dur END) AS INTEGER) AS p50,
             MAX(CASE WHEN rn = CAST((cnt*90+99)/100 AS INT) THEN dur END)             AS p90
      FROM d
      GROUP BY model
    `,
    /* 3. 日 × 模型的调用量与 Token 总量（趋势 + 突增基准，多回溯 7 天）
     *    inWindow 标记是否落在统计窗口内：
     *    - 趋势只用 inWindow=1，保证「图上各日合计 == KPI」（桶按自然日切，窗口首日天然是部分日）
     *    - 突增的基准可以用窗口外的历史日，所以两侧都要取
     */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT date(s.startTime / 1000, 'unixepoch', 'localtime')   AS d,
             COALESCE(NULLIF(sp.model, ''), '(未标注)')            AS modelName,
             CASE WHEN s.startTime >= ${startMs} THEN 1 ELSE 0 END  AS inWindow,
             COUNT(*)                                              AS calls,
             COALESCE(SUM(sp.inputTokens), 0)                      AS inputTokens,
             COALESCE(SUM(sp.outputTokens), 0)                     AS outputTokens,
             COALESCE(SUM(sp.cacheReadTokens), 0)                  AS cacheReadTokens,
             COALESCE(SUM(sp.cacheWriteTokens), 0)                 AS cacheWriteTokens
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${windowCondition(Math.max(0, seriesFromMs - 7 * DAY_MS), toMs)}
      GROUP BY d, modelName, inWindow
      ORDER BY d
    `,
    /* 4. 按轮次的 Token 构成（上下文累积 / 缓存重建的直观证据） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT CASE WHEN sp.roundIndex > ${MAX_ROUND} THEN ${MAX_ROUND} ELSE sp.roundIndex END AS rnd,
             COUNT(*)                                              AS calls,
             CAST(AVG(sp.inputTokens) AS INTEGER)                   AS avgInput,
             CAST(AVG(sp.outputTokens) AS INTEGER)                  AS avgOutput,
             CAST(AVG(sp.cacheReadTokens) AS INTEGER)               AS avgCacheRead
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${windowCondition(startMs, toMs)}
      GROUP BY rnd
      ORDER BY rnd
    `,
    /* 5. 窗口总量（KPI 分子） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*)                                              AS calls,
             COUNT(DISTINCT sp.sessionId)                          AS sessions,
             COUNT(DISTINCT s.agentId)                             AS agents,
             COUNT(DISTINCT COALESCE(NULLIF(sp.model, ''), '(未标注)')) AS models,
             COALESCE(SUM(sp.inputTokens), 0)                      AS inputTokens,
             COALESCE(SUM(sp.outputTokens), 0)                     AS outputTokens,
             COALESCE(SUM(sp.cacheReadTokens), 0)                  AS cacheReadTokens,
             COALESCE(SUM(sp.cacheWriteTokens), 0)                 AS cacheWriteTokens,
             SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failedCalls,
             COUNT(DISTINCT CASE WHEN s.outcome = 'failed' THEN s.id END)     AS failedSessions
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${windowCondition(startMs, toMs)}
    `,
    /* 6. 上期总量（环比） */
    startMs > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT COUNT(*)                                         AS calls,
                 COALESCE(SUM(sp.inputTokens), 0)                 AS inputTokens,
                 COALESCE(SUM(sp.outputTokens), 0)                AS outputTokens,
                 COALESCE(SUM(sp.cacheReadTokens), 0)             AS cacheReadTokens,
                 COALESCE(SUM(sp.cacheWriteTokens), 0)            AS cacheWriteTokens
          FROM Span sp
          JOIN Session s ON s.id = sp.sessionId
          WHERE ${windowCondition(prevStartMs, prevToMs)}
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    /* 7. 失败调用明细（LLM 调用本身失败，与「工具失败」区分） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.id                                               AS spanId,
             sp.sessionId                                        AS sessionId,
             s.title                                            AS sessionTitle,
             a.name                                             AS agentName,
             COALESCE(NULLIF(sp.model, ''), '(未标注)')          AS model,
             sp.status                                          AS status,
             COALESCE(sp.error, '')                             AS error,
             s.startTime                                        AS startTime
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      JOIN Agent a   ON a.id = s.agentId
      WHERE ${windowCondition(startMs, toMs)}
        AND (sp.status IN ('failed','error') OR (sp.error IS NOT NULL AND sp.error <> ''))
      ORDER BY s.startTime DESC
      LIMIT ${TOP_FAILED_CALLS}
    `,
  ]);

  /* --------------------------- 模型维度 --------------------------- */

  const durMap = new Map<string, { cnt: number; p50: number; p90: number }>();
  for (const raw of modelDurRaw) {
    const r = normalizeRow(raw);
    durMap.set(String(r.model), {
      cnt: num(r.cnt),
      p50: num(r.p50),
      p90: num(r.p90),
    });
  }

  interface ModelAgg {
    model: string;
    calls: number;
    sessions: number;
    agents: number;
    tokens: LlmTokenMix;
    failedCalls: number;
    failedSessions: number;
    distinctDurations: number;
    lastUsedAt: number;
  }

  const modelAggs: ModelAgg[] = modelRowsRaw.map((raw) => {
    const r = normalizeRow(raw);
    return {
      model: String(r.modelName),
      calls: num(r.calls),
      sessions: num(r.sessions),
      agents: num(r.agents),
      tokens: {
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        cacheReadTokens: num(r.cacheReadTokens),
        cacheWriteTokens: num(r.cacheWriteTokens),
      },
      failedCalls: num(r.failedCalls),
      failedSessions: num(r.failedSessions),
      distinctDurations: num(r.distinctDurations),
      lastUsedAt: num(r.lastUsedAt),
    };
  });

  const totals = totalsRaw.length > 0 ? normalizeRow(totalsRaw[0]) : {};
  const totalCalls = num(totals.calls);
  const totalTokens: LlmTokenMix = {
    inputTokens: num(totals.inputTokens),
    outputTokens: num(totals.outputTokens),
    cacheReadTokens: num(totals.cacheReadTokens),
    cacheWriteTokens: num(totals.cacheWriteTokens),
  };
  const totalCost = costOf(totalTokens);

  /** 耗时可信判定：样本足够 且 duration 取值足够分散（占位值只有 1 个取值） */
  const isTimingTrusted = (agg: ModelAgg): boolean => {
    const distinct = agg.distinctDurations;
    if (agg.calls < TRUST_MIN_CALLS || distinct <= 1) return false;
    return distinct / Math.max(1, agg.calls) >= TRUST_MIN_DISTINCT_RATIO;
  };

  const models: LlmModelRow[] = modelAggs
    .map((agg) => {
      const dur = durMap.get(agg.model);
      const costIndex = costOf(agg.tokens);
      return {
        model: agg.model,
        calls: agg.calls,
        callShare: totalCalls > 0 ? (agg.calls / totalCalls) * 100 : 0,
        sessions: agg.sessions,
        agents: agg.agents,
        ...agg.tokens,
        avgTokensPerCall:
          agg.calls > 0 ? Math.round((agg.tokens.inputTokens + agg.tokens.outputTokens) / agg.calls) : 0,
        avgCacheReadPerCall:
          agg.calls > 0 ? Math.round(agg.tokens.cacheReadTokens / agg.calls) : 0,
        cacheHitRate: hitRateOf(agg.tokens),
        costIndex: Math.round(costIndex),
        costShare: totalCost > 0 ? (costIndex / totalCost) * 100 : 0,
        p50: dur?.p50 ?? 0,
        p90: dur?.p90 ?? 0,
        timingTrusted: isTimingTrusted(agg),
        distinctDurations: agg.distinctDurations,
        failedCalls: agg.failedCalls,
        failedSessions: agg.failedSessions,
        lastUsedAt: agg.lastUsedAt > 0 ? new Date(agg.lastUsedAt).toISOString() : null,
      };
    })
    .sort((a, b) => b.costIndex - a.costIndex || b.calls - a.calls);

  const trustedModels = models.filter((m) => m.timingTrusted).map((m) => m.model);

  /* -------------- 全局耗时：只统计耗时可信的模型 -------------- */

  let durationP50 = 0;
  let durationP90 = 0;
  let durationSamples = 0;
  if (trustedModels.length > 0) {
    const durCond = Prisma.sql`AND COALESCE(NULLIF(sp.model, ''), '(未标注)') IN (${Prisma.join(trustedModels)})`;
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      WITH d AS (
        SELECT sp.duration AS dur,
               ROW_NUMBER() OVER (ORDER BY sp.duration) AS rn,
               COUNT(*) OVER ()                          AS cnt
        FROM Span sp
        JOIN Session s ON s.id = sp.sessionId
        WHERE ${windowCondition(startMs, toMs)} AND sp.duration > 0 ${durCond}
      )
      SELECT MAX(cnt) AS cnt,
             CAST(AVG(CASE WHEN rn IN ((cnt+1)/2, (cnt+2)/2) THEN dur END) AS INTEGER) AS p50,
             MAX(CASE WHEN rn = CAST((cnt*90+99)/100 AS INT) THEN dur END)             AS p90
      FROM d
    `;
    const r = rows.length > 0 ? normalizeRow(rows[0]) : {};
    durationP50 = num(r.p50);
    durationP90 = num(r.p90);
    durationSamples = num(r.cnt);
  }

  /* --------------------------- 趋势序列 --------------------------- */

  const dayModelRows = dailyModelRaw.map((raw) => {
    const r = normalizeRow(raw);
    return {
      d: String(r.d ?? ""),
      model: String(r.modelName),
      inWindow: num(r.inWindow) === 1,
      calls: num(r.calls),
      tokens: {
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        cacheReadTokens: num(r.cacheReadTokens),
        cacheWriteTokens: num(r.cacheWriteTokens),
      },
    };
  });

  const dayKeys = buildDayKeys(
    dayModelRows.map((r) => r.d).filter(Boolean),
    seriesFromMs,
    now,
  );
  const dayIndex = new Map<string, number>();
  dayKeys.forEach((d, i) => dayIndex.set(d, i));

  // 调用量趋势：取窗口内调用数 Top N 的模型（按整段窗口排，不随单日波动换人）
  const topTrendModels = [...models]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, TOP_MODELS_IN_TREND)
    .map((m) => m.model);

  const callSeries = new Map<string, number[]>();
  for (const name of topTrendModels) callSeries.set(name, new Array(dayKeys.length).fill(0));
  const tokenSums = {
    input: new Array(dayKeys.length).fill(0) as number[],
    output: new Array(dayKeys.length).fill(0) as number[],
    cacheRead: new Array(dayKeys.length).fill(0) as number[],
    cacheWrite: new Array(dayKeys.length).fill(0) as number[],
  };
  for (const row of dayModelRows) {
    // 趋势只统计窗口内的行，保证图上合计与 KPI 一致
    if (!row.inWindow) continue;
    const idx = dayIndex.get(row.d);
    if (idx === undefined) continue;
    // all 档窗口外的历史日会被截断，只在 KPI 里体现，不进趋势
    if (row.d < dayKeys[0] || row.d > dayKeys[dayKeys.length - 1]) continue;
    const series = callSeries.get(row.model);
    if (series) series[idx] += row.calls;
    tokenSums.input[idx] += row.tokens.inputTokens;
    tokenSums.output[idx] += row.tokens.outputTokens;
    tokenSums.cacheRead[idx] += row.tokens.cacheReadTokens;
    tokenSums.cacheWrite[idx] += row.tokens.cacheWriteTokens;
  }

  // X 轴标签与其它看板一致：M/D
  const labels = dayKeys.map((d) => {
    const parts = d.split("-");
    return `${Number(parts[1])}/${Number(parts[2])}`;
  });

  const callTrend: LlmSeries = {
    labels,
    series: topTrendModels.map((name) => ({ name, data: callSeries.get(name) ?? [] })),
  };

  const tokenTrend: LlmSeries = {
    labels,
    series: [
      { name: "输入", data: tokenSums.input },
      { name: "输出", data: tokenSums.output },
      { name: "缓存读", data: tokenSums.cacheRead },
      { name: "缓存写", data: tokenSums.cacheWrite },
    ],
  };

  /* --------------------------- 轮次曲线 --------------------------- */

  const roundMap = new Map<number, { calls: number; input: number; output: number; cacheRead: number }>();
  for (const raw of roundRowsRaw) {
    const r = normalizeRow(raw);
    roundMap.set(num(r.rnd), {
      calls: num(r.calls),
      input: num(r.avgInput),
      output: num(r.avgOutput),
      cacheRead: num(r.avgCacheRead),
    });
  }
  const roundIdx = Array.from(roundMap.keys()).sort((a, b) => a - b);
  const roundCurve: LlmSeries = {
    // 标签用纯数字：10 个「第N轮」在 1440 半宽卡片里会挤成一团
    labels: roundIdx.map((i) => (i >= MAX_ROUND ? `${MAX_ROUND}+` : `${i + 1}`)),
    series: [
      { name: "输入", data: roundIdx.map((i) => roundMap.get(i)?.input ?? 0) },
      { name: "输出", data: roundIdx.map((i) => roundMap.get(i)?.output ?? 0) },
      { name: "缓存读", data: roundIdx.map((i) => roundMap.get(i)?.cacheRead ?? 0) },
    ],
  };

  /* --------------------------- Token 突增 --------------------------- */

  const tokensOfRow = (t: LlmTokenMix) =>
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

  const byModelDays = new Map<string, { d: string; tokens: number; calls: number }[]>();
  for (const row of dayModelRows) {
    if (!row.d) continue;
    const list = byModelDays.get(row.model) ?? [];
    // 同一自然日可能被 inWindow 切成两条（窗口首日），对突增检测要合并成整天
    const hit = list.find((x) => x.d === row.d);
    if (hit) {
      hit.tokens += tokensOfRow(row.tokens);
      hit.calls += row.calls;
    } else {
      list.push({ d: row.d, tokens: tokensOfRow(row.tokens), calls: row.calls });
    }
    byModelDays.set(row.model, list);
  }

  const spikes: LlmSpike[] = [];
  for (const [model, list] of byModelDays) {
    const sorted = [...list].sort((a, b) => a.d.localeCompare(b.d));
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      // 只看趋势窗口内的日期（更早的历史仅作基准）
      if (dayIndex.get(cur.d) === undefined) continue;
      if (cur.tokens < SPIKE_MIN_TOKENS) continue;
      const prevDays = sorted
        .slice(Math.max(0, i - 7), i)
        .filter((x) => x.tokens > 0)
        .map((x) => x.tokens);
      if (prevDays.length < SPIKE_MIN_BASELINE_DAYS) continue;
      const base = median(prevDays);
      if (base <= 0) continue;
      const ratio = cur.tokens / base;
      if (ratio < SPIKE_RATIO) continue;
      spikes.push({
        model,
        date: cur.d,
        tokens: cur.tokens,
        baseline: base,
        ratio: Number(ratio.toFixed(1)),
        calls: cur.calls,
      });
    }
  }
  spikes.sort((a, b) => b.date.localeCompare(a.date) || b.ratio - a.ratio);

  /* --------------------------- 失败调用 --------------------------- */

  const failedCalls: LlmFailedCall[] = failedRaw.map((raw) => {
    const r = normalizeRow(raw);
    return {
      spanId: String(r.spanId ?? ""),
      sessionId: String(r.sessionId ?? ""),
      sessionTitle: String(r.sessionTitle ?? ""),
      agentName: String(r.agentName ?? ""),
      model: String(r.model ?? ""),
      status: String(r.status ?? ""),
      error: String(r.error ?? ""),
      time: new Date(num(r.startTime)).toISOString(),
    };
  });

  /* ------------------------------ KPI ------------------------------ */

  const prev = prevRaw.length > 0 ? normalizeRow(prevRaw[0]) : null;
  const prevTokens: LlmTokenMix | null = prev
    ? {
        inputTokens: num(prev.inputTokens),
        outputTokens: num(prev.outputTokens),
        cacheReadTokens: num(prev.cacheReadTokens),
        cacheWriteTokens: num(prev.cacheWriteTokens),
      }
    : null;

  const kpi: LlmBoardKpi = {
    calls: totalCalls,
    callsPrev: prev ? num(prev.calls) : null,
    sessions: num(totals.sessions),
    agents: num(totals.agents),
    models: num(totals.models),
    ...totalTokens,
    costIndex: Math.round(totalCost),
    costIndexPrev: prevTokens ? Math.round(costOf(prevTokens)) : null,
    cacheHitRate: hitRateOf(totalTokens),
    cacheHitRatePrev: prevTokens ? hitRateOf(prevTokens) : null,
    cacheReadPerCall: totalCalls > 0 ? Math.round(totalTokens.cacheReadTokens / totalCalls) : 0,
    durationP50,
    durationP90,
    durationSamples,
    failedCalls: num(totals.failedCalls),
    failedSessions: num(totals.failedSessions),
    timingTrustedModels: trustedModels.length,
    timingUntrustedModels: models.length - trustedModels.length,
  };

  return {
    range: "",
    rangeKey: "",
    spanDays,
    meta: {
      costWeights: COST_WEIGHTS,
      costNote:
        "成本指数按相对权重折算（输入×1、输出×4、缓存读×0.1、缓存写×1.25），用于横向比较「谁更贵」，不代表实际金额",
      timingNote:
        "耗时只统计 duration 取值足够分散的模型；取值恒定的模型多为采集端占位值，不参与耗时排名",
      seriesDays: dayKeys.length,
      topModelsInTrend: TOP_MODELS_IN_TREND,
      spikeMinTokens: SPIKE_MIN_TOKENS,
      spikeRatio: SPIKE_RATIO,
    },
    kpi,
    callTrend,
    tokenTrend,
    roundCurve,
    models,
    spikes,
    failedCalls,
  };
}
