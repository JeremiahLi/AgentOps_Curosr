import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const cases = await prisma.regressionCase.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      issue: { select: { id: true, title: true, signature: true, status: true } },
      agent: { select: { id: true, name: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { release: { select: { label: true, quality: true } } },
      },
    },
  });
  return NextResponse.json({
    cases: cases.map((item) => ({
      id: item.id,
      issueId: item.issueId,
      issueTitle: item.issue.title,
      issueStatus: item.issue.status,
      signature: item.issue.signature,
      agentId: item.agentId,
      agentName: item.agent.name,
      sourceSessionId: item.sourceSessionId,
      frozenInput: item.frozenInput,
      passCriteria: item.passCriteria,
      referenceOutput: item.referenceOutput,
      hypothesis: item.hypothesis,
      evaluatorIds: safeList(item.evaluatorIds),
      runs: item.runs.map((run) => ({
        id: run.id,
        evaluatorId: run.evaluatorId,
        sessionId: run.sessionId,
        status: run.status,
        verdict: run.verdict,
        score: run.score,
        summary: run.summary,
        errorMessage: run.errorMessage,
        durationMs: run.durationMs,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        releaseLabel: run.release?.label || "",
      })),
    })),
  });
}

function safeList(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
