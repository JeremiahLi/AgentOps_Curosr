import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";
import { SQL_BAD } from "./session-outcome";

/**
 * 使用趋势统计：按天/周粒度聚合使用次数（会话数）、token 消耗与去重计数。
 * - 用户视角：distinct = 使用的 Agent 数
 * - Agent 视角：distinct = 活跃用户数
 */

export type TrendGranularity = "day" | "week";

export interface TrendPoint {
  /** X 轴标签：每天为 M/D，每周为 W周序号 */
  label: string;
  /** 使用次数（会话数） */
  sessions: number;
  /** Token 消耗 */
  tokens: number;
  /** 去重计数（用户视角=Agent 数；Agent 视角=活跃用户数） */
  distinct: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function fetchBuckets(
  prisma: PrismaClient,
  opts: { subject: "user" | "agent"; subjectName: string; startMs: number; granularity: TrendGranularity },
): Promise<Map<string, TrendPoint>> {
  const { subject, subjectName, startMs, granularity } = opts;
  // Prisma $queryRaw 的模板插值默认是绑定参数，SQL 片段必须用 Prisma.raw()
  const bucketExpr =
    granularity === "week"
      ? Prisma.raw(`strftime('%Y-%W', s.startTime / 1000, 'unixepoch', 'localtime')`)
      : Prisma.raw(`date(s.startTime / 1000, 'unixepoch', 'localtime')`);
  const distinctExpr = subject === "user" ? Prisma.raw("s.agentId") : Prisma.raw("s.userId");
  const subjectMatch = subject === "user" ? Prisma.raw("u.name") : Prisma.raw("a.name");

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${bucketExpr} AS bucket,
           COUNT(*) AS sessions,
           COALESCE(SUM(s.totalTokens), 0) AS tokens,
           COUNT(DISTINCT ${distinctExpr}) AS distinctCount
    FROM Session s
    JOIN User u ON s.userId = u.id
    JOIN Agent a ON s.agentId = a.id
    WHERE ${subjectMatch} = ${subjectName}
      AND s.startTime >= ${startMs}
    GROUP BY bucket
    ORDER BY bucket
  `;

  const map = new Map<string, TrendPoint>();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const bucket = String(r.bucket);
    map.set(bucket, {
      label: bucket,
      sessions: Number(r.sessions),
      tokens: Number(r.tokens),
      distinct: Number(r.distinctCount),
    });
  }
  return map;
}

function toLabel(bucket: string, granularity: TrendGranularity): string {
  if (granularity === "week") {
    // "2026-41" -> "W41"
    const parts = bucket.split("-");
    return `W${parts[parts.length - 1]}`;
  }
  // "2026-10-13" -> "10/13"
  const parts = bucket.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** 补齐日粒度缺失的天（填 0），让曲线连续；startMs=0 时从最早数据日起填 */
function fillDaily(map: Map<string, TrendPoint>, startMs: number): TrendPoint[] {
  const out: TrendPoint[] = [];
  let cursor: Date;
  if (startMs > 0) {
    cursor = new Date(startMs);
  } else {
    const keys = Array.from(map.keys()).sort();
    if (keys.length === 0) return [];
    cursor = new Date(`${keys[0]}T00:00:00`);
  }
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let t = cursor.getTime(); t <= today.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const row = map.get(key);
    out.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      sessions: row?.sessions ?? 0,
      tokens: row?.tokens ?? 0,
      distinct: row?.distinct ?? 0,
    });
  }
  return out;
}

function sortedPoints(map: Map<string, TrendPoint>, granularity: TrendGranularity): TrendPoint[] {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, p]) => ({ ...p, label: toLabel(bucket, granularity) }));
}

/** 某用户的使用趋势（distinct = 使用的 Agent 数） */
export async function getUserTrend(
  prisma: PrismaClient,
  userName: string,
  startMs: number,
  granularity: TrendGranularity,
): Promise<TrendPoint[]> {
  const map = await fetchBuckets(prisma, { subject: "user", subjectName: userName, startMs, granularity });
  if (granularity === "day") return fillDaily(map, startMs);
  return sortedPoints(map, "week");
}

/** 某 Agent 的使用趋势（distinct = 活跃用户数） */
export async function getAgentTrend(
  prisma: PrismaClient,
  agentName: string,
  startMs: number,
  granularity: TrendGranularity,
): Promise<TrendPoint[]> {
  const map = await fetchBuckets(prisma, { subject: "agent", subjectName: agentName, startMs, granularity });
  if (granularity === "day") return fillDaily(map, startMs);
  return sortedPoints(map, "week");
}

/** 多 Agent 调用量趋势对比：每个 Agent 一条曲线（按会话数） */
export interface AgentsTrendCompare {
  /** X 轴标签序列 */
  labels: string[];
  /** 每个 Agent 一条序列，data 与 labels 一一对应 */
  series: { name: string; data: number[] }[];
}

/** 对比曲线的指标维度 */
export type AgentTrendMetric = "sessions" | "tokens" | "failed";

export async function getAgentsTrendCompare(
  prisma: PrismaClient,
  startMs: number,
  granularity: TrendGranularity,
  topN = 8,
  metric: AgentTrendMetric = "sessions",
): Promise<AgentsTrendCompare> {
  const bucketExpr =
    granularity === "week"
      ? Prisma.raw(`strftime('%Y-%W', s.startTime / 1000, 'unixepoch', 'localtime')`)
      : Prisma.raw(`date(s.startTime / 1000, 'unixepoch', 'localtime')`);

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${bucketExpr} AS bucket,
           a.name AS agent,
           COUNT(*) AS sessions,
           COALESCE(SUM(s.totalTokens), 0) AS tokens,
           COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS failed
    FROM Session s
    JOIN Agent a ON s.agentId = a.id
    WHERE s.startTime >= ${startMs}
    GROUP BY bucket, a.name
    ORDER BY bucket
  `;

  type BucketRow = { bucket: string; agent: string; sessions: number; tokens: number; failed: number };
  const parsed = rows.map((raw) => {
    const r = normalizeRow(raw);
    return {
      bucket: String(r.bucket),
      agent: String(r.agent),
      sessions: Number(r.sessions),
      tokens: Number(r.tokens),
      failed: Number(r.failed),
    };
  });

  // 按所选指标取 Top N（不能固定按会话数，否则切 Token 时 Token 最高的 Agent 会缺席）
  const totals = new Map<string, number>();
  for (const row of parsed) totals.set(row.agent, (totals.get(row.agent) ?? 0) + row[metric]);
  const topAgents = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);
  const topSet = new Set(topAgents);

  // 构造 X 轴桶序列
  let buckets: string[];
  if (granularity === "day") {
    buckets = buildDayBuckets(parsed.map((r) => r.bucket), startMs);
  } else {
    buckets = Array.from(new Set(parsed.map((r) => r.bucket))).sort();
  }

  // bucket+agent -> value
  const valueMap = new Map<string, number>();
  for (const row of parsed) {
    if (!topSet.has(row.agent)) continue;
    valueMap.set(`${row.bucket}|${row.agent}`, row[metric]);
  }

  const labels = buckets.map((b) => toLabel(b, granularity));
  const series = topAgents.map((agent) => ({
    name: agent,
    data: buckets.map((b) => valueMap.get(`${b}|${agent}`) ?? 0),
  }));

  return { labels, series };
}

/**
 * 供其他模块复用的桶序列构造：日粒度补零到「今天」，周粒度取实际出现过的周。
 * 单 Agent 下钻的趋势图与看板必须用同一套桶，否则同一天的柱子对不齐。
 */
export function buildBucketKeys(
  granularity: TrendGranularity,
  observed: string[],
  startMs: number,
): string[] {
  if (granularity === "day") return buildDayBuckets(observed, startMs);
  return Array.from(new Set(observed)).sort();
}

/** bucket → 展示用标签（10/13 或 W41） */
export function bucketLabel(bucket: string, granularity: TrendGranularity): string {
  return toLabel(bucket, granularity);
}

/** 生成日粒度桶序列（补零用），bucketsFromDb 用于 all 范围时推断起点 */
function buildDayBuckets(bucketsFromDb: string[], startMs: number): string[] {  const out: string[] = [];
  let cursor: Date;
  if (startMs > 0) {
    cursor = new Date(startMs);
  } else {
    const sorted = [...bucketsFromDb].sort();
    if (sorted.length === 0) return [];
    cursor = new Date(`${sorted[0]}T00:00:00`);
  }
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let t = cursor.getTime(); t <= today.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}
