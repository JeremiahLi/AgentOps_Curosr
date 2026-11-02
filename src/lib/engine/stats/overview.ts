import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * 首页概览聚合：按天聚合全平台 Session，产出四张全局趋势图所需序列。
 * - 活跃用户/活跃 Agent：当日 distinct 计数
 * - 会话量：新增数 + 其中失败（status="error"）
 * - Token：输入 / 输出 / cache（cacheRead + cacheWrite）三段堆叠
 * - 累计注册用户：User.createdAt 按日累积
 * 缺失日期补 0，保证曲线连续。
 */

export interface OverviewPoint {
  /** X 轴标签 M/D */
  label: string;
  /** 日期键 YYYY-MM-DD */
  date: string;
  activeUsers: number;
  activeAgents: number;
  sessions: number;
  errorSessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  /** 截至当日（含）的累计注册用户数 */
  cumulativeUsers: number;
}

export interface OverviewTrend {
  series: OverviewPoint[];
  /** 末日累计注册用户总数 */
  cumulativeUsers: number;
  /** Agent 总数（活跃 Agent 锚点分母） */
  agentTotal: number;
  /** 最近一条 Span 的上报时间（数据新鲜度哨兵；无任何数据时为 null） */
  lastSpanAt: Date | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export async function getOverviewTrend(
  prisma: PrismaClient,
  startMs: number,
): Promise<OverviewTrend> {
  // Prisma $queryRaw 的模板插值默认是绑定参数，SQL 片段必须用 Prisma.sql/Prisma.raw
  const timeFilter =
    startMs > 0 ? Prisma.sql` s.startTime >= ${startMs} ` : Prisma.sql` 1=1 `;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT date(s.startTime / 1000, 'unixepoch', 'localtime') AS bucket,
           COUNT(*) AS sessions,
           COALESCE(SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END), 0) AS errorSessions,
           COUNT(DISTINCT s.userId) AS activeUsers,
           COUNT(DISTINCT s.agentId) AS activeAgents,
           COALESCE(SUM(s.totalInputTokens), 0) AS inputTokens,
           COALESCE(SUM(s.totalOutputTokens), 0) AS outputTokens,
           COALESCE(SUM(s.totalCacheReadTokens), 0) + COALESCE(SUM(s.totalCacheWriteTokens), 0) AS cacheTokens,
           COALESCE(SUM(s.totalTokens), 0) AS totalTokens
    FROM Session s
    WHERE ${timeFilter}
    GROUP BY bucket
    ORDER BY bucket
  `;

  const map = new Map<string, Omit<OverviewPoint, "label" | "date" | "cumulativeUsers">>();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const bucket = String(r.bucket);
    map.set(bucket, {
      activeUsers: Number(r.activeUsers),
      activeAgents: Number(r.activeAgents),
      sessions: Number(r.sessions),
      errorSessions: Number(r.errorSessions),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      cacheTokens: Number(r.cacheTokens),
      totalTokens: Number(r.totalTokens),
    });
  }

  // 注册用户按日累积：一条轻查询拉全量 createdAt，用户量级小
  const users = await prisma.user.findMany({ select: { createdAt: true }, orderBy: { createdAt: "asc" } });
  const agentTotal = await prisma.agent.count();
  // 数据新鲜度哨兵：最近一条 Span 的上报时间
  const lastSpanAgg = await prisma.span.aggregate({ _max: { createdAt: true } });
  const lastSpanAt = lastSpanAgg._max.createdAt ?? null;

  // 生成连续日序列（补 0）。startMs=0 时从最早数据日/最早注册日起
  let cursor: Date;
  if (startMs > 0) {
    cursor = new Date(startMs);
  } else {
    const keys = Array.from(map.keys()).sort();
    const firstUser = users.length > 0 ? new Date(users[0].createdAt) : null;
    const firstData = keys.length > 0 ? new Date(`${keys[0]}T00:00:00`) : null;
    const candidates = [firstData, firstUser]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length === 0) {
      return { series: [], cumulativeUsers: 0, agentTotal, lastSpanAt };
    }
    cursor = candidates[0];
  }
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let userIdx = 0;
  const series: OverviewPoint[] = [];
  for (let t = cursor.getTime(); t <= today.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const dayEnd = t + 24 * 60 * 60 * 1000 - 1;
    while (userIdx < users.length && new Date(users[userIdx].createdAt).getTime() <= dayEnd) {
      userIdx++;
    }
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const row = map.get(key);
    series.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      date: key,
      activeUsers: row?.activeUsers ?? 0,
      activeAgents: row?.activeAgents ?? 0,
      sessions: row?.sessions ?? 0,
      errorSessions: row?.errorSessions ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      cacheTokens: row?.cacheTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      cumulativeUsers: userIdx,
    });
  }

  const cumulativeUsers = series.length > 0 ? series[series.length - 1].cumulativeUsers : userIdx;
  return { series, cumulativeUsers, agentTotal, lastSpanAt };
}
