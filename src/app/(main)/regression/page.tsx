"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface RunRow {
  id: string;
  evaluatorId: string;
  sessionId: string;
  status: string;
  verdict: string;
  score: number;
  summary: string;
  errorMessage: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  releaseLabel: string;
}

interface CaseRow {
  id: string;
  issueId: string;
  issueTitle: string;
  agentName: string;
  sourceSessionId: string;
  frozenInput: string;
  passCriteria: string;
  referenceOutput: string;
  hypothesis: string;
  evaluatorIds: string[];
  runs: RunRow[];
}

const VERDICT_LABEL: Record<string, string> = {
  pass: "通过",
  warn: "存疑",
  fail: "仍失败",
};

export default function RegressionPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [hypothesis, setHypothesis] = useState<Record<string, string>>({});
  const [sessionIds, setSessionIds] = useState<Record<string, string>>({});
  const [bindError, setBindError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/regression-cases");
    if (!response.ok) throw new Error("load failed");
    return response.json() as Promise<{ cases: CaseRow[] }>;
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        setCases(data.cases);
        setHypothesis(Object.fromEntries(data.cases.map((item) => [item.id, item.hypothesis])));
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setCases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function saveHypothesis(id: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/regression-cases/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hypothesis: hypothesis[id] ?? "" }),
      });
      if (!response.ok) return;
      const data = await load();
      setCases(data.cases);
    } finally {
      setBusyId("");
    }
  }

  async function bind(id: string) {
    const sessionId = (sessionIds[id] || "").trim();
    if (!sessionId) return;
    setBusyId(id);
    setBindError("");
    try {
      const response = await fetch(`/api/regression-cases/${id}/bind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBindError(body.error || "没有绑上");
        return;
      }
      const data = await load();
      setCases(data.cases);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="回归用例"
        description="从已确认的问题钉出。平台不重新执行 Agent。把新会话绑上来之后，按通过标准做判定。"
      />
      {cases === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      ) : cases.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            还没有用例。在{" "}
            <Link href="/issues" className="text-primary underline-offset-2 hover:underline">
              问题库
            </Link>{" "}
            里对已打开的问题填写通过标准。
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {cases.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-3">
                  <div>
                    <div className="text-[13px] font-medium">{item.issueTitle}</div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {item.agentName} · 判定器 {item.evaluatorIds.join("、") || "无"}
                    </p>
                  </div>
                  <p className="text-[13px]">
                    <span className="text-muted-foreground">通过标准：</span>
                    {item.passCriteria}
                  </p>
                  {item.frozenInput ? (
                    <p className="line-clamp-3 text-[12px] text-muted-foreground">冻结输入：{item.frozenInput}</p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">来源会话没有用户输入。</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] text-muted-foreground">假设根因</label>
                    <textarea
                      value={hypothesis[item.id] ?? ""}
                      onChange={(event) => setHypothesis((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      className="min-h-14 rounded-md border border-border bg-background px-2 py-1.5 text-[13px]"
                    />
                    <div>
                      <Button size="sm" variant="outline" disabled={busyId === item.id} onClick={() => saveHypothesis(item.id)}>
                        保存假设
                      </Button>
                    </div>
                  </div>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      bind(item.id);
                    }}
                  >
                    <input
                      value={sessionIds[item.id] ?? ""}
                      onChange={(event) => setSessionIds((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      placeholder="绑定会话 id"
                      className="h-8 w-72 rounded-md border border-border bg-background px-2 font-mono text-[12px]"
                    />
                    <Button type="submit" size="sm" disabled={busyId === item.id}>
                      绑定并判定
                    </Button>
                    <Link
                      href={`/trace/${item.sourceSessionId}`}
                      className="text-[12px] text-primary underline-offset-2 hover:underline"
                    >
                      来源会话
                    </Link>
                  </form>
                  {bindError ? <p className="text-[12px] text-destructive">{bindError}</p> : null}
                  {item.runs.length > 0 && (
                    <ul className="space-y-1 text-[12px]">
                      {item.runs.map((run) => (
                        <li key={run.id} className="rounded-md bg-muted/40 px-2 py-1.5">
                          <span className="font-medium">
                            {run.status === "failed"
                              ? "判定失败"
                              : VERDICT_LABEL[run.verdict] || run.verdict || run.status}
                          </span>
                          {" · "}
                          {run.evaluatorId}
                          {run.releaseLabel ? ` · v${run.releaseLabel}` : ""}
                          {" · "}
                          <Link href={`/trace/${run.sessionId}`} className="text-primary underline-offset-2 hover:underline">
                            会话
                          </Link>
                          <span className="text-muted-foreground">
                            {" "}
                            · {run.durationMs} ms · 输入 {run.inputTokens} / 输出 {run.outputTokens}
                          </span>
                          <p className="text-muted-foreground">{run.errorMessage || run.summary}</p>
                        </li>
                      ))}
                    </ul>
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
