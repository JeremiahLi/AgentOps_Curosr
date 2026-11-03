import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const settings = await prisma.userSettings.findUnique({ where: { user: "default" } });
  if (!settings) {
    writeFileSync("scripts/_cfgs.json", "none");
    return;
  }
  const parsed = JSON.parse(settings.settingsJson);
  const configs = Array.isArray(parsed.configs) ? parsed.configs : [];
  const brief = configs.map((config: { id?: string; model?: string; baseUrl?: string; apiKey?: string; name?: string }) => ({
    id: config.id,
    name: config.name,
    model: config.model,
    baseUrl: config.baseUrl,
    keyLen: typeof config.apiKey === "string" ? config.apiKey.length : 0,
    active: config.id === parsed.activeConfigId,
  }));
  writeFileSync("scripts/_cfgs.json", JSON.stringify({ activeConfigId: parsed.activeConfigId, brief }, null, 2));
  await prisma.$disconnect();
}

main();
