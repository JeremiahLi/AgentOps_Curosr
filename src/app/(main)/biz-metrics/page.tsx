"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatNumber, formatTokens } from "@/lib/format";
import type { StatsRange } from "@/lib/engine/stats/range";

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "realtime", label: "今日" },
  { value: "weekly", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "all", label: "全部" },
];

interface BizStats {
  overview: {
    totalTasks: number;
    successTasks: number;
    successRate: number;
    totalTokens: number;
    activeAgents: number;
  };
  rankings: { agentId: string; agentName: string; taskCount: number; totalTokens: number }[];
  trend: { date: string; tokens: number; tasks: number }[];
  tasks: {
    id: string;
    agentName: string;
    taskId: string;
    createdAt: string;
    durationMs: number;
    success: boolean;
    totalTokens: number;
    callCount: number;
  }[];
}

export default function BizMetricsPage() {
  const [range, setRange] = useState<StatsRange>("weekly");
  const [data, setData] = useState<BizStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetch(`/api/biz-metrics/stats?range=${range}`)
      .then((response) => {
        if (!response.ok) throw new Error("biz failed");
        return response.json();
      })
      .then((payload: BizStats) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const maxTasks = Math.max(1, ...(data?.trend.map((item) => item.tasks) ?? [1]));

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="业务指标"
        description="外部脚本经 /api/biz-metrics/upload 上报的任务耗时、成败和 Token。这里不重算会话链路。"
        actions={<SegmentedControl options={RANGES} value={range} onChange={setRange} />}
      />

      {data === null && !failed ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : failed || !data ? (
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="任务数" value={formatNumber(data.overview.totalTasks)} />
            <KpiCard label="成功率" value={`${Math.round(data.overview.successRate)}%`} />
            <KpiCard label="Token" value={formatTokens(data.overview.totalTokens)} />
            <KpiCard label="涉及 Agent" value={formatNumber(data.overview.activeAgents)} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">任务量</CardTitle>
            </CardHeader>
            <CardContent>
              {data.trend.length === 0 ? (
                <p className="text-sm text-muted-foreground">这个时间段没有上报。</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.trend.map((item) => (
                    <li key={item.date} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-[12px]">
                      <span className="font-mono text-muted-foreground">{item.date}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary/70"
                          style={{ width: `${(item.tasks / maxTasks) * 100}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-muted-foreground">{item.tasks} 个</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">按 Agent</CardTitle>
            </CardHeader>
            <CardContent>
              {data.rankings.length === 0 ? (
                <p className="text-sm text-muted-foreground">没有可排的 Agent。</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {data.rankings.map((item) => (
                    <li key={item.agentId} className="flex justify-between gap-3">
                      <span>{item.agentName}</span>
                      <span className="text-muted-foreground">
                        {item.taskCount} 个任务 · {formatTokens(item.totalTokens)} token
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">最近任务</CardTitle>
            </CardHeader>
            <CardContent>
              {data.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">没有任务记录。</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {data.tasks.slice(0, 30).map((task) => (
                    <li key={task.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {task.agentName}
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{task.taskId}</span>
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {task.success ? "成功" : "失败"} · {formatDuration(task.durationMs)} · {formatTokens(task.totalTokens)} token
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
