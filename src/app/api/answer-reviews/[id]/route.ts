import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AnswerReviewError, confirmAnswerReview, dismissAnswerReview } from "@/lib/engine/ingest/answer-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  try {
    if (body?.action === "confirm") {
      const result = await confirmAnswerReview(prisma, id);
      return NextResponse.json(result);
    }
    if (body?.action === "dismiss") {
      const result = await dismissAnswerReview(prisma, id);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "action 只能是 confirm 或 dismiss" }, { status: 400 });
  } catch (err) {
    if (err instanceof AnswerReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
