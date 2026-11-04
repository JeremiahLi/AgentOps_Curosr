import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const TYPES = ["error", "agent_error", "token", "activity_drop"] as const;

function ruleData(body: {
  name?: string;
  target?: string;
  minSeverity?: string;
  types?: string[];
  enabled?: boolean;
} | null) {
  const name = (body?.name || "").trim();
  const target = (body?.target || "").trim();
  if (!name) return { error: "规则名称不能为空" as const };
  if (target && !/^https?:\/\//i.test(target)) {
    return { error: "推送地址要以 http:// 或 https:// 开头" as const };
  }
  const types = [...new Set((body?.types ?? []).filter((item) => (TYPES as readonly string[]).includes(item)))];
  return {
    data: {
      name,
      target,
      minSeverity: body?.minSeverity === "critical" ? "critical" : "warning",
      typesJson: JSON.stringify(types),
      enabled: body?.enabled !== false,
    },
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Parameters<typeof ruleData>[0];
  const parsed = ruleData(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const created = await prisma.alertRule.create({ data: parsed.data });
  return NextResponse.json({ id: created.id });
}
