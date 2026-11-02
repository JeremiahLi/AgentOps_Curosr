import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange, type StatsRange } from "@/lib/engine/stats/range";
import { getSessionIdsByTag } from "@/lib/engine/stats/skill-tool-board";

const ALLOWED_RANGES: StatsRange[] = ["realtime", "3d", "weekly", "30d", "all"];

/**
 * 反查命中某个 Skill / Tool 的会话集合，供 /trace?skill=|tool= 下钻过滤。
 *
 * 不把 skill/tool 标签挂进 /api/sessions：那是全量会话响应，
 * 为了一个可选筛选项给每条会话附全量 span 标签不划算。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const name = searchParams.get("name");
  const rawRange = searchParams.get("range") ?? "30d";

  if (type !== "skill" && type !== "tool") {
    return NextResponse.json({ error: "type 必须为 skill 或 tool" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "缺少 name" }, { status: 400 });
  }
  if (!ALLOWED_RANGES.includes(rawRange as StatsRange)) {
    return NextResponse.json({ error: `range=${rawRange} 暂不支持` }, { status: 400 });
  }

  try {
    const title = searchParams.get("title");
    const resolved = resolveRange(rawRange);
    const result = await getSessionIdsByTag(prisma, {
      type,
      name,
      startMs: resolved.startMs,
    });
    return NextResponse.json({
      ...result,
      type,
      name,
      title: title ?? "",
      range: resolved.label,
      rangeKey: rawRange,
    });
  } catch (err: unknown) {
    console.error("[sessions/by-tag] 查询失败", type, name, err);
    return NextResponse.json(
      { error: "按标签反查会话失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
