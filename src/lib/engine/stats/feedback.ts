export interface FeedbackRow {
  userName: string;
  kind: string;
  sessionId: string;
}

export interface FeedbackSummary {
  total: number;
  up: number;
  down: number;
  reports: number;
  /** 窗口内有反馈的会话 / 会话数。没有会话时为 0。 */
  responseRate: number;
  sessionsWithFeedback: number;
  sessionCount: number;
  rank: { name: string; count: number }[];
}

export function summarizeFeedback(rows: FeedbackRow[], sessionCount: number): FeedbackSummary {
  const sessions = new Set(rows.map((row) => row.sessionId).filter(Boolean));
  const counts = new Map<string, number>();
  let up = 0;
  let down = 0;
  let reports = 0;
  for (const row of rows) {
    if (row.kind === "up") up += 1;
    else if (row.kind === "down") down += 1;
    else if (row.kind === "report") reports += 1;
    const name = row.userName || "未知";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rank = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    total: rows.length,
    up,
    down,
    reports,
    responseRate: sessionCount > 0 ? (sessions.size / sessionCount) * 100 : 0,
    sessionsWithFeedback: sessions.size,
    sessionCount,
    rank,
  };
}
