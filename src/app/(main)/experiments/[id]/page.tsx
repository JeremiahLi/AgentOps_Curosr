"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { useEvaluators } from "@/hooks/use-evaluators";
import { VerdictBadge } from "@/components/experiments/verdict-badge";
import { ScoreHistogram } from "@/components/experiments/score-distribution";
import { CommonIssues } from "@/components/experiments/common-issues";

interface EvalResult {
  id: string;
  evaluatorId: string;
  status: string;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  humanScore: number | null;
  evidenceJson: string | null;
}

interface ExperimentCase {
  id: string;
  sessionId: string;
  results: EvalResult[];
}

interface ExperimentDetail {
  id: string;
  name: string;
  status: string;
  overallAverage: number | null;
  evaluatorScores: { evaluatorId: string; averageScore: number | null; scoredCount: number }[];
  cases: ExperimentCase[];
}

const statusIcon = {
  pending: <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
};

export default function ExperimentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { nameOf } = useEvaluators();
  const id = params.id as string;
  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchDetail = () => {
    fetch(`/api/experiments/${id}`)
      .then((r) => r.json())
      .then((data) => setExperiment(data))
      .catch(() => setExperiment(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await fetch(`/api/experiments/${id}/run`, { method: "POST" });
      const pollStatus = () => {
        fetchDetail();
        fetch(`/api/experiments/${id}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.status === "running") {
              setTimeout(pollStatus, 2000);
            }
          })
          .catch(() => {});
      };
      setTimeout(pollStatus, 2000);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">实验不存在</p>
      </div>
    );
  }

  const totalResults = experiment.cases.flatMap((c) => c.results).length;
  const doneResults = experiment.cases.flatMap((c) => c.results).filter((r) => r.status === "done").length;
  const progress = totalResults > 0 ? (doneResults / totalResults) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <PageHeader
        title={experiment.name}
        description={
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="-ml-2 h-6 w-6 text-muted-foreground" onClick={() => router.push("/experiments")}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Badge
              variant={experiment.status === "done" ? "outline" : experiment.status === "running" ? "default" : "secondary"}
            >
              {experiment.status === "draft" && "草稿"}
              {experiment.status === "running" && "运行中"}
              {experiment.status === "done" && "已完成"}
              {experiment.status === "failed" && "失败"}
            </Badge>
            <span className="tabular-nums">
              {experiment.cases.length} 个 Case · {experiment.evaluatorScores.length} 个评估器
            </span>
          </span>
        }
        actions={
          <span className="flex items-center gap-2">
            <Link href={`/experiments/compare?a=${id}`}>
              <Button variant="outline" size="sm">
                <GitCompareArrows className="h-3.5 w-3.5" />
                对比其他实验
              </Button>
            </Link>
            {(experiment.status === "draft" || experiment.status === "running") && (
              <Button size="sm" onClick={handleRun} disabled={running || experiment.status === "running"}>
                {running || experiment.status === "running" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Play />
                )}
                {experiment.status === "running" ? "运行中..." : "运行实验"}
              </Button>
            )}
          </span>
        }
      />

      {/* 总分概览 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="综合均分" value={experiment.overallAverage !== null ? experiment.overallAverage.toFixed(1) : "—"} />
        {experiment.evaluatorScores.map((es) => (
          <KpiCard
            key={es.evaluatorId}
            label={nameOf(es.evaluatorId)}
            value={es.averageScore !== null ? es.averageScore.toFixed(1) : "—"}
            sub={`${es.scoredCount} 个评分`}
          />
        ))}
      </div>

      {/* 进度条 */}
      {experiment.status === "running" && (
        <div>
          <Progress value={progress} className="h-1" />
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            评测进度: {doneResults}/{totalResults}
          </p>
        </div>
      )}

      {/* 分数分布：均值掩盖的失败聚集在这里可见 */}
      <Card>
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>分数分布</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {experiment.evaluatorScores.map((es) => {
              const scores = experiment.cases
                .flatMap((c) =>
                  c.results
                    .filter((r) => r.evaluatorId === es.evaluatorId && r.status === "done")
                    .map((r) => r.humanScore ?? r.score)
                )
                .filter((s): s is number => s !== null);
              return (
                <div key={es.evaluatorId}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[13px] font-medium">{nameOf(es.evaluatorId)}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      均值 {es.averageScore !== null ? es.averageScore.toFixed(1) : "—"} · {scores.length} 份
                    </span>
                  </div>
                  {scores.length > 0 ? (
                    <ScoreHistogram scores={scores} />
                  ) : (
                    <p className="py-6 text-center text-xs text-muted-foreground">暂无评分</p>
                  )}
                </div>
              );
            })}
            {experiment.evaluatorScores.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">暂无评估器</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 共性问题：跨 case 聚合，反复出现的问题才指导改 prompt */}
      <Card>
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>共性问题</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <CommonIssues
            experimentId={id}
            evaluatorIds={experiment.evaluatorScores.map((es) => es.evaluatorId)}
            cases={experiment.cases}
            nameOf={nameOf}
          />
        </CardContent>
      </Card>

      {/* Case 明细表 */}
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>Case 明细</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 text-left text-[11px] font-medium">Case</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium">Session</th>
                {experiment.evaluatorScores.map((es) => (
                  <th key={es.evaluatorId} className="px-3 py-2 text-center text-[11px] font-medium">
                    {nameOf(es.evaluatorId)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-[11px] font-medium">结论</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {experiment.cases.map((expCase, idx) => (
                <tr key={expCase.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium tabular-nums">#{idx + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {expCase.sessionId ? expCase.sessionId.slice(-8) : "—"}
                  </td>
                  {experiment.evaluatorScores.map((es) => {
                    const result = expCase.results.find((r) => r.evaluatorId === es.evaluatorId);
                    return (
                      <td key={es.evaluatorId} className="px-3 py-2 text-center">
                        {result ? (
                          <div className="flex items-center justify-center gap-1.5">
                            {statusIcon[result.status as keyof typeof statusIcon]}
                            {result.status === "done" && (
                              <span
                                className={`font-mono tabular-nums ${
                                  (result.humanScore ?? result.score) !== null
                                    ? (result.humanScore ?? result.score)! >= 80
                                      ? "text-success"
                                      : (result.humanScore ?? result.score)! >= 60
                                      ? "text-warning"
                                      : "text-destructive"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {result.humanScore !== null
                                  ? result.humanScore.toFixed(0)
                                  : result.score !== null
                                  ? result.score.toFixed(0)
                                  : "—"}
                              </span>
                            )}
                            {result.humanScore !== null && (
                              <span className="text-[11px] text-muted-foreground">(人工)</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {experiment.evaluatorScores.map((es) => {
                        const r = expCase.results.find(
                          (x) => x.evaluatorId === es.evaluatorId && x.status === "done"
                        );
                        if (!r) return null;
                        return (
                          <span
                            key={es.evaluatorId}
                            title={`${nameOf(es.evaluatorId)}：${r.summary ?? "—"}`}
                          >
                            <VerdictBadge verdict={r.verdict} />
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Link href={`/experiments/${id}/cases/${expCase.id}`}>
                      <Button variant="ghost" size="xs">
                        详情
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {experiment.cases.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无 Case</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
