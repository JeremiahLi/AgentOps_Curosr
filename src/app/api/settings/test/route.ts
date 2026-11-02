import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


function isMaskedApiKey(key: string): boolean {
  return key.includes("••••••••");
}

interface TestConfig {
  id?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function POST(request: Request) {
  let body: TestConfig;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  let { id, apiKey, baseUrl, model } = body;

  if (!baseUrl || !model) {
    return NextResponse.json({ ok: false, error: "Base URL 和模型不能为空" });
  }

  // 前端拿到的是脱敏 Key，需要从数据库还原真实 Key
  if (isMaskedApiKey(apiKey)) {
    if (!id) {
      return NextResponse.json({ ok: false, error: "API Key 未填写" });
    }
    const settings = await prisma.userSettings.findUnique({
      where: { user: "default" },
    });
    const stored = settings
      ? (JSON.parse(settings.settingsJson).configs as Array<{ id: string; apiKey?: string }>).find(
          (c) => c.id === id
        )
      : undefined;
    if (!stored?.apiKey) {
      return NextResponse.json({ ok: false, error: "未找到已保存的 API Key，请重新填写" });
    }
    apiKey = stored.apiKey;
  }

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "API Key 未填写" });
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 500);
      return NextResponse.json({
        ok: false,
        error: `HTTP ${response.status}: ${errorText}`,
        latencyMs,
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? "";
    const totalTokens = data.usage?.total_tokens;
    return NextResponse.json({
      ok: true,
      latencyMs,
      reply: String(reply).slice(0, 100),
      totalTokens,
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - startedAt;
    const e = err as { name?: string; message?: string };
    const msg =
      e?.name === "AbortError" ? "请求超时（30 秒）" : e?.message || "网络请求失败";
    return NextResponse.json({ ok: false, error: msg, latencyMs });
  }
}
