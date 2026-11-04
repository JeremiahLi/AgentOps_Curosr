import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAlertTypes } from "@/lib/engine/stats/alert-rules";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status")?.trim() || "all";
  const where = status === "open" || status === "resolved" ? { status } : {};
  const [events, rules] = await Promise.all([
    prisma.alertEvent.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: 100 }),
    prisma.alertRule.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      severity: event.severity,
      signature: event.signature,
      message: event.message,
      status: event.status,
      hitCount: event.hitCount,
      firstSeenAt: event.firstSeenAt.toISOString(),
      lastSeenAt: event.lastSeenAt.toISOString(),
      resolvedAt: event.resolvedAt?.toISOString() ?? null,
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      minSeverity: rule.minSeverity,
      types: parseAlertTypes(rule.typesJson),
      target: rule.target,
      lastSentAt: rule.lastSentAt?.toISOString() ?? null,
      lastError: rule.lastError,
    })),
  });
}
