import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getUserDrilldown } from "@/lib/engine/stats/user-drilldown";
import { getUserTrend, type TrendGranularity } from "@/lib/engine/stats/trend";


export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  const { searchParams } = new URL(request.url);
  const range = resolveRange(searchParams.get("range"));
  const granularity: TrendGranularity = searchParams.get("granularity") === "week" ? "week" : "day";

  const drilldown = await getUserDrilldown(prisma, decodedName, range.startMs);
  if (!drilldown) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const trend = await getUserTrend(prisma, decodedName, range.startMs, granularity);
  return NextResponse.json({ range: range.label, trend, ...drilldown });
}
