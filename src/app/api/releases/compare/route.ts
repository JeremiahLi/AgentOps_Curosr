import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { averageOf, compareReleases, TASK_SAMPLE_MIN } from "@/lib/engine/stats/release-compare";

function labelOf(label: string, fingerprint: string): string {
  return label || fingerprint.slice(0, 8);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim() || "";
  const baseId = url.searchParams.get("base")?.trim() || "";
  const nextId = url.searchParams.get("next")?.trim() || "";

  const agents = await prisma.agent.findMany({
    where: { releases: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!agentId) {
    return NextResponse.json({ agents, taskSampleMin: TASK_SAMPLE_MIN });
  }

  const releases = await prisma.release.findMany({
    where: { agentId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      label: true,
      fingerprint: true,
      quality: true,
      model: true,
      lastSeenAt: true,
    },
  });
  const chosenNext = releases.find((item) => item.id === nextId) ?? releases[0];
  const chosenBase =
    releases.find((item) => item.id === baseId && item.id !== chosenNext?.id) ??
    releases.find((item) => item.id !== chosenNext?.id);

  if (!chosenBase || !chosenNext) {
    return NextResponse.json({
      agents,
      releases: releases.map((item) => ({
        ...item,
        label: labelOf(item.label, item.fingerprint),
        lastSeenAt: item.lastSeenAt.toISOString(),
      })),
      taskSampleMin: TASK_SAMPLE_MIN,
      compare: null,
    });
  }

  const sessions = await prisma.session.findMany({
    where: { agentId, releaseId: { in: [chosenBase.id, chosenNext.id] }, totalSpans: { gt: 0 } },
    select: { id: true, releaseId: true, taskKey: true, totalDuration: true, totalTokens: true },
  });
  const hits = await prisma.issueEvidence.findMany({
    where: {
      sessionId: { in: sessions.map((session) => session.id) },
      issue: { agentId, status: { notIn: ["dismissed"] } },
    },
    select: {
      sessionId: true,
      issue: { select: { id: true, title: true, signature: true } },
    },
  });

  const comparable = sessions.flatMap((session) =>
    session.releaseId
      ? [{ ...session, releaseId: session.releaseId }]
      : [],
  );
  const compared = compareReleases({
    baseId: chosenBase.id,
    nextId: chosenNext.id,
    sessions: comparable,
    hits: hits.map((hit) => ({
      issueId: hit.issue.id,
      title: hit.issue.title,
      signature: hit.issue.signature,
      sessionId: hit.sessionId,
    })),
  });

  const pack = (release: typeof chosenBase) => ({
    id: release.id,
    label: labelOf(release.label, release.fingerprint),
    fingerprint: release.fingerprint,
    quality: release.quality,
    model: release.model,
    ...averageOf(comparable, release.id),
  });

  return NextResponse.json({
    agents,
    releases: releases.map((item) => ({
      id: item.id,
      label: labelOf(item.label, item.fingerprint),
      fingerprint: item.fingerprint,
      quality: item.quality,
      model: item.model,
      lastSeenAt: item.lastSeenAt.toISOString(),
    })),
    taskSampleMin: TASK_SAMPLE_MIN,
    compare: {
      base: pack(chosenBase),
      next: pack(chosenNext),
      ...compared,
    },
  });
}
