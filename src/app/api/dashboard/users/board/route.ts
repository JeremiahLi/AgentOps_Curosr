import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getUserBoard } from "@/lib/engine/stats/user-board";

const DAY_MS = 24 * 60 * 60 * 1000;

/** range → 聚合窗口天数（all 用数据实际跨度） */
function spanDaysOf(range: string, startMs: number, firstSessionMs: number | null): number {
  if (range === "realtime") return 1;
  if (range === "3d") return 3;
  if (range === "weekly") return 7;
  if (range === "30d") return 30;
  if (firstSessionMs && firstSessionMs > 0) {
    return Math.max(1, Math.ceil((Date.now() - firstSessionMs) / DAY_MS));
  }
  return 7;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range");
  const range = resolveRange(rangeParam);

  // all 档的活跃度分层需要真实数据跨度，单独取最早一条会话
  let firstSessionMs: number | null = null;
  if (rangeParam === "all" || rangeParam == null) {
    const first = await prisma.session.findFirst({
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    firstSessionMs = first ? new Date(first.startTime).getTime() : null;
  }

  const spanDays = spanDaysOf(rangeParam ?? "all", range.startMs, firstSessionMs);
  // 热力图列数：7 天窗口太窄（只有 7 格，看不出节奏），统一扩到两周起；
  // 30 天档一列一天；全部档最多 6 周（见 user-board HEATMAP_MAX_DAYS）。
  const heatmapDays = rangeParam === "weekly" ? 14 : Math.min(Math.max(spanDays, 7), 42);

  const board = await getUserBoard(prisma, { startMs: range.startMs, spanDays, heatmapDays });
  return NextResponse.json({ ...board, range: range.label, spanDays });
}
