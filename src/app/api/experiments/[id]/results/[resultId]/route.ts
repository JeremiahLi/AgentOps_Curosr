import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; resultId: string }> }
) {
  const { resultId } = await params;
  const body = await request.json();
  const { humanScore, humanReason, humanBy } = body;

  if (humanScore === undefined || humanScore === null) {
    return NextResponse.json({ error: "humanScore is required" }, { status: 400 });
  }

  const result = await prisma.experimentEvalResult.update({
    where: { id: resultId },
    data: {
      humanScore,
      humanReason: humanReason || null,
      humanBy: humanBy || null,
      humanAt: new Date(),
    },
  });

  return NextResponse.json(result);
}
