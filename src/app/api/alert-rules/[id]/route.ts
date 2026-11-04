import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
  const rule = await prisma.alertRule.findUnique({ where: { id }, select: { id: true } });
  if (!rule) return NextResponse.json({ error: "规则不存在" }, { status: 404 });
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 });
  }
  const updated = await prisma.alertRule.update({
    where: { id },
    data: { enabled: body.enabled },
    select: { id: true, enabled: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rule = await prisma.alertRule.findUnique({ where: { id }, select: { id: true } });
  if (!rule) return NextResponse.json({ error: "规则不存在" }, { status: 404 });
  await prisma.alertRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
