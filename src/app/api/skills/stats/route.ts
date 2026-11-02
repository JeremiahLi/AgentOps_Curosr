import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "realtime";

  const now = new Date();
  let startDate: Date;
  let prevStartDate: Date;
  let prevEndDate: Date;

  if (range === "weekly") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    prevStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    prevEndDate = startDate;
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    prevStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
    prevEndDate = startDate;
  }

  // 当前周期
  const spans = await prisma.span.findMany({
    where: {
      name: "skill",
      kind: "tool_call",
      createdAt: { gte: startDate },
    },
    select: { input: true },
  });

  const skillCounts = new Map<string, number>();
  let total = 0;

  for (const span of spans) {
    try {
      const input = JSON.parse(span.input || "{}");
      const path: string = input.path || "";
      const match = path.match(/skills[\\/]([^\\/]+)[\\/]SKILL\.md/i);
      if (match) {
        const skillName = match[1];
        skillCounts.set(skillName, (skillCounts.get(skillName) || 0) + 1);
        total++;
      }
    } catch {
      // 解析失败则跳过
    }
  }

  // 上一周期
  const prevSpans = await prisma.span.findMany({
    where: {
      name: "skill",
      kind: "tool_call",
      createdAt: { gte: prevStartDate, lt: prevEndDate },
    },
    select: { input: true },
  });

  let prevTotal = 0;
  for (const span of prevSpans) {
    try {
      const input = JSON.parse(span.input || "{}");
      const path: string = input.path || "";
      const match = path.match(/skills[\\/]([^\\/]+)[\\/]SKILL\.md/i);
      if (match) prevTotal++;
    } catch {}
  }

  const skills = await Promise.all(
    Array.from(skillCounts.entries()).map(async ([name, calls]) => {
      const skill = await prisma.skill.findUnique({
        where: { name },
        select: { id: true, name: true, description: true, version: true },
      });
      return {
        id: skill?.id || name,
        name,
        calls,
        description: skill?.description || "",
        version: skill?.version || 1,
      };
    }),
  );

  skills.sort((a, b) => b.calls - a.calls);

  return NextResponse.json({ total, prevTotal, skills });
}
