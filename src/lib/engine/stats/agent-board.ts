import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";
import { HEALTH_WINDOW_DAYS, scoreHealth, successRateOf, type HealthScore } from "./health";
import { SQL_BAD, SQL_FINISHED, SQL_PARTIAL } from "./session-outcome";

/**
 * Agent 看板聚合（管理视角）。
 *
 * 回答四类问题：
 *   1. 横向对比 —— 谁用得多、谁用得好、谁成本高（矩阵表 + 会话数/工具失败率柱图）
 *   2. 使用趋势 —— 会话数 / Token / 失败会话数的时间序列
 *   3. 健康画像 —— 四维打分（见 health.ts）
 *
 * 口径三条例规：
 * - 时间过滤一律用 Session.startTime（发生时间）。禁用 Span.createdAt ——
 *   它是入库时间，全库都落在最近 10 天内，会把几个月前的会话算进「近 30 天」。
 * - 会话成败一律用 Session.outcome（success / partial / failed），不再用 errorCount：
 *   errorCount 统计的是「过程失败」（工具重试、质检回流），拿它判会话失败会把
 *   「最终交付了成品」的会话误判为失败。outcome='' 表示历史未回填，按旧口径兜底。
 *   status='active' 与空会话（totalSpans=0）不计入成功率分母。
 * - 成本 = input + output，不含 cache（缓存命中高是优点，不是成本）。
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 日序列窗口固定 30 天，供矩阵表的 Sparkline 使用，与页面 range 解耦 */
const SERIES_DAYS = 30;

/* 会话成败口径见 ./session-outcome.ts（与 agent-detail / trend 共用同一份） */

export interface AgentBoardKpi {
  /** 区间内有会话的 Agent 数 */
  activeAgents: number;
  activeAgentsPrev: number | null;
  /** 在册 Agent 总数 */
  agentTotal: number;
  /** 区间内 0 会话的 Agent 数 */
  silentAgents: number;
  sessions: number;
  sessionsPrev: number | null;
  /** 真实口径成功率 0-100 */
  successRate: number;
  successRatePrev: number | null;
  badSessions: number;
  /** 范围内部分会话数（有交付但过程有失败） */
  partialSessions: number;
  /** 会话端到端耗时 P95（ms）；样本不足为 0 */
  p95Duration: number;
  /** P95 的有效样本数 */
  p95SampleCount: number;
  spans: number;
  failedSpans: number;
  spanFailRate: number;
  totalTokens: number;
}

export interface AgentBoardRow {
  id: string;
  name: string;
  emoji: string;
  version: string;
  framework: string;
  description: string;

  sessions: number;
  prevSessions: number | null;
  /** 非 active 会话数（成功率分母） */
  finishedSessions: number;
  /** errorCount>0 或 status='error' 的会话数 */
  badSessions: number;
  /** 有交付但过程出现失败的会话数（按半失败折算进成功率） */
  partialSessions: number;
  /** 真实成功率 0-100；无样本为 null */
  successRate: number | null;
  users: number;
  projects: number;
  activeDays: number;

  spans: number;
  failedSpans: number;
  /** Span 级失败率 0-100 */
  spanFailRate: number | null;
  toolCalls: number;
  toolFailed: number;
  /** 工具级失败率 0-100 */
  toolFailRate: number | null;
  /** answer 类失败数（error 字段为空，属数据质量指标） */
  answerFailed: number;

  totalTokens: number;
  /** input + output，成本口径 */
  billableTokens: number;
  cacheTokens: number;
  rounds: number;
  avgDuration: number;
  /** 会话端到端 P95（ms）；样本 <20 时前端按「—」展示 */
  p95Duration: number;
  p95SampleCount: number;
  /** 单轮耗时 P95（ms） */
  p95PerRound: number;
  /** 每轮有效 Token（input+output） */
  tokensPerRound: number;

  /** 与 days 对齐的近 30 天每日会话数 */
  daily: number[];
  /** 全历史首次出现时间（ISO） */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysSinceActive: number | null;

  health: HealthScore;
}

export interface AgentBoard {
  range: string;
  rangeKey: string;
  spanDays: number;
  /** 近 30 天日期键 YYYY-MM-DD（升序），与 row.daily 对齐 */
  days: string[];
  kpi: AgentBoardKpi;
  agents: AgentBoardRow[];
  /** 本期新增（首次出现落在区间内）与本期消失（上期有、本期 0） */
  newAgents: string[];
  lostAgents: string[];
}

export interface AgentBoardOptions {
  startMs: number;
  /** 区间跨度天数，用于上期窗口；all 档传实际数据跨度 */
  spanDays: number;
}

/* --------------------------------- 工具 --------------------------------- */

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

function toIso(v: unknown): string | null {
  const n = num(v);
  return n > 0 ? new Date(n).toISOString() : null;
}

type Agg = {
  sessions: number;
  finishedSessions: number;
  badSessions: number;
  partialSessions: number;
  totalTokens: number;
  billableTokens: number;
  cacheTokens: number;
  rounds: number;
  users: number;
  projects: number;
  activeDays: number;
  firstSeenAt: number;
  lastSeenAt: number;
  avgDuration: number;
};

/** 一次区间内的 Agent 维度聚合（4 条并行查询） */
async function measure(
  prisma: PrismaClient,
  from: number,
  to: number | null,
  opts: { spans: boolean } = { spans: true },
): Promise<{
  agg: Map<string, Agg>;
  p95Session: Map<string, { p95: number; cnt: number }>;
  p95Round: Map<string, { p95: number; cnt: number }>;
  span: Map<string, { spans: number; failedSpans: number; toolCalls: number; toolFailed: number; answerFailed: number }>;
}> {
  const timeCond =
    to == null
      ? Prisma.sql`AND s.startTime >= ${from}`
      : Prisma.sql`AND s.startTime >= ${from} AND s.startTime < ${to}`;

  const [aggRows, p95SessionRows, p95RoundRows, spanRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT a.id AS id,
             COUNT(s.id) AS sessions,
             COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finishedSessions,
             COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS badSessions,
             COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partialSessions,
             COALESCE(SUM(s.totalTokens), 0) AS totalTokens,
             COALESCE(SUM(s.totalInputTokens + s.totalOutputTokens), 0) AS billableTokens,
             COALESCE(SUM(s.totalCacheReadTokens + s.totalCacheWriteTokens), 0) AS cacheTokens,
             COALESCE(SUM(s.totalRounds), 0) AS rounds,
             COUNT(DISTINCT s.userId) AS users,
             COUNT(DISTINCT s.projectId) AS projects,
             COUNT(DISTINCT date(s.startTime / 1000, 'unixepoch', 'localtime')) AS activeDays,
             -- AVG 返回 REAL，Prisma 反序列化会拒绝非整数（"cannot be converted to a BigInt"），必须 CAST
             CAST(COALESCE(AVG(NULLIF(s.totalDuration, 0)), 0) AS INTEGER) AS avgDuration,
             MIN(s.startTime) AS firstSeenAt,
             MAX(s.startTime) AS lastSeenAt
      FROM Agent a
      LEFT JOIN Session s ON s.agentId = a.id ${timeCond}
      GROUP BY a.id
    `,
    // 会话端到端 P95：最近秩法 idx = ceil(0.95n)，整数写法 (cnt*95+99)/100
    // 必须排除 totalDuration = 0 的脏数据（pi 有 22 个）
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH ranked AS (
        SELECT s.agentId AS agentId,
               s.totalDuration AS v,
               ROW_NUMBER() OVER (PARTITION BY s.agentId ORDER BY s.totalDuration) AS rn,
               COUNT(*)       OVER (PARTITION BY s.agentId) AS cnt
        FROM Session s
        WHERE s.totalDuration > 0 ${timeCond}
      )
      SELECT agentId, MAX(cnt) AS cnt,
             CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95
      FROM ranked GROUP BY agentId
    `,
    // 单轮耗时 P95：用 per-round 消掉长会话影响
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH ranked AS (
        SELECT s.agentId AS agentId,
               s.totalDuration * 1.0 / s.totalRounds AS v,
               ROW_NUMBER() OVER (PARTITION BY s.agentId ORDER BY s.totalDuration * 1.0 / s.totalRounds) AS rn,
               COUNT(*)       OVER (PARTITION BY s.agentId) AS cnt
        FROM Session s
        WHERE s.totalDuration > 0 AND s.totalRounds > 0 ${timeCond}
      )
      SELECT agentId, MAX(cnt) AS cnt,
             CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95
      FROM ranked GROUP BY agentId
    `,
    opts.spans
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT s.agentId AS agentId,
                 COUNT(*) AS spans,
                 COALESCE(SUM(CASE WHEN sp.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedSpans,
                 COALESCE(SUM(CASE WHEN sp.kind = 'tool_call' THEN 1 ELSE 0 END), 0) AS toolCalls,
                 COALESCE(SUM(CASE WHEN sp.kind = 'tool_call' AND sp.status = 'failed' THEN 1 ELSE 0 END), 0) AS toolFailed,
                 COALESCE(SUM(CASE WHEN sp.kind = 'answer' AND sp.status = 'failed' THEN 1 ELSE 0 END), 0) AS answerFailed
          FROM Span sp
          JOIN Session s ON sp.sessionId = s.id
          WHERE 1 = 1 ${timeCond}
          GROUP BY s.agentId
        `
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  const agg = new Map<string, Agg>();
  for (const raw of aggRows) {
    const r = normalizeRow(raw);
    agg.set(String(r.id), {
      sessions: Number(r.sessions),
      finishedSessions: Number(r.finishedSessions),
      badSessions: Number(r.badSessions),
      partialSessions: Number(r.partialSessions),
      totalTokens: Number(r.totalTokens),
      billableTokens: Number(r.billableTokens),
      cacheTokens: Number(r.cacheTokens),
      rounds: Number(r.rounds),
      users: Number(r.users),
      projects: Number(r.projects),
      activeDays: Number(r.activeDays),
      firstSeenAt: num(raw.firstSeenAt),
      lastSeenAt: num(raw.lastSeenAt),
      avgDuration: Number(r.avgDuration),
    });
  }

  const pctMap = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, { p95: number; cnt: number }>();
    for (const raw of rows) {
      const r = normalizeRow(raw);
      m.set(String(r.agentId), { p95: Number(r.p95) || 0, cnt: Number(r.cnt) || 0 });
    }
    return m;
  };

  const span = new Map<
    string,
    { spans: number; failedSpans: number; toolCalls: number; toolFailed: number; answerFailed: number }
  >();
  for (const raw of spanRows) {
    const r = normalizeRow(raw);
    span.set(String(r.agentId), {
      spans: Number(r.spans),
      failedSpans: Number(r.failedSpans),
      toolCalls: Number(r.toolCalls),
      toolFailed: Number(r.toolFailed),
      answerFailed: Number(r.answerFailed),
    });
  }

  return { agg, p95Session: pctMap(p95SessionRows), p95Round: pctMap(p95RoundRows), span };
}

/* -------------------------------- 主函数 -------------------------------- */

export async function getAgentBoard(
  prisma: PrismaClient,
  opts: AgentBoardOptions,
): Promise<AgentBoard> {
  const now = Date.now();
  const { startMs, spanDays } = opts;
  const prevStartMs = startMs > 0 && spanDays > 0 ? startMs - spanDays * DAY_MS : 0;

  // 健康分固定 30 天窗口，与页面 range 解耦
  const healthFrom = now - HEALTH_WINDOW_DAYS * DAY_MS;
  const healthBaselineFrom = healthFrom - HEALTH_WINDOW_DAYS * DAY_MS;

  // 日序列窗口：今天 0 点往前 SERIES_DAYS-1 天
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i--) days.push(ymdLocal(new Date(today.getTime() - i * DAY_MS)));
  const seriesFrom = today.getTime() - (SERIES_DAYS - 1) * DAY_MS;

  const [
    agents,
    current,
    health,
    healthBaseline,
    prevAggRows,
    dailyRows,
    lifeRows,
    prevTotalsRows,
    globalP95Rows,
  ] = await Promise.all([
    prisma.agent.findMany({
      select: { id: true, name: true, emoji: true, version: true, framework: true, description: true },
      orderBy: { name: "asc" },
    }),
    measure(prisma, startMs, null),
    measure(prisma, healthFrom, null),
    measure(prisma, healthBaselineFrom, healthFrom, { spans: false }),
    prevStartMs > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT s.agentId AS agentId,
                 COUNT(*) AS sessions,
                 COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finishedSessions,
                 COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS badSessions,
                 COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partialSessions
          FROM Session s
          WHERE s.startTime >= ${prevStartMs} AND s.startTime < ${startMs}
          GROUP BY s.agentId
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT s.agentId AS agentId,
             date(s.startTime / 1000, 'unixepoch', 'localtime') AS d,
             COUNT(*) AS sessions
      FROM Session s
      WHERE s.startTime >= ${seriesFrom}
      GROUP BY s.agentId, d
    `,
    // 全历史首末次出现（不受 range 限制，供画像与「本期新增」判定）
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT agentId AS agentId, MIN(startTime) AS firstAt, MAX(startTime) AS lastAt
      FROM Session GROUP BY agentId
    `,
    prevStartMs > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT COUNT(*) AS sessions,
                 COUNT(DISTINCT s.agentId) AS agents,
                 COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finishedSessions,
                 COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS badSessions,
                 COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partialSessions
          FROM Session s
          WHERE s.startTime >= ${prevStartMs} AND s.startTime < ${startMs}
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    // 整体 P95：必须跨 Agent 一起排名，不能对各 Agent 的 P95 取平均/取最大
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH ranked AS (
        SELECT s.totalDuration AS v,
               ROW_NUMBER() OVER (ORDER BY s.totalDuration) AS rn,
               COUNT(*)       OVER () AS cnt
        FROM Session s
        WHERE s.totalDuration > 0 AND s.startTime >= ${startMs}
      )
      SELECT MAX(cnt) AS cnt,
             MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS p95
      FROM ranked
    `,
  ]);

  /* ---- 索引表 ---- */
  const prevMap = new Map<
    string,
    { sessions: number; finishedSessions: number; badSessions: number; partialSessions: number }
  >();
  for (const raw of prevAggRows) {
    const r = normalizeRow(raw);
    prevMap.set(String(r.agentId), {
      sessions: Number(r.sessions),
      finishedSessions: Number(r.finishedSessions),
      badSessions: Number(r.badSessions),
      partialSessions: Number(r.partialSessions),
    });
  }

  const dailyByAgent = new Map<string, Map<string, number>>();
  for (const raw of dailyRows) {
    const r = normalizeRow(raw);
    const agentId = String(r.agentId);
    const d = String(r.d ?? "");
    if (!d) continue;
    let m = dailyByAgent.get(agentId);
    if (!m) {
      m = new Map();
      dailyByAgent.set(agentId, m);
    }
    m.set(d, Number(r.sessions));
  }

  const lifeMap = new Map<string, { firstAt: number; lastAt: number }>();
  for (const raw of lifeRows) {
    const r = normalizeRow(raw);
    lifeMap.set(String(r.agentId), { firstAt: num(raw.firstAt), lastAt: num(raw.lastAt) });
  }

  /* ---- 逐 Agent 组装 ---- */
  const rows: AgentBoardRow[] = agents.map((a) => {
    const cur = current.agg.get(a.id);
    const hAgg = health.agg.get(a.id);
    const hP95Round = health.p95Round.get(a.id);
    const hBase = healthBaseline.agg.get(a.id);
    const hBaseP95Round = healthBaseline.p95Round.get(a.id);
    const p95Session = current.p95Session.get(a.id);
    const sp = current.span.get(a.id);
    const prev = prevMap.get(a.id);
    const life = lifeMap.get(a.id);

    const sessions = cur?.sessions ?? 0;
    const finishedSessions = cur?.finishedSessions ?? 0;
    const badSessions = cur?.badSessions ?? 0;
    const partialSessions = cur?.partialSessions ?? 0;
    const rounds = cur?.rounds ?? 0;
    const tokensPerRound = rounds > 0 ? (cur?.billableTokens ?? 0) / rounds : 0;

    const hSessions = hAgg?.sessions ?? 0;
    const hRounds = hAgg?.rounds ?? 0;

    const healthScore = scoreHealth({
      framework: a.framework,
      sessions: hSessions,
      finishedSessions: hAgg?.finishedSessions ?? 0,
      badSessions: hAgg?.badSessions ?? 0,
      partialSessions: hAgg?.partialSessions ?? 0,
      toolCalls: health.span.get(a.id)?.toolCalls ?? 0,
      toolFailed: health.span.get(a.id)?.toolFailed ?? 0,
      rounds: hRounds,
      activeDays: hAgg?.activeDays ?? 0,
      users: hAgg?.users ?? 0,
      p95PerRound: hP95Round?.p95 ?? 0,
      tokensPerRound: hRounds > 0 ? (hAgg?.billableTokens ?? 0) / hRounds : 0,
      prev:
        hBase || hBaseP95Round
          ? {
              sessions: hBase?.sessions ?? 0,
              p95PerRound: hBaseP95Round?.p95 ?? 0,
              tokensPerRound:
                hBase && hBase.rounds > 0 ? hBase.billableTokens / hBase.rounds : 0,
            }
          : null,
    });

    const dmap = dailyByAgent.get(a.id);
    const spans = sp?.spans ?? 0;
    const toolCalls = sp?.toolCalls ?? 0;

    return {
      ...a,
      sessions,
      prevSessions: prevStartMs > 0 ? (prev?.sessions ?? 0) : null,
      finishedSessions,
      badSessions,
      partialSessions,
      successRate: successRateOf(finishedSessions, badSessions, partialSessions),
      users: cur?.users ?? 0,
      projects: cur?.projects ?? 0,
      activeDays: cur?.activeDays ?? 0,
      spans,
      failedSpans: sp?.failedSpans ?? 0,
      spanFailRate: spans > 0 ? ((sp?.failedSpans ?? 0) / spans) * 100 : null,
      toolCalls,
      toolFailed: sp?.toolFailed ?? 0,
      toolFailRate: toolCalls > 0 ? ((sp?.toolFailed ?? 0) / toolCalls) * 100 : null,
      answerFailed: sp?.answerFailed ?? 0,
      totalTokens: cur?.totalTokens ?? 0,
      billableTokens: cur?.billableTokens ?? 0,
      cacheTokens: cur?.cacheTokens ?? 0,
      rounds,
      avgDuration: Math.round(cur?.avgDuration ?? 0),
      p95Duration: Math.round(p95Session?.p95 ?? 0),
      p95SampleCount: p95Session?.cnt ?? 0,
      p95PerRound: Math.round(hP95Round?.p95 ?? 0),
      tokensPerRound,
      daily: days.map((d) => dmap?.get(d) ?? 0),
      firstSeenAt: life && life.firstAt > 0 ? new Date(life.firstAt).toISOString() : null,
      lastSeenAt: life && life.lastAt > 0 ? new Date(life.lastAt).toISOString() : null,
      daysSinceActive: life && life.lastAt > 0 ? Math.floor((now - life.lastAt) / DAY_MS) : null,
      health: healthScore,
    };
  });

  rows.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  /* ---- 汇总 ---- */
  const prevTotals = prevTotalsRows.length > 0 ? normalizeRow(prevTotalsRows[0]) : null;
  const activeAgents = rows.filter((r) => r.sessions > 0).length;
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const finishedSessions = rows.reduce((s, r) => s + r.finishedSessions, 0);
  const badSessions = rows.reduce((s, r) => s + r.badSessions, 0);
  const partialSessions = rows.reduce((s, r) => s + r.partialSessions, 0);
  const spans = rows.reduce((s, r) => s + r.spans, 0);
  const failedSpans = rows.reduce((s, r) => s + r.failedSpans, 0);
  const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0);

  // 整体 P95 走单条跨 Agent 排名查询，不是各 Agent P95 的聚合
  const globalP95 = globalP95Rows.length > 0 ? normalizeRow(globalP95Rows[0]) : null;
  const p95Duration = Math.round(Number(globalP95?.p95 ?? 0));
  const p95SampleCount = Number(globalP95?.cnt ?? 0);

  const newAgents =
    startMs > 0
      ? rows.filter((r) => r.firstSeenAt && new Date(r.firstSeenAt).getTime() >= startMs).map((r) => r.name)
      : [];
  const lostAgents = rows.filter((r) => (r.prevSessions ?? 0) > 0 && r.sessions === 0).map((r) => r.name);

  return {
    range: "",
    rangeKey: "",
    spanDays,
    days,
    kpi: {
      activeAgents,
      activeAgentsPrev: prevTotals ? Number(prevTotals.agents) : null,
      agentTotal: rows.length,
      silentAgents: rows.length - activeAgents,
      sessions,
      sessionsPrev: prevTotals ? Number(prevTotals.sessions) : null,
      successRate: successRateOf(finishedSessions, badSessions, partialSessions) ?? 100,
      successRatePrev:
        prevTotals && Number(prevTotals.finishedSessions) > 0
          ? (successRateOf(
              Number(prevTotals.finishedSessions),
              Number(prevTotals.badSessions),
              Number(prevTotals.partialSessions ?? 0),
            ) ?? 100)
          : null,
      badSessions,
      partialSessions,
      p95Duration,
      p95SampleCount,
      spans,
      failedSpans,
      spanFailRate: spans > 0 ? (failedSpans / spans) * 100 : 0,
      totalTokens,
    },
    agents: rows,
    newAgents,
    lostAgents,
  };
}
