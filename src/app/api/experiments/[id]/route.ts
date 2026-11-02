import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregateScores } from "@/lib/engine/experiment/detail-agg";


// 与 judge-assembly.assembleContext 相同的取数规则：优先取 Session 中第一条非空 answer span。
// 返回 hasRealOutput=false 表示 Session 里没有真实回答（LLM 调用失败 / 无录制），
// 此时只能回退到创建实验时的快照，前端应标注"样例"。
async function resolveActualOutput(
  sessionId: string | null,
  snapshot: string
): Promise<{ actualOutput: string; hasRealOutput: boolean }> {
  if (!sessionId) {
    return { actualOutput: snapshot, hasRealOutput: false };
  }
  const answerSpans = await prisma.span.findMany({
    where: { sessionId, kind: "answer" },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
  });
  const live = answerSpans.find((s) => s.output && s.output.trim())?.output;
  if (live) {
    return { actualOutput: live, hasRealOutput: true };
  }
  return { actualOutput: snapshot, hasRealOutput: false };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      cases: {
        include: {
          results: true,
        },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const evaluatorIds = JSON.parse(experiment.evaluatorIdsJson) as string[];

  const allResults = experiment.cases.flatMap((c) =>
    c.results.map((r) => ({
      caseId: c.id,
      evaluatorId: r.evaluatorId,
      status: r.status,
      score: r.score,
      humanScore: r.humanScore,
    }))
  );
  const aggregation = aggregateScores(allResults, evaluatorIds);

  return NextResponse.json({
    id: experiment.id,
    name: experiment.name,
    type: experiment.type,
    agentId: experiment.agentId,
    evaluatorIds,
    status: experiment.status,
    scope: experiment.scope,
    watchMode: experiment.watchMode,
    overallAverage: aggregation.overallAverage,
    evaluatorScores: aggregation.evaluatorScores,
    cases: await Promise.all(
      experiment.cases.map(async (c) => {
        const { actualOutput, hasRealOutput } = await resolveActualOutput(
          c.sessionId,
          c.actualOutput
        );
        return {
          id: c.id,
          sessionId: c.sessionId,
          input: c.input,
          actualOutput,
          hasRealOutput,
          referenceOutput: c.referenceOutput,
          results: c.results.map((r) => ({
            id: r.id,
            evaluatorId: r.evaluatorId,
            status: r.status,
            verdict: r.verdict,
            summary: r.summary,
            score: r.score,
            humanScore: r.humanScore,
            evidenceJson: r.evidenceJson,
            errorMessage: r.errorMessage,
          })),
        };
      })
    ),
    comments: experiment.comments,
    createdAt: experiment.createdAt,
    updatedAt: experiment.updatedAt,
  });
}
