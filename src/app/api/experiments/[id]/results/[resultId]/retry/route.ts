import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runExperiment } from "@/lib/engine/experiment/run-experiment";


export async function POST(
  _request: Request,
  { params }: { params: Promise<{ resultId: string }> }
) {
  const { resultId } = await params;

  const existing = await prisma.experimentEvalResult.findUnique({
    where: { id: resultId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Result not found" }, { status: 404 });
  }

  const result = await prisma.experimentEvalResult.update({
    where: { id: resultId },
    data: {
      status: "pending",
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });

  // 重置状态后立即触发重跑：runExperiment 会捞取 pending/failed 的结果执行。
  // 实验正在运行时不重复启动，避免并发重跑；本次重置会在下次运行时被拾起。
  const experiment = await prisma.experiment.findUnique({
    where: { id: existing.experimentId },
    select: { status: true },
  });

  if (experiment?.status === "running") {
    return NextResponse.json({
      ok: true,
      started: false,
      note: "实验正在运行中，本次重置将在下次运行时执行",
    });
  }

  runExperiment(existing.experimentId).catch(async (err) => {
    console.error("Experiment run failed:", err);
    await prisma.experiment.update({
      where: { id: existing.experimentId },
      data: { status: "failed" },
    });
  });

  return NextResponse.json({ ok: true, started: true });
}
