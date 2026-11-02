import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getAgentBoard } from "@/lib/engine/stats/agent-board";

const DAY_MS = 24 * 60 * 60 * 1000;

const ALLOWED_RANGES = new Set(["realtime", "3d", "weekly", "30d", "all"]);
/** 显式默认值：绝不能把 null 交给 resolveRange（它会静默返回「全部」） */
const DEFAULT_RANGE = "30d";

/** range → 聚合窗口天数（all 用数据实际跨度） */
function spanDaysOf(range: string, firstSessionMs: number | null): number {
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
  const raw = searchParams.get("range") ?? DEFAULT_RANGE;

  if (!ALLOWED_RANGES.has(raw)) {
    return NextResponse.json(
      { error: `range=${raw} 暂不支持，可用值：realtime / 3d / weekly / 30d / all` },
      { status: 400 },
    );
  }

  const range = resolveRange(raw);

  // all 档的环比与活跃分层需要真实数据跨度
  let firstSessionMs: number | null = null;
  if (raw === "all") {
    const first = await prisma.session.findFirst({
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    firstSessionMs = first ? new Date(first.startTime).getTime() : null;
  }

  const spanDays = spanDaysOf(raw, firstSessionMs);
  try {
    const board = await getAgentBoard(prisma, { startMs: range.startMs, spanDays });
    return NextResponse.json({ ...board, range: range.label, rangeKey: raw, spanDays });
  } catch (err) {
    console.error("[agent-board] 聚合失败", raw, err);
    return NextResponse.json(
      { error: "Agent 看板聚合失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
