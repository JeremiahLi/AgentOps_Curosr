import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { projectId: true, userId: true, agentId: true } });
    await prisma.span.deleteMany({ where: { sessionId } });
    await prisma.session.delete({ where: { id: sessionId } });
    if (session) {
      const projectRefs = await prisma.session.count({ where: { projectId: session.projectId } });
      if (projectRefs === 0) await prisma.project.delete({ where: { id: session.projectId } }).catch(() => {});
      const userRefs = await prisma.session.count({ where: { userId: session.userId } });
      if (userRefs === 0) await prisma.user.delete({ where: { id: session.userId } }).catch(() => {});
      const agentRefs = await prisma.session.count({ where: { agentId: session.agentId } });
      if (agentRefs === 0) await prisma.agent.delete({ where: { id: session.agentId } }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  // 说明：当前是全表返回 + 客户端筛选（231 条约 60KB，够用）。
  // 触发服务端分页的条件：Session 超过 2000 条，或本响应体超过 1MB。
  // 届时分两步走：① 加 ?range&limit&offset（仍返回数组）；② 过滤条件下沉并改返回 { rows, total }。
  const sessions = await prisma.session.findMany({
    orderBy: { startTime: "desc" },
    include: {
      user: true,
      agent: true,
      project: true,
      _count: { select: { spans: true } },
    },
  });

  /**
   * 会话实际调用过的模型（Span 粒度）。
   * Session.model 只有一个值且有 22/231 为空，LLM 看板跳转 /trace?model=xxx 必须靠这份
   * 集合才准确（跨模型会话只有 4 个，但漏掉就会少算）。
   * 一次 groupBy 拿全量，随 /api/sessions 一起返回，避免前端再发一轮请求。
   */
  const modelGroups = await prisma.span.groupBy({
    by: ["sessionId", "model"],
    where: { kind: "llm_thinking" },
  });
  const modelsBySession = new Map<string, Set<string>>();
  for (const g of modelGroups) {
    if (!g.model) continue;
    const set = modelsBySession.get(g.sessionId) ?? new Set<string>();
    set.add(g.model);
    modelsBySession.set(g.sessionId, set);
  }

  // 父子链：直接子会话计数（一次 groupBy 拿全量，列表行 ↳N chip 用）
  const childCountGroups = await prisma.session.groupBy({
    by: ["parentSessionId"],
    _count: { _all: true },
    where: { parentSessionId: { not: null } },
  });
  const childCountByParent = new Map<string, number>(
    childCountGroups.map((g) => [g.parentSessionId as string, g._count._all]),
  );

  const result = sessions.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    projectName: s.project.name,
    userId: s.userId,
    userName: s.user.name,
    userOrg: s.user.org,
    agentId: s.agentId,
    agentName: s.agent.name,
    agentEmoji: s.agent.emoji,
    status: s.status,
    title: s.title,
    outcome: s.outcome,
    model: s.model,
    /** 该会话实际调用过的模型（去重，来自 llm_thinking span） */
    models: Array.from(modelsBySession.get(s.id) ?? []).sort(),
    startTime: s.startTime,
    totalRounds: s.totalRounds,
    totalSpans: s.totalSpans,
    errorCount: s.errorCount,
    llmCallCount: s.llmCallCount,
    toolCallCount: s.toolCallCount,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    totalCacheReadTokens: s.totalCacheReadTokens,
    totalCacheWriteTokens: s.totalCacheWriteTokens,
    totalTokens: s.totalTokens,
    /** 可计费 Token = input + output，不含 cache（与 Agent 看板成本口径一致） */
    billableTokens: s.totalInputTokens + s.totalOutputTokens,
    totalDuration: s.totalDuration,
    forkCount: s.forkCount,
    parentSessionId: s.parentSessionId,
    childCount: childCountByParent.get(s.id) ?? 0,
  }));

  return NextResponse.json(result);
}
