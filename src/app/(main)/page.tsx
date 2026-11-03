"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, ChevronDown, ChevronUp, Coins, MessageSquare, Users } from "lucide-react";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BarGradient, MetricTrendCard } from "@/components/charts/metric-trend-card";
import { formatNumber, formatTokens } from "@/lib/format";
import { AnomalyItem, type Anomaly } from "@/components/shell/anomaly-list";
import { useChartColors, useMetricAccents } from "@/lib/use-chart-colors";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

/**
 * 首页概览：异常栏 + 四张全局趋势图（用户 / 会话量 / Token / 活跃 Agent）。
 * 趋势优先，单点数据只作图上锚点（末值 + 环比）；排行与实体下钻归各自看板。
 */

type TrendRange = "weekly" | "30d" | "all";

const TREND_RANGE_OPTIONS: { value: TrendRange; label: string }[] = [
  { value: "weekly", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "all", label: "全部" },
];

/** Token 三段用同色相梯度区分，避免和会话图抢蓝紫两个色相 */

interface OverviewPoint {
  label: string;
  date: string;
  activeUsers: number;
  activeAgents: number;
  sessions: number;
  errorSessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  cumulativeUsers: number;
}

interface OverviewData {
  range: string;
  series: OverviewPoint[];
  cumulativeUsers: number;
  agentTotal: number;
  /** 最近一条 Span 的上报时间（ISO）；无任何数据时为 null */
  lastSpanAt: string | null;
}

/** 数据新鲜度三态：绿=30分钟内有上报；黄=延迟 30 分钟~2 小时；红=停报超 2 小时或从无数据 */
function freshnessState(lastSpanAt: string | null, now: number) {
  if (!lastSpanAt) return { level: "red" as const, text: "暂无数据上报" };
  const diffMs = Math.max(0, now - new Date(lastSpanAt).getTime());
  const mins = Math.floor(diffMs / 60000);
  const hhmm = new Date(lastSpanAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (mins < 30) return { level: "green" as const, text: `数据截至 ${mins < 1 ? "1 分钟内" : `${mins} 分钟前`}` };
  if (mins < 120) return { level: "amber" as const, text: `数据延迟 ${mins} 分钟（最后上报 ${hhmm}）` };
  const hours = Math.floor(mins / 60);
  return { level: "red" as const, text: `数据已停报 ${hours} 小时（最后上报 ${hhmm}）` };
}

function FreshnessDot({ level }: { level: "green" | "amber" | "red" }) {
  const cls = level === "green" ? "bg-success" : level === "amber" ? "bg-warning" : "bg-destructive";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

/** 锚点环比基准：weekly 档取前一日；30d/all 档取 7 天前同日（滤掉周末噪声），序列不足时回退前一日 */
function pickPrev(series: OverviewPoint[], range: TrendRange): OverviewPoint | undefined {
  if (series.length < 2) return undefined;
  if (range === "weekly") return series[series.length - 2];
  return series.length >= 8 ? series[series.length - 8] : series[series.length - 2];
}

/** 锚点环比：与基准点比较，±5% 内视为持平 */
function calcTrend(current: number, prev?: number) {
  if (prev === undefined || prev === 0) return { percent: null as number | null, direction: "flat" as const };
  const change = ((current - prev) / prev) * 100;
  return {
    percent: Math.abs(Math.round(change)),
    direction: change > 5 ? ("up" as const) : change < -5 ? ("down" as const) : ("flat" as const),
  };
}

function TrendText({ percent, direction }: { percent: number | null; direction: "up" | "down" | "flat" }) {
  if (percent === null || direction === "flat") {
    return <span className="text-xs text-muted-foreground">持平</span>;
  }
  const cls = direction === "up" ? "text-success" : "text-destructive";
  const sign = direction === "up" ? "+" : "-";
  return (
    <span className={`text-xs tabular-nums ${cls}`}>
      {sign}
      {percent}%
    </span>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<TrendRange>("weekly");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  // 新鲜度相对时间的当前时刻：60s 轮询刷新，组件卸载时清理
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const colors = useChartColors();
  const accents = useMetricAccents();
  // Token 三段：输入最突出，cache 最淡（浅色下最深→最浅，深色下最亮→最暗）
  const tokenRamp = accents.tokens.ramp ?? [accents.tokens.solid, accents.tokens.solid, accents.tokens.solid];

  // 异常哨兵固定取实时档，不随趋势范围切换
  useEffect(() => {
    fetch("/api/stats?range=realtime")
      .then((r) => r.json())
      .then((d) => setAnomalies(d.anomalies ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/overview?range=${range}`)
      .then((r) => r.json())
      .then((d: OverviewData) => {
        setOverview(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [range]);

  if (loading || !overview) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
            <div className="h-3.5 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-7 w-44 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-xl bg-card shadow-card ring-1 ring-foreground/5" />
          ))}
        </div>
      </div>
    );
  }

  const series = overview.series;
  const last = series.length > 0 ? series[series.length - 1] : null;
  const prev = pickPrev(series, range);

  /** 图表数据：派生正常会话数 = 总数 - 失败数（供堆叠柱使用） */
  const chartSeries = series.map((p) => ({ ...p, okSessions: p.sessions - p.errorSessions }));

  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
  const warningCount = anomalies.filter((a) => a.severity === "warning").length;

  const anchorNum = (value: number | undefined) => (
    <span className="text-sm font-medium text-foreground tabular-nums">{value === undefined ? "-" : formatNumber(value)}</span>
  );

  const tooltipStyle = {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: colors.text,
    boxShadow: "0 8px 24px -8px rgb(30 20 60 / 0.18)",
  } as const;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="概览"
        description="平台全局运行趋势 · 单点数据仅作图上锚点"
        actions={<SegmentedControl options={TREND_RANGE_OPTIONS} value={range} onChange={setRange} />}
      />

      {/* 数据新鲜度哨兵：采集断流时趋势线会"安静地变平"，此行防止误读为无流量 */}
      {(() => {
        const fresh = freshnessState(overview.lastSpanAt, now);
        return (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FreshnessDot level={fresh.level} />
            <span>{fresh.text}</span>
          </div>
        );
      })()}

      {/* 异常栏：唯一的"现在时"信息，固定反映实时异常 */}
      {anomalies.length > 0 && (
        <div className="rounded-lg bg-destructive/5 px-4 py-3 ring-1 ring-destructive/25">
          <button
            onClick={() => setAlertsExpanded(!alertsExpanded)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              {criticalCount > 0 && <span className="text-destructive tabular-nums">{criticalCount} 项严重异常</span>}
              {criticalCount > 0 && warningCount > 0 && <span className="text-muted-foreground">·</span>}
              {warningCount > 0 && <span className="text-warning tabular-nums">{warningCount} 项警告</span>}
            </span>
            <span className="flex items-center gap-2">
              <Link
                href="/alerts"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                告警中心 →
              </Link>
              {alertsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </span>
          </button>
          {alertsExpanded && (
            <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
              {anomalies.slice(0, 5).map((a, i) => (
                <AnomalyItem key={i} anomaly={a} />
              ))}
              {anomalies.length > 5 && (
                <p className="pl-4 text-xs text-muted-foreground tabular-nums">还有 {anomalies.length - 5} 项异常…</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 四张全局趋势图 */}
      {series.length === 0 ? (
        <Card>
          <CardContent className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">暂无数据</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* 用户趋势：活跃用户 + 累计注册 */}
          <MetricTrendCard
            title="用户趋势"
            unit="人"
            icon={Users}
            accent={accents.users}
            caliber="每日活跃 · 累计注册"
            legend={[
              { label: "活跃用户", color: accents.users.solid, kind: "line" },
              { label: "累计注册", color: colors.neutralLine, kind: "line-dashed" },
            ]}
            anchor={
              last && (
                <>
                  <span className="text-xs">今日活跃 {anchorNum(last.activeUsers)}</span>
                  <span className="text-xs text-muted-foreground">/ 累计 {formatNumber(last.cumulativeUsers)}</span>
                </>
              )
            }
            trend={<TrendText {...calcTrend(last?.activeUsers ?? 0, prev?.activeUsers)} />}
          >
            <LineChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} interval="preserveStartEnd" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickLine={false} width={44} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontSize: 11, color: colors.text }} />
              <Line type="monotone" dataKey="activeUsers" name="活跃用户" stroke={accents.users.solid} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line type="monotone" dataKey="cumulativeUsers" name="累计注册" stroke={colors.neutralLine} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            </LineChart>
          </MetricTrendCard>

          {/* 会话量趋势：新增会话 + 失败叠红 */}
          <MetricTrendCard
            title="会话量趋势"
            unit="次"
            icon={MessageSquare}
            accent={accents.sessions}
            caliber="每日新增会话 · 其中失败会话堆叠"
            legend={[
              { label: "正常会话", color: accents.sessions.solid, kind: "bar" },
              { label: "失败会话", color: "var(--destructive)", kind: "bar" },
            ]}
            anchor={last && <span className="text-xs">今日新增 {anchorNum(last.sessions)}</span>}
            trend={<TrendText {...calcTrend(last?.sessions ?? 0, prev?.sessions)} />}
          >
            <BarChart data={chartSeries} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <BarGradient id="overviewSessions" color={accents.sessions.solid} />
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} interval="preserveStartEnd" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickLine={false} width={44} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontSize: 11, color: colors.text }} cursor={{ fill: colors.grid, opacity: 0.35 }} />
              <Bar dataKey="okSessions" name="正常会话" stackId="s" fill="url(#overviewSessions)" />
              <Bar dataKey="errorSessions" name="失败会话" stackId="s" fill="var(--destructive)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </MetricTrendCard>

          {/* Token 消耗趋势：输入/输出/cache 三段堆叠 */}
          <MetricTrendCard
            title="Token 消耗趋势"
            unit="tokens"
            icon={Coins}
            accent={accents.tokens}
            caliber="每日消耗按 输入 / 输出 / cache 堆叠"
            legend={[
              { label: "输入", color: tokenRamp[0], kind: "bar" },
              { label: "输出", color: tokenRamp[1], kind: "bar" },
              { label: "cache", color: tokenRamp[2], kind: "bar" },
            ]}
            anchor={last && <span className="text-xs">今日消耗 {anchorNum(last.totalTokens)}</span>}
            trend={<TrendText {...calcTrend(last?.totalTokens ?? 0, prev?.totalTokens)} />}
          >
            <BarChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} interval="preserveStartEnd" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickLine={false} width={44} tickFormatter={(v) => formatTokens(Number(v))} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontSize: 11, color: colors.text }} formatter={(v) => formatTokens(Number(v))} cursor={{ fill: colors.grid, opacity: 0.35 }} />
              <Bar dataKey="inputTokens" name="输入" stackId="t" fill={tokenRamp[0]} />
              <Bar dataKey="outputTokens" name="输出" stackId="t" fill={tokenRamp[1]} />
              <Bar dataKey="cacheTokens" name="cache" stackId="t" fill={tokenRamp[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </MetricTrendCard>

          {/* 活跃 Agent 趋势 */}
          <MetricTrendCard
            title="活跃 Agent 趋势"
            unit="个"
            icon={Bot}
            accent={accents.agents}
            caliber="每日有调用的 Agent 数（去重）"
            legend={[{ label: "活跃 Agent", color: accents.agents.solid, kind: "area" }]}
            anchor={
              last && (
                <>
                  <span className="text-xs">今日 {anchorNum(last.activeAgents)}</span>
                  <span className="text-xs text-muted-foreground">/ 共 {formatNumber(overview.agentTotal)}</span>
                </>
              )
            }
            trend={<TrendText {...calcTrend(last?.activeAgents ?? 0, prev?.activeAgents)} />}
          >
            <AreaChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="overviewAgentGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accents.agents.solid} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={accents.agents.solid} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} interval="preserveStartEnd" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickLine={false} width={44} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontSize: 11, color: colors.text }} />
              <Area type="monotone" dataKey="activeAgents" name="活跃 Agent" stroke={accents.agents.solid} fill="url(#overviewAgentGradient)" strokeWidth={2} />
            </AreaChart>
          </MetricTrendCard>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        锚点为所选范围最后一天的值及环比（近7天档对比前一日，30天/全部档对比 7 天前同日）；活跃用户 / 活跃 Agent 按当日去重计数。排行与单实体分析见 Agent / Session / Skill 看板。
      </p>
    </div>
  );
}
