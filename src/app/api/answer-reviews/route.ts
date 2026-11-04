import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AnswerReviewError, sampleAnswers } from "@/lib/engine/ingest/answer-review";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "pending";

  const reviews = await prisma.answerReview.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      ...(status && status !== "all" ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      agent: { select: { name: true } },
      issue: { select: { id: true, title: true } },
    },
  });
  const agents = await prisma.agent.findMany({
    where: { sessions: { some: { outcome: { in: ["success", "partial"] } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    agents,
    reviews: reviews.map((review) => ({
      id: review.id,
      agentId: review.agentId,
      agentName: review.agent.name,
      sessionId: review.sessionId,
      evaluatorId: review.evaluatorId,
      status: review.status,
      verdict: review.verdict,
      score: review.score,
      summary: review.summary,
      quote: review.quote,
      issueId: review.issueId,
      issueTitle: review.issue?.title || "",
      createdAt: review.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { agentId?: string; limit?: number } | null;
  try {
    const result = await sampleAnswers(prisma, {
      agentId: body?.agentId || "",
      limit: body?.limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AnswerReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
