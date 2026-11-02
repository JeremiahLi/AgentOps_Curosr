import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "realtime";

  const now = new Date();
  let since: Date | undefined;

  if (range === "weekly") {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "realtime") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // 统计卡片依然按 startTime 过滤（今日新增）
  // 但 Session 排行按 span.startTime 过滤（今日活跃）
  if (since !== undefined) {
    // 先查出在时间范围内有 span 活跃的 sessionId
    // span.startTime 存的是秒级时间戳
    const sinceSec = Math.floor(since.getTime() / 1000);
    const activeSpans = await prisma.span.findMany({
      where: { startTime: { gte: sinceSec } },
      select: { sessionId: true },
    });
    const activeIds = [...new Set(activeSpans.map((s) => s.sessionId))];

    if (activeIds.length === 0) {
      return NextResponse.json([]);
    }

    // 再查这些 session 的详情
    const sessions = await prisma.session.findMany({
      where: { id: { in: activeIds } },
      orderBy: { totalTokens: "desc" },
      take: 5,
      select: {
        id: true,
        totalTokens: true,
        totalDuration: true,
        totalRounds: true,
        totalSpans: true,
        status: true,
        model: true,
        agentId: true,
        startTime: true,
      },
    });

    // 获取 Agent 名称
    const agentIds = [...new Set(sessions.map((s) => s.agentId))];
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true, emoji: true },
    });
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const result = sessions.map((s) => ({
      id: s.id,
      totalTokens: s.totalTokens,
      totalDuration: s.totalDuration,
      totalRounds: s.totalRounds,
      totalSpans: s.totalSpans,
      status: s.status,
      model: s.model,
      agentName: agentMap.get(s.agentId)?.name || "",
      agentEmoji: agentMap.get(s.agentId)?.emoji || "",
      startTime: s.startTime.toISOString(),
    }));

    return NextResponse.json(result);
  } else {
    // range=all：全量查询，不过滤
    const sessions = await prisma.session.findMany({
      orderBy: { totalTokens: "desc" },
      take: 5,
      select: {
        id: true,
        totalTokens: true,
        totalDuration: true,
        totalRounds: true,
        totalSpans: true,
        status: true,
        model: true,
        agentId: true,
        startTime: true,
      },
    });

    const agentIds = [...new Set(sessions.map((s) => s.agentId))];
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true, emoji: true },
    });
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const result = sessions.map((s) => ({
      id: s.id,
      totalTokens: s.totalTokens,
      totalDuration: s.totalDuration,
      totalRounds: s.totalRounds,
      totalSpans: s.totalSpans,
      status: s.status,
      model: s.model,
      agentName: agentMap.get(s.agentId)?.name || "",
      agentEmoji: agentMap.get(s.agentId)?.emoji || "",
      startTime: s.startTime.toISOString(),
    }));

    return NextResponse.json(result);
  }
}