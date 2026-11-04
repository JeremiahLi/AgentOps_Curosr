/** 两边都至少有这么多条同任务会话时，才把这个任务类型单独拆开。 */
export const TASK_SAMPLE_MIN = 3;

export type CompareVerdict = "improved" | "still" | "worse";

export interface CompareSession {
  id: string;
  releaseId: string;
  taskKey: string;
  totalDuration: number;
  totalTokens: number;
}

export interface CompareHit {
  issueId: string;
  title: string;
  signature: string;
  sessionId: string;
}

export interface SideStat {
  hits: number;
  /** 命中会话的平均耗时。这一侧没有命中时为 0。 */
  durationMs: number;
  /** 命中会话的平均 token。这一侧没有命中时为 0。 */
  tokens: number;
}

export interface ComparedIssue {
  issueId: string;
  title: string;
  signature: string;
  verdict: CompareVerdict;
  base: SideStat;
  next: SideStat;
}

export interface ComparedTask {
  taskKey: string;
  baseSessions: number;
  nextSessions: number;
  issues: ComparedIssue[];
}

export function compareVerdict(baseHits: number, nextHits: number): CompareVerdict | null {
  if (baseHits > 0 && nextHits === 0) return "improved";
  if (baseHits === 0 && nextHits > 0) return "worse";
  if (baseHits > 0 && nextHits > 0) return "still";
  return null;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

const VERDICT_ORDER: Record<CompareVerdict, number> = { worse: 0, still: 1, improved: 2 };

function compareIssues(
  sessions: CompareSession[],
  hits: CompareHit[],
  baseId: string,
  nextId: string,
): ComparedIssue[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const grouped = new Map<string, CompareHit & { base: Set<string>; next: Set<string> }>();
  for (const hit of hits) {
    const session = byId.get(hit.sessionId);
    if (!session) continue;
    if (session.releaseId !== baseId && session.releaseId !== nextId) continue;
    const row = grouped.get(hit.issueId) ?? {
      ...hit,
      base: new Set<string>(),
      next: new Set<string>(),
    };
    if (session.releaseId === baseId) row.base.add(session.id);
    if (session.releaseId === nextId) row.next.add(session.id);
    grouped.set(hit.issueId, row);
  }

  const issues: ComparedIssue[] = [];
  for (const row of grouped.values()) {
    const verdict = compareVerdict(row.base.size, row.next.size);
    if (!verdict) continue;
    const side = (ids: Set<string>): SideStat => {
      const rows = [...ids].map((id) => byId.get(id)).filter((item): item is CompareSession => !!item);
      return {
        hits: ids.size,
        durationMs: avg(rows.map((item) => item.totalDuration)),
        tokens: avg(rows.map((item) => item.totalTokens)),
      };
    };
    issues.push({
      issueId: row.issueId,
      title: row.title,
      signature: row.signature,
      verdict,
      base: side(row.base),
      next: side(row.next),
    });
  }
  issues.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      b.next.hits + b.base.hits - (a.next.hits + a.base.hits),
  );
  return issues;
}

/**
 * 按问题比较两个版本：只在基线出现是变好，两边都有是仍失败，只在新版本出现是变差。
 * 耗时和 token 是命中会话的平均值。任务类型两边都够样本才拆开，不够的留在总表里。
 */
export function compareReleases(input: {
  baseId: string;
  nextId: string;
  sessions: CompareSession[];
  hits: CompareHit[];
  taskSampleMin?: number;
}): { issues: ComparedIssue[]; tasks: ComparedTask[] } {
  const min = input.taskSampleMin ?? TASK_SAMPLE_MIN;
  const scoped = input.sessions.filter(
    (session) => session.releaseId === input.baseId || session.releaseId === input.nextId,
  );
  const issues = compareIssues(scoped, input.hits, input.baseId, input.nextId);

  const baseCount = new Map<string, number>();
  const nextCount = new Map<string, number>();
  for (const session of scoped) {
    if (!session.taskKey) continue;
    const bucket = session.releaseId === input.baseId ? baseCount : nextCount;
    bucket.set(session.taskKey, (bucket.get(session.taskKey) ?? 0) + 1);
  }
  const tasks: ComparedTask[] = [];
  for (const [taskKey, baseSessions] of baseCount) {
    const nextSessions = nextCount.get(taskKey) ?? 0;
    if (baseSessions < min || nextSessions < min) continue;
    const ids = new Set(scoped.filter((session) => session.taskKey === taskKey).map((session) => session.id));
    const taskSessions = scoped.filter((session) => ids.has(session.id));
    const taskHits = input.hits.filter((hit) => ids.has(hit.sessionId));
    const taskIssues = compareIssues(taskSessions, taskHits, input.baseId, input.nextId);
    if (taskIssues.length === 0) continue;
    tasks.push({ taskKey, baseSessions, nextSessions, issues: taskIssues });
  }
  tasks.sort((a, b) => b.baseSessions + b.nextSessions - (a.baseSessions + a.nextSessions));
  return { issues, tasks };
}

export function averageOf(sessions: CompareSession[], releaseId: string): { sessions: number; durationMs: number; tokens: number } {
  const rows = sessions.filter((session) => session.releaseId === releaseId);
  return {
    sessions: rows.length,
    durationMs: avg(rows.map((session) => session.totalDuration)),
    tokens: avg(rows.map((session) => session.totalTokens)),
  };
}
