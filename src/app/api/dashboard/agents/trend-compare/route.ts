import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import {
  getAgentsTrendCompare,
  type AgentTrendMetric,
  type TrendGranularity,
} from "@/lib/engine/stats/trend";

const ALLOWED_RANGES = new Set(["realtime", "3d", "weekly", "30d", "all"]);
const METRICS = new Set<AgentTrendMetric>(["sessions", "tokens", "failed"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const rawRange = searchParams.get("range") ?? "30d";
  if (!ALLOWED_RANGES.has(rawRange)) {
    return NextResponse.json(
      { error: `range=${rawRange} 暂不支持，可用值：realtime / 3d / weekly / 30d / all` },
      { status: 400 },
    );
  }

  const granularity: TrendGranularity = searchParams.get("granularity") === "week" ? "week" : "day";
  const metricParam = (searchParams.get("metric") ?? "sessions") as AgentTrendMetric;
  const metric: AgentTrendMetric = METRICS.has(metricParam) ? metricParam : "sessions";
  const topNParam = Number(searchParams.get("topN"));
  const topN = Number.isFinite(topNParam) && topNParam > 0 ? topNParam : 8;

  const range = resolveRange(rawRange);
  const compare = await getAgentsTrendCompare(prisma, range.startMs, granularity, topN, metric);
  return NextResponse.json({ range: range.label, rangeKey: rawRange, granularity, metric, ...compare });
}
