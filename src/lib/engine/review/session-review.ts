import { prisma } from "@/lib/prisma";
import { getActiveLlmConfig, type LlmConfig, type LlmMessage } from "@/lib/engine/experiment/judge-llm";
import { analyzeSessionFacts, type FactSpan } from "@/lib/engine/ingest/session-facts";
import { diagnoseSession } from "@/lib/engine/ingest/session-diagnosis";

export type ReviewPresetId = "full" | "reasoning" | "control" | "action" | "explain" | "custom";

export interface ReviewFinding {
  category: "reasoning" | "control" | "action";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  spanId: string;
}

export interface SessionReviewResult {
  model: string;
  question: string;
  summary: string;
  findings: ReviewFinding[];
}

export class SessionReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const PRESET_QUESTIONS: Record<Exclude<ReviewPresetId, "custom">, string> = {
  full: "这个 Session 表面上看起来可能没有报错。请只根据轨迹，检查有没有隐形问题，并分成三类：推理（上下文不够、用错上下文、没遵守指令、漏看已经出现的证据）、控制流（死循环、该停却继续、不该停却停、步数打满）、动作（工具选错、参数不合法、工具执行失败、工具结果被后文无视）。每一条都要写明 spanId，并摘出你看到的原文。没有证据就不要报。如果没有这类问题，findings 留空，summary 说明轨迹里哪些证据支撑“表面正常”。",
  reasoning:
    "只看推理：有没有上下文不够、用错上下文、没遵守指令，或漏看轨迹里已经出现的证据？指出是哪一步、它当时已经能看到什么、它实际依据了什么。摘出原文。没有证据就不要报。",
  control:
    "只看控制流：有没有死循环、该停却继续、不该停却停，或步数被打满？指出从哪一步开始、重复或停下的是什么、按当时的工具结果本来应该继续还是停止。摘出原文。没有证据就不要报。",
  action:
    "只看动作：有没有工具选错、参数不合法、工具执行失败，或工具结果被后文无视？指出工具名、关键参数或报错原文，以及后面的步骤有没有用上返回。摘出原文。没有证据就不要报。",
  explain:
    "解释标成【当前关注】的这一步：它在做什么，和前后已经出现的证据是否对得上。如果有问题，说明是推理、控制流还是动作，并摘出依据的原文。",
};

const SYSTEM_PROMPT = `你是 Agent 会话评审员。用户会给出一条已经发生的轨迹，以及一个问题。
只根据轨迹里写明的内容回答。不要推测轨迹里没有的文件、意图或后来发生的事。
规则诊断只是线索，不能当成你的结论。用户问的是轨迹本身对不对得上。
用中文，写具体：点名工具、参数、报错原文或模型原话。不要只写“可能有问题”。

回复的第一个字符必须是 {，最后一个字符必须是 }。不要写前言，不要写 Let me，不要用 markdown。
只输出这个 JSON：
{
  "summary": "针对这个问题的一两句结论",
  "findings": [
    {
      "category": "reasoning 或 control 或 action",
      "severity": "high 或 medium 或 low",
      "title": "不超过 24 个字",
      "detail": "具体证据，包含轨迹里的原话",
      "spanId": "必须是轨迹里出现过的 id；对不上就用空字符串"
    }
  ]
}
findings 最多 5 条。没有把握就不要写进 findings。`;

const FIELD_CLIP = 500;
const FOCUS_CLIP = 1600;
const MAX_TRANSCRIPT = 48000;

function clip(text: string | null | undefined, limit: number): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}…`;
}

function isFailed(status: string | null | undefined): boolean {
  return status === "failed" || status === "error";
}

interface ReviewSpan {
  id: string;
  kind: string;
  name: string;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  content: string | null;
  details: string | null;
  roundIndex: number;
}

function stepText(span: ReviewSpan, limit: number, focus: boolean): string {
  const lines = [
    `${focus ? "【当前关注】" : "步骤"} id=${span.id} kind=${span.kind} name=${span.name || "—"} status=${span.status} round=${span.roundIndex}`,
  ];
  const input = clip(span.input, limit);
  const output = clip(span.output || span.content, limit);
  const error = clip(span.error, limit);
  const details = clip(span.details, Math.min(limit, 300));
  if (input) lines.push(`入参: ${input}`);
  if (output) lines.push(`输出: ${output}`);
  if (error) lines.push(`错误: ${error}`);
  if (details && details !== output) lines.push(`附加: ${details}`);
  return lines.join("\n");
}

function buildTranscript(session: {
  title: string;
  outcome: string;
  status: string;
  totalRounds: number;
  errorCount: number;
  totalTokens: number;
}, spans: ReviewSpan[], focusId: string | null, ruleLine: string): string {
  const header = [
    "# 会话",
    `标题: ${clip(session.title, 300) || "（无标题）"}`,
    `状态: ${session.status || "未知"} 终态: ${session.outcome || "未知"} 轮次: ${session.totalRounds} 错误数: ${session.errorCount} tokens: ${session.totalTokens}`,
    `规则诊断（只是线索，不要照抄）: ${ruleLine}`,
    "",
    "# 轨迹",
    "每一步都有 id。回答里的 spanId 只能从这些 id 里选。",
    "",
  ].join("\n");

  const focusIndex = focusId ? spans.findIndex((span) => span.id === focusId) : -1;
  const keepBody = (index: number, span: ReviewSpan) => {
    if (isFailed(span.status)) return true;
    if (focusIndex >= 0 && Math.abs(index - focusIndex) <= 2) return true;
    if (index < 6 || index >= spans.length - 8) return true;
    return false;
  };

  const render = (withBody: (index: number, span: ReviewSpan) => boolean) => {
    const steps = spans.map((span, index) => {
      const focus = span.id === focusId;
      if (!withBody(index, span)) {
        return `步骤 id=${span.id} kind=${span.kind} name=${span.name || "—"} status=${span.status} round=${span.roundIndex}（正文已省略）`;
      }
      const limit = focus || (focusIndex >= 0 && Math.abs(index - focusIndex) <= 1) ? FOCUS_CLIP : FIELD_CLIP;
      return stepText(span, limit, focus);
    });
    return `${header}${steps.join("\n\n")}`;
  };

  const full = render(() => true);
  if (full.length <= MAX_TRANSCRIPT) return full;
  const trimmed = render(keepBody);
  if (trimmed.length <= MAX_TRANSCRIPT) return trimmed;
  return `${trimmed.slice(0, MAX_TRANSCRIPT)}\n…（轨迹后部已截断）`;
}

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const tryParse = (value: string): unknown | null => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct && typeof direct === "object") return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(cleaned.slice(start, end + 1));
    if (sliced && typeof sliced === "object") return sliced;
  }
  return null;
}

/** 评审单独发请求：不强制 response_format，并读 reasoning_content。思考模型常把正文留空。 */
async function callReviewModel(config: LlmConfig, messages: LlmMessage[]): Promise<unknown> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0,
        max_tokens: 4096,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SessionReviewError(`模型调用失败：${message}`, 502);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new SessionReviewError(`模型调用失败（${response.status}）：${raw.slice(0, 400)}`, 502);
  }

  let data: {
    choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string } }>;
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new SessionReviewError(`模型服务返回了无法解析的内容：${raw.slice(0, 200)}`, 502);
  }
  if (data.error?.message) {
    throw new SessionReviewError(`模型调用失败：${data.error.message}`, 502);
  }

  const choice = data.choices?.[0];
  const message = choice?.message;
  const content = (message?.content || "").trim();
  const reasoning = (message?.reasoning_content || "").trim();
  const text = content || reasoning;
  if (!text) {
    const reason = choice?.finish_reason || "empty";
    throw new SessionReviewError(
      `模型没有返回正文（finish_reason=${reason}）。可以在设置里换一个模型后再问。`,
      502,
    );
  }
  return extractJson(content) ?? extractJson(reasoning) ?? {
    summary: text.slice(0, 4000),
    findings: [],
  };
}

function questionFor(preset: ReviewPresetId, custom: string | undefined): string {
  if (preset === "custom") {
    const question = custom?.trim() ?? "";
    if (!question) throw new SessionReviewError("请写下要问的问题");
    if (question.length > 2000) throw new SessionReviewError("问题请控制在 2000 字以内");
    return question;
  }
  return PRESET_QUESTIONS[preset];
}

function asCategory(value: unknown): ReviewFinding["category"] | null {
  if (value === "reasoning" || value === "control" || value === "action") return value;
  return null;
}

function asSeverity(value: unknown): ReviewFinding["severity"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function parseFindings(raw: unknown, knownIds: Set<string>): { summary: string; findings: ReviewFinding[] } {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const list = Array.isArray(record.findings) ? record.findings : [];
  const findings: ReviewFinding[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const category = asCategory(row.category);
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const detail = typeof row.detail === "string" ? row.detail.trim() : "";
    if (!category || !title || !detail) continue;
    const spanId = typeof row.spanId === "string" && knownIds.has(row.spanId) ? row.spanId : "";
    findings.push({
      category,
      severity: asSeverity(row.severity),
      title: title.slice(0, 80),
      detail,
      spanId,
    });
    if (findings.length >= 5) break;
  }
  return { summary, findings };
}

export async function reviewSession(
  sessionId: string,
  preset: ReviewPresetId,
  options: { spanId?: string; question?: string },
): Promise<SessionReviewResult> {
  if (!sessionId) throw new SessionReviewError("缺少 sessionId");
  if (!(preset in PRESET_QUESTIONS) && preset !== "custom") {
    throw new SessionReviewError("未知的预置问题");
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      outcome: true,
      status: true,
      totalRounds: true,
      errorCount: true,
      totalTokens: true,
    },
  });
  if (!session) throw new SessionReviewError("Session 不存在", 404);

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      status: true,
      input: true,
      output: true,
      error: true,
      content: true,
      details: true,
      roundIndex: true,
      turnId: true,
      parentId: true,
      branchId: true,
    },
  });
  if (spans.length === 0) throw new SessionReviewError("这个 Session 还没有可评审的步骤");

  const focusId = options.spanId?.trim() || "";
  if (preset === "explain" && !spans.some((span) => span.id === focusId)) {
    throw new SessionReviewError("请先在轨迹里选中要解释的一步");
  }

  let config;
  try {
    config = await getActiveLlmConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SessionReviewError(`读取模型配置失败：${message}`, 500);
  }
  if (!config) {
    throw new SessionReviewError("设置里还没有可用的模型。请到设置页选择一个已填写 API Key 的配置。", 400);
  }

  const factSpans: FactSpan[] = spans.map((span) => ({
    id: span.id,
    kind: span.kind,
    name: span.name,
    status: span.status,
    input: span.input,
    output: span.output,
    error: span.error,
    details: span.details,
    content: span.content,
    roundIndex: span.roundIndex,
    turnId: span.turnId,
    parentId: span.parentId,
    branchId: span.branchId,
  }));
  const diagnosis = diagnoseSession(analyzeSessionFacts(factSpans), factSpans);
  const question = questionFor(preset, options.question);
  const transcript = buildTranscript(session, spans, focusId || null, diagnosis.headline);

  const parsed = await callReviewModel(config, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${question}\n\n${transcript}\n\n只输出一个 JSON 对象，用中文写 summary 和 detail。第一个字符是 {。`,
    },
  ]);

  const knownIds = new Set(spans.map((span) => span.id));
  const { summary, findings } = parseFindings(parsed, knownIds);
  return {
    model: config.model,
    question,
    summary: summary || "模型没有给出总结。",
    findings,
  };
}
