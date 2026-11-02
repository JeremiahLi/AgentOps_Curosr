import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRegressionCase, RegressionInputError } from "@/lib/engine/ingest/regression";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    passCriteria?: string;
    referenceOutput?: string;
    hypothesis?: string;
    evaluatorIds?: string[];
    evaluatorConfig?: Record<string, Record<string, unknown>>;
    sourceSessionId?: string;
  } | null;
  try {
    const created = await createRegressionCase(prisma, {
      issueId: id,
      passCriteria: body?.passCriteria,
      referenceOutput: body?.referenceOutput,
      hypothesis: body?.hypothesis,
      evaluatorIds: body?.evaluatorIds,
      evaluatorConfig: body?.evaluatorConfig,
      sourceSessionId: body?.sourceSessionId,
    });
    return NextResponse.json({ id: created.id, issueId: created.issueId });
  } catch (err) {
    if (err instanceof RegressionInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
