"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { MultiLineTrendChart } from "@/components/charts/multi-line-trend-chart";
import { AgentCompareTable } from "@/components/agent/agent-compare-table";
import { useCategoryPalette } from "@/lib/use-chart-colors";
import { formatDuration, formatNumber, formatTokens, pctChange } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import { HEALTH_WINDOW_DAYS } from "@/lib/engine/stats/health";
import type { AgentBoard } from "@/lib/engine/stats/agent-board";
import type { AgentTrendMetric } from "@/lib/engine/stats/trend";
import { cn } from "@/lib/utils";

/**
 * Agent 看板（横向 / 全局视角）。
 *
 * 与「用户看板」的分工：用户看板回答「谁在用」，本页回答「Agent 用得怎么样」：
 *   1. KPI 行     —— 多少 Agent 在跑、整体成功率、整体耗时水位
 *   2. 会话数对比 —— 各 Agent 会话数，唯一能一眼看出「谁在被用得最多」的形状
 *   3. 使用趋势   —— 各 Agent 的会话数 / Token / 失败数走势
 *   4. 工具失败率 —— 唯一能一眼看出「谁在坏」的形状
 *   5. 对比矩阵   —— 全量指标 + 健康分，可排序、可下钻
 *
 * 口径：时间过滤用 Session.startTime；成功率 = 1 - (失败会话 + 部分成功×0.5) / 完成会话；
 * 健康分固定近 30 天（与页面时间档解耦），列头已标注。
 */

const METRIC_OPTIONS: { value: AgentTrendMetric; label: string }[] = [
  { value: "sessions", label: "会话数" },
  { value: "tokens", label: "Token" },
  { value: "failed", label: "失败会话" },
];

type Granularity = "day" | "week";

interface TrendData {
  labels: string[];
  series: { name: string; data: number[] }[];
}

export default function AgentBoardPage() {
  const [range, setRange] = useState<StatsRange>("30d");
  const [metric, setMetric] = useState<AgentTrendMetric>("sessions");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<AgentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendData>({ labels: [], series: [] });
  const [trendLoading, setTrendLoading] = useState(false);
  const palette = useCategoryPalette();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard/agents/board?range=${range}`)
      .then((r) => r.json())
      .then((d: AgentBoard & { error?: string }) => {
        if (cancelled || d.error) return;
        setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    fetch(`/api/dashboard/agents/trend-compare?range=${range}&granularity=${granularity}&metric=${metric}`)
      .then((r) => r.json())
      .then((d: TrendData) => {
        if (cancelled) return;
        setTrend({ labels: d.labels ?? [], series: d.series ?? [] });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, granularity, metric]);

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">{loading ? "加载中..." : "加载失败，请刷新重试"}</p>
      </div>
    );
  }

  const { kpi } = data;

  // 工具失败率对比：样本太小的 Agent（<5 次调用）不参与，避免 1/1=100% 抢眼
  // 名字过长的截断，否则 Y 轴标签会折行叠在一起（完整名在上面的矩阵表里）
  const shortName = (n: string, max = 11) => (n.length > max ? `${n.slice(0, max)}…` : n);
  // Agent → 颜色：按 Agent 名升序的位置分配，与两张图各自的排序、与时间档筛选都无关，
  // 所以同一个 Agent 在「会话数」和「工具失败率」两张图里恒定同色。
  // 基准取全量 data.agents（接口 LEFT JOIN，未使用的 Agent 也在），切档时颜色不会整体错位。
  const agentColor = new Map<string, string>();
  [...data.agents]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((a, i) => agentColor.set(a.name, palette[i % palette.length]));
  // 用截断前的原始 name 查色；截断后的 label 只用于显示
  const colorOf = (name: string) => agentColor.get(name) ?? palette[0];
  // 会话数对比：0 会话的 Agent 不画（空柱子只是噪声），降序排名
  const sessionData = data.agents
    .filter((a) => a.sessions > 0)
    .map((a) => ({ name: shortName(a.name), value: a.sessions, color: colorOf(a.name) }))
    .sort((a, b) => b.value - a.value);
  const failRateData = data.agents
    .filter((a) => a.toolCalls >= 5 && a.toolFailRate != null)
    .map((a) => ({
      name: shortName(a.name),
      value: Number(a.toolFailRate!.toFixed(2)),
      color: colorOf(a.name),
    }))
    .sort((a, b) => b.value - a.value);
  // 两卡同一行，图表高度取两者行数较大者（对齐柱距便于横向对比），并封顶避免 20+ Agent 时卡片过高
  const chartH = Math.min(Math.max(210, Math.max(sessionData.length, failRateData.length) * 24), 420);
  const toolCallsTotal = data.agents.reduce((s, a) => s + a.toolCalls, 0);
  const toolFailedTotal = data.agents.reduce((s, a) => s + a.toolFailed, 0);

  return (
    <div className={cn("flex flex-col gap-5 p-6 transition-opacity", loading && "opacity-60")}>
      <PageHeader
        title="Agent 看板"
        description={`全量 Agent 的使用对比与健康状态（${data.range}）· 成功率按「末轮是否有交付」计，部分成功按半失败折算`}
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={range}
            onChange={setRange}
          />
        }
      />

      {/* 1. KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="活跃 Agent"
          value={`${kpi.activeAgents} / ${kpi.agentTotal}`}
          sub={kpi.silentAgents > 0 ? `沉默 ${kpi.silentAgents} 个` : "全部有使用"}
          subTone={kpi.silentAgents > 0 ? "warning" : "success"}
          trend={pctChange(kpi.activeAgents, kpi.activeAgentsPrev)}
        />
        <KpiCard
          label="总会话数"
          value={formatNumber(kpi.sessions)}
          sub={`失败 ${kpi.badSessions} · 部分成功 ${kpi.partialSessions ?? 0}`}
          trend={pctChange(kpi.sessions, kpi.sessionsPrev)}
        />
        <KpiCard
          label="整体成功率"
          value={`${kpi.successRate.toFixed(1)}%`}
          sub={`Span 失败率 ${kpi.spanFailRate.toFixed(1)}%（${formatNumber(kpi.failedSpans)}/${formatNumber(kpi.spans)}）`}
          subTone={kpi.successRate >= 97 ? "success" : kpi.successRate >= 93 ? "warning" : "destructive"}
        />
        <KpiCard
          label="P95 会话耗时"
          value={kpi.p95SampleCount < 10 ? "—" : formatDuration(kpi.p95Duration)}
          sub={kpi.p95SampleCount < 10 ? `有效样本仅 ${kpi.p95SampleCount} 个，不显示` : `有效样本 ${kpi.p95SampleCount} 个会话`}
        />
      </div>

      {/* 2. 会话数对比 + 3. 工具失败率 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Agent 会话数</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {data.range} · {sessionData.length} 个 Agent 有会话
            </span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH }}>
            {sessionData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段暂无 Agent 有会话
              </p>
            ) : (
              <FancyBarChartH
                data={sessionData}
                valueFormatter={(v) => formatNumber(v)}
                ariaLabel="会话数"
                yAxisInterval={0}
                xInteger
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>工具失败率</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {formatNumber(toolFailedTotal)} / {formatNumber(toolCallsTotal)} 次失败
            </span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH }}>
            {failRateData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段工具调用不足 5 次
              </p>
            ) : (
              <FancyBarChartH
                data={failRateData}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                ariaLabel="工具失败率"
                yAxisInterval={0}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4. 使用量趋势 */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <div>
            <CardTitle>使用量趋势</CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              按所选指标取 Top 8 Agent，其余不画
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
            <SegmentedControl
              options={[
                { value: "day", label: "每天" },
                { value: "week", label: "每周" },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
          </div>
        </CardHeader>
        <CardContent className={cn("pt-4 transition-opacity", trendLoading && "opacity-50")}>
          {trend.labels.length === 0 ? (
            <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              该时间段暂无数据
            </p>
          ) : (
            <MultiLineTrendChart
              labels={trend.labels}
              series={trend.series}
              height={280}
              valueFormatter={metric === "tokens" ? (v) => formatTokens(v) : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* 5. 对比矩阵 */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>Agent 对比矩阵</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            点击列头排序 · 点击 Agent 名进入单 Agent 视角 · 健康分固定近 {HEALTH_WINDOW_DAYS} 天
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <AgentCompareTable rows={data.agents} />
        </CardContent>
      </Card>
    </div>
  );
}
