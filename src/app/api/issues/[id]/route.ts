import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action !== "confirm" && action !== "dismiss") {
    return NextResponse.json({ error: "action 只能是 confirm 或 dismiss" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!issue) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  if (action === "confirm" && issue.status !== "open") {
    return NextResponse.json({ error: "只有已打开的问题可以确认" }, { status: 409 });
  }
  if (action === "dismiss" && issue.status !== "candidate" && issue.status !== "open" && issue.status !== "confirmed") {
    return NextResponse.json({ error: "这条问题不能忽略" }, { status: 409 });
  }

  const updated = await prisma.issue.update({
    where: { id },
    data: { status: action === "confirm" ? "confirmed" : "dismissed" },
    select: { id: true, status: true },
  });
  return NextResponse.json(updated);
}
