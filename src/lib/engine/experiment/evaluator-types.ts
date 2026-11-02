export interface EvalOutput {
  score: number;
  confidence: number;
  verdict: "pass" | "warn" | "fail";
  summary: string;
  evidence: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: string;
  output: string;
  error?: string;
}

export interface ContextStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  errorCount: number;
  toolCallCount: number;
}

export interface EvaluatorContext {
  input: string;
  actualOutput: string;
  referenceOutput?: string;
  trace: ToolCall[];
  stats?: ContextStats;
}

export interface FieldDescriptor {
  key: string;
  label: string;
  type: "number" | "text" | "textarea" | "select" | "boolean" | "json";
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface EvaluatorBase {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "llm" | "rule";
  needsReference?: boolean;
}

export interface LlmEvaluator extends EvaluatorBase {
  type: "llm";
  systemPrompt: string;
  buildUserPrompt: (ctx: EvaluatorContext) => string;
  parseResponse: (response: unknown) => EvalOutput;
}

export interface RuleEvaluator extends EvaluatorBase {
  type: "rule";
  configSchema: FieldDescriptor[];
  evaluate: (ctx: EvaluatorContext, config: Record<string, unknown>) => EvalOutput;
}

export type Evaluator = LlmEvaluator | RuleEvaluator;
