import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractSessionData } from "@/lib/engine/experiment/session-data";


// 向已有实验批量追加用例（session 抽样场景）
// 不创建 ExperimentEvalResult：运行实验时会为缺失的 case×evaluator 自动补 pending 结果
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { cases: { select: { sessionId: true } } },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  if (experiment.status === "running") {
    return NextResponse.json({ error: "实验运行中，无法追加用例" }, { status: 400 });
  }

  const body = await request.json();
  const { caseIds, cases } = body;

  const caseItems = cases || (caseIds?.map((sid: string) => ({ sessionId: sid })) ?? []);
  if (caseItems.length === 0) {
    return NextResponse.json({ error: "At least one case is required" }, { status: 400 });
  }

  // 按已有 sessionId 去重，避免同一 session 产生重复用例
  const existingSessionIds = new Set(
    experiment.cases.map((c) => c.sessionId).filter((s): s is string => s !== null)
  );

  const skipped: string[] = [];
  const toCreate: { sessionId?: string; referenceOutput?: string | null }[] = [];
  for (const item of caseItems) {
    const sessionId = item.sessionId || "";
    if (sessionId && existingSessionIds.has(sessionId)) {
      skipped.push(sessionId);
      continue;
    }
    if (sessionId) existingSessionIds.add(sessionId);
    toCreate.push(item);
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ ok: true, addedCount: 0, skippedCount: skipped.length, addedCaseIds: [] });
  }

  const created = await prisma.$transaction(async (tx) => {
    const addedCaseIds: string[] = [];
    for (const item of toCreate) {
      const { input, actualOutput } = await extractSessionData(item.sessionId || "");
      const created = await tx.experimentCase.create({
        data: {
          experimentId: id,
          sessionId: item.sessionId || null,
          input,
          actualOutput,
          referenceOutput: item.referenceOutput || null,
        },
        select: { id: true },
      });
      addedCaseIds.push(created.id);
    }
    return addedCaseIds;
  });

  return NextResponse.json({
    ok: true,
    addedCount: created.length,
    skippedCount: skipped.length,
    addedCaseIds: created,
  });
}
