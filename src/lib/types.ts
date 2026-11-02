export type AgentStatus = "healthy" | "warning" | "error";

export type Framework =
  | "opencode"
  | "claude-code"
  | "hermes"
  | "langgraph"
  | "jiuwen-swarm";

export type SpanKind =
  | "user"
  | "llm_thinking"
  | "tool_call"
  | "command"
  | "answer"
  | "error"
  | "system";

export type SpanStatus = "success" | "failed" | "running";

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  description: string;
  framework: Framework;
  version: string;
  status: AgentStatus;
  totalSessions: number;
  totalRounds: number;
  errorRate: number;
  avgRoundsPerSession: number;
}

export interface User {
  id: string;
  name: string;
  org: string;
}

export interface Project {
  id: string;
  name: string;
  userId: string;
  agentId: string;
}

export interface Span {
  id: string;
  roundId: string;
  parentId: string | null;
  kind: SpanKind;
  name: string;
  status: SpanStatus;
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
}

export interface Round {
  id: string;
  sessionId: string;
  index: number;
  spans: Span[];
  branches?: Branch[];
  isForkPoint?: boolean;
}

export interface Branch {
  id: string;
  roundId: string;
  name: string;
  spans: Span[];
  isActive: boolean;
}

export interface Session {
  id: string;
  projectId: string;
  userId: string;
  agentId: string;
  status: "active" | "completed" | "error";
  rounds: Round[];
  startTime: number;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  totalTokens: number;
  totalDuration: number;
  model: string;
}

export interface AgentHealth {
  agent: Agent;
  sessions: number;
  errorRate: number;
  avgRounds: number;
  totalTokens: number;
  trend: number[];
}
