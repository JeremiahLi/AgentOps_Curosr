import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange, type StatsRange } from "@/lib/engine/stats/range";
import { getSkillToolBoard } from "@/lib/engine/stats/skill-tool-board";

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

  try {
    if (!ALLOWED_RANGES.includes(rawRange as StatsRange)) {
      return NextResponse.json({ error: `range=${rawRange} 暂不支持` }, { status: 400 });
    }
    const range = rawRange as StatsRange;
    const resolved = resolveRange(range);
    const startMs = resolved.startMs;
    let spanDays = spanDaysOf(range);

    if (range === "all") {
      // 全量档：上期窗口无意义，跨度只用于均值类说明，取实际数据跨度
      const first = await prisma.span.findFirst({
        where: { kind: "tool_call" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      const firstMs = first ? new Date(first.createdAt).getTime() : 0;
      spanDays = firstMs > 0 ? Math.max(1, Math.ceil((Date.now() - firstMs) / DAY_MS)) : 7;
    }

    const board = await getSkillToolBoard(prisma, { startMs, spanDays });
    return NextResponse.json({
      ...board,
      range: resolved.label,
      rangeKey: range,
      spanDays,
    });
  } catch (err: unknown) {
    console.error("[skill-tool-board] 聚合失败", rawRange, err);
    return NextResponse.json(
      {
        error: "Tool & Skill 看板聚合失败",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
