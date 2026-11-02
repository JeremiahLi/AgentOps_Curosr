import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractSessionData } from "@/lib/engine/experiment/session-data";


export async function GET() {
  const experiments = await prisma.experiment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { cases: true } },
    },
  });

  const result = experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
    type: exp.type,
    agentId: exp.agentId,
    evaluatorIds: JSON.parse(exp.evaluatorIdsJson) as string[],
    status: exp.status,
    scope: exp.scope,
    watchMode: exp.watchMode,
    caseCount: exp._count.cases,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  }));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, type, agentId, evaluatorIds, evaluatorConfigJson, cases, caseIds, scope } = body;

  if (!name || !agentId || !evaluatorIds) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 规则评估器参数（实验级）：必须是合法 JSON 对象
  let normalizedConfig = "{}";
  if (evaluatorConfigJson !== undefined && evaluatorConfigJson !== null && evaluatorConfigJson !== "") {
    try {
      const parsed = typeof evaluatorConfigJson === "string" ? JSON.parse(evaluatorConfigJson) : evaluatorConfigJson;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "evaluatorConfigJson 必须是 JSON 对象" }, { status: 400 });
      }
      normalizedConfig = JSON.stringify(parsed);
    } catch {
      return NextResponse.json({ error: "evaluatorConfigJson 必须是合法 JSON" }, { status: 400 });
    }
  }

  const caseItems = cases || (caseIds?.map((id: string) => ({ sessionId: id })) ?? []);

  if (caseItems.length === 0) {
    return NextResponse.json({ error: "At least one case is required" }, { status: 400 });
  }

  const casesWithData = await Promise.all(
    caseItems.map(async (item: { sessionId?: string; referenceOutput?: string | null }) => {
      const { input, actualOutput } = await extractSessionData(item.sessionId || "");
      return {
        sessionId: item.sessionId || null,
        input,
        actualOutput,
        referenceOutput: item.referenceOutput || null,
      };
    })
  );

  const experiment = await prisma.experiment.create({
    data: {
      userId: "default",
      name,
      type: type || "single",
      agentId,
      evaluatorIdsJson: JSON.stringify(evaluatorIds),
      evaluatorConfigJson: normalizedConfig,
      scope: scope || "",
      status: "draft",
      cases: {
        create: casesWithData,
      },
    },
    include: {
      cases: true,
    },
  });

  return NextResponse.json({
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    caseCount: experiment.cases.length,
  });
}
