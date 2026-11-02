import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAgentGuide } from "@/lib/engine/ingest/issue-guide";
import { resolveRange } from "@/lib/engine/stats/range";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const ALLOWED_RANGES = new Set(["realtime", "3d", "weekly", "30d", "all"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const rangeKey = new URL(request.url).searchParams.get("range") ?? "30d";
  if (!ALLOWED_RANGES.has(rangeKey)) {
    return NextResponse.json({ error: `range=${rangeKey} 暂不支持` }, { status: 400 });
  }
  const range = resolveRange(rangeKey);
  const guide = await buildAgentGuide(prisma, safeDecode(name), range.startMs, rangeKey);
  if (!guide) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
  return NextResponse.json(guide);
}
