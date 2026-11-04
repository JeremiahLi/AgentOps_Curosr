"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ReviewRow {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  status: string;
  verdict: string;
  score: number;
  summary: string;
  quote: string;
  issueId: string | null;
  issueTitle: string;
}

export default function AnswerReviewPage() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState("");
  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (nextAgent: string) => {
    const params = new URLSearchParams({ status: "pending" });
    if (nextAgent) params.set("agentId", nextAgent);
    const response = await fetch(`/api/answer-reviews?${params.toString()}`);
    if (!response.ok) throw new Error("load failed");
    return response.json() as Promise<{ agents: { id: string; name: string }[]; reviews: ReviewRow[] }>;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(agentId)
      .then((data) => {
        if (cancelled) return;
        setAgents(data.agents);
        setReviews(data.reviews);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, load]);

  async function sample() {
    if (!agentId) {
      setNotice("先选一个 Agent。");
      return;
    }
    setBusy("sample");
    setNotice("");
    try {
      const response = await fetch("/api/answer-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, limit: 5 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error || "抽样没有跑完");
        return;
      }
      const parts = [`评了 ${body.judged} 条`, `待确认 ${body.pending} 条`, `通过 ${body.passed} 条`];
      if (body.skipped) parts.push(`跳过 ${body.skipped} 条`);
      if (body.errors?.length) parts.push(body.errors[0]);
      setNotice(parts.join("，"));
      const data = await load(agentId);
      setReviews(data.reviews);
    } finally {
      setBusy("");
    }
  }

  async function act(id: string, action: "confirm" | "dismiss") {
    setBusy(id);
    setNotice("");
    try {
      const response = await fetch(`/api/answer-reviews/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error || "没有写上");
        return;
      }
      if (action === "confirm") setNotice("已写入问题库。可以在问题库里钉成回归用例。");
      const data = await load(agentId);
      setReviews(data.reviews);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="结果抽查"
        description="用准确性裁判抽查已经交付的回答。通过的不进问题库。确认之后才写成回答问题，然后可以钉成回归用例。"
        actions={
          <Button size="sm" disabled={busy === "sample" || !agentId} onClick={sample}>
            {busy === "sample" ? "抽样中…" : "抽 5 条"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">选择 Agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {notice ? <p className="text-[12px] text-muted-foreground">{notice}</p> : null}
      </div>

      {reviews === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            没有待确认的回答。选中 Agent 后抽 5 条已交付会话。裁判模型在
            <Link href="/settings" className="mx-1 text-primary underline-offset-2 hover:underline">
              设置
            </Link>
            里配置。
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        {review.agentName} · {review.verdict || "warn"} · {Math.round(review.score)} 分
                      </p>
                      <p className="mt-1 text-[13px]">{review.summary}</p>
                      {review.quote ? (
                        <p className="mt-1 line-clamp-3 font-mono text-[11px] text-muted-foreground">{review.quote}</p>
                      ) : null}
                      <Link
                        href={`/trace/${review.sessionId}`}
                        className="mt-1 inline-block text-[12px] text-primary underline-offset-2 hover:underline"
                      >
                        打开这次会话
                      </Link>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" disabled={busy === review.id} onClick={() => act(review.id, "confirm")}>
                        确认并写入问题库
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === review.id}
                        onClick={() => act(review.id, "dismiss")}
                      >
                        忽略
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
