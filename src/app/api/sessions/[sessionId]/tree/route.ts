import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * 会话父子树查询（跨进程 Agent 父子链）。
 *
 * 链路来源：采集端经环境变量链（PI_PARENT_SESSION_ID，每跳由采集扩展重写）上报，
 * upload route 落到 Session.parentSessionId。无外键约束——子会话可能先于父会话
 * 入库，祖先链查询遇到悬空引用时自然截断（不报错）。
 *
 * 递归深度上限 50：既限制链深，也防御脏数据成环导致 SQLite 递归死循环。
 */

const MAX_DEPTH = 50;

interface SessionTreeNode {
  id: string;
  title: string;
  status: string;
  outcome: string;
  startTime: Date;
  endTime: Date | null;
  agentName: string;
  model: string;
  totalTokens: number;
  parentSessionId: string | null;
  parentSpanId: string | null;
  depth: number;
  children: SessionTreeNode[];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 祖先链（直接父 → 根，depth 1..n）
  const ancestorRows = await prisma.$queryRaw<
    Array<{ id: string; depth: number }>
  >`
    WITH RECURSIVE up AS (
      SELECT id, parentSessionId, 0 AS depth FROM "Session" WHERE id = ${sessionId}
      UNION ALL
      SELECT s.id, s.parentSessionId, up.depth + 1
      FROM "Session" s JOIN up ON s.id = up.parentSessionId
      WHERE up.depth < ${MAX_DEPTH}
    )
    SELECT id, depth FROM up WHERE depth > 0
  `;

  // 子树（直接子 → 叶，depth 1..n；自身单独处理）
  const descendantRows = await prisma.$queryRaw<
    Array<{ id: string; depth: number }>
  >`
    WITH RECURSIVE down AS (
      SELECT id, parentSessionId, 0 AS depth FROM "Session" WHERE id = ${sessionId}
      UNION ALL
      SELECT s.id, s.parentSessionId, down.depth + 1
      FROM "Session" s JOIN down ON s.parentSessionId = down.id
      WHERE down.depth < ${MAX_DEPTH}
    )
    SELECT id, depth FROM down WHERE depth > 0
  `;

  const relatedIds = [
    ...new Set([
      ...ancestorRows.map((r) => r.id),
      ...descendantRows.map((r) => r.id),
    ]),
  ];
  const related = relatedIds.length
    ? await prisma.session.findMany({
        where: { id: { in: relatedIds } },
        select: {
          id: true,
          title: true,
          status: true,
          outcome: true,
          startTime: true,
          endTime: true,
          model: true,
          totalTokens: true,
          parentSessionId: true,
          parentSpanId: true,
          agent: { select: { name: true } },
        },
      })
    : [];
  const byId = new Map(related.map((s) => [s.id, s]));

  const toNode = (
    s: (typeof related)[number],
    depth: number,
  ): SessionTreeNode => ({
    id: s.id,
    title: s.title,
    status: s.status,
    outcome: s.outcome,
    startTime: s.startTime,
    endTime: s.endTime,
    agentName: s.agent.name,
    model: s.model,
    totalTokens: s.totalTokens,
    parentSessionId: s.parentSessionId,
    parentSpanId: s.parentSpanId,
    depth,
    children: [],
  });

  // 祖先按 depth 降序组装 = 根在最前（SQLite $queryRaw 返回的整数是 BigInt，收敛为 Number）
  const ancestors = ancestorRows
    .map((r) => ({ id: r.id, depth: Number(r.depth) }))
    .sort((a, b) => b.depth - a.depth)
    .map((r) => {
      const s = byId.get(r.id);
      return s ? toNode(s, r.depth) : null;
    })
    .filter((n): n is SessionTreeNode => n !== null);

  // 子树按 depth 升序逐层挂到父节点
  const descendantRowsSorted = descendantRows
    .map((r) => ({ id: r.id, depth: Number(r.depth) }))
    .sort((a, b) => a.depth - b.depth);
  const nodeMap = new Map<string, SessionTreeNode>();
  const descendants: SessionTreeNode[] = [];
  for (const row of descendantRowsSorted) {
    const s = byId.get(row.id);
    if (!s) continue; // 悬空引用（会话已删）或脏数据
    const node = toNode(s, row.depth);
    nodeMap.set(row.id, node);
    if (row.depth === 1) {
      descendants.push(node);
    } else {
      const parent = s.parentSessionId ? nodeMap.get(s.parentSessionId) : undefined;
      if (parent) parent.children.push(node);
      else descendants.push(node); // 中间节点缺失（悬空引用）时提升为顶层，不丢数据
    }
  }

  const self = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      status: true,
      outcome: true,
      startTime: true,
      endTime: true,
      model: true,
      totalTokens: true,
      parentSessionId: true,
      parentSpanId: true,
      agent: { select: { name: true } },
    },
  });

  // parentSpanName 仅 self 节点解析：该 span 属于父会话，子会话详情数据里没有
  let parentSpanName: string | null = null;
  if (self?.parentSpanId) {
    const parentSpan = await prisma.span.findUnique({
      where: { id: self.parentSpanId },
      select: { name: true, kind: true },
    });
    parentSpanName = parentSpan ? `${parentSpan.name} (${parentSpan.kind})` : null;
  }

  return NextResponse.json({
    session: self
      ? {
          id: self.id,
          title: self.title,
          status: self.status,
          outcome: self.outcome,
          startTime: self.startTime,
          endTime: self.endTime,
          agentName: self.agent.name,
          model: self.model,
          totalTokens: self.totalTokens,
          parentSessionId: self.parentSessionId,
          parentSpanId: self.parentSpanId,
          parentSpanName,
          depth: 0,
          childCount: descendantRows.filter((r) => Number(r.depth) === 1).length,
          children: [],
        }
      : null,
    ancestors,
    descendants,
  });
}
