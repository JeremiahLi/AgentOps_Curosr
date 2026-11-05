import { NextResponse } from "next/server";
import { reviewSession, SessionReviewError, type ReviewPresetId } from "@/lib/engine/review/session-review";

export const maxDuration = 120;

const PRESETS = new Set<ReviewPresetId>(["full", "reasoning", "control", "action", "explain", "custom"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    preset?: string;
    spanId?: string;
    question?: string;
  } | null;
  const preset = body?.preset;
  if (!preset || !PRESETS.has(preset as ReviewPresetId)) {
    return NextResponse.json({ error: "需要选择一个预置问题，或提交自定义问题" }, { status: 400 });
  }
  try {
    const result = await reviewSession(sessionId, preset as ReviewPresetId, {
      spanId: body?.spanId,
      question: body?.question,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
