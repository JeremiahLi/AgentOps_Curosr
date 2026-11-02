"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight, GitCompareArrows, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shell/page-header";
import { useEvaluators } from "@/hooks/use-evaluators";
import { VerdictBadge } from "@/components/experiments/verdict-badge";

interface ExperimentListItem {
  id: string;
  name: string;
  status: string;
}

interface CompareCell {
  a: number | null;
  b: number | null;
  verdictA: string | null;
  verdictB: string | null;
}

interface CompareRow {
  sessionId: string;
  caseIdA: string | null;
  caseIdB: string | null;
  cells: Record<string, CompareCell>;
}

interface CompareSummary {
  evaluatorId: string;
  compared: number;
  improved: number;
  regressed: number;
  unchanged: number;
  aOnly: number;
  bOnly: number;
  avgA: number | null;
  avgB: number | null;
  delta: number | null;
}

interface CompareData {
  a: { id: string; name: string; status: string };
  b: { id: string; name: string; status: string };
  evaluatorIds: string[];
  rows: CompareRow[];
  summary: CompareSummary[];
}

function fmtScore(n: number | null): string {
  return n !== null ? n.toFixed(0) : "—";
}

function DeltaTag({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  if (Math.abs(delta) < 0.5) {
    return <span className="text-[11px] text-muted-foreground">±0</span>;
  }
  const up = delta > 0;
  return (
    <span className={`text-[11px] font-medium tabular-nums ${up ? "text-success" : "text-destructive"}`}>
      {up ? "+" : ""}
      {delta.toFixed(1)}
    </span>
  );
}

function CompareContent() {
  const searchParams = useSearchParams();
  const { nameOf } = useEvaluators();
  const [experiments, setExperiments] = useState<ExperimentListItem[]>([]);
  const [aId, setAId] = useState(searchParams.get("a") ?? "");
  const [bId, setBId] = useState(searchParams.get("b") ?? "");
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/experiments")
      .then((r) => r.json())
      .then((list) => setExperiments(Array.isArray(list) ? list : []))
      .catch(() => setExperiments([]));
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!aId || !bId || aId === bId) return;
    setLoading(true);
    fetch(`/api/experiments/compare?a=${aId}&b=${bId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "加载失败");
        setData(json);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [aId, bId]);

  const swap = () => {
    setAId(bId);
    setBId(aId);
  };

  const canCompare = aId && bId && aId !== bId;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="实验对比"
        description="选择两个实验，按 Session 对齐用例，查看分数变化与回归情况"
      />

      {/* 实验选择 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">基线实验（A）</label>
            <Select value={aId} onValueChange={(v) => setAId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="选择基线实验" />
              </SelectTrigger>
              <SelectContent>
                {experiments
                  .filter((e) => e.id !== bId)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mt-5"
            onClick={swap}
            disabled={!aId || !bId}
            title="交换 A / B"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">对比实验（B）</label>
            <Select value={bId} onValueChange={(v) => setBId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="选择对比实验" />
              </SelectTrigger>
              <SelectContent>
                {experiments
                  .filter((e) => e.id !== aId)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!canCompare && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {experiments.length < 2 ? "至少需要两个实验才能对比" : "请选择两个不同的实验"}
        </p>
      )}

      {canCompare && loading && (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          对比加载中...
        </p>
      )}

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>
      )}

      {canCompare && data && (
        <>
          {/* 实验级汇总 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.summary.map((s) => {
              const up = s.delta !== null && s.delta > 0.5;
              const down = s.delta !== null && s.delta < -0.5;
              return (
                <Card key={s.evaluatorId}>
                  <CardContent className="pt-4">
                    <p className="text-[13px] font-medium">{nameOf(s.evaluatorId)}</p>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="font-mono text-lg font-semibold tabular-nums">
                        {fmtScore(s.avgA)} → {fmtScore(s.avgB)}
                      </span>
                      <DeltaTag delta={s.delta} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.compared > 0 ? (
                        <>
                          <Badge className="border-transparent bg-success/10 text-success">
                            提升 {s.improved}
                          </Badge>
                          <Badge className="border-transparent bg-destructive/10 text-destructive">
                            回归 {s.regressed}
                          </Badge>
                          {s.unchanged > 0 && (
                            <Badge variant="outline">持平 {s.unchanged}</Badge>
                          )}
                        </>
                      ) : (
                        <Badge variant="outline">无可对齐用例</Badge>
                      )}
                      {s.aOnly > 0 && <Badge variant="outline">仅A {s.aOnly}</Badge>}
                      {s.bOnly > 0 && <Badge variant="outline">仅B {s.bOnly}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* 用例级明细 */}
          <Card className="flex min-h-0 flex-col">
            <CardHeader className="border-b border-border/60 pb-2.5">
              <CardTitle>用例级对比（{data.rows.length} 个 Session）</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto scrollbar-thin">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-left text-[11px] font-medium">Session</th>
                    {data.evaluatorIds.map((eid) => (
                      <th key={eid} className="px-3 py-2 text-center text-[11px] font-medium">
                        {nameOf(eid)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.rows.map((row) => (
                    <tr key={row.sessionId} className="transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        <Link href={`/trace/${row.sessionId}`} className="hover:text-foreground">
                          {row.sessionId.slice(-8)}
                        </Link>
                      </td>
                      {data.evaluatorIds.map((eid) => {
                        const cell = row.cells[eid];
                        const delta =
                          cell.a !== null && cell.b !== null ? cell.b - cell.a : null;
                        return (
                          <td key={eid} className="px-3 py-2 text-center">
                            {cell.a === null && cell.b === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-mono tabular-nums">
                                  {fmtScore(cell.a)}
                                  <span className="mx-1 text-muted-foreground">→</span>
                                  {fmtScore(cell.b)}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <DeltaTag delta={delta} />
                                  {cell.verdictA !== cell.verdictB && (cell.verdictA || cell.verdictB) && (
                                    <span className="flex items-center gap-0.5">
                                      <VerdictBadge verdict={cell.verdictA} />
                                      <span className="text-[10px] text-muted-foreground">→</span>
                                      <VerdictBadge verdict={cell.verdictB} />
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={data.evaluatorIds.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                        两个实验没有可对齐的 Session 用例
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitCompareArrows className="h-3.5 w-3.5" />
            A = {data.a.name}（基线）· B = {data.b.name}（对比）· 分数取人工分（如有）否则模型分
          </p>
        </>
      )}
    </div>
  );
}

export default function ExperimentComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-56px)] items-center justify-center">
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
