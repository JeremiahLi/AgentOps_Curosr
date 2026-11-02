export interface EvalResultRow {
  caseId: string;
  evaluatorId: string;
  status: string;
  score: number | null;
  humanScore: number | null;
}

export interface EvaluatorScore {
  evaluatorId: string;
  averageScore: number | null;
  scoredCount: number;
}

export interface ScoreAggregation {
  overallAverage: number | null;
  evaluatorScores: EvaluatorScore[];
  totalCases: number;
  scoredCases: number;
}

function effectiveScore(row: EvalResultRow): number | null {
  if (row.status !== "done") return null;
  return row.humanScore ?? row.score ?? null;
}

export function aggregateScores(
  results: EvalResultRow[],
  evaluatorIds: string[]
): ScoreAggregation {
  const scoredRows = results.filter((r) => effectiveScore(r) !== null);
  const overallAverage =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, r) => sum + effectiveScore(r)!, 0) / scoredRows.length
      : null;

  const evaluatorScores: EvaluatorScore[] = evaluatorIds.map((evaluatorId) => {
    const rows = results.filter(
      (r) => r.evaluatorId === evaluatorId && effectiveScore(r) !== null
    );
    const avg =
      rows.length > 0
        ? rows.reduce((sum, r) => sum + effectiveScore(r)!, 0) / rows.length
        : null;
    return { evaluatorId, averageScore: avg, scoredCount: rows.length };
  });

  // 按 caseId 统计（此前误把 evaluatorId 当作 case 去重）
  const totalCases = new Set(results.map((r) => r.caseId)).size;
  const scoredCases = new Set(scoredRows.map((r) => r.caseId)).size;

  return {
    overallAverage,
    evaluatorScores,
    totalCases,
    scoredCases,
  };
}
