import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAgentAnomalous } from "@/lib/engine/stats/anomalies";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "realtime";

  const now = new Date();
  let startDate: Date | undefined;
  let prevStartDate: Date | undefined;
  let prevEndDate: Date | undefined;

  if (range === "weekly") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    prevStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    prevEndDate = startDate;
  } else if (range === "realtime") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 环比必须同口径：今日截至现在 vs 昨日同一时刻。原实现拿"昨日全天"做对照，
    // 每天上午都会算出 50% 以上的假下降，触发并不存在的活跃度告警。
    const elapsedMs = now.getTime() - startDate.getTime();
    prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
    prevEndDate = new Date(prevStartDate.getTime() + elapsedMs);
  } else if (range !== "all") {
    // 3d / 30d 等档位本路由没有实现分桶与环比逻辑。原实现会静默落到"全量"分支，
    // 返回口径完全不同的数据；这里直接拒绝，避免调用方拿到看似正常的错数据。
    return NextResponse.json(
      { error: `range=${range} 暂不支持，可用值：realtime / weekly / all` },
      { status: 400 }
    );
  }

  // 按 Span 活动时间统计活跃 Session
  async function getStatsForPeriod(start?: Date, end?: Date) {
    const spanWhere: Record<string, unknown> = {};
    if (start) spanWhere.createdAt = { gte: start };
    if (end) spanWhere.createdAt = { ...(spanWhere.createdAt as object || {}), lt: end };

    const activeSpans = await prisma.span.findMany({
      where: spanWhere,
      select: { sessionId: true },
    });
    const activeIds = [...new Set(activeSpans.map((s) => s.sessionId))];

    if (activeIds.length === 0) {
      return { totalSessions: 0, totalTokens: 0, activeAgents: 0, sessions: [] };
    }

    const sessions = await prisma.session.findMany({
      where: { id: { in: activeIds } },
      select: { id: true, totalTokens: true, agentId: true, status: true },
    });

    return {
      totalSessions: sessions.length,
      totalTokens: sessions.reduce((s, x) => s + x.totalTokens, 0),
      activeAgents: [...new Set(sessions.map((s) => s.agentId))].length,
      sessions,
    };
  }

  if (startDate !== undefined) {
    const [currentStats, prevStats] = await Promise.all([
      getStatsForPeriod(startDate),
      prevStartDate ? getStatsForPeriod(prevStartDate, prevEndDate) : { totalSessions: 0, totalTokens: 0, activeAgents: 0, sessions: [] },
    ]);

    // 异常检测
    const anomalies: { type: string; severity: "critical" | "warning"; message: string; details?: { sessionId?: string; agentName?: string; tokens?: number; excessPercent?: number; errorRate?: number }[] }[] = [];

    // 1. 错误 Session 检测
    const errorSessions = currentStats.sessions.filter((s) => s.status === "error");
    if (errorSessions.length > 0) {
      anomalies.push({
        type: "error",
        severity: "critical",
        message: `${errorSessions.length} 个 Session 发生错误`,
        details: errorSessions.map((s) => ({ sessionId: s.id })),
      });
    }

    // 2. Agent 错误率检测（口径见 lib/engine/stats/anomalies.ts，与性能看板共用）
    const agentErrorMap = new Map<string, { total: number; errors: number }>();
    currentStats.sessions.forEach((s) => {
      const existing = agentErrorMap.get(s.agentId) || { total: 0, errors: 0 };
      existing.total++;
      if (s.status === "error") existing.errors++;
      agentErrorMap.set(s.agentId, existing);
    });
    const agentErrorDetails: { agentName: string; errorRate: number }[] = [];
    for (const [agentId, data] of agentErrorMap) {
      if (isAgentAnomalous(data)) {
        const rate = Math.round((data.errors / data.total) * 100);
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
        agentErrorDetails.push({ agentName: agent?.name ?? agentId.slice(-6), errorRate: rate });
      }
    }
    if (agentErrorDetails.length > 0) {
      anomalies.push({
        type: "agent_error",
        severity: "critical",
        message: `${agentErrorDetails.length} 个 Agent 错误率超过 30%`,
        details: agentErrorDetails,
      });
    }

    // 3. Token 消耗异常（超过平均值 3 倍）
    if (currentStats.sessions.length > 0) {
      const avgTokens = currentStats.totalTokens / currentStats.totalSessions;
      const tokenAnomalies = currentStats.sessions.filter((s) => s.totalTokens > avgTokens * 3);
      if (tokenAnomalies.length > 0) {
        anomalies.push({
          type: "token",
          severity: "warning",
          message: `${tokenAnomalies.length} 个 Session Token 消耗异常偏高`,
          details: tokenAnomalies.map((s) => ({
            sessionId: s.id,
            tokens: s.totalTokens,
            excessPercent: Math.round(((s.totalTokens - avgTokens) / avgTokens) * 100),
          })),
        });
      }
    }

    // 4. 活跃度环比下降（下降超过 50%）
    if (prevStats.totalSessions > 0) {
      const dropRate = (prevStats.totalSessions - currentStats.totalSessions) / prevStats.totalSessions;
      if (dropRate > 0.5) {
        anomalies.push({
          type: "activity_drop",
          severity: "warning",
          message: `Session 数量环比下降 ${Math.round(dropRate * 100)}%`,
        });
      }
    }

    // 每日 Token 趋势
    const dailyTrend = [];
    if (range === "weekly") {
      // 按天分组
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const daySpans = await prisma.span.findMany({
          where: { createdAt: { gte: dayStart, lt: dayEnd } },
          select: { sessionId: true },
        });
        const daySessionIds = [...new Set(daySpans.map((s) => s.sessionId))];
        const daySessions = await prisma.session.findMany({
          where: { id: { in: daySessionIds } },
          select: { totalTokens: true },
        });
        const tokens = daySessions.reduce((s, x) => s + x.totalTokens, 0);
        dailyTrend.push({
          label: `${dayStart.getMonth() + 1}/${dayStart.getDate()}`,
          tokens,
        });
      }
    } else {
      // 按小时分组（今日）- 只显示到当前小时
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const currentHour = now.getHours();
      for (let h = 0; h <= currentHour; h++) {
        const hourStart = new Date(todayStart.getTime() + h * 60 * 60 * 1000);
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
        const hourSpans = await prisma.span.findMany({
          where: { createdAt: { gte: hourStart, lt: hourEnd } },
          select: { sessionId: true },
        });
        const hourSessionIds = [...new Set(hourSpans.map((s) => s.sessionId))];
        const hourSessions = await prisma.session.findMany({
          where: { id: { in: hourSessionIds } },
          select: { totalTokens: true },
        });
        const tokens = hourSessions.reduce((s, x) => s + x.totalTokens, 0);
        dailyTrend.push({
          label: `${String(h).padStart(2, "0")}:00`,
          tokens,
        });
      }
    }

    return NextResponse.json({
      totalSessions: currentStats.totalSessions,
      totalTokens: currentStats.totalTokens,
      activeAgents: currentStats.activeAgents,
      prevTotalSessions: prevStats.totalSessions,
      prevTotalTokens: prevStats.totalTokens,
      prevActiveAgents: prevStats.activeAgents,
      anomalies,
      dailyTrend,
    });
  } else {
    // range=all：全量
    const totalSessions = await prisma.session.count();
    const tokenResult = await prisma.session.aggregate({ _sum: { totalTokens: true } });
    const totalTokens = tokenResult._sum.totalTokens || 0;
    const sessions = await prisma.session.findMany({
      select: { agentId: true },
      distinct: ["agentId"],
    });

    return NextResponse.json({
      totalSessions,
      totalTokens,
      activeAgents: sessions.length,
      prevTotalSessions: 0,
      prevTotalTokens: 0,
      prevActiveAgents: 0,
      anomalies: [],
    });
  }
}
