import { PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * 单用户下钻统计（按用户名，同名合并）。
 * 返回：总量 KPI、各 Agent 使用频率与 token 消耗、输入资料大小、最近会话列表。
 */

export interface UserDrilldown {
  name: string;
  totals: {
    sessions: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    rounds: number;
    errors: number;
    errorSessions: number;
    /** 输入条数（user span 数） */
    inputCount: number;
    /** 输入资料大小（按输入文本字符数估算） */
    inputChars: number;
    /** 输出条数（answer span 数） */
    outputCount: number;
    /** 输出资料大小（按回答文本字符数估算） */
    outputChars: number;
  };
  perAgent: {
    name: string;
    emoji: string;
    sessions: number;
    tokens: number;
    rounds: number;
  }[];
  recentSessions: {
    id: string;
    agentName: string;
    agentEmoji: string;
    model: string | null;
    status: string;
    startTime: string;
    totalTokens: number;
    totalRounds: number;
    totalDuration: number;
  }[];
}

export async function getUserDrilldown(
  prisma: PrismaClient,
  name: string,
  startMs: number,
): Promise<UserDrilldown | null> {
  // 用户存在性检查（聚合查询对不存在的分组也会返回一行全 0，不能据此判断）
  const user = await prisma.user.findFirst({ where: { name }, select: { id: true } });
  if (!user) return null;

  const totalsRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COUNT(*) AS sessions,
           COALESCE(SUM(s.totalTokens), 0) AS tokens,
           COALESCE(SUM(s.totalInputTokens), 0) AS inputTokens,
           COALESCE(SUM(s.totalOutputTokens), 0) AS outputTokens,
           COALESCE(SUM(s.totalRounds), 0) AS rounds,
           COALESCE(SUM(s.errorCount), 0) AS errors,
           SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS errorSessions
    FROM Session s
    JOIN User u ON s.userId = u.id
    WHERE u.name = ${name} AND s.startTime >= ${startMs}
  `;
  if (totalsRows.length === 0) return null;

  const ioRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COALESCE(SUM(CASE WHEN sp.kind = 'user' THEN 1 ELSE 0 END), 0) AS inputCount,
           COALESCE(SUM(CASE WHEN sp.kind = 'user' THEN LENGTH(sp.input) ELSE 0 END), 0) AS inputChars,
           COALESCE(SUM(CASE WHEN sp.kind = 'answer' THEN 1 ELSE 0 END), 0) AS outputCount,
           COALESCE(SUM(CASE WHEN sp.kind = 'answer' THEN LENGTH(sp.output) ELSE 0 END), 0) AS outputChars
    FROM Span sp
    JOIN Session s ON sp.sessionId = s.id
    JOIN User u ON s.userId = u.id
    WHERE u.name = ${name} AND sp.kind IN ('user', 'answer') AND s.startTime >= ${startMs}
  `;

  const perAgentRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT a.name AS name, a.emoji AS emoji,
           COUNT(*) AS sessions,
           COALESCE(SUM(s.totalTokens), 0) AS tokens,
           COALESCE(SUM(s.totalRounds), 0) AS rounds
    FROM Session s
    JOIN User u ON s.userId = u.id
    JOIN Agent a ON s.agentId = a.id
    WHERE u.name = ${name} AND s.startTime >= ${startMs}
    GROUP BY a.name, a.emoji
    ORDER BY tokens DESC
  `;

  const recentSessions = await prisma.session.findMany({
    where: {
      user: { name },
      ...(startMs > 0 ? { startTime: { gte: new Date(startMs) } } : {}),
    },
    orderBy: { startTime: "desc" },
    take: 50,
    select: {
      id: true,
      model: true,
      status: true,
      startTime: true,
      totalTokens: true,
      totalRounds: true,
      totalDuration: true,
      agent: { select: { name: true, emoji: true } },
    },
  });

  const t = normalizeRow(totalsRows[0]);
  const io = normalizeRow(ioRows[0] ?? {});
  return {
    name,
    totals: {
      sessions: Number(t.sessions),
      tokens: Number(t.tokens),
      inputTokens: Number(t.inputTokens),
      outputTokens: Number(t.outputTokens),
      rounds: Number(t.rounds),
      errors: Number(t.errors),
      errorSessions: Number(t.errorSessions),
      inputCount: Number(io.inputCount ?? 0),
      inputChars: Number(io.inputChars ?? 0),
      outputCount: Number(io.outputCount ?? 0),
      outputChars: Number(io.outputChars ?? 0),
    },
    perAgent: perAgentRows.map((raw) => {
      const r = normalizeRow(raw);
      return {
        name: String(r.name),
        emoji: String(r.emoji ?? "🤖"),
        sessions: Number(r.sessions),
        tokens: Number(r.tokens),
        rounds: Number(r.rounds),
      };
    }),
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      agentName: s.agent?.name ?? "未知 Agent",
      agentEmoji: s.agent?.emoji ?? "🤖",
      model: s.model,
      status: s.status,
      startTime: (typeof s.startTime === "string" ? s.startTime : new Date(s.startTime).toISOString()),
      totalTokens: s.totalTokens,
      totalRounds: s.totalRounds,
      totalDuration: s.totalDuration,
    })),
  };
}
