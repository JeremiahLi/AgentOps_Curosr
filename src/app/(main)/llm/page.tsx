"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { MultiLineTrendChart } from "@/components/charts/multi-line-trend-chart";
import { StackedBarTrendChart } from "@/components/charts/stacked-bar-trend-chart";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { ModelCompareTable } from "@/components/llm/model-compare-table";
import { useCategoryPalette } from "@/lib/use-chart-colors";
import { formatDuration, formatNumber, formatRelativeTime, formatTokens, pctChange } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import type { LlmBoard } from "@/lib/engine/stats/llm-board";
import { cn } from "@/lib/utils";

/**
 * LLM 看板（横向 / 模型视角）。
 *
 * 回答「钱花在哪、谁慢谁错」：
 *   1. KPI      —— 调用量、成本指数、缓存命中率、单次耗时
 *   2. 调用趋势 —— 多模型调用量走势（谁在被用得越来越多）
 *   3. Token 构成 —— 输入/输出/缓存读/缓存写四段堆叠（缓存读写分开是降本的关键视角）
 *   4. 轮次曲线 —— 按轮次的 Token 构成，暴露「长会话被缓存读取主导」
 *   5. 缓存命中率 —— 各模型横向对比
 *   6. 模型对比表 —— 成本 / 耗时 / 失败，可排序，点模型跳 Session 列表
 *   7. 异常      —— Token 突增、LLM 调用失败
 *
 * 口径提醒：成本是**相对权重折算的指数**，不是金额；耗时只统计数据可信的模型
 * （详见引擎层 COST_WEIGHTS 与耗时闸门注释）。
 */
export default function LlmBoardPage() {
  const [range, setRange] = useState<StatsRange>("30d");
  const [data, setData] = useState<LlmBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const palette = useCategoryPalette();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/llm/board?range=${range}`)
      .then((r) => r.json())
      .then((d: LlmBoard & { error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setFailed(true);
          return;
        }
        setData(d);
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
  }, [range]);

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {loading ? "加载中..." : failed ? "加载失败，请刷新重试" : "暂无数据"}
        </p>
      </div>
    );
  }

  const { kpi, meta } = data;
  /** 空窗口：图表画一排 0 的坐标轴比「暂无数据」更难读，统一走空状态 */
  const noCalls = kpi.calls === 0;

  /* ---------- Token 构成的四段固定配色：同色系语义跨两张图保持一致 ---------- */
  const tokenColors: Record<string, string> = {
    输入: palette[0],
    输出: palette[1],
    缓存读: palette[5],
    缓存写: palette[3],
  };
  const withColors = (series: { name: string; data: number[] }[]) =>
    series.map((s) => ({ ...s, color: tokenColors[s.name] ?? palette[2] }));

  const shortModel = (n: string, max = 14) => (n.length > max ? `${n.slice(0, max)}…` : n);

  // 缓存命中率：调用数太少的模型不参与（1 次调用 100% 会抢眼）
  const hitRateData = data.models
    .filter((m) => m.calls >= 5 && m.cacheReadTokens > 0)
    .map((m) => ({ name: shortModel(m.model), value: Number(m.cacheHitRate.toFixed(1)) }))
    .sort((a, b) => b.value - a.value);
  const hitRateH = Math.min(Math.max(150, hitRateData.length * 26), 380);

  return (
    <div className={cn("flex flex-col gap-5 p-6 transition-opacity", loading && "opacity-60")}>
      <PageHeader
        title="LLM 看板"
        description={`模型维度的成本、性能与缓存效率（${data.range}）· 成本为相对权重折算的指数，非实际金额`}
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
          label="LLM 调用"
          value={formatNumber(kpi.calls)}
          sub={`${kpi.models} 个模型 · ${formatNumber(kpi.sessions)} 个会话`}
          trend={pctChange(kpi.calls, kpi.callsPrev)}
        />
        <KpiCard
          label="成本指数"
          value={formatNumber(Math.round(kpi.costIndex))}
          sub="相对权重折算，非实际金额"
          trend={pctChange(Math.round(kpi.costIndex), kpi.costIndexPrev)}
        />
        <KpiCard
          label="缓存命中率"
          value={`${kpi.cacheHitRate.toFixed(1)}%`}
          sub={`缓存读 ${formatTokens(kpi.cacheReadTokens)} · ${formatNumber(kpi.cacheReadPerCall)}/次`}
          subTone={kpi.cacheHitRate >= 80 ? "success" : "default"}
          trend={pctChange(kpi.cacheHitRate * 100, kpi.cacheHitRatePrev == null ? null : kpi.cacheHitRatePrev * 100)}
        />
        <KpiCard
          label="单次调用耗时 P50"
          value={kpi.durationSamples > 0 ? formatDuration(kpi.durationP50) : "—"}
          sub={
            noCalls
              ? "该时间段无调用"
              : kpi.timingUntrustedModels > 0
                ? `耗时可信 ${kpi.timingTrustedModels}/${kpi.models} 个模型`
                : "全部模型耗时可信"
          }
          subTone={kpi.timingUntrustedModels > 0 ? "warning" : "default"}
        />
      </div>

      {/* 耗时闸门说明：只在存在不可信模型时出现，避免长期噪音 */}
      {kpi.timingUntrustedModels > 0 ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-warning ring-1 ring-warning/25">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {kpi.timingUntrustedModels} 个模型的 duration 取值恒定（多为采集端占位值），
            已从耗时统计与排名中排除 —— 否则会得出「某模型快 9 倍」的错误结论。
            修复采集端上报后才能恢复。
          </span>
        </div>
      ) : null}

      {/* 2. 调用量趋势 + 3. Token 构成趋势 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>模型调用量趋势</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              Top {meta.topModelsInTrend} 模型 · 按调用数
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {noCalls || data.callTrend.labels.length === 0 ? (
              <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                该时间段暂无调用
              </p>
            ) : (
              <MultiLineTrendChart
                labels={data.callTrend.labels}
                series={data.callTrend.series}
                height={240}
                valueFormatter={(v) => formatNumber(v)}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Token 构成趋势</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">缓存读写分开统计</span>
          </CardHeader>
          <CardContent className="pt-4">
            {noCalls || data.tokenTrend.labels.length === 0 ? (
              <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                该时间段暂无数据
              </p>
            ) : (
              <StackedBarTrendChart
                labels={data.tokenTrend.labels}
                series={withColors(data.tokenTrend.series)}
                height={240}
                valueFormatter={(v) => formatTokens(v)}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4. 轮次曲线 + 5. 模型缓存命中率 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>按轮次的 Token 构成</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              横轴为第 N 轮 · 每次调用的平均值
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {data.roundCurve.labels.length === 0 ? (
              <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                该时间段暂无数据
              </p>
            ) : (
              <>
                <StackedBarTrendChart
                  labels={data.roundCurve.labels}
                  series={withColors(data.roundCurve.series)}
                  height={200}
                  valueFormatter={(v) => formatTokens(v)}
                />
                <p className="mt-1 px-1 text-[11px] leading-relaxed text-muted-foreground/80">
                  深轮次的成本几乎全在缓存读：上下文每累积一轮就被重新读一遍。
                  缓存读在某轮突然塌陷、输入同步上涨，说明上下文被重建（缓存失效）。
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>各模型缓存命中率</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">调用 ≥5 次的模型</span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: hitRateH }}>
            {hitRateData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段缓存数据不足
              </p>
            ) : (
              <FancyBarChartH
                data={hitRateData}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                ariaLabel="缓存命中率"
                yAxisInterval={0}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 6. 模型对比表 */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>模型对比</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            默认按成本指数排序 · 点击列头切换 · 点击模型进入相关 Session
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <ModelCompareTable rows={data.models} />
        </CardContent>
        <div className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
          {meta.costNote}。{meta.timingNote}。
        </div>
      </Card>

      {/* 7. 异常 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Token 突增</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              较前 7 日中位数 ≥{meta.spikeRatio}× 且当日 ≥{formatTokens(meta.spikeMinTokens)}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {data.spikes.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                该时间段未发现 Token 突增
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.spikes.slice(0, 8).map((s) => (
                  <li
                    key={`${s.model}-${s.date}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/trace?model=${encodeURIComponent(s.model)}`}
                        className="block truncate font-mono text-[13px] font-medium hover:text-primary"
                      >
                        {s.model}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {s.date} · {s.calls} 次调用 · 基准 {formatTokens(s.baseline)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[13px] tabular-nums">{formatTokens(s.tokens)}</p>
                      <p className="font-mono text-[11px] tabular-nums text-destructive">
                        {s.ratio}×
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>LLM 调用失败</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {kpi.failedCalls} 次失败 · 会话终态失败 {kpi.failedSessions}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {data.failedCalls.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                该时间段没有 LLM 调用失败记录
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.failedCalls.slice(0, 8).map((f) => (
                  <li key={f.spanId} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/trace/${f.sessionId}`}
                        className="min-w-0 truncate text-[13px] font-medium hover:text-primary"
                        title={f.sessionTitle || f.sessionId}
                      >
                        {f.sessionTitle || f.sessionId.slice(0, 8)}
                      </Link>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatRelativeTime(new Date(f.time).getTime())}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      <span className="font-mono">{f.model}</span> · {f.agentName}
                      {f.error ? ` · ${f.error}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 数据完整性提示：cache 字段在旧采集端缺失，命中率早期会偏低 */}
      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground/70">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        旧版采集端未上报缓存字段（cacheWrite 尤甚），早期的命中率与成本指数会偏低，
        跨月对比时请注意采集口径变化。
      </p>
    </div>
  );
}
