import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOutcome, deriveAgentName, deriveTitle, workspaceLabel } from "@/lib/engine/ingest/derive";

/** 无任何线索时使用的框架名兜底（也是 Agent.framework 的默认值，不要与实例名混用） */
const FALLBACK_AGENT_NAME = "pi-coding-agent";


export async function POST(request: Request) {
  let body: {
    sessionID?: string;
    userId?: string;
    projectId?: string;
    /** 采集端上报的 Agent 实例名；缺省时从 span 内容反推工作目录名 */
    agentName?: string;
    /** 采集端上报的可读项目名；缺省时从 span 内容反推工作目录名 */
    projectName?: string;
    /** 父会话 id：跨进程父子链（采集端经环境变量链上报）；缺省/自环时为 null */
    parentSessionId?: string | null;
    startedAt?: string;
    endedAt?: string;
    model?: string;
    rawData?: string;
    spans?: Array<{
      spanId?: string;
      kind?: string;
      name?: string;
      status?: string;
      roundIndex?: number;
      turnId?: number;
      input?: string | null;
      output?: string | null;
      tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } | null;
      model?: string | null;
      toolCallId?: string | null;
      toolName?: string | null;
      isError?: boolean;
      duration?: number | null;
      llmThinkDuration?: number | null;
      agentReplyDuration?: number | null;
      toolDuration?: number | null;
      details?: string | null;
      content?: string | null;
      agent_name?: string;
      agent_id?: string;
      agent_version?: string;
      parentSessionId?: string | null;
      createdAt?: string;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // rawData（整包原始 payload）不再入库：全工程没有任何读取方，
  // 而它会把每个会话的原始数据永久留在 Session 里（实测占库体 39%）。
  // 字段仍保留在请求类型里，旧采集端继续携带也不会报错，服务端忽略。
  const { sessionID, userId, projectId, startedAt, endedAt, model } = body;

  if (!sessionID || !userId || !projectId) {
    return NextResponse.json(
      { error: "Missing required fields: sessionID, userId, projectId" },
      { status: 400 }
    );
  }

  const inSpans = body.spans || [];

  // 父子链解析：顶层字段优先，回落取 span 里的首个非空值（兼容未来逐条上报）。
  // 自环守卫：父 id 等于自身会话 id 视为无效（嵌套 pi resume 父会话等异常）。
  const rawParentSessionId =
    (typeof body.parentSessionId === "string" && body.parentSessionId.trim()) ||
    inSpans.find((s) => typeof s.parentSessionId === "string" && s.parentSessionId.trim())
      ?.parentSessionId ||
    null;
  const parentSessionId =
    rawParentSessionId && rawParentSessionId.trim() && rawParentSessionId.trim() !== sessionID
      ? rawParentSessionId.trim()
      : null;

// 数值字段收敛：旧版采集端（2026-07 前）会把 turnId 写成字符串（如 "loop-xxx#0"），
// 其他数值字段也可能因历史格式异常传入非数字。Prisma Int 列校验严格，
// 不收敛会导致整个会话 createMany 报 500。非数字/NaN 一律回退默认值。
function toIntOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

  var sessionStartSpan = inSpans.find(function(s: any) { return s.kind === 'session_start'; });

  // Agent 实例名四级兜底：session_start.agent_name → span.agent_name（逐条上报）
  // → 工作目录 basename（从 tool_call 路径反推）→ 框架名。
  // 实测全库 session_start 为 0 条，因此 cwd 反推是历史数据唯一的可读名字来源。
  const agentName = deriveAgentName(
    inSpans,
    (sessionStartSpan && sessionStartSpan.agent_name) || body.agentName || null,
    FALLBACK_AGENT_NAME,
  );

  // 项目名同源推导：旧代码把 Project.name 直接写成 projectId，列表里全是 16 位 hex
  const projectName =
    (body.projectName && body.projectName.trim()) || workspaceLabel(inSpans) || projectId;

  // session.startTime 兜底：会话不可能晚于自己最早的一条 Span 开始。
  // 若 payload 的 startedAt 晚于最早 Span（例如采集端把首次上传时间当作 startedAt），
  // 以最早 Span 为准；两者都没有时才退回当前时间。
  const earliestSpanMs = inSpans.reduce((min, s) => {
    if (!s.createdAt) return min;
    const t = new Date(s.createdAt).getTime();
    return Number.isFinite(t) && (min === Infinity || t < min) ? t : min;
  }, Infinity as number);
  const resolvedStartMs = (() => {
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const hasSpan = Number.isFinite(earliestSpanMs);
    if (Number.isFinite(startedAtMs) && hasSpan) return Math.min(startedAtMs, earliestSpanMs);
    if (Number.isFinite(startedAtMs)) return startedAtMs;
    if (hasSpan) return earliestSpanMs;
    return null; // 无法确定时不下发，避免把 startTime 覆盖成入库时间
  })();
  var agentId = (sessionStartSpan && sessionStartSpan.agent_id) || null;
  var agentVersion = (sessionStartSpan && sessionStartSpan.agent_version) || '1.0.0';

  try {
    const { id: userIdDb } = await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, name: userId, org: "" },
    });

    // Agent 归属：先按客户端给的 agent_id 命中（同一实例改名不新建记录），
    // 再按 name 命中，最后 create。旧实现用 upsert({ where: { name } }) 且 create 时带
    // 客户端 id，一旦真名分开而 id 相同就会主键冲突整包 500。
    const agent = await resolveAgent(agentName, agentId, agentVersion);

    // 项目名只在「当前还是 hex / 等于 id」时才刷新，避免覆盖人工改名
    const existingProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    const shouldRenameProject =
      projectName !== projectId && (!existingProject || existingProject.name === projectId);

    const { id: projectIdDb } = await prisma.project.upsert({
      where: { id: projectId },
      update: shouldRenameProject ? { name: projectName } : {},
      create: { id: projectId, name: projectName, userId: userIdDb, agentId: agent.id },
    });

    // 1. 先确保 session 存在（用最小的数据 insert，不覆盖统计字段）
    // parentSessionId：有值才覆盖，缺省不清空——旧格式 payload 不能抹掉已有链接
    const startFallback = resolvedStartMs != null ? { startTime: new Date(resolvedStartMs) } : {};
    await prisma.session.upsert({
      where: { id: sessionID },
      // startTime 修正：若 payload 带了 startedAt，或此前误用入库时间落库，则用正确基准刷新
      update: { ...startFallback, ...(parentSessionId ? { parentSessionId } : {}) },
      create: {
        id: sessionID,
        projectId: projectIdDb,
        userId: userIdDb,
        agentId: agent.id,
        status: "active",
        ...(parentSessionId ? { parentSessionId } : {}),
        // 首次就能推出可读名时直接写入，避免历史脏归属
        title: deriveTitle(inSpans),
        startTime: new Date(resolvedStartMs ?? Date.now()),
        endTime: endedAt ? new Date(endedAt) : new Date(),
      },
    });

    // 2. 增量 upsert spans，按 id 去重并更新字段
    let insertedNew = 0;
    let updated = 0;
    if (inSpans.length > 0) {
      // 构造 span 数据
      const data = inSpans.map((s) => ({
        id: s.spanId || crypto.randomUUID(),
        sessionId: sessionID,
        roundIndex: toIntOr(s.roundIndex, 0),
        turnId: toIntOr(s.turnId, 0),
        kind: s.kind || "user",
        name: s.name || "",
        status: s.status || "success",
        startTime: s.createdAt
          ? Math.floor(new Date(s.createdAt).getTime() / 1000) || 0
          : 0,
        duration: toIntOr(s.duration, 0),
        inputTokens: toIntOr(s.tokens?.input, 0),
        outputTokens: toIntOr(s.tokens?.output, 0),
        cacheReadTokens: toIntOr(s.tokens?.cacheRead, 0),
        cacheWriteTokens: toIntOr(s.tokens?.cacheWrite, 0),
        totalTokens: toIntOr(s.tokens?.total, 0),
        model: s.model ?? null,
        input: s.input ?? null,
        output: s.output ?? null,
        error: s.isError ? (s.output ?? null) : null,
        llmThinkDuration: s.llmThinkDuration ?? null,
        agentReplyDuration: s.agentReplyDuration ?? null,
        toolDuration: s.toolDuration ?? null,
        details: s.details ?? null,
        content: s.content ?? null,
      }));

      // 查出已存在的 span id
      const incomingIds = data.map((d) => d.id);
      const existing = await prisma.span.findMany({
        where: { id: { in: incomingIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));

      const toInsert = [];
      const toUpdate = [];
      for (const d of data) {
        if (existingIds.has(d.id)) toUpdate.push(d);
        else toInsert.push(d);
      }

      // SQLite 不支持 createMany 的 skipDuplicates，所以拆成 insert 列表
      if (toInsert.length > 0) {
        const BATCH = 200;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const result = await prisma.span.createMany({ data: batch });
          insertedNew += result.count;
        }
      }

      // 对已存在的 span，用原生 SQL 批量 upsert（比逐条 update 快）
      // 先删除再批量插入，确保幂等
      if (toUpdate.length > 0) {
        await prisma.span.deleteMany({
          where: { id: { in: toUpdate.map((d) => d.id) } },
        });
        const BATCH = 200;
        for (let i = 0; i < toUpdate.length; i += BATCH) {
          const batch = toUpdate.slice(i, i + BATCH);
          await prisma.span.createMany({ data: batch });
          updated += batch.length;
        }
      }
    }

    const insertedCount = insertedNew;

    // 3. 从 DB 重新统计该 session 的实际数据，更新 session 字段
    const allSpans = await prisma.span.findMany({
      where: { sessionId: sessionID },
      select: {
        roundIndex: true,
        turnId: true,
        kind: true,
        status: true,
        duration: true,
        input: true,
        output: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        totalTokens: true,
      },
    });

    const roundIndices = new Set<number>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalDuration = 0;
    let errorCount = 0;
    let llmCallCount = 0;
    let toolCallCount = 0;

    for (const sp of allSpans) {
      roundIndices.add(sp.roundIndex);
      if (sp.status === "failed") errorCount++;
      // 口径与 scripts/backfill-session-counters.cjs、session-board.ts 保持一致
      if (sp.kind === "llm_thinking") llmCallCount++;
      // command（shell 命令）与 tool_call 同属「工具调用」，与 trace 前端 isToolKind 对齐
      if (sp.kind === "tool_call" || sp.kind === "command") toolCallCount++;
      totalDuration += sp.duration;
      totalInputTokens += sp.inputTokens;
      totalOutputTokens += sp.outputTokens;
      totalCacheReadTokens += sp.cacheReadTokens;
      totalCacheWriteTokens += sp.cacheWriteTokens;
    }

    const totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens;

    // 只允许 round/spans 数值增长，防止并发上传时用旧数据覆盖新数据
    const existingSession = await prisma.session.findUnique({
      where: { id: sessionID },
      select: {
        totalRounds: true,
        totalSpans: true,
        title: true,
        parentSpanId: true,
        startTime: true,
        agent: { select: { name: true } },
      },
    });

    // 终态以库内全量 span 为准（增量上传时本次 payload 往往只有尾部）
    const { outcome } = computeOutcome(allSpans);
    // 标题用库内全量算，已有值不覆盖（用户诉求不会变）
    const titleFromDb = existingSession?.title ? "" : deriveTitle(allSpans);

    // Agent 归属修正：能从 cwd 推出真名、而当前还挂在框架名兜底记录上时，改挂过去
    const shouldReassignAgent =
      agentName !== FALLBACK_AGENT_NAME && existingSession?.agent?.name === FALLBACK_AGENT_NAME;

    // Span 级父子链接：时间窗匹配父会话中覆盖本会话 startTime 的工具调用 span。
    // fill-if-empty：父会话可能晚于子会话入库（子进程先结束），每次子上传都重试；
    // 已有值不覆盖——首次匹配视为权威，避免父 span 时间重锚定后链接漂移。
    let parentSpanId: string | null = null;
    if (parentSessionId && !existingSession?.parentSpanId) {
      const childStartSec = Math.floor(
        (existingSession?.startTime?.getTime() ?? resolvedStartMs ?? Date.now()) / 1000,
      );
      parentSpanId = await resolveParentSpanId(parentSessionId, childStartSec);
    }

    await prisma.session.update({
      where: { id: sessionID },
      data: {
        // status 由终态决定：只有真失败才置 error，partial 仍算完成（有交付）
        status: outcome === "failed" ? "error" : "completed",
        ...(titleFromDb ? { title: titleFromDb } : {}),
        ...(outcome ? { outcome } : {}),
        ...(shouldReassignAgent ? { agentId: agent.id } : {}),
        ...(parentSessionId ? { parentSessionId } : {}),
        ...(parentSpanId ? { parentSpanId } : {}),
        model: model || "",
        endTime: endedAt ? new Date(endedAt) : new Date(),
        totalRounds: Math.max(roundIndices.size, existingSession?.totalRounds ?? 0),
        totalSpans: Math.max(allSpans.length, existingSession?.totalSpans ?? 0),
        errorCount,
        llmCallCount,
        toolCallCount,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalCacheWriteTokens,
        totalTokens,
        totalDuration,
      },
    });

    // 反向补填：父会话常常最后才结束/上传，子会话此前匹配不到父 span（诚实置 null）
    // 且自己不会再上传——这里以刚入库的本会话 spans 反向补填子会话的 parentSpanId。
    if (allSpans.length > 0) {
      const pendingChildren = await prisma.session.findMany({
        where: { parentSessionId: sessionID, parentSpanId: null },
        select: { id: true, startTime: true },
      });
      for (const child of pendingChildren) {
        const spanId = await resolveParentSpanId(
          sessionID,
          Math.floor(child.startTime.getTime() / 1000),
        );
        if (spanId) {
          await prisma.session.update({
            where: { id: child.id },
            data: { parentSpanId: spanId },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      sessionId: sessionID,
      agent: agent.name,
      outcome,
      totalSpans: allSpans.length,
      insertedNew: insertedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[upload] " + message, stack);
    return NextResponse.json({ error: "Upload failed", detail: message, stack }, { status: 500 });
  }
}

/**
 * Span 级父子链接：时间窗匹配。
 *
 * 为什么不做采集端 env 盖章：pi 的工具调用默认并行执行（agent-loop.ts 的
 * Promise.all，toolExecution 从未被覆盖），同一批 tool_call 的 prepare 全部
 * 先于 execute 串行触发，env 章会被批内后续工具覆盖，产生错误的父 span
 * （比 null 更糟）。时间窗匹配完全在服务端：确定性、零采集端改动。
 *
 * 规则：在父会话 kind ∈ ('tool_call','command')（对齐 isToolKind 口径）且
 * duration > 0 的 span 中，找 [startTime, startTime+duration] 覆盖子会话
 * startTime 的那条。注意单位：Span.startTime 是秒，duration 是毫秒
 * （toolDuration/agentReplyDuration 均为 Date.now() 差值），比较时换算。
 * 并行 spawn 窗口重叠时按 startTime desc（再按 duration desc）取第一条 =
 * 最近启动的内层窗口，是语义上最可信的 spawn 点；无命中诚实置 null。
 */
async function resolveParentSpanId(
  parentSessionId: string,
  childStartSec: number,
): Promise<string | null> {
  const candidates = await prisma.span.findMany({
    where: {
      sessionId: parentSessionId,
      kind: { in: ["tool_call", "command"] },
      startTime: { gt: 0 },
    },
    select: { id: true, startTime: true, duration: true },
    orderBy: [{ startTime: "desc" }, { duration: "desc" }],
  });
  const hit = candidates.find(
    (sp) =>
      sp.duration > 0 &&
      sp.startTime <= childStartSec &&
      childStartSec <= sp.startTime + sp.duration / 1000,
  );
  return hit?.id ?? null;
}

/**
 * Agent 归属解析：id 优先 → name 次之 → 新建。
 *
 * 为什么不直接用 upsert({ where: { name } })：
 * Agent.name 是 unique，而 create 时又允许客户端指定 id。当采集端开始上报真实
 * 实例名、但多个实例仍共用同一个 pi 安装 id 时，create 会主键冲突导致整包 500。
 * 这里把两种键分开匹配，冲突时降级为「按 name 复用 / 不指定 id 新建」。
 */
async function resolveAgent(agentName: string, agentId: string | null, agentVersion: string) {
  if (agentId) {
    const byId = await prisma.agent.findUnique({ where: { id: agentId } });
    if (byId) {
      if (byId.name === agentName && byId.version === agentVersion) return byId;
      // 改名可能撞上别的记录的 unique 约束，失败则保留原记录
      return prisma.agent
        .update({ where: { id: byId.id }, data: { name: agentName, version: agentVersion } })
        .catch(() => byId);
    }
  }

  const byName = await prisma.agent.findUnique({ where: { name: agentName } });
  if (byName) {
    if (byName.version === agentVersion) return byName;
    return prisma.agent.update({ where: { id: byName.id }, data: { version: agentVersion } });
  }

  const create = (id?: string) =>
    prisma.agent.create({
      data: {
        ...(id ? { id } : {}),
        name: agentName,
        version: agentVersion,
        emoji: "🤖",
        description: "",
        framework: FALLBACK_AGENT_NAME,
      },
    });

  try {
    return await create(agentId ?? undefined);
  } catch {
    const again = await prisma.agent.findUnique({ where: { name: agentName } });
    if (again) return again;
    return create();
  }
}
