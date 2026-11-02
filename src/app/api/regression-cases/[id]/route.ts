import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { hypothesis?: string } | null;
  if (typeof body?.hypothesis !== "string") {
    return NextResponse.json({ error: "需要 hypothesis" }, { status: 400 });
  }
  const existing = await prisma.regressionCase.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "回归用例不存在" }, { status: 404 });
  const updated = await prisma.regressionCase.update({
    where: { id },
    data: { hypothesis: body.hypothesis.trim() },
    select: { id: true, hypothesis: true },
  });
  return NextResponse.json(updated);
}
