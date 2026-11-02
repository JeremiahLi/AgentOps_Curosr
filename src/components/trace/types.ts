export interface SpanNode {
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
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  model?: string;
  input?: string;
  output?: string;
  error?: string;
  llmThinkDuration?: number;
  agentReplyDuration?: number;
  toolDuration?: number;
  details?: string;
  content?: string;
  isForkPoint: boolean;
}

export interface TurnNode {
  id: string;
  roundIndex: number;
  turnId: number;
  spans: SpanNode[];
}

export interface RoundNode {
  id: string;
  sessionId: string;
  index: number;
  inputSpan?: SpanNode;
  systemPromptSpan?: SpanNode;
  answerSpan?: SpanNode;
  turns: TurnNode[];
  isForkPoint?: boolean;
  branches?: BranchNode[];
}

export interface BranchNode {
  id: string;
  roundId: string;
  name: string;
  spans: SpanNode[];
  isActive: boolean;
}

export interface SessionNode {
  id: string;
  totalRounds: number;
  totalSpans: number;
  rounds: RoundNode[];
}

export interface SessionDetail {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  userOrg: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  /** 会话标题（首条用户诉求），空串表示采集端未提供且无法派生 */
  title: string;
  /** success / partial / failed / 空串=未知 */
  outcome: string;
  model: string;
  startTime: string;
  endTime: string | null;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalDuration: number;
  forkCount: number;
  /** 父会话 id（跨进程父子链）；null = 无父/未知 */
  parentSessionId: string | null;
  /** 父会话中派生本会话的工具调用 span id（时间窗匹配）；null = 未匹配/无父 */
  parentSpanId: string | null;
  /** 直接子会话数 */
  childCount: number;
  /** 会话级指标（服务端按 Span 现算，与 header chip 同源） */
  metrics?: SessionMetrics;
  /** 同 Agent 近 30 天的中位数 / P90；null 表示基准计算失败 */
  baseline?: SessionDetailBaseline | null;
  rounds: RoundNode[];
}

/** 详情页的会话级指标，服务端由 Span 现算 */
export interface SessionMetrics {
  billableTokens: number;
  totalTokens: number;
  durationMs: number;
  perRoundMs: number;
  llmCalls: number;
  toolCalls: number;
  failedTools: number;
  failedSpans: number;
  toolsPerLlm: number;
  thinkMs: number;
  toolMs: number;
  thinkSharePct: number;
  toolFailPct: number;
}

export interface BaselineMetric {
  median: number;
  p90: number;
}

export type BaselineMetrics = Record<
  | "billableTokens"
  | "durationMs"
  | "perRoundMs"
  | "llmCalls"
  | "toolCalls"
  | "toolsPerLlm"
  | "thinkSharePct"
  | "toolFailPct",
  BaselineMetric
>;

export interface SessionDetailBaseline {
  /** agent = 该 Agent 样本充足；global = 样本不足退回全局 */
  scope: "agent" | "global";
  /** 实际参与基准计算的会话数（scope=global 时是全局样本数） */
  samples: number;
  /** 该 Agent 自身的有效会话数 */
  agentSamples?: number;
  windowDays: number;
  metrics: BaselineMetrics;
}
