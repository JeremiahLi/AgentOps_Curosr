import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBaseline } from "@/lib/engine/stats/session-board";

/** 工具调用口径：command（shell 命令）与 tool_call 同属工具调用，与 trace 前端 isToolKind 一致 */
function isToolKind(kind: string): boolean {
  return kind === "tool_call" || kind === "command";
}


export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: true,
      agent: true,
      project: true,
      spans: { orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }, { startTime: "asc" }] },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Build tree: Round → Turn → Spans
  const allSpans = session.spans;
  const roundIndices = Array.from(new Set(allSpans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  const rounds = roundIndices.map((rIdx) => {
    const roundSpans = allSpans.filter((s) => s.roundIndex === rIdx && !s.branchId);

    // Extract round-level spans
    const inputSpan = roundSpans.find((s) => s.kind === "user" || s.kind === "input");
    const systemPromptSpan = roundSpans.find((s) => s.kind === "system_prompt");
    const answerSpan = roundSpans.find((s) => s.kind === "answer");

    // Remaining spans belong to turns
    const turnSpans = roundSpans.filter((s) =>
      s.kind !== "user" && s.kind !== "input" &&
      s.kind !== "system_prompt" && s.kind !== "answer"
    );
    const turnIds = Array.from(new Set(turnSpans.map((s) => s.turnId))).sort((a, b) => a - b);

    const turns = turnIds.map((tId) => {
      const spans = turnSpans.filter((s) => s.turnId === tId);
      return {
        id: `${sessionId}-r${rIdx}-t${tId}`,
        roundIndex: rIdx,
        turnId: tId,
        spans: spans.map(serializeSpan),
      };
    });

    const forkSpan = roundSpans.find((s) => s.isForkPoint);
    const branches = forkSpan
      ? Array.from(new Set(allSpans.filter((s) => s.roundIndex === rIdx && s.branchId).map((s) => s.branchId)))
          .map((branchId) => {
            const branchSpans = allSpans.filter((s) => s.branchId === branchId);
            return {
              id: branchId,
              roundId: `${sessionId}-r${rIdx}`,
              name: branchSpans[0]?.name || branchId,
              spans: branchSpans.map(serializeSpan),
              isActive: branchSpans.some((s) => s.status === "success"),
            };
          })
      : undefined;

    return {
      id: `${sessionId}-r${rIdx}`,
      sessionId,
      index: rIdx,
      inputSpan: inputSpan ? serializeSpan(inputSpan) : undefined,
      systemPromptSpan: systemPromptSpan ? serializeSpan(systemPromptSpan) : undefined,
      answerSpan: answerSpan ? serializeSpan(answerSpan) : undefined,
      turns,
      isForkPoint: !!forkSpan,
      branches,
    };
  });

  /* ---- 会话级指标（与 header chip 同源，不读冗余列） ---- */
  const llmCalls = allSpans.filter((s) => s.kind === "llm_thinking").length;
  const toolSpans = allSpans.filter((s) => isToolKind(s.kind));
  const toolCalls = toolSpans.length;
  const failedTools = toolSpans.filter((s) => s.status === "failed").length;
  const failedSpans = allSpans.filter((s) => s.status === "failed" || s.status === "error").length;
  const thinkMs = allSpans.reduce(
    (n, s) => n + (s.kind === "llm_thinking" ? (s.llmThinkDuration ?? s.duration) : 0),
    0,
  );
  const toolMs = allSpans.reduce(
    (n, s) => n + (isToolKind(s.kind) ? (s.toolDuration ?? s.duration) : 0),
    0,
  );
  const billableTokens = session.totalInputTokens + session.totalOutputTokens;
  // 父子链：直接子会话数（header 徽章用，省一次前端请求）
  const childCount = await prisma.session.count({ where: { parentSessionId: sessionId } });
  const metrics = {
    billableTokens,
    totalTokens: session.totalTokens,
    durationMs: session.totalDuration,
    perRoundMs:
      session.totalRounds > 0 ? Math.round(session.totalDuration / session.totalRounds) : 0,
    llmCalls,
    toolCalls,
    failedTools,
    failedSpans,
    toolsPerLlm: llmCalls > 0 ? Number((toolCalls / llmCalls).toFixed(2)) : 0,
    thinkMs,
    toolMs,
    thinkSharePct:
      thinkMs + toolMs > 0 ? Math.round((thinkMs / (thinkMs + toolMs)) * 100) : 0,
    toolFailPct: toolCalls > 0 ? Number(((failedTools / toolCalls) * 100).toFixed(2)) : 0,
  };

  // 基准算失败不能拖垮详情页本身：降级为「无基准」，前端按 samples=0 显示 —
  const baseline = await getSessionBaseline(prisma, { agentId: session.agentId }).catch((err) => {
    console.error("[session-detail] 基准计算失败", err);
    return null;
  });

  const result = {
    id: session.id,
    projectId: session.projectId,
    projectName: session.project.name,
    userId: session.userId,
    userName: session.user.name,
    userOrg: session.user.org,
    agentId: session.agentId,
    agentName: session.agent.name,
    agentEmoji: session.agent.emoji,
    status: session.status,
    title: session.title,
    outcome: session.outcome,
    model: session.model,
    startTime: session.startTime,
    endTime: session.endTime,
    totalRounds: session.totalRounds,
    totalSpans: session.totalSpans,
    errorCount: session.errorCount,
    totalInputTokens: session.totalInputTokens,
    totalOutputTokens: session.totalOutputTokens,
    totalCacheReadTokens: session.totalCacheReadTokens,
    totalCacheWriteTokens: session.totalCacheWriteTokens,
    totalTokens: session.totalTokens,
    totalDuration: session.totalDuration,
    forkCount: session.forkCount,
    parentSessionId: session.parentSessionId,
    parentSpanId: session.parentSpanId,
    childCount,
    /**
     * 会话级指标：全部由内存里的 allSpans 现算，与详情页 header 的 LLM/Tool chip 完全同源，
     * 不依赖 Session.llmCallCount 是否已回填。
     */
    metrics,
    /** 同 Agent 近 30 天的中位数 / P90，供 header 的倍数额度对比 */
    baseline,
    rounds,
  };

  return NextResponse.json(result);
}

function serializeSpan(span: {
  id: string;
  roundIndex: number;
  turnId: number;
  parentId: string | null;
  branchId: string | null;
  kind: string;
  name: string;
  status: string;
  startTime: number;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  model: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  llmThinkDuration: number | null;
  agentReplyDuration: number | null;
  toolDuration: number | null;
  details: string | null;
  content: string | null;
  isForkPoint: boolean;
}) {
  return {
    id: span.id,
    roundIndex: span.roundIndex,
    turnId: span.turnId,
    parentId: span.parentId,
    branchId: span.branchId,
    kind: span.kind,
    name: span.name,
    status: span.status,
    startTime: span.startTime * 1000,
    duration: span.duration,
    tokens: span.totalTokens > 0 ? { input: span.inputTokens, output: span.outputTokens, cacheRead: span.cacheReadTokens, cacheWrite: span.cacheWriteTokens, total: span.totalTokens } : undefined,
    model: span.model ?? undefined,
    input: span.input ?? undefined,
    output: span.output ?? undefined,
    error: span.error ?? undefined,
    llmThinkDuration: span.llmThinkDuration ?? undefined,
    agentReplyDuration: span.agentReplyDuration ?? undefined,
    toolDuration: span.toolDuration ?? undefined,
    details: span.details ?? undefined,
    content: span.content ?? undefined,
    isForkPoint: span.isForkPoint,
  };
}
