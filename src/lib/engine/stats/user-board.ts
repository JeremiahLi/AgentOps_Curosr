import { PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * 用户看板聚合（管理视角）。
 *
 * 原 user-compare 只回答"平台一共用了多少"，本模块回答管理动作相关的四个问题：
 *   1. 渗透率 —— 活跃用户 / 在册用户
 *   2. 节奏   —— 人均会话、人均活跃天数、每日/每周使用热度
 *   3. 谁掉队 —— 活跃度分层 + 近 14 天沉默名单
 *   4. 用得深 —— 人均轮数、异常会话、Agent 广度
 *
 * 口径约定：
 * - 一律按 User.name 聚合（库中存在同名重复 User 记录，按 id 会拆成两行）。
 * - 会话统计按 Session.startTime 过滤（startTime 为毫秒整数）。
 * - 热力图窗口固定取「最近 heatmapDays 天」，与 range 只有列数差异，不改变聚合口径。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 热力图最大列数（6 周）；all 档超过时只展示最近 6 周 */
const HEATMAP_MAX_DAYS = 42;

export type UserTier = "high" | "mid" | "low" | "none";

export interface UserBoardRow {
  name: string;
  org: string;
  /** range 内会话数 */
  sessions: number;
  /** 上一等长窗口会话数（all 档为 null） */
  prevSessions: number | null;
  tokens: number;
  rounds: number;
  /** range 内有使用的天数 */
  activeDays: number;
  /** range 内使用的 Agent 种类数 */
  agentCount: number;
  errorSessions: number;
  /** 最后一次使用时间（ISO）；从未使用为 null */
  lastActiveAt: string | null;
  /** 距今天数（从未使用为 null） */
  daysSinceActive: number | null;
  /** 与 heatmap days 对齐的每日会话数 */
  daily: number[];
  /** 最近 14 天每日会话数，供 sparkline 使用 */
  recent: number[];
  tier: UserTier;
  /** 窗口内没有任何会话（与所选时间范围同口径，用于点名提醒） */
  idle: boolean;
}

export interface UserBoardTotals {
  /** 在册用户数（按 name 去重） */
  registered: number;
  /** range 内有使用的用户数 */
  activeUsers: number;
  sessions: number;
  prevSessions: number | null;
  rounds: number;
  tokens: number;
  /** 部门人均会话数（分母为在册人数，不受活跃人数波动影响） */
  avgSessions: number;
  /** 上一窗口的部门人均会话数 */
  prevAvgSessions: number | null;
  /** 部门人均使用天数（分母为在册人数） */
  avgActiveDays: number;
  /** 活跃成员人均使用天数（分母为有使用的成员） */
  activeAvgDays: number;
  /** 人均轮数（单会话深度） */
  roundsPerSession: number;
  errorSessions: number;
  /** 异常会话占比（%） */
  errorRate: number;
  /** 窗口内未使用的在册成员（与 activeUsers 互补） */
  idleUsers: number;
  idleNames: string[];
}

export interface UserBoard {
  range: string;
  /** 热力图列日期 YYYY-MM-DD（升序） */
  days: string[];
  totals: UserBoardTotals;
  users: UserBoardRow[];
  tiers: Record<UserTier, string[]>;
}

export interface UserBoardOptions {
  startMs: number;
  /** range 跨度天数（用于活跃度分层与环比窗口） */
  spanDays: number;
  /** 热力图列数 */
  heatmapDays: number;
}

function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

/** 活跃度分层：按「活跃天数 / 窗口天数」判定，跨 range 可比较 */
function tierOf(activeDays: number, spanDays: number): UserTier {
  if (activeDays <= 0) return "none";
  const ratio = activeDays / Math.max(spanDays, 1);
  if (ratio >= 0.4) return "high";
  if (ratio >= 0.15) return "mid";
  return "low";
}

export async function getUserBoard(
  prisma: PrismaClient,
  opts: UserBoardOptions,
): Promise<UserBoard> {
  const now = Date.now();
  const heatmapDays = Math.min(opts.heatmapDays, HEATMAP_MAX_DAYS);
  const { startMs, spanDays } = opts;
  const prevStartMs = startMs > 0 && spanDays > 0 ? startMs - spanDays * DAY_MS : 0;

  // 热力图窗口起点：今天 0 点往前 heatmapDays-1 天
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let i = heatmapDays - 1; i >= 0; i--) {
    days.push(ymdLocal(new Date(today.getTime() - i * DAY_MS)));
  }
  const dailyFrom = today.getTime() - (heatmapDays - 1) * DAY_MS;

  const [registeredRows, rows, prevRows, dailyRows, lastRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT name AS name, MAX(NULLIF(org, '')) AS org
      FROM User
      GROUP BY name
      ORDER BY name
    `,
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT u.name AS name,
             COUNT(*) AS sessions,
             COALESCE(SUM(s.totalTokens), 0) AS tokens,
             COALESCE(SUM(s.totalRounds), 0) AS rounds,
             SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS errorSessions,
             COUNT(DISTINCT date(s.startTime / 1000, 'unixepoch', 'localtime')) AS activeDays,
             COUNT(DISTINCT s.agentId) AS agentCount
      FROM Session s
      JOIN User u ON s.userId = u.id
      WHERE s.startTime >= ${startMs}
      GROUP BY u.name
    `,
    prevStartMs > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT u.name AS name, COUNT(*) AS sessions
          FROM Session s
          JOIN User u ON s.userId = u.id
          WHERE s.startTime >= ${prevStartMs} AND s.startTime < ${startMs}
          GROUP BY u.name
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT u.name AS name,
             date(s.startTime / 1000, 'unixepoch', 'localtime') AS d,
             COUNT(*) AS n
      FROM Session s
      JOIN User u ON s.userId = u.id
      WHERE s.startTime >= ${dailyFrom}
      GROUP BY u.name, d
    `,
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT u.name AS name, MAX(s.startTime) AS lastAt
      FROM Session s
      JOIN User u ON s.userId = u.id
      GROUP BY u.name
    `,
  ]);

  const prevMap = new Map<string, number>();
  for (const raw of prevRows) {
    const r = normalizeRow(raw);
    prevMap.set(String(r.name), Number(r.sessions));
  }

  const lastMap = new Map<string, number>();
  for (const raw of lastRows) {
    const r = normalizeRow(raw);
    const ms = toMs(raw.lastAt);
    if (ms > 0) lastMap.set(String(r.name), ms);
  }

  // name -> (date -> sessions)
  const dailyMap = new Map<string, Map<string, number>>();
  for (const raw of dailyRows) {
    const r = normalizeRow(raw);
    const name = String(r.name);
    const d = String(r.d ?? "");
    if (!d) continue;
    let m = dailyMap.get(name);
    if (!m) {
      m = new Map();
      dailyMap.set(name, m);
    }
    m.set(d, Number(r.n));
  }

  const aggMap = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    aggMap.set(String(r.name), r);
  }

  const users: UserBoardRow[] = registeredRows.map((raw) => {
    const r = normalizeRow(raw);
    const name = String(r.name);
    const agg = aggMap.get(name);
    const dmap = dailyMap.get(name);
    const daily = days.map((d) => dmap?.get(d) ?? 0);
    const sessions = agg ? Number(agg.sessions) : 0;
    const activeDays = agg ? Number(agg.activeDays) : 0;
    const lastMs = lastMap.get(name) ?? 0;
    const daysSinceActive = lastMs > 0 ? Math.floor((now - lastMs) / DAY_MS) : null;

    return {
      name,
      org: String(r.org ?? ""),
      sessions,
      prevSessions: prevStartMs > 0 ? (prevMap.get(name) ?? 0) : null,
      tokens: agg ? Number(agg.tokens) : 0,
      rounds: agg ? Number(agg.rounds) : 0,
      activeDays,
      agentCount: agg ? Number(agg.agentCount) : 0,
      errorSessions: agg ? Number(agg.errorSessions) : 0,
      lastActiveAt: lastMs > 0 ? new Date(lastMs).toISOString() : null,
      daysSinceActive,
      daily,
      recent: daily.slice(-14),
      tier: tierOf(activeDays, spanDays),
      idle: sessions === 0,
    };
  });

  users.sort((a, b) => b.sessions - a.sessions || (a.daysSinceActive ?? 1e9) - (b.daysSinceActive ?? 1e9));

  const activeUsers = users.filter((u) => u.sessions > 0).length;
  const sessions = users.reduce((s, u) => s + u.sessions, 0);
  const rounds = users.reduce((s, u) => s + u.rounds, 0);
  const tokens = users.reduce((s, u) => s + u.tokens, 0);
  const errorSessions = users.reduce((s, u) => s + u.errorSessions, 0);
  const activeDaySum = users.reduce((s, u) => s + u.activeDays, 0);
  const prevSessions = prevStartMs > 0 ? users.reduce((s, u) => s + (u.prevSessions ?? 0), 0) : null;
  const registered = users.length;
  const idleNames = users.filter((u) => u.idle).map((u) => u.name);

  const tiers: Record<UserTier, string[]> = { high: [], mid: [], low: [], none: [] };
  for (const u of users) tiers[u.tier].push(u.name);

  return {
    range: "",
    days,
    totals: {
      registered,
      activeUsers,
      sessions,
      prevSessions,
      rounds,
      tokens,
      avgSessions: registered > 0 ? sessions / registered : 0,
      prevAvgSessions: prevSessions !== null && registered > 0 ? prevSessions / registered : null,
      avgActiveDays: registered > 0 ? activeDaySum / registered : 0,
      activeAvgDays: activeUsers > 0 ? activeDaySum / activeUsers : 0,
      roundsPerSession: sessions > 0 ? rounds / sessions : 0,
      errorSessions,
      errorRate: sessions > 0 ? (errorSessions / sessions) * 100 : 0,
      idleUsers: idleNames.length,
      idleNames,
    },
    users,
    tiers,
  };
}
