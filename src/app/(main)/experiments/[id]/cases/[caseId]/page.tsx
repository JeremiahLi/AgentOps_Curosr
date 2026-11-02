"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shell/page-header";
import { useEvaluators } from "@/hooks/use-evaluators";
import { VerdictBadge } from "@/components/experiments/verdict-badge";
import { EvalResultDetail } from "@/components/experiments/eval-result-detail";


interface CaseDetail {
  id: string;
  sessionId: string | null;
  input: string;
  actualOutput: string;
  hasRealOutput: boolean;
  referenceOutput: string | null;
  results: {
    id: string;
    evaluatorId: string;
    status: string;
    verdict: string | null;
    summary: string | null;
    score: number | null;
    pointsJson: string | null;
    evidenceJson: string | null;
    humanScore: number | null;
    humanReason: string | null;
    errorMessage: string | null;
  }[];
}

const statusConfig: Record<string, { icon: React.ReactNode; label: string }> = {
  pending: { icon: <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />, label: "待评测" },
  running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />, label: "评测中" },
  done: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />, label: "已完成" },
  failed: { icon: <XCircle className="h-3.5 w-3.5 text-destructive" />, label: "失败" },
};

export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { nameOf } = useEvaluators();
  const experimentId = params.id as string;
  const caseId = params.caseId as string;
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [editScoreValue, setEditScoreValue] = useState("");
  const [editReasonValue, setEditReasonValue] = useState("");

  const applyCase = (found: any) => {
    setCaseData({
      ...found,
      input: found.input || "",
      actualOutput: found.actualOutput || "",
      hasRealOutput: found.hasRealOutput ?? false,
      referenceOutput: found.referenceOutput || null,
    });
  };

  const fetchDetail = () => {
    fetch(`/api/experiments/${experimentId}`)
      .then((r) => r.json())
      .then((data) => {
        const found = data.cases?.find((c: any) => c.id === caseId);
        if (found) applyCase(found);
      })
      .catch(() => setCaseData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDetail();
  }, [experimentId, caseId]);

  const handleRetry = async (resultId: string) => {
    await fetch(`/api/experiments/${experimentId}/results/${resultId}/retry`, {
      method: "POST",
    });
    fetchDetail();
    // 轮询直到该结果离开 pending/running（上限 60s），让用户看到完整流转
    const startedAt = Date.now();
    const poll = () => {
      if (Date.now() - startedAt > 60000) return;
      fetch(`/api/experiments/${experimentId}`)
        .then((r) => r.json())
        .then((data) => {
          const found = data.cases?.find((c: any) => c.id === caseId);
          if (!found) return;
          applyCase(found);
          const target = (found.results as any[] | undefined)?.find(
            (r) => r.id === resultId
          );
          if (target && (target.status === "pending" || target.status === "running")) {
            setTimeout(poll, 2000);
          }
        })
        .catch(() => {});
    };
    setTimeout(poll, 2000);
  };

  const handleSaveScore = async (resultId: string) => {
    const score = parseFloat(editScoreValue);
    if (isNaN(score) || score < 0 || score > 100) return;

    await fetch(`/api/experiments/${experimentId}/results/${resultId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        humanScore: score,
        humanReason: editReasonValue || null,
        humanBy: "admin",
      }),
    });
    setEditingScore(null);
    fetchDetail();
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Case 不存在</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <PageHeader
        title="Case 详情"
        description={caseData.sessionId ? `Session: ${caseData.sessionId.slice(-8)}` : "手动创建"}
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.push(`/experiments/${experimentId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回实验
          </Button>
        }
      />

      {/* Case 内容 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>输入</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground scrollbar-thin">
              {caseData.input || "（暂无输入）"}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <div className="flex items-center justify-between">
              <CardTitle>实际输出</CardTitle>
              {!caseData.hasRealOutput && (
                <Badge variant="outline" className="text-warning border-warning/40 shrink-0">
                  样例 · 无真实运行输出
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {!caseData.hasRealOutput && (
              <p className="mb-2 text-xs text-warning">
                该 Case 没有来自 Session 录制的真实回答（LLM 调用失败或无输出记录），以下内容仅供参考。
              </p>
            )}
            <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground scrollbar-thin">
              {caseData.actualOutput || "（暂无输出）"}
            </pre>
          </CardContent>
        </Card>
      </div>

      {caseData.referenceOutput && (
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>参考答案</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <pre className="max-h-[150px] overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground scrollbar-thin">
              {caseData.referenceOutput}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* 评估结论总表 */}
      <Card>
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>评估结论总表</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 text-left text-[11px] font-medium">评估维度</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium">期望输出</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium">实际输出</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium">评估结论</th>
                <th className="px-3 py-2 text-center text-[11px] font-medium">打分</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {caseData.results.map((result) => {
                const status = statusConfig[result.status] || statusConfig.pending;
                const finalScore = result.humanScore ?? result.score;
                return (
                  <tr key={result.id} className="align-top transition-colors hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {status.icon}
                        <span className="font-medium">{nameOf(result.evaluatorId)}</span>
                      </div>
                    </td>
                    <td className="max-w-[200px] px-3 py-2">
                      {caseData.referenceOutput ? (
                        <span className="line-clamp-2 break-all text-muted-foreground" title={caseData.referenceOutput}>
                          {caseData.referenceOutput}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="max-w-[200px] px-3 py-2">
                      <span className="line-clamp-2 break-all text-muted-foreground" title={caseData.actualOutput}>
                        {caseData.actualOutput || "—"}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {result.status === "done" ? (
                          <VerdictBadge verdict={result.verdict} />
                        ) : (
                          <Badge variant="secondary">{status.label}</Badge>
                        )}
                      </div>
                      {result.summary && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={result.summary}>
                          {result.summary}
                        </p>
                      )}
                      {result.errorMessage && (
                        <p className="mt-1 line-clamp-2 text-xs text-destructive" title={result.errorMessage}>
                          {result.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {result.status === "done" && finalScore !== null ? (
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            finalScore >= 80 ? "text-success" : finalScore >= 60 ? "text-warning" : "text-destructive"
                          }`}
                        >
                          {finalScore.toFixed(0)}
                          {result.humanScore !== null && (
                            <span className="ml-1 text-[11px] font-normal text-muted-foreground">(人工)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {caseData.results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    暂无评估结果，请先在实验详情页运行实验
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 评估结果 */}
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>评估结果</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-auto scrollbar-thin">
          {caseData.results.map((result) => {
            const status = statusConfig[result.status] || statusConfig.pending;
            return (
              <div key={result.id} className="rounded-md p-4 ring-1 ring-foreground/10">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {status.icon}
                    <span className="text-[13px] font-medium">
                      {nameOf(result.evaluatorId)}
                    </span>
                    <Badge variant="secondary">
                      {status.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.status === "done" && (
                      <span
                        className={`text-lg font-semibold tabular-nums ${
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
                    {result.status === "failed" && (
                      <Button variant="ghost" size="sm" onClick={() => handleRetry(result.id)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        重试
                      </Button>
                    )}
                  </div>
                </div>

                {result.errorMessage && (
                  <p className="mb-2 text-[13px] text-destructive">{result.errorMessage}</p>
                )}

                {result.status === "done" && (
                  <EvalResultDetail
                    evaluatorId={result.evaluatorId}
                    summary={result.summary}
                    evidenceJson={result.evidenceJson}
                    actualOutput={caseData.actualOutput}
                    sessionId={caseData.sessionId}
                  />
                )}

                {result.status === "done" && (
                  <div className="mt-2 flex items-center gap-2">
                    {editingScore === result.id ? (
                      <div className="flex w-full items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="分数 (0-100)"
                          value={editScoreValue}
                          onChange={(e) => setEditScoreValue(e.target.value)}
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 font-mono text-[13px] tabular-nums"
                        />
                        <input
                          type="text"
                          placeholder="修改原因（可选）"
                          value={editReasonValue}
                          onChange={(e) => setEditReasonValue(e.target.value)}
                          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-[13px]"
                        />
                        <Button size="sm" onClick={() => handleSaveScore(result.id)}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingScore(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingScore(result.id);
                          setEditScoreValue(result.humanScore?.toString() || result.score?.toString() || "");
                          setEditReasonValue(result.humanReason || "");
                        }}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {result.humanScore !== null ? "修改人工分" : "人工修正"}
                      </Button>
                    )}
                    {result.humanScore !== null && editingScore !== result.id && (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        原始分: {result.score?.toFixed(0) || "—"} → 人工分: {result.humanScore.toFixed(0)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
