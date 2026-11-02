import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STATUSES = ["candidate", "open", "confirmed", "dismissed", "fixed"] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim() || "";
  const q = url.searchParams.get("q")?.trim() || "";
  const statusParam = url.searchParams.get("status")?.trim() || "open,confirmed";
  const statuses = statusParam
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(item));

  const issues = await prisma.issue.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      ...(q
        ? {
            OR: [{ signature: { contains: q } }, { title: { contains: q } }],
          }
        : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 200,
    include: {
      agent: { select: { id: true, name: true } },
      evidence: {
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { release: { select: { label: true, quality: true } } },
      },
      regressionCase: { select: { id: true } },
    },
  });

  const releaseRows =
    issues.length === 0
      ? []
      : await prisma.issueEvidence.findMany({
          where: { issueId: { in: issues.map((issue) => issue.id) }, releaseId: { not: null } },
          distinct: ["issueId", "releaseId"],
          select: {
            issueId: true,
            release: { select: { label: true, quality: true } },
          },
        });
  const releasesByIssue = new Map<string, { label: string; quality: string }[]>();
  for (const row of releaseRows) {
    if (!row.release) continue;
    const list = releasesByIssue.get(row.issueId) ?? [];
    list.push(row.release);
    releasesByIssue.set(row.issueId, list);
  }

  const agents = await prisma.agent.findMany({
    where: { issues: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    agents,
    issues: issues.map((issue) => ({
      id: issue.id,
      agentId: issue.agentId,
      agentName: issue.agent.name,
      signature: issue.signature,
      kind: issue.kind,
      title: issue.title,
      status: issue.status,
      severity: issue.severity,
      hitCount: issue.hitCount,
      sampleError: issue.sampleError,
      regressionCaseId: issue.regressionCase?.id ?? null,
      firstSeenAt: issue.firstSeenAt.toISOString(),
      lastSeenAt: issue.lastSeenAt.toISOString(),
      releases: releasesByIssue.get(issue.id) ?? [],
      evidence: issue.evidence.map((item) => ({
        sessionId: item.sessionId,
        spanId: item.spanId,
        source: item.source,
        releaseLabel: item.release?.label || "",
        createdAt: item.createdAt.toISOString(),
      })),
    })),
  });
}
