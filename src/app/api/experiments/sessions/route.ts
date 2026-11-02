import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");

  const sessions = await prisma.session.findMany({
    where: agentId ? { agentId } : {},
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      agentId: true,
      status: true,
      model: true,
      startTime: true,
      totalRounds: true,
      totalTokens: true,
      errorCount: true,
      agent: {
        select: { name: true, emoji: true },
      },
    },
  });

  const result = sessions.map((s) => ({
    id: s.id,
    agentId: s.agentId,
    agentName: s.agent.name,
    agentEmoji: s.agent.emoji,
    status: s.status,
    model: s.model,
    startTime: s.startTime,
    totalRounds: s.totalRounds,
    totalTokens: s.totalTokens,
    errorCount: s.errorCount,
  }));

  return NextResponse.json(result);
}
