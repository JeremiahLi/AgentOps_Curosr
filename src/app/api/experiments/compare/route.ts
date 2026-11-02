import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


/**
 * 跨实验对比：按 sessionId 对齐两个实验的用例，
 * 输出 per-case per-evaluator 分数与结论，以及实验级汇总（均值 delta / 提升 / 回归数）。
 * 分数取 humanScore ?? score（与实验详情聚合口径一致）。
 */

function effectiveScore(r: { status: string; score: number | null; humanScore: number | null }): number | null {
  if (r.status !== "done") return null;
  return r.humanScore ?? r.score ?? null;
}

type SideMap = Map<string, Map<string, { score: number | null; verdict: string | null; caseId: string | null }>>;

function buildSideMap(exp: {
  cases: { sessionId: string | null; results: { evaluatorId: string; status: string; score: number | null; humanScore: number | null; verdict: string | null }[] }[];
}): SideMap {
  const map: SideMap = new Map();
  for (const expCase of exp.cases) {
    if (!expCase.sessionId) continue;
    let perEvaluator = map.get(expCase.sessionId);
    if (!perEvaluator) {
      perEvaluator = new Map();
      map.set(expCase.sessionId, perEvaluator);
    }
    for (const r of expCase.results) {
      const score = effectiveScore(r);
      // 已有 done 结果则不覆盖（重复追加场景取首次）
      if (perEvaluator.has(r.evaluatorId) && perEvaluator.get(r.evaluatorId)!.score !== null) continue;
      perEvaluator.set(r.evaluatorId, { score, verdict: r.verdict, caseId: null });
    }
  }
  return map;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const aId = searchParams.get("a");
  const bId = searchParams.get("b");

  if (!aId || !bId) {
    return NextResponse.json({ error: "需要 a、b 两个实验 id" }, { status: 400 });
  }
  if (aId === bId) {
    return NextResponse.json({ error: "不能与自己对比" }, { status: 400 });
  }

  const [expA, expB] = await Promise.all([
    prisma.experiment.findUnique({
      where: { id: aId },
      include: { cases: { include: { results: true } } },
    }),
    prisma.experiment.findUnique({
      where: { id: bId },
      include: { cases: { include: { results: true } } },
    }),
  ]);

  if (!expA || !expB) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const idsA = JSON.parse(expA.evaluatorIdsJson) as string[];
  const idsB = JSON.parse(expB.evaluatorIdsJson) as string[];
  const evaluatorIds = [...idsA, ...idsB.filter((id) => !idsA.includes(id))];

  const mapA = buildSideMap(expA);
  const mapB = buildSideMap(expB);

  // 两个实验 case id 映射（用于跳转）
  const caseIdA = new Map(expA.cases.filter((c) => c.sessionId).map((c) => [c.sessionId!, c.id]));
  const caseIdB = new Map(expB.cases.filter((c) => c.sessionId).map((c) => [c.sessionId!, c.id]));

  const sessionIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();

  const rows = sessionIds.map((sessionId) => {
    const perA = mapA.get(sessionId);
    const perB = mapB.get(sessionId);
    const cells: Record<
      string,
      { a: number | null; b: number | null; verdictA: string | null; verdictB: string | null }
    > = {};
    for (const evaluatorId of evaluatorIds) {
      cells[evaluatorId] = {
        a: perA?.get(evaluatorId)?.score ?? null,
        b: perB?.get(evaluatorId)?.score ?? null,
        verdictA: perA?.get(evaluatorId)?.verdict ?? null,
        verdictB: perB?.get(evaluatorId)?.verdict ?? null,
      };
    }
    return { sessionId, caseIdA: caseIdA.get(sessionId) ?? null, caseIdB: caseIdB.get(sessionId) ?? null, cells };
  });

  const summary = evaluatorIds.map((evaluatorId) => {
    let sumA = 0;
    let sumB = 0;
    let compared = 0;
    let improved = 0;
    let regressed = 0;
    let unchanged = 0;
    let aOnly = 0;
    let bOnly = 0;
    for (const row of rows) {
      const cell = row.cells[evaluatorId];
      if (cell.a !== null && cell.b !== null) {
        compared += 1;
        sumA += cell.a;
        sumB += cell.b;
        if (cell.b > cell.a) improved += 1;
        else if (cell.b < cell.a) regressed += 1;
        else unchanged += 1;
      } else if (cell.a !== null) {
        aOnly += 1;
      } else if (cell.b !== null) {
        bOnly += 1;
      }
    }
    const avgA = compared > 0 ? sumA / compared : null;
    const avgB = compared > 0 ? sumB / compared : null;
    return {
      evaluatorId,
      compared,
      improved,
      regressed,
      unchanged,
      aOnly,
      bOnly,
      avgA,
      avgB,
      delta: compared > 0 ? avgB! - avgA! : null,
    };
  });

  return NextResponse.json({
    a: { id: expA.id, name: expA.name, status: expA.status },
    b: { id: expB.id, name: expB.name, status: expB.status },
    evaluatorIds,
    rows,
    summary,
  });
}
