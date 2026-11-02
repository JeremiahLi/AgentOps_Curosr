import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildAgentGuide } from "@/lib/engine/ingest/issue-guide";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const guide = await buildAgentGuide(prisma, safeDecode(name));
  if (!guide) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
  return NextResponse.json(guide);
}
