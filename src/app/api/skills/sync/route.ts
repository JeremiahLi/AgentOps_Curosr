import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFileSync } from "fs";
import { createHash } from "crypto";


export async function POST() {
  // 1. 获取所有 skill span 中提取的名称
  const spans = await prisma.span.findMany({
    where: { name: "skill", kind: "tool_call" },
    select: { input: true },
    distinct: ["input"],
  });

  const skillNamesFromSpans = new Set<string>();
  const pathMap = new Map<string, string>();

  for (const span of spans) {
    try {
      const input = JSON.parse(span.input || "{}");
      const path: string = input.path || "";
      const match = path.match(/skills[\\/]([^\\/]+)[\\/]SKILL\.md/i);
      if (match) {
        const skillName = match[1];
        skillNamesFromSpans.add(skillName);
        pathMap.set(skillName, path);
      }
    } catch {}
  }

  // 2. 获取已注册的 skill 名称
  const registeredSkills = await prisma.skill.findMany({ select: { name: true } });
  const registeredNames = new Set(registeredSkills.map((s) => s.name));

  // 3. 找出未注册的
  const unregistered = [...skillNamesFromSpans].filter((n) => !registeredNames.has(n));

  // 4. 逐个注册
  const results = [];
  for (const skillName of unregistered) {
    try {
      const filePath = pathMap.get(skillName);
      let skillMd = "";
      let description = "";
      let version = 1;

      if (filePath) {
        try {
          skillMd = readFileSync(filePath, "utf-8");
          // 解析 frontmatter
          const descMatch = skillMd.match(/^description:\s*["']?(.+?)["']?\s*$/m);
          if (descMatch) description = descMatch[1];
          const verMatch = skillMd.match(/^version:\s*(\d+)/m);
          if (verMatch) version = parseInt(verMatch[1]);
        } catch {
          // 文件读不到就用空值
        }
      }

      const contentHash = createHash("sha256").update(skillMd).digest("hex");

      await prisma.skill.create({
        data: {
          name: skillName,
          description,
          skillMd,
          contentHash,
          version,
          lastSyncedAt: new Date(),
        },
      });

      results.push({ name: skillName, status: "created" });
    } catch (err) {
      results.push({ name: skillName, status: "failed", error: String(err) });
    }
  }

  return NextResponse.json({
    scanned: skillNamesFromSpans.size,
    registered: registeredNames.size,
    newRegistrations: results,
  });
}
