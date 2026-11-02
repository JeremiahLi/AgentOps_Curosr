import { prisma } from "@/lib/prisma";


/**
 * 从 session 的 Span 中提取首条用户输入与首条 Agent 回答，
 * 用于批量把 session 抽样为实验用例（ExperimentCase）。
 */
export async function extractSessionData(
  sessionId: string
): Promise<{ input: string; actualOutput: string }> {
  if (!sessionId) return { input: "", actualOutput: "" };

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
  });

  let input = "";
  let actualOutput = "";

  for (const span of spans) {
    if (span.kind === "user" && span.input && !input) {
      input = span.input;
    }
    if (span.kind === "answer" && span.output && !actualOutput) {
      actualOutput = span.output;
    }
  }

  return { input, actualOutput };
}
