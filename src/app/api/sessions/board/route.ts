import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange, type StatsRange } from "@/lib/engine/stats/range";
import { getSessionBoard } from "@/lib/engine/stats/session-board";

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_RANGES: StatsRange[] = ["realtime", "3d", "weekly", "30d", "all"];
const DEFAULT_RANGE: StatsRange = "30d";

/** 与 resolveRange 对齐的跨度天数（用于上期环比窗口） */
function spanDaysOf(range: StatsRange): number {
  if (range === "realtime") return 1;
  if (range === "3d") return 3;
  if (range === "weekly") return 7;
  if (range === "30d") return 30;
  return 0; // all：由实际数据跨度决定
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawRange = searchParams.get("range") ?? DEFAULT_RANGE;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    let startMs: number;
    let toMs = Date.now() + DAY_MS;
    let label: string;
    let rangeKey: string;
    let spanDays: number;

    if (from) {
      // 自定义区间：保留原有能力（排查某次事故的时间切片）
      const start = new Date(`${from}T00:00:00`).getTime();
      if (Number.isNaN(start)) {
        return NextResponse.json({ error: `无效的 from=${from}` }, { status: 400 });
      }
      const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Date.now();
      if (Number.isNaN(end) || end <= start) {
        return NextResponse.json({ error: "结束日期必须晚于开始日期" }, { status: 400 });
      }
      startMs = start;
      toMs = end + 1;
      spanDays = Math.max(1, Math.round((end - start) / DAY_MS));
      label = `${from} → ${to ?? "今日"}`;
      rangeKey = "custom";
    } else {
      if (!ALLOWED_RANGES.includes(rawRange as StatsRange)) {
        return NextResponse.json({ error: `range=${rawRange} 暂不支持` }, { status: 400 });
      }
      const range = rawRange as StatsRange;
      const resolved = resolveRange(range);
      startMs = resolved.startMs;
      label = resolved.label;
      rangeKey = range;
      spanDays = spanDaysOf(range);
      if (range === "all") {
        const first = await prisma.session.findFirst({
          orderBy: { startTime: "asc" },
          select: { startTime: true },
        });
        const firstMs = first ? new Date(first.startTime).getTime() : 0;
        spanDays = firstMs > 0 ? Math.max(1, Math.ceil((Date.now() - firstMs) / DAY_MS)) : 7;
      }
    }

    const board = await getSessionBoard(prisma, { startMs, spanDays });
    return NextResponse.json({
      ...board,
      range: label,
      rangeKey,
      spanDays,
      // 自定义区间的实际边界，前端表格按同一窗口过滤
      windowStartMs: startMs,
      windowEndMs: toMs,
    });
  } catch (err: unknown) {
    console.error("[session-board] 聚合失败", rawRange, err);
    return NextResponse.json(
      {
        error: "Session 看板聚合失败",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
