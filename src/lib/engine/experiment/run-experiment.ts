import { prisma } from "@/lib/prisma";
import { runEvaluator } from "./evaluators";
import { assembleContext } from "./judge-assembly";

/** 判定"看似在跑、实际已死"的空闲阈值：结果表 10 分钟没有任何变更 */
export const STALE_RUN_MS = 10 * 60 * 1000;

export interface ReclaimResult {
  /** 是否判定为中断并已回收 */
  reset: boolean;
  /** 最后一次结果更新的时间（存活信号） */
  lastActivityAt: Date;
  /** 被标记为 failed 的残留结果数 */
  stuckResultCount: number;
}

/**
 * 回收被中断的实验运行。
 *
 * runExperiment 是 fire-and-forget 启动的（route 里不 await），进程重启、
 * dev HMR 重载模块、或崩溃都会让它悄悄消失，而 Experiment.status 会永远停在
 * "running"；此时再点运行又被 `status === "running"` 拒绝 —— 实验永久卡死，
 * 只能手工改库。
 *
 * 这里用结果表的最后更新时间做存活信号：超过 STALE_RUN_MS 仍无任何结果变更，
 * 就判定为已中断，把残留的 pending/running 结果标记为 failed、实验置 failed，
 * 使它可以被重新运行（runExperiment 只挑 pending/failed 的结果重跑）。
 */
export async function reclaimInterruptedRun(
  experimentId: string,
  experimentUpdatedAt: Date
): Promise<ReclaimResult> {
  const last = await prisma.experimentEvalResult.findFirst({
    where: { experimentId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  const lastActivityAt = last?.updatedAt ?? experimentUpdatedAt;
  if (Date.now() - lastActivityAt.getTime() < STALE_RUN_MS) {
    return { reset: false, lastActivityAt, stuckResultCount: 0 };
  }

  const { count } = await prisma.experimentEvalResult.updateMany({
    where: { experimentId, status: { in: ["pending", "running"] } },
    data: {
      status: "failed",
      errorMessage: "运行被中断（进程重启或异常退出），已自动回收，可重新运行",
    },
  });

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "failed" },
  });

  return { reset: true, lastActivityAt, stuckResultCount: count };
}


class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

export interface RunOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runExperiment(
  experimentId: string,
  options?: RunOptions
): Promise<void> {
  const concurrency = options?.concurrency ?? 4;
  const semaphore = new Semaphore(concurrency);

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      cases: {
        include: { results: true },
      },
    },
  });

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "running" },
  });

  const pendingResults = experiment.cases.flatMap((c) =>
    c.results.filter((r) => r.status === "pending" || r.status === "failed")
  );

  // 实验级规则评估器配置：Record<evaluatorId, params>
  let configMap: Record<string, Record<string, unknown>> = {};
  try {
    const parsed = JSON.parse(experiment.evaluatorConfigJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      configMap = parsed;
    }
  } catch {
    console.error("Invalid evaluatorConfigJson for experiment:", experimentId);
  }

  const total = pendingResults.length;
  let done = 0;

  const tasks = pendingResults.map(async (result) => {
    await semaphore.acquire();
    try {
      const caseData = experiment.cases.find((c) => c.id === result.caseId);
      if (!caseData) return;

      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: { status: "running" },
      });

      const context = await assembleContext(
        caseData.sessionId,
        caseData.input,
        caseData.actualOutput,
        caseData.referenceOutput
      );

      const startTime = Date.now();
      const output = await runEvaluator(result.evaluatorId, context, configMap[result.evaluatorId]);
      const durationMs = Date.now() - startTime;

      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: {
          status: "done",
          score: output.score,
          verdict: output.verdict,
          summary: output.summary,
          evidenceJson: JSON.stringify(output.evidence),
          durationMs,
          attempts: { increment: 1 },
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: {
          status: "failed",
          errorMessage: message,
          attempts: { increment: 1 },
        },
      });
    } finally {
      done++;
      options?.onProgress?.(done, total);
      semaphore.release();
    }
  });

  await Promise.all(tasks);

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "done" },
  });
}
