import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "weekly";
  const { startMs } = resolveRange(range);
  const since = startMs > 0 ? new Date(startMs) : undefined;

  try {
    const records = await prisma.businessMetric.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      orderBy: { createdAt: "desc" },
    });

    const totalTasks = records.length;
    const successTasks = records.filter((r) => r.success).length;
    const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
    const activeAgents = new Set(records.map(r => r.agentId)).size;

    const agentMap = new Map<string, { taskCount: number; totalTokens: number }>();
    for (const r of records) {
      const existing = agentMap.get(r.agentId);
      if (existing) {
        existing.taskCount++;
        existing.totalTokens += r.totalTokens;
      } else {
        agentMap.set(r.agentId, {
          taskCount: 1,
          totalTokens: r.totalTokens,
        });
      }
    }
    const rankings = Array.from(agentMap.entries())
      .map(([agentId, data]) => ({
        agentId,
        taskCount: data.taskCount,
        totalTokens: data.totalTokens,
      }))
      .sort((a, b) => b.taskCount - a.taskCount);

    const agentIds = [...agentMap.keys()];
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true, emoji: true },
    });
    const agentInfoMap = new Map(agents.map(a => [a.id, a]));

    const rankingsWithInfo = rankings.map(r => ({
      ...r,
      agentName: agentInfoMap.get(r.agentId)?.name || r.agentId,
      agentEmoji: agentInfoMap.get(r.agentId)?.emoji || "🤖",
    }));

    const dayMap = new Map<string, { tokens: number; tasks: number }>();
    for (const r of records) {
      const d = new Date(r.createdAt);
      const key = range === "realtime"
        ? `${String(d.getHours()).padStart(2, "0")}:00`
        : `${d.getMonth() + 1}/${d.getDate()}`;
      const existing = dayMap.get(key);
      if (existing) {
        existing.tokens += r.totalTokens;
        existing.tasks++;
      } else {
        dayMap.set(key, { tokens: r.totalTokens, tasks: 1 });
      }
    }
    const trend = Array.from(dayMap.entries())
      .map(([date, data]) => ({
        date,
        tokens: data.tokens,
        tasks: data.tasks,
      }))
      .reverse();

    const tasks = records.slice(0, 100).map(r => ({
      id: r.id,
      agentId: r.agentId,
      agentName: agentInfoMap.get(r.agentId)?.name || r.agentId,
      agentEmoji: agentInfoMap.get(r.agentId)?.emoji || "🤖",
      taskId: r.taskId,
      createdAt: r.createdAt,
      durationMs: r.durationMs,
      success: r.success,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      callCount: r.callCount,
      customData: r.customData ? JSON.parse(r.customData) : {},
    }));

    return NextResponse.json({
      overview: {
        totalTasks,
        successTasks,
        successRate: totalTasks > 0 ? (successTasks / totalTasks) * 100 : 0,
        totalTokens,
        activeAgents,
      },
      rankings: rankingsWithInfo,
      trend,
      tasks,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
