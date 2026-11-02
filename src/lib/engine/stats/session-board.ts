import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";
import { successRateOf } from "./health";
import { SQL_BAD, SQL_FINISHED, SQL_PARTIAL } from "./session-outcome";

/**
 * Session 看板聚合（运维视角）。
 *
 * 回答三类问题：
 *   1. 全局水位 —— 会话量 / 成功率 / 成本 / 耗时的分布与趋势
 *   2. 谁不正常 —— 单个 Session 相对「同 Agent 同窗口中位数」的偏离，超出 P90 的指标计数
 *   3. 为什么 —— 思考耗时 vs 工具耗时占比、工具失败率，用来区分慢在模型还是慢在工具
 *
 * 口径铁律（与 agent-board.ts 同源，踩过的坑不要重踩）：
 * - 时间过滤一律用 Session.startTime（发生时间），禁用 Span.createdAt（入库时间，全库都落在最近几天）。
 * - 会话成败一律用 Session.outcome（见 session-outcome.ts），不用 errorCount 判会话失败；
 *   active 与空会话（totalSpans=0）不进成功率分母，也不进基准样本。
 * - 成本 = input + output，不含 cache。缓存命中高是优点，混进总量会让「谁贵」失真。
 * - SQLite 的 AVG 返回 REAL，Prisma 反序列化会抛 "cannot be converted to a BigInt"，
 *   所有 AVG 必须 CAST(... AS INTEGER)；所有比率在 SQL 内放大成整数再在 TS 侧除回来。
 * - 中位数依赖 SQLite 整数除法 (cnt+1)/2，不能写成 cnt/2.0。
 *
 * 待跟进：本项目「工具调用」有两套口径 —— 本模块与 trace 前端算 tool_call + command，
 * 而 agent-board.ts 的 toolCalls 只算 tool_call。当前库里 command 为 0，数字暂时一致；
 * 采集端开始上报 command 后 Agent 看板会偏低，届时需统一（不要在本模块改回窄口径）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 低于该样本量不单独建 Agent 基准，退回全局基准（前端必须显著标注） */
export const MIN_BASELINE_SAMPLES = 8;
/** 散点返回上限：异常点全保留，其余等距抽样 */
export const SCATTER_CAP = 600;
/** 日序列最多展示天数（all 档跨度大时只画最近 60 天） */
const SERIES_MAX_DAYS = 60;
/** 异常榜单条数 */
const TOP_ANOMALIES = 12;
/**
 * 判定「异常会话」的最少超线项数。
 * 为什么不是 1 项：8 个指标各自取 P90，若独立则 1-0.9^8≈57% 的会话至少会超 1 项，
 * 「超 1 项」等于全员异常，失去筛查价值。实测本项目（209 个有效会话）：
 * 超 1 项 39%、超 2 项 19%、超 3 项 11% —— 取 2 项才能把噪声压到可读区间。
 */
const ANOMALY_MIN_SCORE = 2;
/** 严重：至少 4 项超线，通常意味着「成本高 + 耗时高 + 轮次多」同时发生 */
const SEVERE_MIN_SCORE = 4;

/* ------------------------------- 类型 ------------------------------- */

export type SessionMetricKey =
  | "billableTokens"
  | "durationMs"
  | "perRoundMs"
  | "llmCalls"
  | "toolCalls"
  | "toolsPerLlm"
  | "thinkSharePct"
  | "toolFailPct";

interface MetricDef {
  key: SessionMetricKey;
  label: string;
  /** ps CTE 里的列名 */
  col: string;
  /** 列值是放大后的整数，除以该值还原（避免 REAL） */
  scale: number;
  /** 格式化用 */
  unit: "tokens" | "ms" | "count" | "ratio" | "pct";
}

/** 8 项全部单向「越大越坏」：低值不是运维问题（短会话天然低），真异常由详情页 Span 树暴露 */
const METRIC_DEFS: MetricDef[] = [
  { key: "billableTokens", label: "可计费 Token", col: "billableTokens", scale: 1, unit: "tokens" },
  { key: "durationMs", label: "总耗时", col: "durationMs", scale: 1, unit: "ms" },
  { key: "perRoundMs", label: "单轮耗时", col: "perRoundMs", scale: 1, unit: "ms" },
  { key: "llmCalls", label: "LLM 调用", col: "llmCalls", scale: 1, unit: "count" },
  { key: "toolCalls", label: "工具调用", col: "toolCalls", scale: 1, unit: "count" },
  { key: "toolsPerLlm", label: "每 LLM 工具数", col: "toolsPerLlmX100", scale: 100, unit: "ratio" },
  { key: "thinkSharePct", label: "思考耗时占比", col: "thinkSharePct", scale: 1, unit: "pct" },
  { key: "toolFailPct", label: "工具失败率", col: "toolFailBp", scale: 100, unit: "pct" },
];

export interface SessionBaselineMetric {
  /** 同组中位数 */
  median: number;
  /** 同组 P90（最近秩法） */
  p90: number;
}

export type SessionBaselineMetrics = Record<SessionMetricKey, SessionBaselineMetric>;

export interface SessionBaseline {
  /** agent = 该 Agent 样本充足；global = 样本不足退回全局 */
  scope: "agent" | "global";
  /** 实际参与基准计算的会话数（scope=global 时是全局样本数） */
  samples: number;
  /** 该 Agent 自身的有效会话数（用于解释为什么退回全局） */
  agentSamples: number;
  /** 基准窗口天数 */
  windowDays: number;
  metrics: SessionBaselineMetrics;
}

export interface SessionBreach {
  key: SessionMetricKey;
  label: string;
  unit: MetricDef["unit"];
  value: number;
  median: number;
  p90: number;
  /** value / p90，> 1 即超线 */
  ratio: number;
}

/** 会话的原始指标（未与基准比较） */
export interface SessionMetricBase {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  userName: string;
  projectName: string;
  title: string;
  /** success / partial / failed / 空串=未知 */
  outcome: string;
  status: string;
  /** ISO */
  startTime: string;
  rounds: number;
  spans: number;

  billableTokens: number;
  totalTokens: number;
  durationMs: number;
  perRoundMs: number;

  llmCalls: number;
  toolCalls: number;
  failedTools: number;
  failedSpans: number;
  toolsPerLlm: number;
  thinkMs: number;
  toolMs: number;
  thinkSharePct: number;
  toolSharePct: number;
  toolFailPct: number;
}

export interface SessionMetricRow extends SessionMetricBase {
  baselineScope: "agent" | "global";
  baselineSamples: number;
  /** 超线指标个数 0..8 */
  score: number;
  /** 超线指标里最大的 value/p90；无超线为 0 */
  maxRatio: number;
  breaches: SessionBreach[];
}

export interface SessionBoardKpi {
  sessions: number;
  sessionsPrev: number | null;
  /** 参与成功率分母的会话数 */
  finished: number;
  success: number;
  partial: number;
  failed: number;
  successRate: number;
  successRatePrev: number | null;

  billableTokens: number;
  billableTokensPrev: number | null;
  /** 每会话可计费 Token 中位数（不是均值：长尾会被个别大会话绑架） */
  billableMedian: number;
  durationMedian: number;
  durationP90: number;

  /** 至少 1 项超 P90 的会话数 */
  anomalySessions: number;
  /** 至少 3 项超 P90 的会话数 */
  severeSessions: number;
  anomalyRate: number;

  llmCalls: number;
  toolCalls: number;
  toolFailPct: number;
  /** 参与基准计算的会话数（排除 active 与空会话） */
  sampleSessions: number;
  /** 样本是否达到 MIN_BASELINE_SAMPLES */
  baselineReady: boolean;
}

export interface SessionBoardDaily {
  days: string[];
  sessions: number[];
  success: number[];
  partial: number[];
  failed: number[];
  /** 当日异常会话数（超 1 项以上） */
  anomalies: number[];
}

export interface SessionBoardAgentRow {
  id: string;
  name: string;
  emoji: string;
  sessions: number;
  baselineScope: "agent" | "global";
  samples: number;
  billableMedian: number;
  billableP90: number;
  durationMedian: number;
  durationP90: number;
  perRoundP90: number;
  toolsPerLlmP90: number;
  toolFailPctMedian: number;
  anomalySessions: number;
}

export interface SessionScatterPoint {
  id: string;
  title: string;
  agentName: string;
  outcome: string;
  /** 可计费 Token */
  x: number;
  /** 端到端耗时 ms */
  y: number;
  score: number;
  ratio: number;
}

export interface SessionDurationBucket {
  label: string;
  count: number;
  anomalies: number;
}

/** 表格用的轻量偏离映射，避免把整份 SessionMetricRow 塞进响应 */
export interface SessionDeviation {
  /** 超线项数 */
  s: number;
  /** 最大倍数 */
  r: number;
  /** 超线指标名（前 3 个） */
  b: string[];
  /** 基准来源 */
  sc: "agent" | "global";
  /** 基准样本数 */
  n: number;
}

export interface SessionBoard {
  range: string;
  rangeKey: string;
  spanDays: number;
  meta: {
    /** 判定基准说明 */
    baseline: "median+p90";
    minSamples: number;
    /** 判定「异常会话」的最少超线项数 */
    anomalyMinScore: number;
    severeMinScore: number;
    baselineReady: boolean;
    scatterTotal: number;
    scatterReturned: number;
  };
  kpi: SessionBoardKpi;
  daily: SessionBoardDaily;
  agents: SessionBoardAgentRow[];
  anomalies: SessionMetricRow[];
  scatter: SessionScatterPoint[];
  durationBuckets: SessionDurationBucket[];
  rowDeviation: Record<string, SessionDeviation>;
}

export interface SessionBoardOptions {
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

/** SQL 里的工具调用口径：command（shell 命令）与 tool_call 同属工具调用 */
const SQL_TOOL_KIND = Prisma.sql`sp.kind IN ('tool_call','command')`;

/* --------------------------- 公共 CTE --------------------------- */

/**
 * 每会话指标 CTE（别名为 ps）。
 * llmCalls / toolCalls 读 Session 的冗余列（与列表页同源，避免两处数字不一致），
 * 其余需要按 kind 拆的量（失败工具数、思考/工具耗时）只能从 Span 聚合。
 */
function sessionMetricCte(
  fromMs: number,
  toMs: number,
  agentId?: string | null,
): Prisma.Sql {
  const agentCond = agentId ? Prisma.sql`AND s.agentId = ${agentId}` : Prisma.empty;
  return Prisma.sql`
    WITH ps AS (
      SELECT
        s.id                                          AS id,
        s.agentId                                     AS agentId,
        a.name                                        AS agentName,
        a.emoji                                       AS agentEmoji,
        u.name                                        AS userName,
        p.name                                        AS projectName,
        s.title                                       AS title,
        s.outcome                                     AS outcome,
        s.status                                      AS status,
        s.startTime                                   AS startTime,
        s.totalRounds                                 AS rounds,
        s.totalSpans                                  AS spans,
        (s.totalInputTokens + s.totalOutputTokens)    AS billableTokens,
        s.totalTokens                                 AS totalTokens,
        s.totalDuration                               AS durationMs,
        CASE WHEN s.totalRounds > 0
             THEN CAST(s.totalDuration * 1.0 / s.totalRounds AS INTEGER)
             ELSE 0 END                               AS perRoundMs,
        s.llmCallCount                                AS llmCalls,
        s.toolCallCount                               AS toolCalls,
        COALESCE(k.failedTools, 0)                    AS failedTools,
        COALESCE(k.failedSpans, 0)                    AS failedSpans,
        COALESCE(k.thinkMs, 0)                        AS thinkMs,
        COALESCE(k.toolMs, 0)                          AS toolMs,
        -- 比率放大成整数，规避 Prisma 对 REAL 的反序列化报错
        CASE WHEN s.llmCallCount > 0
             THEN CAST(s.toolCallCount * 100.0 / s.llmCallCount AS INTEGER)
             ELSE 0 END                               AS toolsPerLlmX100,
        CASE WHEN COALESCE(k.thinkMs, 0) + COALESCE(k.toolMs, 0) > 0
             THEN CAST(COALESCE(k.thinkMs, 0) * 100.0
                       / (COALESCE(k.thinkMs, 0) + COALESCE(k.toolMs, 0)) AS INTEGER)
             ELSE 0 END                               AS thinkSharePct,
        CASE WHEN s.toolCallCount > 0
             THEN CAST(COALESCE(k.failedTools, 0) * 10000.0 / s.toolCallCount AS INTEGER)
             ELSE 0 END                               AS toolFailBp
      FROM Session s
      JOIN Agent   a ON a.id = s.agentId
      JOIN Project p ON p.id = s.projectId
      JOIN User    u ON u.id = s.userId
      LEFT JOIN (
        SELECT sp.sessionId                                          AS sessionId,
               SUM(CASE WHEN ${SQL_TOOL_KIND} AND sp.status = 'failed' THEN 1 ELSE 0 END) AS failedTools,
               SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END)           AS failedSpans,
               -- llmThinkDuration 覆盖 97%，缺失时用 span 总时长兜底
               SUM(CASE WHEN sp.kind = 'llm_thinking'
                        THEN COALESCE(sp.llmThinkDuration, sp.duration) ELSE 0 END)       AS thinkMs,
               -- toolDuration 覆盖约 45%，缺失时同样兜底（精度受限，不影响比值量级）
               SUM(CASE WHEN ${SQL_TOOL_KIND}
                        THEN COALESCE(sp.toolDuration, sp.duration) ELSE 0 END)           AS toolMs
        FROM Span sp
        JOIN Session s2 ON s2.id = sp.sessionId
        WHERE s2.startTime >= ${fromMs} AND s2.startTime < ${toMs}
        GROUP BY sp.sessionId
      ) k ON k.sessionId = s.id
      WHERE s.startTime >= ${fromMs} AND s.startTime < ${toMs}
        ${agentCond}
        -- 与成功率分母同口径：未收尾的 active 与空会话不参与基准
        AND s.status <> 'active'
        AND s.totalSpans > 0
    )
  `;
}

/** 基准查询：中位数 + P90。byAgent=false 时算全局一组（agentId 恒为 ''） */
function baselineQuery(cte: Prisma.Sql, byAgent: boolean): Prisma.Sql {
  const part = byAgent ? Prisma.sql`PARTITION BY agentId` : Prisma.empty;
  const rnCols = METRIC_DEFS.map(
    (m) =>
      Prisma.sql`ROW_NUMBER() OVER (${part} ORDER BY ${Prisma.raw(m.col)}) AS ${Prisma.raw(`rn_${m.key}`)}`,
  );
  const aggCols = METRIC_DEFS.flatMap((m) => [
    // 偶数取中间两行均值、奇数两行指向同一行，依赖 SQLite 整数除法
    Prisma.sql`CAST(AVG(CASE WHEN ${Prisma.raw(`rn_${m.key}`)} IN ((cnt+1)/2, (cnt+2)/2)
                             THEN ${Prisma.raw(m.col)} END) AS INTEGER) AS ${Prisma.raw(`${m.key}Med`)}`,
    // P90 最近秩法，与 agent-board 的 P95 同源
    Prisma.sql`MAX(CASE WHEN ${Prisma.raw(`rn_${m.key}`)} = CAST((cnt*90+99)/100 AS INT)
                        THEN ${Prisma.raw(m.col)} END) AS ${Prisma.raw(`${m.key}P90`)}`,
  ]);

  return Prisma.sql`
    ${cte},
    ranked AS (
      SELECT ps.*, ${Prisma.join(rnCols)}, COUNT(*) OVER (${part}) AS cnt
      FROM ps
    )
    SELECT ${byAgent ? Prisma.sql`agentId` : Prisma.raw("''")} AS agentId,
           MAX(cnt) AS cnt,
           ${Prisma.join(aggCols)}
    FROM ranked
    GROUP BY ${byAgent ? Prisma.sql`agentId` : Prisma.raw("1")}
  `;
}

/** 把基准行转成 TS 侧的指标对象（相除还原放大倍数） */
function toBaselineMetrics(raw: Record<string, unknown>): SessionBaselineMetrics {
  const r = normalizeRow(raw);
  const out = {} as SessionBaselineMetrics;
  for (const m of METRIC_DEFS) {
    out[m.key] = {
      median: Number(r[`${m.key}Med`] ?? 0) / m.scale,
      p90: Number(r[`${m.key}P90`] ?? 0) / m.scale,
    };
  }
  return out;
}

/* --------------------------- 组装 --------------------------- */

function toMetricRow(raw: Record<string, unknown>): SessionMetricBase {
  const r = normalizeRow(raw);
  const thinkMs = Number(r.thinkMs ?? 0);
  const toolMs = Number(r.toolMs ?? 0);
  const thinkSharePct = Number(r.thinkSharePct ?? 0);
  return {
    id: String(r.id),
    agentId: String(r.agentId),
    agentName: String(r.agentName ?? ""),
    agentEmoji: String(r.agentEmoji ?? ""),
    userName: String(r.userName ?? ""),
    projectName: String(r.projectName ?? ""),
    title: String(r.title ?? ""),
    outcome: String(r.outcome ?? ""),
    status: String(r.status ?? ""),
    startTime: new Date(Number(r.startTime ?? 0)).toISOString(),
    rounds: Number(r.rounds ?? 0),
    spans: Number(r.spans ?? 0),
    billableTokens: Number(r.billableTokens ?? 0),
    totalTokens: Number(r.totalTokens ?? 0),
    durationMs: Number(r.durationMs ?? 0),
    perRoundMs: Number(r.perRoundMs ?? 0),
    llmCalls: Number(r.llmCalls ?? 0),
    toolCalls: Number(r.toolCalls ?? 0),
    failedTools: Number(r.failedTools ?? 0),
    failedSpans: Number(r.failedSpans ?? 0),
    toolsPerLlm: Number(r.toolsPerLlmX100 ?? 0) / 100,
    thinkMs,
    toolMs,
    thinkSharePct,
    toolSharePct: thinkMs + toolMs > 0 ? 100 - thinkSharePct : 0,
    toolFailPct: Number(r.toolFailBp ?? 0) / 100,
  };
}

function pickBaseline(
  agentId: string,
  byAgent: Map<string, { cnt: number; metrics: SessionBaselineMetrics }>,
  global: { cnt: number; metrics: SessionBaselineMetrics },
): { scope: "agent" | "global"; samples: number; metrics: SessionBaselineMetrics } {
  const own = byAgent.get(agentId);
  if (own && own.cnt >= MIN_BASELINE_SAMPLES) {
    return { scope: "agent", samples: own.cnt, metrics: own.metrics };
  }
  return { scope: "global", samples: global.cnt, metrics: global.metrics };
}

function scoreRow(
  row: SessionMetricBase,
  base: { scope: "agent" | "global"; samples: number; metrics: SessionBaselineMetrics },
): SessionMetricRow {
  const breaches: SessionBreach[] = [];
  for (const def of METRIC_DEFS) {
    const value = row[def.key];
    const { median, p90 } = base.metrics[def.key];
    // 工具失败率样本 <3 次调用不判：1/1=100% 会淹没真问题
    if (def.key === "toolFailPct" && row.toolCalls < 3) continue;
    if (p90 > 0 && value > p90) {
      breaches.push({
        key: def.key,
        label: def.label,
        unit: def.unit,
        value,
        median,
        p90,
        ratio: p90 > 0 ? value / p90 : 0,
      });
    }
  }
  breaches.sort((a, b) => b.ratio - a.ratio);
  return {
    ...row,
    baselineScope: base.scope,
    baselineSamples: base.samples,
    score: breaches.length,
    maxRatio: breaches.length > 0 ? breaches[0].ratio : 0,
    breaches,
  };
}

const DURATION_BUCKETS: { label: string; max: number }[] = [
  { label: "<30s", max: 30_000 },
  { label: "30s-1m", max: 60_000 },
  { label: "1-3m", max: 180_000 },
  { label: "3-10m", max: 600_000 },
  { label: "10-30m", max: 1_800_000 },
  { label: ">30m", max: Number.POSITIVE_INFINITY },
];

/** 散点抽样：异常点全保留，其余按时间等距抽样（确定性，不用随机） */
function pickScatter(rows: SessionMetricRow[]): SessionScatterPoint[] {
  const valid = rows
    .filter((r) => r.billableTokens > 0 && r.durationMs > 0)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const toPoint = (r: SessionMetricRow): SessionScatterPoint => ({
    id: r.id,
    title: r.title,
    agentName: r.agentName,
    outcome: r.outcome,
    x: r.billableTokens,
    y: r.durationMs,
    score: r.score,
    ratio: Number(r.maxRatio.toFixed(2)),
  });

  if (valid.length <= SCATTER_CAP) return valid.map(toPoint);

  const flagged = valid.filter((r) => r.score >= ANOMALY_MIN_SCORE);
  const rest = valid.filter((r) => r.score < ANOMALY_MIN_SCORE);
  const quota = Math.max(0, SCATTER_CAP - flagged.length);
  const stride = quota > 0 ? rest.length / quota : 0;
  const sampled =
    quota > 0
      ? Array.from({ length: quota }, (_, i) => rest[Math.min(rest.length - 1, Math.floor(i * stride))])
      : [];
  return [...flagged, ...sampled].map(toPoint);
}

/* --------------------------- 主函数 --------------------------- */

export async function getSessionBoard(
  prisma: PrismaClient,
  opts: SessionBoardOptions,
): Promise<SessionBoard> {
  const { startMs, spanDays } = opts;
  const now = Date.now();
  // 留一天余量，避免采集端时钟偏移导致最新会话落在窗口外
  const toMs = now + DAY_MS;
  const prevStartMs = startMs > 0 && spanDays > 0 ? startMs - spanDays * DAY_MS : 0;
  const cte = sessionMetricCte(startMs, toMs);

  const [metricRowsRaw, agentBaseRows, globalBaseRows, dailyRows, totalsRows, prevRows] =
    await Promise.all([
      prisma.$queryRaw<Record<string, unknown>[]>(
        Prisma.sql`${cte} SELECT * FROM ps ORDER BY startTime DESC`,
      ),
      prisma.$queryRaw<Record<string, unknown>[]>(baselineQuery(cte, true)),
      prisma.$queryRaw<Record<string, unknown>[]>(baselineQuery(cte, false)),
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT date(s.startTime / 1000, 'unixepoch', 'localtime') AS d,
               COUNT(*) AS sessions,
               COALESCE(SUM(CASE WHEN ${SQL_FINISHED} AND NOT ${SQL_BAD} AND NOT ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS success,
               COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partial,
               COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS failed
        FROM Session s
        WHERE s.startTime >= ${Math.max(startMs, now - SERIES_MAX_DAYS * DAY_MS)}
          AND s.startTime < ${toMs}
        GROUP BY d
        ORDER BY d
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COUNT(*) AS sessions,
               COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finished,
               COALESCE(SUM(CASE WHEN ${SQL_FINISHED} AND NOT ${SQL_BAD} AND NOT ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS success,
               COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partial,
               COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS failed,
               COALESCE(SUM(s.totalInputTokens + s.totalOutputTokens), 0) AS billableTokens,
               COALESCE(SUM(s.llmCallCount), 0) AS llmCalls,
               COALESCE(SUM(s.toolCallCount), 0) AS toolCalls
        FROM Session s
        WHERE s.startTime >= ${startMs} AND s.startTime < ${toMs}
      `,
      startMs > 0
        ? prisma.$queryRaw<Record<string, unknown>[]>`
            SELECT COUNT(*) AS sessions,
                   COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finished,
                   COALESCE(SUM(CASE WHEN ${SQL_FINISHED} AND NOT ${SQL_BAD} AND NOT ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS success,
                   COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partial,
                   COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS failed,
                   COALESCE(SUM(s.totalInputTokens + s.totalOutputTokens), 0) AS billableTokens
            FROM Session s
            WHERE s.startTime >= ${prevStartMs} AND s.startTime < ${startMs}
          `
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);

  /* ---- 基准索引 ---- */
  const byAgent = new Map<string, { cnt: number; metrics: SessionBaselineMetrics }>();
  for (const raw of agentBaseRows) {
    const r = normalizeRow(raw);
    byAgent.set(String(r.agentId), {
      cnt: Number(r.cnt ?? 0),
      metrics: toBaselineMetrics(raw),
    });
  }
  const gRaw = globalBaseRows.length > 0 ? globalBaseRows[0] : {};
  const globalBase = {
    cnt: Number(normalizeRow(gRaw).cnt ?? 0),
    metrics: toBaselineMetrics(gRaw),
  };
  const baselineReady = globalBase.cnt >= MIN_BASELINE_SAMPLES;

  /* ---- 逐会话打分 ---- */
  const rows = metricRowsRaw
    .map(toMetricRow)
    .map((row) => scoreRow(row, pickBaseline(row.agentId, byAgent, globalBase)));

  /* ---- 日序列（按本地日对齐，缺失补 0） ---- */
  const dayKeys: string[] = [];
  {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earliest = rows.reduce(
      (min, r) => Math.min(min, new Date(r.startTime).getTime()),
      today.getTime(),
    );
    const from = Math.max(
      startMs,
      new Date(earliest).setHours(0, 0, 0, 0),
      today.getTime() - (SERIES_MAX_DAYS - 1) * DAY_MS,
    );
    const startOfFrom = new Date(from);
    startOfFrom.setHours(0, 0, 0, 0);
    const count = Math.max(1, Math.round((today.getTime() - startOfFrom.getTime()) / DAY_MS) + 1);
    for (let i = 0; i < count; i++) {
      dayKeys.push(ymdLocal(new Date(startOfFrom.getTime() + i * DAY_MS)));
    }
  }
  const dailyMap = new Map<string, { sessions: number; success: number; partial: number; failed: number }>();
  for (const raw of dailyRows) {
    const r = normalizeRow(raw);
    dailyMap.set(String(r.d ?? ""), {
      sessions: Number(r.sessions ?? 0),
      success: Number(r.success ?? 0),
      partial: Number(r.partial ?? 0),
      failed: Number(r.failed ?? 0),
    });
  }
  const anomalyByDay = new Map<string, number>();
  for (const r of rows) {
    if (r.score < ANOMALY_MIN_SCORE) continue;
    const k = ymdLocal(new Date(r.startTime));
    anomalyByDay.set(k, (anomalyByDay.get(k) ?? 0) + 1);
  }
  const daily: SessionBoardDaily = {
    days: dayKeys.map((d) => d.slice(5)),
    sessions: dayKeys.map((d) => dailyMap.get(d)?.sessions ?? 0),
    success: dayKeys.map((d) => dailyMap.get(d)?.success ?? 0),
    partial: dayKeys.map((d) => dailyMap.get(d)?.partial ?? 0),
    failed: dayKeys.map((d) => dailyMap.get(d)?.failed ?? 0),
    anomalies: dayKeys.map((d) => anomalyByDay.get(d) ?? 0),
  };

  /* ---- Agent 基准表 ---- */
  const agentAgg = new Map<
    string,
    { id: string; name: string; emoji: string; sessions: number; anomalies: number }
  >();
  for (const r of rows) {
    const cur = agentAgg.get(r.agentId) ?? {
      id: r.agentId,
      name: r.agentName,
      emoji: r.agentEmoji,
      sessions: 0,
      anomalies: 0,
    };
    cur.sessions += 1;
    if (r.score >= ANOMALY_MIN_SCORE) cur.anomalies += 1;
    agentAgg.set(r.agentId, cur);
  }
  const agents: SessionBoardAgentRow[] = Array.from(agentAgg.values()).map((a) => {
    const own = byAgent.get(a.id);
    const scope: "agent" | "global" = own && own.cnt >= MIN_BASELINE_SAMPLES ? "agent" : "global";
    const m = scope === "agent" && own ? own.metrics : globalBase.metrics;
    return {
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      sessions: a.sessions,
      baselineScope: scope,
      samples: scope === "agent" && own ? own.cnt : globalBase.cnt,
      billableMedian: Math.round(m.billableTokens.median),
      billableP90: Math.round(m.billableTokens.p90),
      durationMedian: Math.round(m.durationMs.median),
      durationP90: Math.round(m.durationMs.p90),
      perRoundP90: Math.round(m.perRoundMs.p90),
      toolsPerLlmP90: Number(m.toolsPerLlm.p90.toFixed(2)),
      toolFailPctMedian: Number(m.toolFailPct.median.toFixed(2)),
      anomalySessions: a.anomalies,
    };
  });
  agents.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  /* ---- 榜单 / 散点 / 分布桶 / 表格偏离 ---- */
  const ranked = [...rows].sort(
    (a, b) =>
      b.score - a.score ||
      b.maxRatio - a.maxRatio ||
      b.durationMs - a.durationMs,
  );
  /** 榜单只收 ANOMALY_MIN_SCORE 以上；数量不足 3 条时放宽到 1 项，避免榜单空白 */
  const strong = ranked.filter((r) => r.score >= ANOMALY_MIN_SCORE);
  const anomalies = (strong.length >= 3 ? strong : ranked.filter((r) => r.score > 0)).slice(
    0,
    TOP_ANOMALIES,
  );

  const scatter = pickScatter(rows);
  const scatterTotal = rows.filter((r) => r.billableTokens > 0 && r.durationMs > 0).length;

  const durationBuckets: SessionDurationBucket[] = DURATION_BUCKETS.map((b, i) => {
    const lower = i === 0 ? -1 : DURATION_BUCKETS[i - 1].max;
    const hit = rows.filter((r) => r.durationMs > lower && r.durationMs <= b.max);
    return {
      label: b.label,
      count: hit.length,
      anomalies: hit.filter((r) => r.score >= ANOMALY_MIN_SCORE).length,
    };
  });

  const rowDeviation: Record<string, SessionDeviation> = {};
  for (const r of rows) {
    rowDeviation[r.id] = {
      s: r.score,
      r: Number(r.maxRatio.toFixed(2)),
      b: r.breaches.slice(0, 3).map((x) => x.label),
      sc: r.baselineScope,
      n: r.baselineSamples,
    };
  }

  /* ---- KPI ---- */
  const totals = totalsRows.length > 0 ? normalizeRow(totalsRows[0]) : {};
  const prev = prevRows.length > 0 ? normalizeRow(prevRows[0]) : null;
  const totalSessions = Number(totals.sessions ?? 0);
  const success = Number(totals.success ?? 0);
  const partial = Number(totals.partial ?? 0);
  const failed = Number(totals.failed ?? 0);
  const finished = Number(totals.finished ?? 0);

  const billables = rows.map((r) => r.billableTokens).filter((v) => v > 0).sort((a, b) => a - b);
  const durations = rows.map((r) => r.durationMs).filter((v) => v > 0).sort((a, b) => a - b);
  const medianOf = (arr: number[]) =>
    arr.length === 0
      ? 0
      : arr.length % 2 === 1
        ? arr[(arr.length - 1) / 2]
        : Math.round((arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const p90Of = (arr: number[]) =>
    arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.ceil(arr.length * 0.9) - 1)];

  const anomalySessions = rows.filter((r) => r.score >= ANOMALY_MIN_SCORE).length;
  const severeSessions = rows.filter((r) => r.score >= SEVERE_MIN_SCORE).length;

  return {
    range: "",
    rangeKey: "",
    spanDays,
    meta: {
      baseline: "median+p90",
      minSamples: MIN_BASELINE_SAMPLES,
      anomalyMinScore: ANOMALY_MIN_SCORE,
      severeMinScore: SEVERE_MIN_SCORE,
      baselineReady,
      scatterTotal,
      scatterReturned: scatter.length,
    },
    kpi: {
      sessions: totalSessions,
      sessionsPrev: prev ? Number(prev.sessions ?? 0) : null,
      finished,
      success,
      partial,
      failed,
      successRate: successRateOf(finished, failed, partial) ?? 0,
      successRatePrev: prev
        ? (successRateOf(
            Number(prev.finished ?? 0),
            Number(prev.failed ?? 0),
            Number(prev.partial ?? 0),
          ) ?? 0)
        : null,
      billableTokens: Number(totals.billableTokens ?? 0),
      billableTokensPrev: prev ? Number(prev.billableTokens ?? 0) : null,
      billableMedian: medianOf(billables),
      durationMedian: medianOf(durations),
      durationP90: p90Of(durations),
      anomalySessions,
      severeSessions,
      anomalyRate: rows.length > 0 ? (anomalySessions / rows.length) * 100 : 0,
      llmCalls: Number(totals.llmCalls ?? 0),
      toolCalls: Number(totals.toolCalls ?? 0),
      toolFailPct:
        Number(totals.toolCalls ?? 0) > 0
          ? (rows.reduce((n, r) => n + r.failedTools, 0) / Number(totals.toolCalls ?? 1)) * 100
          : 0,
      sampleSessions: rows.length,
      baselineReady,
    },
    daily,
    agents,
    anomalies,
    scatter,
    durationBuckets,
    rowDeviation,
  };
}

/**
 * 单会话基准（详情页用）：固定近 N 天窗口，保证样本量。
 * 与看板的时间档解耦——详情页看的是「这个 Agent 这段时间的正常水位」。
 */
export async function getSessionBaseline(
  prisma: PrismaClient,
  opts: { agentId: string; windowDays?: number },
): Promise<SessionBaseline> {
  const windowDays = opts.windowDays ?? 30;
  const fromMs = Date.now() - windowDays * DAY_MS;
  const toMs = Date.now() + DAY_MS;

  const [agentRows, globalRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(
      baselineQuery(sessionMetricCte(fromMs, toMs, opts.agentId), false),
    ),
    prisma.$queryRaw<Record<string, unknown>[]>(
      baselineQuery(sessionMetricCte(fromMs, toMs), false),
    ),
  ]);

  const ownRaw = agentRows.length > 0 ? agentRows[0] : {};
  const ownCnt = Number(normalizeRow(ownRaw).cnt ?? 0);
  const useAgent = ownCnt >= MIN_BASELINE_SAMPLES;

  const gRaw = globalRows.length > 0 ? globalRows[0] : {};
  const gCnt = Number(normalizeRow(gRaw).cnt ?? 0);

  return {
    scope: useAgent ? "agent" : "global",
    samples: useAgent ? ownCnt : gCnt,
    agentSamples: ownCnt,
    windowDays,
    metrics: toBaselineMetrics(useAgent ? ownRaw : gRaw),
  };
}
