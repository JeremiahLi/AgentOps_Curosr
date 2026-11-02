import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function POST(request: Request) {
  let body: {
    sessionId?: string;
    userId?: string;
    projectId?: string;
    metrics?: Array<{
      agentId?: string;
      taskId?: string;
      durationMs?: number;
      success?: boolean;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      callCount?: number;
      models?: string[];
      customData?: Record<string, unknown>;
      createdAt?: string;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, userId, projectId } = body;

  if (!sessionId || !userId || !projectId) {
    return NextResponse.json(
      { error: "Missing required fields: sessionId, userId, projectId" },
      { status: 400 }
    );
  }

  const inMetrics = body.metrics || [];

  try {
    let inserted = 0;
    let skipped = 0;

    for (const m of inMetrics) {
      if (!m.agentId || !m.taskId) {
        skipped++;
        continue;
      }

      const exists = await prisma.businessMetric.findUnique({
        where: { taskId: m.taskId },
      });

      if (exists) {
        skipped++;
        continue;
      }

      await prisma.businessMetric.create({
        data: {
          sessionId,
          userId,
          projectId,
          agentId: m.agentId,
          taskId: m.taskId,
          durationMs: m.durationMs ?? 0,
          success: m.success ?? true,
          inputTokens: m.inputTokens ?? 0,
          outputTokens: m.outputTokens ?? 0,
          totalTokens: m.totalTokens ?? ((m.inputTokens ?? 0) + (m.outputTokens ?? 0)),
          callCount: m.callCount ?? 0,
          models: JSON.stringify(m.models ?? []),
          customData: m.customData ? JSON.stringify(m.customData) : null,
          createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        },
      });

      inserted++;
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped,
      total: inMetrics.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Upload failed", detail: message }, { status: 500 });
  }
}
