import type { PrismaClient } from "@prisma/client";
import { assembleContext } from "../experiment/judge-assembly";
import { runEvaluator } from "../experiment/evaluators";
import { issueTitle } from "./issue-rules";
import { normalizeError } from "./normalize-error";

type Db = PrismaClient;

export const ANSWER_EVALUATOR = "accuracy";
export const SAMPLE_LIMIT = 5;
export const SAMPLE_LIMIT_MAX = 8;

export class AnswerReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 裁判摘录或结论压成回答问题的签名。同一段原文跨会话并成一条。 */
export function answerWrongSignature(text: string): string {
  const pattern = normalizeError(text) || "未给出原文";
  return `answer|wrong:${pattern}`;
}

/**
 * 没有参考答案时，准确性裁判最多给 warn。
 * fail，或带问题摘录 / 低分的 warn，才留下来等人确认。
 */
export function reviewNeedsConfirm(input: { verdict: string; score: number; issueCount: number }): boolean {
  if (input.verdict === "fail") return true;
  if (input.verdict === "warn" && (input.score < 70 || input.issueCount > 0)) return true;
  return false;
}

export function quoteFromEvidence(evidence: Record<string, unknown> | undefined): string {
  const issues = evidence?.issues;
  if (!Array.isArray(issues)) return "";
  for (const item of issues) {
    if (!item || typeof item !== "object") continue;
    const quote = (item as { quote?: unknown }).quote;
    if (typeof quote === "string" && quote.trim()) return quote.trim().slice(0, 240);
  }
  return "";
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return SAMPLE_LIMIT;
  return Math.min(SAMPLE_LIMIT_MAX, Math.max(1, Math.trunc(limit)));
}

export async function sampleAnswers(
  db: Db,
  input: { agentId: string; limit?: number },
): Promise<{ judged: number; pending: number; passed: number; skipped: number; errors: string[] }> {
  const agentId = input.agentId.trim();
  if (!agentId) throw new AnswerReviewError("要指定 Agent");
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) throw new AnswerReviewError("Agent 不存在", 404);
  const limit = clampLimit(input.limit);

  const reviewed = await db.answerReview.findMany({
    where: { agentId, evaluatorId: ANSWER_EVALUATOR },
    select: { sessionId: true },
  });
  const seen = new Set(reviewed.map((row) => row.sessionId));
  const sessions = await db.session.findMany({
    where: {
      agentId,
      outcome: { in: ["success", "partial"] },
      ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
    },
    orderBy: { startTime: "desc" },
    take: limit * 4,
    select: { id: true, releaseId: true },
  });

  let judged = 0;
  let pending = 0;
  let passed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const session of sessions) {
    if (judged >= limit) break;
    const context = await assembleContext(session.id, "", "", "");
    if (!context.actualOutput.trim()) {
      await db.answerReview.create({
        data: {
          agentId,
          sessionId: session.id,
          releaseId: session.releaseId,
          evaluatorId: ANSWER_EVALUATOR,
          status: "skipped",
          summary: "这次会话没有可评的回答正文",
        },
      });
      skipped += 1;
      continue;
    }
    judged += 1;
    try {
      const output = await runEvaluator(ANSWER_EVALUATOR, context, {});
      const quote = quoteFromEvidence(output.evidence);
      const issueCount = Array.isArray(output.evidence?.issues) ? output.evidence.issues.length : 0;
      const hold = reviewNeedsConfirm({ verdict: output.verdict, score: output.score, issueCount });
      await db.answerReview.create({
        data: {
          agentId,
          sessionId: session.id,
          releaseId: session.releaseId,
          evaluatorId: ANSWER_EVALUATOR,
          status: hold ? "pending" : "pass",
          verdict: output.verdict,
          score: output.score,
          summary: (output.summary || "").slice(0, 500),
          quote,
        },
      });
      if (hold) pending += 1;
      else passed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message.slice(0, 200));
      judged -= 1;
      break;
    }
  }
  return { judged, pending, passed, skipped, errors };
}

/**
 * 确认一条抽样后，才写成问题库里的回答问题。
 * 已忽略或已修复的同一签名不会被重新打开。
 */
export async function confirmAnswerReview(db: Db, reviewId: string) {
  const review = await db.answerReview.findUnique({ where: { id: reviewId } });
  if (!review) throw new AnswerReviewError("抽样不存在", 404);
  if (review.status === "confirmed" && review.issueId) return { issueId: review.issueId, status: "confirmed" as const };
  if (review.status !== "pending") throw new AnswerReviewError("只有待确认的抽样可以写入问题库", 409);

  const signature = answerWrongSignature(review.quote || review.summary);
  const answer = await db.span.findFirst({
    where: { sessionId: review.sessionId, kind: "answer" },
    orderBy: [{ roundIndex: "desc" }, { turnId: "desc" }],
    select: { id: true },
  });
  const spanId = answer?.id || "";

  const existing = await db.issue.findUnique({
    where: { agentId_signature: { agentId: review.agentId, signature } },
  });
  if (existing && (existing.status === "dismissed" || existing.status === "fixed")) {
    throw new AnswerReviewError("同一条回答问题已被忽略或标为已修复", 409);
  }

  const issue =
    existing ??
    (await db.issue.create({
      data: {
        agentId: review.agentId,
        signature,
        kind: "answer_wrong",
        title: issueTitle(signature),
        status: "confirmed",
        severity: "warning",
        sampleError: (review.quote || review.summary).slice(0, 200),
        hitCount: 0,
      },
    }));

  const prior = await db.issueEvidence.findFirst({
    where: { issueId: issue.id, sessionId: review.sessionId, spanId },
    select: { id: true },
  });
  if (!prior) {
    await db.issueEvidence.create({
      data: {
        issueId: issue.id,
        sessionId: review.sessionId,
        spanId,
        releaseId: review.releaseId,
        source: "review",
      },
    });
  }
  const hitCount = await db.issueEvidence.count({ where: { issueId: issue.id } });
  await db.issue.update({
    where: { id: issue.id },
    data: {
      kind: "answer_wrong",
      title: issueTitle(signature),
      status: "confirmed",
      severity: "warning",
      hitCount,
      lastSeenAt: new Date(),
      ...(issue.sampleError ? {} : { sampleError: (review.quote || review.summary).slice(0, 200) }),
    },
  });
  await db.answerReview.update({
    where: { id: review.id },
    data: { status: "confirmed", issueId: issue.id },
  });
  return { issueId: issue.id, status: "confirmed" as const };
}

export async function dismissAnswerReview(db: Db, reviewId: string) {
  const review = await db.answerReview.findUnique({ where: { id: reviewId }, select: { id: true, status: true } });
  if (!review) throw new AnswerReviewError("抽样不存在", 404);
  if (review.status !== "pending") throw new AnswerReviewError("只有待确认的抽样可以忽略", 409);
  await db.answerReview.update({ where: { id: review.id }, data: { status: "dismissed" } });
  return { id: review.id, status: "dismissed" as const };
}
