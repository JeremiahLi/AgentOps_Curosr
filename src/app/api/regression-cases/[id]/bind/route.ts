import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bindRegressionSession, RegressionInputError } from "@/lib/engine/ingest/regression";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { sessionId?: string } | null;
  const sessionId = body?.sessionId?.trim() || "";
  if (!sessionId) return NextResponse.json({ error: "需要 sessionId" }, { status: 400 });
  try {
    const runs = await bindRegressionSession(prisma, { caseId: id, sessionId, rerun: true });
    return NextResponse.json({
      runs: runs.map((run) => ({
        id: run.id,
        evaluatorId: run.evaluatorId,
        sessionId: run.sessionId,
        status: run.status,
        verdict: run.verdict,
        summary: run.summary,
        errorMessage: run.errorMessage,
      })),
    });
  } catch (err) {
    if (err instanceof RegressionInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
