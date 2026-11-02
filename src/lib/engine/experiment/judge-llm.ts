import { prisma } from "@/lib/prisma";


export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const SYSTEM_PROMPT =
  'You are a strict JSON formatter. Output ONLY valid JSON. No markdown, no code fences, no explanations. Start with { and end with }. Ensure all strings are properly escaped.';

export async function getActiveLlmConfig(): Promise<LlmConfig | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { user: "default" },
  });

  if (!settings) return null;

  const parsed = JSON.parse(settings.settingsJson);
  const { activeConfigId, configs } = parsed;

  if (!activeConfigId || !configs) return null;

  const activeConfig = configs.find((c: any) => c.id === activeConfigId);
  if (!activeConfig || !activeConfig.apiKey) return null;

  return {
    apiKey: activeConfig.apiKey,
    baseUrl: activeConfig.baseUrl,
    model: activeConfig.model,
  };
}

export async function callLlm(
  messages: LlmMessage[],
  config: LlmConfig,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LlmResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  return {
    content,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

export async function callLlmAsJson<T>(
  messages: LlmMessage[],
  config: LlmConfig,
  options?: { temperature?: number; maxTokens?: number }
): Promise<T> {
  const systemFormattedMessages: LlmMessage[] = messages.map((m) =>
    m.role === "system" ? { ...m, content: SYSTEM_PROMPT + '\n\n' + m.content } : m
  );
  const response = await callLlm(systemFormattedMessages, config, options);
  try {
    return JSON.parse(response.content) as T;
  } catch {
    const cleaned = response.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  }
}
