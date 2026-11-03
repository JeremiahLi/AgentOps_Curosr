import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeError } from "../ingest/normalize-error";
import { normalizeRow } from "./range";
import { scoreHealth, successRateOf, HEALTH_WINDOW_DAYS, type HealthScore } from "./health";
import { getAgentBoard, type AgentBoardRow } from "./agent-board";
import { SQL_BAD, SQL_FINISHED, SQL_PARTIAL } from "./session-outcome";
import { buildBucketKeys, bucketLabel, type TrendGranularity } from "./trend";
import { explainRecordedIssue, isMissingErrorSignature, type RecordedSpan } from "../ingest/issue-note";
import { loadSlowCallReport, type SlowSpanView } from "./slow-call";

/**
 * 单 Agent 下钻聚合（单一视角）。
 *
 * 回答「这个 Agent 现在什么状态、有什么问题」：
 *   1. 画像   —— 框架/版本/上线时间/覆盖范围（Agent 表没有 readme，用它替代）
 *   2. 健康   —— 复调 agent-board，保证与看板口径一字不差
 *   3. 问题   —— 工具失败 / 错误聚类 / 慢调用 / 衰退 / 沉默 / 数据质量
 *   4. 高频   —— 工具、用户、项目、模型
 *   5. 趋势   —— 耗时（avg+P95）、Token 三段、成功失败
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 环比跌幅阈值，复用 /api/stats 的 activity_drop 约定 */
const DECLINE_RATIO = 0.5;

export type IssueSeverity = "critical" | "warning" | "info";
export type IssueKind =
  | "tool_failure"
  | "error_cluster"
  | "slow_span"
  | "decline"
  | "idle"
  | "data_quality";

export interface AgentIssue {
  id: string;
  severity: IssueSeverity;
  kind: IssueKind;
  /** 一句话结论，如「bash 失败 252 次（19.1%）」 */
  title: string;
  /** 落到组件 / 配置项 / 数据 span / 这次判断。界面加「结论：」前缀。 */
  conclusion?: string;
  /** 证据：可直接核对的事实，2-4 条 */
  evidence: string[];
  /** 建议动作 */
  suggestion: string;
  /** 深链，指向 /trace/{sessionId}?spanId={spanId}（无 spanId 时落到会话顶部） */
  links: { sessionId: string; label: string; spanId?: string }[];
}

export interface AgentTopItem {
  name: string;
  value: number;
  sub?: string;
  failed?: number;
  failRate?: number;
}

export interface AgentProfile {
  name: string;
  emoji: string;
  description: string;
  framework: string;
  version: string;
  /** Agent 注册时间 */
  createdAt: string | null;
  /** 首次出现会话时间 */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysOnline: number | null;
  /** 累计覆盖（全历史） */
  totalUsers: number;
  totalProjects: number;
}

export interface AgentDetailTotals {
  sessions: number;
  finishedSessions: number;
  activeSessions: number;
  badSessions: number;
  /** 有交付但过程出现失败的会话数（按半失败折算进成功率） */
  partialSessions: number;
  successRate: number | null;
  spans: number;
  failedSpans: number;
  spanFailRate: number;
  toolCalls: number;
  toolFailed: number;
  toolFailRate: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  rounds: number;
  users: number;
  projects: number;
  activeDays: number;
  avgDuration: number;
  p95Duration: number;
  p95SampleCount: number;
}

export interface AgentTrendBundle {
  labels: string[];
  duration: { avg: number[]; p95: number[] };
  tokens: { input: number[]; output: number[]; cache: number[] };
  outcome: { sessions: number[]; badSessions: number[] };
}

export interface AgentDetail {
  profile: AgentProfile;
  range: string;
  rangeKey: string;
  spanDays: number;
  totals: AgentDetailTotals;
  /** 固定近 30 天，与看板一致 */
  health: HealthScore;
  issues: AgentIssue[];
  topTools: AgentTopItem[];
  topUsers: AgentTopItem[];
  topProjects: AgentTopItem[];
  topModels: AgentTopItem[];
  errorClusters: { pattern: string; count: number; sample: string; sessionId: string; spanId?: string }[];
  slowSpans: SlowSpanView[];
  trends: AgentTrendBundle;
  /** 数据质量提示（如 answer 类失败但 error 为空） */
  dataNotes: string[];
}

export interface AgentDetailOptions {
  startMs: number;
  spanDays: number;
  granularity: TrendGranularity;
}

/* --------------------------------- 工具 --------------------------------- */

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

function toIso(v: unknown): string | null {
  const n = num(v);
  return n > 0 ? new Date(n).toISOString() : null;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };

/* -------------------------------- 主函数 -------------------------------- */

export async function getAgentDetail(
  prisma: PrismaClient,
  name: string,
  opts: AgentDetailOptions,
): Promise<AgentDetail | null> {
  const { startMs, spanDays, granularity } = opts;
  const now = Date.now();

  const agent = await prisma.agent.findUnique({ where: { name } });
  if (!agent) return null;

  const agentId = agent.id;

  // 健康分固定近 30 天，复用看板聚合，保证两处数字一致
  const board = await getAgentBoard(prisma, {
    startMs: now - HEALTH_WINDOW_DAYS * DAY_MS,
    spanDays: HEALTH_WINDOW_DAYS,
  });
  const boardRow: AgentBoardRow | undefined = board.agents.find((a) => a.id === agentId);

  const bucketExpr =
    granularity === "week"
      ? Prisma.raw(`strftime('%Y-%W', s.startTime / 1000, 'unixepoch', 'localtime')`)
      : Prisma.raw(`date(s.startTime / 1000, 'unixepoch', 'localtime')`);

  const [
    totalsRows,
    spanAggRows,
    lifeRows,
    topToolRows,
    failedSpanRows,
    spanP95Rows,
    topUserRows,
    topProjectRows,
    topModelRows,
    trendRows,
  ] = await Promise.all([
    // D2 区间 totals
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS sessions,
             COALESCE(SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END), 0) AS finishedSessions,
             COALESCE(SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END), 0) AS activeSessions,
             COALESCE(SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END), 0) AS badSessions,
             COALESCE(SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END), 0) AS partialSessions,
             COALESCE(SUM(s.totalTokens), 0) AS totalTokens,
             COALESCE(SUM(s.totalInputTokens), 0) AS inputTokens,
             COALESCE(SUM(s.totalOutputTokens), 0) AS outputTokens,
             COALESCE(SUM(s.totalCacheReadTokens + s.totalCacheWriteTokens), 0) AS cacheTokens,
             COALESCE(SUM(s.totalRounds), 0) AS rounds,
             COUNT(DISTINCT s.userId) AS users,
             COUNT(DISTINCT s.projectId) AS projects,
             COUNT(DISTINCT date(s.startTime / 1000, 'unixepoch', 'localtime')) AS activeDays,
             CAST(COALESCE(AVG(NULLIF(s.totalDuration, 0)), 0) AS INTEGER) AS avgDuration
      FROM Session s
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
    `,
    // span 级失败统计（必须按所选区间算，不能复用 30 天口径）
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS spans,
             COALESCE(SUM(CASE WHEN sp.status IN ('failed', 'error') THEN 1 ELSE 0 END), 0) AS failedSpans,
             COALESCE(SUM(CASE WHEN sp.kind = 'tool_call' THEN 1 ELSE 0 END), 0) AS toolCalls,
             COALESCE(SUM(CASE WHEN sp.kind = 'tool_call' AND sp.status IN ('failed', 'error') THEN 1 ELSE 0 END), 0) AS toolFailed
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
    `,
    // 全历史覆盖
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(DISTINCT userId) AS users, COUNT(DISTINCT projectId) AS projects,
             MIN(startTime) AS firstAt, MAX(startTime) AS lastAt
      FROM Session WHERE agentId = ${agentId}
    `,
    // D3 工具榜
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.name AS name,
             COUNT(*) AS calls,
             COALESCE(SUM(CASE WHEN sp.status IN ('failed', 'error') THEN 1 ELSE 0 END), 0) AS failed,
             CAST(COALESCE(AVG(NULLIF(sp.duration, 0)), 0) AS INTEGER) AS avgDuration
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.kind = 'tool_call'
      GROUP BY sp.name
      ORDER BY calls DESC
      LIMIT 10
    `,
    // D4 失败 span 明细（供错误聚类 + 工具取证）
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.id AS id, sp.sessionId AS sessionId, sp.kind AS kind, sp.name AS name,
             sp.error AS error, sp.duration AS duration, sp.createdAt AS createdAt
      FROM Span sp
      JOIN Session s ON sp.sessionId = s.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.status IN ('failed', 'error')
      ORDER BY sp.createdAt DESC
      LIMIT 500
    `,
    // D5a span P95 阈值
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH ranked AS (
        SELECT sp.duration AS v,
               ROW_NUMBER() OVER (ORDER BY sp.duration) AS rn,
               COUNT(*)       OVER () AS cnt
        FROM Span sp
        JOIN Session s ON sp.sessionId = s.id
        WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs} AND sp.duration > 0
      )
      SELECT MAX(cnt) AS cnt,
             CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95
      FROM ranked
    `,
    // D6 用户榜（按 User.name 聚合，规避同名重复 User）
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT u.name AS name, COALESCE(MAX(NULLIF(u.org, '')), '') AS org,
             COUNT(*) AS sessions, MAX(s.startTime) AS lastAt
      FROM Session s JOIN User u ON s.userId = u.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
      GROUP BY u.name ORDER BY sessions DESC LIMIT 8
    `,
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(MAX(p.name), s.projectId) AS name, COUNT(*) AS sessions
      FROM Session s LEFT JOIN Project p ON s.projectId = p.id
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
      GROUP BY s.projectId ORDER BY sessions DESC LIMIT 8
    `,
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(NULLIF(s.model, ''), '(未标注)') AS model, COUNT(*) AS sessions
      FROM Session s
      WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
      GROUP BY model ORDER BY sessions DESC LIMIT 6
    `,
    // D7 三组趋势（一张桶表同时出耗时/Token/成败）
    prisma.$queryRaw<Record<string, unknown>[]>`
      WITH base AS (
        SELECT ${bucketExpr} AS bucket,
               s.totalDuration AS dur,
               s.totalInputTokens AS inTok,
               s.totalOutputTokens AS outTok,
               s.totalCacheReadTokens + s.totalCacheWriteTokens AS cacheTok,
               CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END AS bad
        FROM Session s
        WHERE s.agentId = ${agentId} AND s.startTime >= ${startMs}
      ),
      agg AS (
        SELECT bucket, COUNT(*) AS sessions, SUM(bad) AS badSessions,
               CAST(COALESCE(AVG(NULLIF(dur, 0)), 0) AS INTEGER) AS avgDuration,
               COALESCE(SUM(inTok), 0) AS inputTokens,
               COALESCE(SUM(outTok), 0) AS outputTokens,
               COALESCE(SUM(cacheTok), 0) AS cacheTokens
        FROM base GROUP BY bucket
      ),
      ranked AS (
        SELECT bucket, dur,
               ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY dur) AS rn,
               COUNT(*)       OVER (PARTITION BY bucket) AS cnt
        FROM base WHERE dur > 0
      ),
      p95 AS (
        SELECT bucket,
               CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN dur END) AS INTEGER) AS p95Duration
        FROM ranked GROUP BY bucket
      )
      SELECT agg.bucket AS bucket, agg.sessions AS sessions, agg.badSessions AS badSessions,
             agg.avgDuration AS avgDuration, agg.inputTokens AS inputTokens,
             agg.outputTokens AS outputTokens, agg.cacheTokens AS cacheTokens,
             COALESCE(p95.p95Duration, 0) AS p95Duration
      FROM agg LEFT JOIN p95 ON p95.bucket = agg.bucket
      ORDER BY agg.bucket
    `,
  ]);

  /* ---- totals ---- */
  const t = totalsRows.length > 0 ? normalizeRow(totalsRows[0]) : null;
  const sessions = Number(t?.sessions ?? 0);
  const finishedSessions = Number(t?.finishedSessions ?? 0);
  const badSessions = Number(t?.badSessions ?? 0);
  const partialSessions = Number(t?.partialSessions ?? 0);
  const spanAgg = spanAggRows.length > 0 ? normalizeRow(spanAggRows[0]) : null;
  const spans = Number(spanAgg?.spans ?? 0);
  const failedSpans = Number(spanAgg?.failedSpans ?? 0);
  const toolCalls = Number(spanAgg?.toolCalls ?? 0);
  const toolFailed = Number(spanAgg?.toolFailed ?? 0);

  const totals: AgentDetailTotals = {
    sessions,
    finishedSessions,
    activeSessions: Number(t?.activeSessions ?? 0),
    badSessions,
    partialSessions,
    successRate: successRateOf(finishedSessions, badSessions, partialSessions),
    spans,
    failedSpans,
    spanFailRate: spans > 0 ? (failedSpans / spans) * 100 : 0,
    toolCalls,
    toolFailed,
    toolFailRate: toolCalls > 0 ? (toolFailed / toolCalls) * 100 : 0,
    totalTokens: Number(t?.totalTokens ?? 0),
    inputTokens: Number(t?.inputTokens ?? 0),
    outputTokens: Number(t?.outputTokens ?? 0),
    cacheTokens: Number(t?.cacheTokens ?? 0),
    rounds: Number(t?.rounds ?? 0),
    users: Number(t?.users ?? 0),
    projects: Number(t?.projects ?? 0),
    activeDays: Number(t?.activeDays ?? 0),
    avgDuration: Number(t?.avgDuration ?? 0),
    p95Duration: 0,
    p95SampleCount: 0,
  };

  /* ---- 画像 ---- */
  const life = lifeRows.length > 0 ? normalizeRow(lifeRows[0]) : null;
  const firstSeenMs = num(lifeRows[0]?.firstAt);
  const profile: AgentProfile = {
    name: agent.name,
    emoji: agent.emoji,
    description: agent.description,
    framework: agent.framework,
    version: agent.version,
    createdAt: agent.createdAt ? new Date(agent.createdAt).toISOString() : null,
    firstSeenAt: toIso(lifeRows[0]?.firstAt),
    lastSeenAt: toIso(lifeRows[0]?.lastAt),
    daysOnline: firstSeenMs > 0 ? Math.max(1, Math.floor((now - firstSeenMs) / DAY_MS)) : null,
    totalUsers: Number(life?.users ?? 0),
    totalProjects: Number(life?.projects ?? 0),
  };

  /* ---- 工具榜 ---- */
  const topTools: AgentTopItem[] = topToolRows.map((raw) => {
    const r = normalizeRow(raw);
    const calls = Number(r.calls);
    const failed = Number(r.failed);
    return {
      name: String(r.name || "(未命名)"),
      value: calls,
      failed,
      failRate: calls > 0 ? (failed / calls) * 100 : 0,
      sub: `均 ${fmtDuration(Number(r.avgDuration))}`,
    };
  });

  /* ---- 失败 span：聚类 + 工具取证 ---- */
  const failedSpansList = failedSpanRows.map((raw) => {
    const r = normalizeRow(raw);
    return {
      spanId: String(r.id),
      sessionId: String(r.sessionId),
      kind: String(r.kind),
      name: String(r.name || ""),
      error: String(raw.error ?? ""),
      at: num(raw.createdAt),
    };
  });

  let emptyErrorCount = 0;
  for (const f of failedSpansList) {
    if (!f.error.trim() || !normalizeError(f.error)) emptyErrorCount++;
  }

  /* ---- 慢 span ---- */
  const spanP95 = spanP95Rows.length > 0 ? normalizeRow(spanP95Rows[0]) : null;
  const p95Threshold = Number(spanP95?.p95 ?? 0);
  totals.p95Duration = p95Threshold;
  totals.p95SampleCount = Number(spanP95?.cnt ?? 0);

  const slowReport = await loadSlowCallReport(prisma, agentId, startMs);
  const slowSpans = slowReport?.spans ?? [];

  /* ---- 趋势 ---- */
  const trendParsed = trendRows.map((raw) => {
    const r = normalizeRow(raw);
    return {
      bucket: String(r.bucket),
      sessions: Number(r.sessions),
      badSessions: Number(r.badSessions),
      avgDuration: Number(r.avgDuration),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      cacheTokens: Number(r.cacheTokens),
      p95Duration: Number(r.p95Duration),
    };
  });
  const buckets = buildBucketKeys(
    granularity,
    trendParsed.map((r) => r.bucket),
    startMs,
  );
  const trendMap = new Map(trendParsed.map((r) => [r.bucket, r]));
  const pick = (b: string) => trendMap.get(b);

  const trends: AgentTrendBundle = {
    labels: buckets.map((b) => bucketLabel(b, granularity)),
    duration: {
      avg: buckets.map((b) => pick(b)?.avgDuration ?? 0),
      p95: buckets.map((b) => pick(b)?.p95Duration ?? 0),
    },
    tokens: {
      input: buckets.map((b) => pick(b)?.inputTokens ?? 0),
      output: buckets.map((b) => pick(b)?.outputTokens ?? 0),
      cache: buckets.map((b) => pick(b)?.cacheTokens ?? 0),
    },
    outcome: {
      sessions: buckets.map((b) => pick(b)?.sessions ?? 0),
      badSessions: buckets.map((b) => pick(b)?.badSessions ?? 0),
    },
  };

  /* ---- 问题列表 ---- */
  const issues: AgentIssue[] = [];

  // 工具失败和错误聚类读问题库里已打开的记录。慢调用、衰退、沉默、数据质量仍按当前时间窗现算。
  const storedIssues = await prisma.issue.findMany({
    where: { agentId, status: { in: ["open", "confirmed", "fixed"] } },
    orderBy: { lastSeenAt: "desc" },
    include: {
      evidence: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  const evidenceSpanIds = [
    ...new Set(storedIssues.flatMap((issue) => issue.evidence.map((item) => item.spanId).filter(Boolean))),
  ];
  const recordedRows = evidenceSpanIds.length
    ? await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT sp.id AS id, sp.kind AS kind, sp.name AS name, COALESCE(sp.model, '') AS model,
               sp.duration AS duration, sp.inputTokens AS inputTokens, sp.outputTokens AS outputTokens,
               length(COALESCE(sp.output, '')) AS outputChars,
               substr(COALESCE(sp.error, ''), 1, 180) AS error
        FROM Span sp
        WHERE sp.id IN (${Prisma.join(evidenceSpanIds)})
      `
    : [];
  const recordedById = new Map<string, Omit<RecordedSpan, "sessionId">>();
  for (const raw of recordedRows) {
    const row = normalizeRow(raw);
    recordedById.set(String(row.id), {
      spanId: String(row.id),
      kind: String(row.kind || ""),
      name: String(row.name || ""),
      model: String(row.model || ""),
      duration: Number(row.duration) || 0,
      inputTokens: Number(row.inputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      outputChars: Number(row.outputChars) || 0,
      error: String(raw.error ?? row.error ?? ""),
    });
  }
  for (const issue of storedIssues) {
    const severity = issue.severity === "critical" || issue.severity === "info" ? issue.severity : "warning";
    const kind = issue.kind === "tool_failure" ? "tool_failure" : "error_cluster";
    const facts: RecordedSpan[] = issue.evidence.flatMap((item) => {
      const span = recordedById.get(item.spanId);
      return span ? [{ ...span, sessionId: item.sessionId }] : [];
    });
    const explained = explainRecordedIssue(facts);
    const missing = isMissingErrorSignature(issue.signature);
    issues.push({
      id: issue.id,
      severity,
      kind,
      title: issue.title,
      conclusion: explained?.conclusion || "",
      evidence: [
        `累计命中 ${issue.hitCount} 次`,
        issue.sampleError ? `样例：${issue.sampleError.slice(0, 160)}` : "没有留下错误原文",
      ],
      suggestion:
        missing && explained
          ? explained.action
          : issue.status === "confirmed"
            ? "已确认。同样的新失败会继续追加证据。"
            : "在问题库里确认或忽略。忽略后，同样的新会话不会把它重新打开。",
      links: issue.evidence.slice(0, 3).map((item, index) => ({
        sessionId: item.sessionId,
        spanId: item.spanId || undefined,
        label: `证据 ${index + 1}`,
      })),
    });
  }

  // 3) 慢调用。只记达到该模型自身 P95 两倍的调用。倍数写在结论里。
  if (slowReport?.issue) {
    issues.push(slowReport.issue);
  }

  // 4) 衰退
  const prevSessions = boardRow?.prevSessions ?? null;
  if (prevSessions != null && prevSessions >= 3 && (prevSessions - sessions) / prevSessions > DECLINE_RATIO) {
    issues.push({
      id: "decline",
      severity: "warning",
      kind: "decline",
      title: `使用量环比下降 ${(((prevSessions - sessions) / prevSessions) * 100).toFixed(0)}%`,
      evidence: [`本期 ${sessions} 会话，上期 ${prevSessions} 会话`],
      suggestion: "确认是否被其他 Agent 替代、接入方式变更，或采集端上报中断。",
      links: [],
    });
  }

  // 5) 沉默
  if (sessions === 0) {
    issues.push({
      id: "idle",
      severity: "info",
      kind: "idle",
      title: "本时间段内零使用",
      evidence: [profile.lastSeenAt ? `最后活跃：${profile.lastSeenAt.slice(0, 10)}` : "从未产生会话"],
      suggestion: "确认该 Agent 是否已下线；若仍在线，检查接入文档与入口是否可达。",
      links: [],
    });
  }

  // 6) 数据质量。已经有「无错误文本」聚类时，结论写在那一条上，这里不再重复一条空泛提示。
  const answerFailed = boardRow?.answerFailed ?? 0;
  const failureExplained = issues.some(
    (item) => item.kind === "error_cluster" && Boolean(item.conclusion) && item.title.includes("无错误文本"),
  );
  if (answerFailed > 0 && !failureExplained) {
    issues.push({
      id: "data-quality",
      severity: "info",
      kind: "data_quality",
      title: `近 30 天有 ${answerFailed} 个回答被标记失败`,
      conclusion:
        emptyErrorCount > 0
          ? `落在数据：本区间 ${emptyErrorCount} 条失败 span 的 error 为空。失败原因没有写进这几条记录。`
          : `落在数据：${answerFailed} 个失败回答的 error 不是空字符串，但聚类签名仍是无错误文本。打开对应 span 看 error 字段的原值。`,
      evidence: [`失败 span 中 ${emptyErrorCount} 条 error 字段为空（本区间样本）`],
      suggestion: "打开失败 span，核对 error 字段里的原文。",
      links: [],
    });
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  /* ---- 高频榜 ---- */
  const topUsers: AgentTopItem[] = topUserRows.map((raw) => {
    const r = normalizeRow(raw);
    return {
      name: String(r.name),
      value: Number(r.sessions),
      sub: String(r.org || "") || undefined,
    };
  });
  const topProjects: AgentTopItem[] = topProjectRows.map((raw) => {
    const r = normalizeRow(raw);
    return { name: String(r.name), value: Number(r.sessions) };
  });
  const topModels: AgentTopItem[] = topModelRows.map((raw) => {
    const r = normalizeRow(raw);
    return { name: String(r.model), value: Number(r.sessions) };
  });

  return {
    profile,
    range: "",
    rangeKey: "",
    spanDays,
    totals,
    health: boardRow?.health ?? scoreHealth({
      framework: agent.framework,
      sessions: 0,
      finishedSessions: 0,
      badSessions: 0,
      toolCalls: 0,
      toolFailed: 0,
      rounds: 0,
      activeDays: 0,
      users: 0,
      p95PerRound: 0,
      tokensPerRound: 0,
      prev: null,
    }),
    issues,
    topTools,
    topUsers,
    topProjects,
    topModels,
    errorClusters: [],
    slowSpans,
    trends,
    dataNotes: emptyErrorCount > 0 ? [`${emptyErrorCount} 条失败 span 没有错误文本`] : [],
  };
}
