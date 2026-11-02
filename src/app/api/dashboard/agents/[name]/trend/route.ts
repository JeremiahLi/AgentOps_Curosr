import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getAgentTrend, type TrendGranularity } from "@/lib/engine/stats/trend";


export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  const { searchParams } = new URL(request.url);
  const range = resolveRange(searchParams.get("range"));
  const granularity: TrendGranularity = searchParams.get("granularity") === "week" ? "week" : "day";

  const agent = await prisma.agent.findFirst({ where: { name: decodedName }, select: { id: true } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const trend = await getAgentTrend(prisma, decodedName, range.startMs, granularity);
  return NextResponse.json({ range: range.label, granularity, trend });
}
