"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration, formatTokens } from "@/lib/format";

interface ReleaseOption {
  id: string;
  label: string;
  fingerprint: string;
  quality: string;
  model: string;
  lastSeenAt: string;
}

interface SideStat {
  hits: number;
  durationMs: number;
  tokens: number;
}

interface ComparedIssue {
  issueId: string;
  title: string;
  signature: string;
  verdict: "improved" | "still" | "worse";
  base: SideStat;
  next: SideStat;
}

interface ComparePayload {
  base: { id: string; label: string; model: string; quality: string; sessions: number; durationMs: number; tokens: number };
  next: { id: string; label: string; model: string; quality: string; sessions: number; durationMs: number; tokens: number };
  issues: ComparedIssue[];
  tasks: { taskKey: string; baseSessions: number; nextSessions: number; issues: ComparedIssue[] }[];
}

const VERDICT_LABEL = { improved: "变好", still: "仍失败", worse: "变差" } as const;

function releaseName(release: { label: string; model: string; quality: string }): string {
  const parts = [`v${release.label || "未标版本"}`];
  if (release.model) parts.push(release.model);
  if (release.quality === "weak") parts.push("弱指纹");
  return parts.join(" · ");
}

function SideLine({ stat }: { stat: SideStat }) {
  if (stat.hits === 0) return <span>0 次</span>;
  return (
    <span>
      {stat.hits} 次 · {formatDuration(stat.durationMs)} · {formatTokens(stat.tokens)} token
    </span>
  );
}

function IssueRows({ issues }: { issues: ComparedIssue[] }) {
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li key={issue.issueId} className="rounded-lg border border-border/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-sm bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
              {VERDICT_LABEL[issue.verdict]}
            </span>
            <span className="text-[13px] font-medium">{issue.title}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            基线 <SideLine stat={issue.base} />
            {" · "}
            新版本 <SideLine stat={issue.next} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function ReleaseComparePage() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [agentId, setAgentId] = useState("");
  const [releases, setReleases] = useState<ReleaseOption[]>([]);
  const [baseId, setBaseId] = useState("");
  const [nextId, setNextId] = useState("");
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [minSamples, setMinSamples] = useState(3);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    if (baseId) params.set("base", baseId);
    if (nextId) params.set("next", nextId);
    let cancelled = false;
    setLoading(true);
    fetch(`/api/releases/compare?${params.toString()}`)
      .then((response) => {
        if (!response.ok) throw new Error("compare failed");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setAgents(data.agents ?? []);
        setReleases(data.releases ?? []);
        setMinSamples(data.taskSampleMin ?? 3);
        setCompare(data.compare ?? null);
        if (!agentId && data.agents?.[0]) setAgentId(data.agents[0].id);
        if (data.compare) {
          setBaseId(data.compare.base.id);
          setNextId(data.compare.next.id);
        }
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, baseId, nextId]);

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="版本对照"
        description="按问题比较两个版本。只在基线出现是变好，两边都有是仍失败，只在新版本出现是变差。耗时和 token 是命中会话的平均值。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          value={agentId}
          onChange={(event) => {
            setAgentId(event.target.value);
            setBaseId("");
            setNextId("");
          }}
        >
          {agents.length === 0 ? <option value="">还没有版本</option> : null}
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          value={baseId}
          onChange={(event) => setBaseId(event.target.value)}
        >
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              基线 {releaseName(release)}
            </option>
          ))}
        </select>
        <select
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-[13px]"
          value={nextId}
          onChange={(event) => setNextId(event.target.value)}
        >
          {releases.map((release) => (
            <option key={release.id} value={release.id}>
              新版本 {releaseName(release)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      ) : !compare ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            这个 Agent 还没有两个可对照的版本。新会话带上 prompt、skill 或 config 哈希后，会在这里出现。
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 py-3 text-[13px] sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">基线 {releaseName(compare.base)}</span>
                <span className="mt-0.5 block">
                  {compare.base.sessions} 个会话 · {formatDuration(compare.base.durationMs)} · {formatTokens(compare.base.tokens)} token
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">新版本 {releaseName(compare.next)}</span>
                <span className="mt-0.5 block">
                  {compare.next.sessions} 个会话 · {formatDuration(compare.next.durationMs)} · {formatTokens(compare.next.tokens)} token
                </span>
              </p>
            </CardContent>
          </Card>

          {compare.issues.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                这两个版本上没有可对照的问题。过程问题要先进入
                <Link href="/issues" className="mx-1 text-primary underline-offset-2 hover:underline">
                  问题库
                </Link>
                。
              </CardContent>
            </Card>
          ) : (
            <IssueRows issues={compare.issues} />
          )}

          {compare.tasks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">按任务类型</h2>
              <p className="text-[12px] text-muted-foreground">
                只拆开两边都至少有 {minSamples} 条会话的任务。其余任务留在上面的总表里。
              </p>
              {compare.tasks.map((task) => (
                <Card key={task.taskKey}>
                  <CardContent className="flex flex-col gap-2 py-3">
                    <p className="text-[13px] font-medium">{task.taskKey}</p>
                    <p className="text-[12px] text-muted-foreground">
                      基线 {task.baseSessions} 条 · 新版本 {task.nextSessions} 条
                    </p>
                    <IssueRows issues={task.issues} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
