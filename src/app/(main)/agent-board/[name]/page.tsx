"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { MultiLineTrendChart } from "@/components/charts/multi-line-trend-chart";
import { StackedBarTrendChart } from "@/components/charts/stacked-bar-trend-chart";
import { HealthPanel } from "@/components/agent/health-panel";
import { AgentIssueList } from "@/components/agent/agent-issue-list";
import { TopList } from "@/components/agent/top-list";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTokens,
} from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import type { AgentDetail } from "@/lib/engine/stats/agent-detail";
import { cn } from "@/lib/utils";

/**
 * 单 Agent 视角（下钻页）。
 *
 * 与看板矩阵行的关系：矩阵行给结论（健康分/排序），本页给依据 ——
 * 健康分的四维原始数值、具体是哪些工具在失败、错在哪、慢在哪。
 * 所有区间指标跟随时间档；健康分固定近 30 天（与看板一致，避免跳级）。
 */

type Granularity = "day" | "week";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentName = safeDecode(String(params.name ?? ""));

  const [range, setRange] = useState<StatsRange>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(
      `/api/dashboard/agents/${encodeURIComponent(agentName)}?range=${range}&granularity=${granularity}`,
    )
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d: (AgentDetail & { error?: string }) | null) => {
        if (cancelled || !d) return;
        if (d.error) {
          setNotFound(true);
          return;
        }
        setData(d);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentName, range, granularity]);

  if (notFound) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">未找到 Agent：{agentName}</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/agent-board")}>
          返回 Agent 看板
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">{loading ? "加载中..." : "加载失败"}</p>
      </div>
    );
  }

  const { totals, profile, trends } = data;
  const okSessions = Math.max(totals.sessions - totals.badSessions, 0);

  return (
    <div className={cn("flex flex-col gap-5 p-6 transition-opacity", loading && "opacity-60")}>
      <PageHeader
        title={`${profile.emoji} ${profile.name}`}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1.5 h-6 w-6 text-muted-foreground"
              onClick={() => router.push("/agent-board")}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            单 Agent 视角（{data.range}）
            <span className="rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              {profile.framework}
            </span>
            <span className="rounded-sm bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              v{profile.version}
            </span>
            {data.issues.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">
                <AlertCircle className="h-2.5 w-2.5" />
                {data.issues.length} 个待处理问题
              </span>
            )}
          </span>
        }
        actions={
          <>
            <SegmentedControl
              options={[
                { value: "day", label: "每天" },
                { value: "week", label: "每周" },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
            <SegmentedControl
              options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={range}
              onChange={setRange}
            />
          </>
        }
      />

      {/* 健康仪表盘 */}
      <Card>
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>健康仪表盘</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            固定近 30 天四维加权 · 点维度行展开打分依据
          </span>
        </CardHeader>
        <CardContent className="pt-4">
          <HealthPanel health={data.health} />
        </CardContent>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <KpiCard label="会话数" value={formatNumber(totals.sessions)} sub={`${totals.finishedSessions} 已完成`} />
        <KpiCard
          label="成功率"
          value={totals.successRate == null ? "—" : `${totals.successRate.toFixed(1)}%`}
          sub={`失败 ${totals.badSessions} · 部分成功 ${totals.partialSessions ?? 0}`}
          subTone={totals.badSessions > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Span 失败率"
          value={`${totals.spanFailRate.toFixed(1)}%`}
          sub={`${formatNumber(totals.failedSpans)} / ${formatNumber(totals.spans)} 个 span`}
          subTone={totals.spanFailRate > 5 ? "destructive" : totals.spanFailRate > 2 ? "warning" : "success"}
        />
        <KpiCard
          label="Token 总消耗"
          value={formatTokens(totals.totalTokens)}
          sub={`入 ${formatTokens(totals.inputTokens)} · 出 ${formatTokens(totals.outputTokens)}`}
        />
        <KpiCard
          label="对话轮数"
          value={formatNumber(totals.rounds)}
          sub={totals.sessions > 0 ? `单会话均 ${(totals.rounds / totals.sessions).toFixed(1)} 轮` : "—"}
        />
        <KpiCard
          label="覆盖范围"
          value={`${totals.users} 人`}
          sub={`${totals.projects} 个项目 · 全历史 ${profile.totalUsers} 人`}
        />
      </div>

      {/* 问题列表 + 工具榜 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>问题列表</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              按严重度排序 · 证据可直接核对 · 链路可点开
            </span>
          </CardHeader>
          <CardContent className="pt-3">
            <AgentIssueList issues={data.issues} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Top 工具</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {formatNumber(totals.toolCalls)} 次 · 失败 {formatNumber(totals.toolFailed)}
            </span>
          </CardHeader>
          <CardContent className="pt-3">
            <TopList
              items={data.topTools}
              valueFormatter={(v) => `${formatNumber(v)} 次`}
              showFailRate
              emptyText="该时间段无工具调用"
            />
          </CardContent>
        </Card>
      </div>

      {/* 三张趋势 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>会话耗时 P95</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              平均 {totals.avgDuration > 0 ? formatDuration(totals.avgDuration) : "—"}
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {/* 只画 P95：平均耗时通常只有 P95 的 1/10，同轴画会把平均压成贴底的直线 */}
            <MultiLineTrendChart
              labels={trends.labels}
              series={[{ name: "P95 耗时", data: trends.duration.p95 }]}
              height={200}
              valueFormatter={(v) => formatDuration(v)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Token 消耗</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <MultiLineTrendChart
              labels={trends.labels}
              series={[
                { name: "输入", data: trends.tokens.input },
                { name: "输出", data: trends.tokens.output },
                { name: "缓存", data: trends.tokens.cache },
              ]}
              height={200}
              valueFormatter={(v) => formatTokens(v)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>成功 / 失败</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {totals.sessions < 30 ? "样本稀疏，可切每周" : `${totals.sessions} 个会话`}
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            <StackedBarTrendChart
              labels={trends.labels}
              series={[
                {
                  name: "成功",
                  data: trends.outcome.sessions.map((s, i) => Math.max(s - trends.outcome.badSessions[i], 0)),
                },
                { name: "失败", data: trends.outcome.badSessions, color: "var(--destructive)" },
              ]}
              height={200}
            />
          </CardContent>
        </Card>
      </div>

      {/* 高频榜 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Top 用户</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <TopList items={data.topUsers} valueFormatter={(v) => `${v} 会话`} emptyText="该时间段无使用" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Top 项目</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <TopList items={data.topProjects} valueFormatter={(v) => `${v} 会话`} emptyText="该时间段无项目" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Top 模型</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <TopList items={data.topModels} valueFormatter={(v) => `${v} 会话`} emptyText="该时间段无模型记录" />
          </CardContent>
        </Card>
      </div>

      {/* 画像 + 慢调用 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Agent 画像</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {profile.description && (
              <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{profile.description}</p>
            )}
            <dl className="space-y-1.5 text-[12px]">
              <Row label="框架" value={profile.framework} mono />
              <Row label="版本" value={`v${profile.version}`} mono />
              <Row label="注册时间" value={profile.createdAt ? formatDateTime(new Date(profile.createdAt).getTime()) : "—"} />
              <Row label="首次上线" value={profile.firstSeenAt ? formatDateTime(new Date(profile.firstSeenAt).getTime()) : "—"} />
              <Row label="最后活跃" value={profile.lastSeenAt ? formatDateTime(new Date(profile.lastSeenAt).getTime()) : "—"} />
              <Row label="在线天数" value={profile.daysOnline != null ? `${profile.daysOnline} 天` : "—"} />
              <Row label="累计覆盖" value={`${profile.totalUsers} 用户 · ${profile.totalProjects} 项目`} />
              <Row label="缓存 Token" value={formatTokens(totals.cacheTokens)} />
              <Row
                label="平均会话耗时"
                value={totals.avgDuration > 0 ? formatDuration(totals.avgDuration) : "—"}
              />
              <Row label="Span P95" value={totals.p95SampleCount > 0 ? formatDuration(totals.p95Duration) : "—"} />
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>最慢 span</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              超过 span P95（{formatDuration(totals.p95Duration)}）的前 10 条
            </span>
          </CardHeader>
          <CardContent className="pt-2">
            {data.slowSpans.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                该时间段没有超过 P95 的 span
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {data.slowSpans.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5 text-[12px]">
                    <span className="w-[92px] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                      {s.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {s.status === "failed" && (
                      <span className="shrink-0 rounded-sm bg-destructive/10 px-1 text-[10px] text-destructive">
                        失败
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-warning">
                      {formatDuration(s.duration)}
                    </span>
                    <span className="w-[46px] shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                      {totals.p95Duration > 0 ? `${(s.duration / totals.p95Duration).toFixed(1)}×` : "—"}
                    </span>
                    <Link
                      href={`/trace/${s.sessionId}?spanId=${encodeURIComponent(s.id)}`}
                      className="shrink-0 text-[11px] text-primary hover:underline"
                    >
                      链路
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.dataNotes.length > 0 && (
              <p className="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                {data.dataNotes.join("；")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
