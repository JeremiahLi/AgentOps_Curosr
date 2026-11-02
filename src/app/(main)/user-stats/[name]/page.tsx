"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatTokens, formatDuration, formatDateTime } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { UsageTrendChart, type TrendPointDto } from "@/components/charts/usage-trend-chart";

interface DrilldownData {
  name: string;
  range: string;
  totals: {
    sessions: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    rounds: number;
    errors: number;
    errorSessions: number;
    inputCount: number;
    inputChars: number;
    outputCount: number;
    outputChars: number;
  };
  perAgent: { name: string; emoji: string; sessions: number; tokens: number; rounds: number }[];
  recentSessions: {
    id: string;
    agentName: string;
    agentEmoji: string;
    model: string | null;
    status: string;
    startTime: string;
    totalTokens: number;
    totalRounds: number;
    totalDuration: number;
  }[];
}

type Granularity = "day" | "week";

export default function UserDrilldownPage() {
  const params = useParams();
  const router = useRouter();
  const userName = decodeURIComponent(params.name as string);

  const [timeRange, setTimeRange] = useState<StatsRange>("all");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<DrilldownData | null>(null);
  const [trend, setTrend] = useState<TrendPointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    fetch(
      `/api/dashboard/users/${encodeURIComponent(userName)}?range=${timeRange}&granularity=${granularity}`,
    )
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setData(d);
          setTrend(d.trend ?? []);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [userName, timeRange, granularity]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">用户未找到: {userName}</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/user-stats")}>
          返回用户看板
        </Button>
      </div>
    );
  }

  const agentSessionData = data.perAgent.map((a) => ({ name: a.name, value: a.sessions }));
  const agentTokenData = data.perAgent.map((a) => ({ name: a.name, value: a.tokens }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={data.name}
        description={
          <span className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="h-6 w-6 -ml-1.5 text-muted-foreground" onClick={() => router.push("/user-stats")}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            单用户使用明细（{data.range}）
          </span>
        }
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={timeRange}
            onChange={setTimeRange}
          />
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <KpiCard label="会话总数" value={formatNumber(data.totals.sessions)} sub="Agent 调用次数" />
        <KpiCard label="Token 总消耗" value={formatTokens(data.totals.tokens)} sub={`输入 ${formatTokens(data.totals.inputTokens)} / 输出 ${formatTokens(data.totals.outputTokens)}`} />
        <KpiCard label="对话总轮数" value={formatNumber(data.totals.rounds)} sub="所有会话累计" />
        <KpiCard
          label="输入资料"
          value={`${formatNumber(data.totals.inputCount)} 条`}
          sub={`${formatNumber(data.totals.inputChars)} 字符`}
        />
        <KpiCard
          label="输出资料"
          value={`${formatNumber(data.totals.outputCount)} 条`}
          sub={`${formatNumber(data.totals.outputChars)} 字符`}
        />
        <KpiCard
          label="异常会话"
          value={`${data.totals.errorSessions}`}
          sub={data.totals.errorSessions > 0 ? "存在失败会话" : "一切正常"}
          subTone={data.totals.errorSessions > 0 ? "warning" : "success"}
        />
      </div>

      {/* 使用趋势 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>使用趋势</CardTitle>
          <SegmentedControl
            options={[
              { value: "day", label: "每天" },
              { value: "week", label: "每周" },
            ]}
            value={granularity}
            onChange={setGranularity}
          />
        </CardHeader>
        <CardContent className="pt-4">
          <UsageTrendChart data={trend} secondaryName="使用 Agent 数" />
        </CardContent>
      </Card>

      {/* 各 Agent 维度双图 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>各 Agent 使用频率（会话数）</CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-4">
            {agentSessionData.length === 0 ? (
              <Empty />
            ) : (
              <FancyBarChartH data={agentSessionData} valueFormatter={(v) => formatNumber(v)} ariaLabel="会话数" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>各 Agent Token 消耗</CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-4">
            {agentTokenData.length === 0 ? (
              <Empty />
            ) : (
              <FancyBarChartH data={agentTokenData} valueFormatter={(v) => formatTokens(v)} ariaLabel="Token" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 会话列表 */}
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b border-border/60 pb-2.5">
          <CardTitle>最近会话（最多 50 条，点击查看链路详情）</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[460px] overflow-auto scrollbar-thin">
          {data.recentSessions.length === 0 ? (
            <Empty text="该时间段暂无会话" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>开始时间</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className="text-right">状态</TableHead>
                  <TableHead className="text-right">轮数</TableHead>
                  <TableHead className="text-right">Token</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSessions.map((s) => (
                  <TableRow key={s.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{formatDateTime(new Date(s.startTime).getTime())}</TableCell>
                    <TableCell className="whitespace-nowrap">{s.agentName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.model || "—"}</TableCell>
                    <TableCell className="text-right">
                      {s.status === "error" ? (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                          <AlertCircle className="h-3 w-3" /> 错误
                        </span>
                      ) : s.status === "active" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-sm bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">
                          <span className="h-1 w-1 rounded-full bg-info" />
                          进行中
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-sm bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
                          <span className="h-1 w-1 rounded-full bg-success" />
                          完成
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{s.totalRounds}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatTokens(s.totalTokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatDuration(s.totalDuration)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/trace/${s.id}`}
                        className="text-[13px] text-primary hover:underline"
                      >
                        查看链路
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ text = "暂无数据" }: { text?: string }) {
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</p>;
}
