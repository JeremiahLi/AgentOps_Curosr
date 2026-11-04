import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { summarizeFeedback } from "@/lib/engine/stats/feedback";

const KINDS = ["up", "down", "report"] as const;

async function resolveUser(user: string) {
  const key = user.trim();
  if (!key) return null;
  const found = await prisma.user.findFirst({ where: { OR: [{ id: key }, { name: key }] } });
  if (found) return found;
  return prisma.user.upsert({
    where: { id: key },
    update: {},
    create: { id: key, name: key, org: "" },
  });
}

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range") || "weekly";
  const { startMs } = resolveRange(range);
  const since = startMs > 0 ? new Date(startMs) : undefined;
  const [rows, sessionCount] = await Promise.all([
    prisma.feedback.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    }),
    prisma.session.count({ where: since ? { startTime: { gte: since } } : {} }),
  ]);
  const summary = summarizeFeedback(
    rows.map((row) => ({ userName: row.user.name, kind: row.kind, sessionId: row.sessionId })),
    sessionCount,
  );
  return NextResponse.json({
    ...summary,
    recent: rows.slice(0, 20).map((row) => ({
      id: row.id,
      userName: row.user.name,
      sessionId: row.sessionId,
      kind: row.kind,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    user?: string;
    sessionId?: string;
    agentId?: string;
    kind?: string;
    body?: string;
  } | null;
  const kind = body?.kind || "";
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "kind 只能是 up、down 或 report" }, { status: 400 });
  }
  const user = await resolveUser(body?.userId || body?.user || "");
  if (!user) return NextResponse.json({ error: "要指定用户" }, { status: 400 });
  const created = await prisma.feedback.create({
    data: {
      userId: user.id,
      sessionId: (body?.sessionId || "").trim(),
      agentId: (body?.agentId || "").trim(),
      kind,
      body: (body?.body || "").trim().slice(0, 500),
    },
  });
  return NextResponse.json({ id: created.id });
}
