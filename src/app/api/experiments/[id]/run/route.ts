import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runExperiment, reclaimInterruptedRun } from "@/lib/engine/experiment/run-experiment";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { cases: { include: { results: true } } },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  if (experiment.status === "running") {
    // 进程重启 / HMR 后实验会永远停在 running，这里先尝试回收中断的运行；
    // 判定为仍在正常推进时才拒绝重复启动。
    const reclaim = await reclaimInterruptedRun(id, experiment.updatedAt);
    if (!reclaim.reset) {
      return NextResponse.json({ error: "Experiment already running" }, { status: 400 });
    }
    // 回收改写了结果状态，重新读一遍再决定要补建哪些结果
    experiment = await prisma.experiment.findUnique({
      where: { id },
      include: { cases: { include: { results: true } } },
    });
    if (!experiment) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }
  }

  let evaluatorIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(experiment.evaluatorIdsJson);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    evaluatorIds = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return NextResponse.json(
      { error: "实验配置的评估器列表已损坏（evaluatorIdsJson 不是合法数组），请在实验设置里重新选择评估器" },
      { status: 422 }
    );
  }

  for (const expCase of experiment.cases) {
    for (const evaluatorId of evaluatorIds) {
      const existing = expCase.results.find(
        (r) => r.evaluatorId === evaluatorId && r.status !== "failed"
      );
      if (!existing) {
        await prisma.experimentEvalResult.create({
          data: {
            experimentId: id,
            caseId: expCase.id,
            evaluatorId,
            status: "pending",
          },
        });
      }
    }
  }

  runExperiment(id).catch(async (err) => {
    console.error("Experiment run failed:", err);
    await prisma.experiment.update({
      where: { id },
      data: { status: "failed" },
    });
  });

  return NextResponse.json({ ok: true, message: "Experiment started" });
}
