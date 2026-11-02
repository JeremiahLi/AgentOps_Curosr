import { PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * 用户对比统计（按用户名聚合）。
 * 注意：库中可能存在同名用户（真实账号 + 演示账号），必须按 name 聚合而非 userId，
 * 否则页面上会出现重复条目。
 */
export interface UserCompareRow {
  name: string;
  /** 会话数（≈ Agent 调用次数） */
  sessions: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** 对话总轮数 */
  rounds: number;
  /** 错误 span 数 */
  errors: number;
  /** 状态为 error 的会话数 */
  errorSessions: number;
  /** 使用的 Agent 种类数 */
  agentCount: number;
  /** 输入条数（user span 数） */
  inputCount: number;
  /** 输入资料大小（按用户输入文本字符数估算） */
  inputChars: number;
}

export async function getUserCompare(
  prisma: PrismaClient,
  startMs: number,
): Promise<UserCompareRow[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT u.name AS name,
           COUNT(*) AS sessions,
           COALESCE(SUM(s.totalTokens), 0) AS tokens,
           COALESCE(SUM(s.totalInputTokens), 0) AS inputTokens,
           COALESCE(SUM(s.totalOutputTokens), 0) AS outputTokens,
           COALESCE(SUM(s.totalRounds), 0) AS rounds,
           COALESCE(SUM(s.errorCount), 0) AS errors,
           SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) AS errorSessions,
           COUNT(DISTINCT s.agentId) AS agentCount
    FROM Session s
    JOIN User u ON s.userId = u.id
    WHERE s.startTime >= ${startMs}
    GROUP BY u.name
    ORDER BY tokens DESC
  `;

  // 输入资料：该用户 user span 条数与 input 文本字符数之和
  const charRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT u.name AS name,
           COALESCE(SUM(CASE WHEN sp.kind = 'user' THEN 1 ELSE 0 END), 0) AS cnt,
           COALESCE(SUM(CASE WHEN sp.kind = 'user' THEN LENGTH(sp.input) ELSE 0 END), 0) AS chars
    FROM Span sp
    JOIN Session s ON sp.sessionId = s.id
    JOIN User u ON s.userId = u.id
    WHERE sp.kind IN ('user', 'answer') AND s.startTime >= ${startMs}
    GROUP BY u.name
  `;
  const charMap = new Map<string, { cnt: number; chars: number }>();
  for (const raw of charRows) {
    const r = normalizeRow(raw);
    charMap.set(String(r.name), { cnt: Number(r.cnt), chars: Number(r.chars) });
  }

  return rows.map((raw) => {
    const r = normalizeRow(raw);
    return {
      name: String(r.name),
      sessions: Number(r.sessions),
      tokens: Number(r.tokens),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      rounds: Number(r.rounds),
      errors: Number(r.errors),
      errorSessions: Number(r.errorSessions),
      agentCount: Number(r.agentCount),
      inputCount: charMap.get(String(r.name))?.cnt ?? 0,
      inputChars: charMap.get(String(r.name))?.chars ?? 0,
    };
  });
}
