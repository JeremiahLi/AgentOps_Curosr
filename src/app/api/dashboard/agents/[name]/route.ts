import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getAgentDetail } from "@/lib/engine/stats/agent-detail";
import type { TrendGranularity } from "@/lib/engine/stats/trend";

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_RANGES = new Set(["realtime", "3d", "weekly", "30d", "all"]);
const DEFAULT_RANGE = "30d";

/** Next 已经把 URL 段解码过一次，这里再解一次会抛 URIError（名字里含 % 时）；失败就原样用 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("range") ?? DEFAULT_RANGE;

  if (!ALLOWED_RANGES.has(raw)) {
    return NextResponse.json(
      { error: `range=${raw} 暂不支持，可用值：realtime / 3d / weekly / 30d / all` },
      { status: 400 },
    );
  }

  const granularity: TrendGranularity = searchParams.get("granularity") === "week" ? "week" : "day";
  const range = resolveRange(raw);
  const { name } = await params;
  const agentName = safeDecode(name);

  let spanDays: number;
  if (raw === "realtime") spanDays = 1;
  else if (raw === "3d") spanDays = 3;
  else if (raw === "weekly") spanDays = 7;
  else if (raw === "30d") spanDays = 30;
  else {
    const first = await prisma.session.findFirst({
      where: { agent: { name: agentName } },
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    spanDays = first
      ? Math.max(1, Math.ceil((Date.now() - new Date(first.startTime).getTime()) / DAY_MS))
      : 7;
  }

  try {
    const detail = await getAgentDetail(prisma, agentName, {
      startMs: range.startMs,
      spanDays,
      granularity,
    });
    if (!detail) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ ...detail, range: range.label, rangeKey: raw, spanDays });
  } catch (err) {
    console.error("[agent-detail] 聚合失败", agentName, err);
    return NextResponse.json(
      { error: "Agent 详情聚合失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
