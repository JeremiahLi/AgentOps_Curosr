import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


function maskApiKey(key: string | undefined | null): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

function isMaskedApiKey(key: string): boolean {
  return key.includes("••••••••");
}

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface UserSettings {
  activeConfigId: string | null;
  configs: ModelConfig[];
}

export async function GET() {
  const settings = await prisma.userSettings.findUnique({
    where: { user: "default" },
  });

  if (!settings) {
    return NextResponse.json({ activeConfigId: null, configs: [] });
  }

  const parsed: UserSettings = JSON.parse(settings.settingsJson);

  const masked = {
    ...parsed,
    configs: parsed.configs.map((c) => ({
      ...c,
      apiKey: maskApiKey(c.apiKey),
    })),
  };

  return NextResponse.json(masked);
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { activeConfigId, configs } = body as UserSettings;

  const existing = await prisma.userSettings.findUnique({
    where: { user: "default" },
  });

  let finalConfigs = configs;

  if (existing) {
    const existingParsed: UserSettings = JSON.parse(existing.settingsJson);
    const existingMap = new Map(existingParsed.configs.map((c) => [c.id, c]));

    finalConfigs = configs.map((c) => {
      if (isMaskedApiKey(c.apiKey)) {
        const original = existingMap.get(c.id);
        if (original) {
          return { ...c, apiKey: original.apiKey };
        }
      }
      return c;
    });
  }

  const settingsJson = JSON.stringify({ activeConfigId, configs: finalConfigs });

  await prisma.userSettings.upsert({
    where: { user: "default" },
    update: { settingsJson },
    create: { user: "default", settingsJson },
  });

  return NextResponse.json({ ok: true });
}
