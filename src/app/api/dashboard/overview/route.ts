import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOverviewTrend } from "@/lib/engine/stats/overview";

const ALLOWED_RANGES = new Set(["weekly", "30d", "all"]);

/** 首页概览聚合：四张全局趋势图的数据源（按天），档位 weekly / 30d / all */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const param = searchParams.get("range");
  const range = ALLOWED_RANGES.has(param ?? "") ? (param as "weekly" | "30d" | "all") : "weekly";

  const startMs =
    range === "weekly"
      ? Date.now() - 7 * 24 * 60 * 60 * 1000
      : range === "30d"
        ? Date.now() - 30 * 24 * 60 * 60 * 1000
        : 0;

  const data = await getOverviewTrend(prisma, startMs);
  return NextResponse.json({
    range,
    ...data,
    lastSpanAt: data.lastSpanAt ? data.lastSpanAt.toISOString() : null,
  });
}
