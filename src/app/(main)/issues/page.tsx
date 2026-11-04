"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface IssueRow {
  id: string;
  agentId: string;
  agentName: string;
  signature: string;
  kind: string;
  title: string;
  status: string;
  severity: string;
  hitCount: number;
  sampleError: string;
  regressionCaseId: string | null;
  lastSeenAt: string;
  releases: { label: string; quality: string }[];
  evidence: { sessionId: string; spanId: string; releaseLabel: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  candidate: "未达阈值",
  open: "待确认",
  confirmed: "已确认",
  dismissed: "已忽略",
  fixed: "已修复",
};

const FILTERS = [
  { value: "open,confirmed", label: "待处理" },
  { value: "candidate", label: "未达阈值" },
  { value: "dismissed", label: "已忽略" },
  { value: "fixed", label: "已修复" },
  { value: "candidate,open,confirmed,dismissed,fixed", label: "全部" },
];

export default function IssuesPage() {
  const [status, setStatus] = useState("open,confirmed");
  const [agentId, setAgentId] = useState("");
  const [q, setQ] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [issues, setIssues] = useState<IssueRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [pinId, setPinId] = useState("");
  const [pinError, setPinError] = useState("");
  const [evaluators, setEvaluators] = useState<{ id: string; name: string; type: string }[]>([]);

  const load = useCallback(async (nextStatus: string, nextAgent: string, nextQ: string) => {
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (nextAgent) params.set("agentId", nextAgent);
    if (nextQ.trim()) params.set("q", nextQ.trim());
    const response = await fetch(`/api/issues?${params.toString()}`);
    if (!response.ok) throw new Error("load failed");
    return response.json() as Promise<{ agents: { id: string; name: string }[]; issues: IssueRow[] }>;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(status, agentId, q)
      .then((data) => {
        if (cancelled) return;
        setAgents(data.agents);
        setIssues(data.issues);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setIssues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status, agentId, load]);

  async function act(id: string, action: "confirm" | "dismiss") {
    setBusyId(id);
    try {
      const response = await fetch(`/api/issues/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) return;
      const data = await load(status, agentId, q);
      setIssues(data.issues);
      setAgents(data.agents);
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    fetch("/api/evaluators")
      .then((response) => (response.ok ? response.json() : { evaluators: [] }))
      .then((data) => setEvaluators(data.evaluators ?? []))
      .catch(() => setEvaluators([]));
  }, []);

  async function pin(issue: IssueRow, form: FormData) {
    const passCriteria = String(form.get("passCriteria") || "");
    const referenceOutput = String(form.get("referenceOutput") || "");
    const hypothesis = String(form.get("hypothesis") || "");
    const sourceSessionId = String(form.get("sourceSessionId") || issue.evidence[0]?.sessionId || "");
    const evaluatorIds = form.getAll("evaluatorId").map(String);
    setBusyId(issue.id);
    try {
      const response = await fetch(`/api/issues/${issue.id}/case`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passCriteria, referenceOutput, hypothesis, sourceSessionId, evaluatorIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPinError(body.error || "没有钉上");
        return;
      }
      setPinError("");
      setPinId("");
      const data = await load(status, agentId, q);
      setIssues(data.issues);
      setAgents(data.agents);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="问题库"
        description="同一错误签名跨会话累计。未达阈值的不在默认列表里。忽略之后，新的命中只追加证据，不会重新打开。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">全部 Agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            load(status, agentId, q)
              .then((data) => {
                setIssues(data.issues);
                setAgents(data.agents);
                setFailed(false);
              })
              .catch(() => setFailed(true));
          }}
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="签名或标题"
            className="h-8 w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          />
          <Button type="submit" variant="outline" size="sm">
            筛选
          </Button>
        </form>
      </div>

      {issues === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      ) : issues.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">这个范围里没有问题。</CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-sm bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                          {STATUS_LABEL[issue.status] ?? issue.status}
                        </span>
                        <span className="rounded-sm bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                          {issue.kind === "tool_failure" ? "工具失败" : issue.kind === "answer_wrong" ? "回答有误" : "过程错误"}
                        </span>
                        <span className="text-[13px] font-medium">{issue.title}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {issue.agentName} · 命中 {issue.hitCount} 次
                        {issue.releases.length > 0
                          ? ` · ${issue.releases.map((item) => (item.label ? `v${item.label}` : "未标版本")).join("、")}`
                          : ""}
                      </p>
                      {issue.sampleError ? (
                        <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">{issue.sampleError}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {issue.status === "open" && (
                        <Button size="sm" disabled={busyId === issue.id} onClick={() => act(issue.id, "confirm")}>
                          确认
                        </Button>
                      )}
                      {(issue.status === "open" || issue.status === "confirmed" || issue.status === "candidate") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === issue.id}
                          onClick={() => act(issue.id, "dismiss")}
                        >
                          忽略
                        </Button>
                      )}
                      {issue.regressionCaseId ? (
                        <Link href="/regression" className="self-center text-[12px] text-primary underline-offset-2 hover:underline">
                          已钉用例
                        </Link>
                      ) : (
                        (issue.status === "open" || issue.status === "confirmed") && (
                          <Button size="sm" variant="outline" onClick={() => setPinId(pinId === issue.id ? "" : issue.id)}>
                            钉成回归用例
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                  {issue.evidence.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-[12px]">
                      {issue.evidence.map((item, index) => (
                        <Link
                          key={`${item.sessionId}-${item.spanId}-${index}`}
                          href={
                            item.spanId
                              ? `/trace/${item.sessionId}?spanId=${encodeURIComponent(item.spanId)}`
                              : `/trace/${item.sessionId}`
                          }
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          证据 {index + 1}
                          {item.releaseLabel ? ` · v${item.releaseLabel}` : ""}
                        </Link>
                      ))}
                    </div>
                  )}
                  {pinId === issue.id && (
                    <form
                      className="mt-1 flex flex-col gap-2 border-t border-border/60 pt-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        pin(issue, new FormData(event.currentTarget));
                      }}
                    >
                      <textarea
                        name="passCriteria"
                        required
                        placeholder="通过标准：怎样算修好。空着不能提交。"
                        className="min-h-16 rounded-md border border-border bg-background px-2 py-1.5 text-[13px]"
                      />
                      <textarea
                        name="referenceOutput"
                        placeholder="参考答案，可选"
                        className="min-h-12 rounded-md border border-border bg-background px-2 py-1.5 text-[13px]"
                      />
                      <input
                        name="hypothesis"
                        placeholder="假设根因，可选。裁判结论不会改这里。"
                        className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                      />
                      <input
                        name="sourceSessionId"
                        defaultValue={issue.evidence[0]?.sessionId || ""}
                        placeholder="冻结输入用的会话 id"
                        className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[12px]"
                      />
                      <div className="flex flex-wrap gap-2 text-[12px]">
                        {evaluators.map((item) => (
                          <label key={item.id} className="inline-flex items-center gap-1">
                            <input type="checkbox" name="evaluatorId" value={item.id} defaultChecked={item.id === "task-completion"} />
                            {item.name}
                          </label>
                        ))}
                      </div>
                      <div>
                        {pinError && pinId === issue.id ? (
                          <p className="mb-1 text-[12px] text-destructive">{pinError}</p>
                        ) : null}
                        <Button type="submit" size="sm" disabled={busyId === issue.id}>
                          保存用例
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
