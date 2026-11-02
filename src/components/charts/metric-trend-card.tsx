"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import type { MetricAccent } from "@/lib/use-chart-colors";

/**
 * 趋势图卡片外壳。
 *
 * 设计前提：颜色标识「这是哪个指标」，而不是「这是卡里哪条序列」。
 * 所以每张卡有一个专属色相 + 图标，卡内多序列靠同色族梯度 / 线型 / 语义红区分。
 * 序列与颜色的对应关系交给图例，不再写成「（蓝）（红，堆叠）」这种文字翻译。
 */

export type LegendKind = "line" | "line-dashed" | "bar" | "area";

export interface LegendItem {
  label: string;
  color: string;
  kind: LegendKind;
  /** 与图内 fillOpacity 对齐，保持图例色块和柱子明度一致 */
  opacity?: number;
}

function LegendSwatch({ kind, color, opacity }: { kind: LegendKind; color: string; opacity?: number }) {
  if (kind === "bar") {
    return <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color, opacity }} />;
  }
  if (kind === "line-dashed") {
    return <span className="w-2.5 border-t border-dashed" style={{ borderColor: color, opacity }} />;
  }
  if (kind === "area") {
    return (
      <span className="relative inline-flex h-2.5 w-3 items-end">
        <span className="absolute inset-x-0 top-0 h-[2px] rounded-full" style={{ backgroundColor: color }} />
        <span
          className="absolute inset-x-0 bottom-0 h-1.5 rounded-[2px]"
          style={{ backgroundColor: color, opacity: 0.18 }}
        />
      </span>
    );
  }
  return <span className="h-[2px] w-2.5 rounded-full" style={{ backgroundColor: color, opacity }} />;
}

export function TrendLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mb-1.5 flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <LegendSwatch kind={item.kind} color={item.color} opacity={item.opacity} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** 柱状渐变填充：上端实、下端淡，制造体量感 */
export function BarGradient({
  id,
  color,
  from = 0.95,
  to = 0.55,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={from} />
        <stop offset="100%" stopColor={color} stopOpacity={to} />
      </linearGradient>
    </defs>
  );
}

export function MetricTrendCard({
  title,
  caliber,
  unit,
  icon: Icon,
  accent,
  legend,
  anchor,
  trend,
  height = 220,
  children,
}: {
  title: string;
  /** 统计口径，一句话，不再描述颜色 */
  caliber: string;
  /** 量纲，拼在口径尾部 */
  unit: string;
  icon: LucideIcon;
  accent: MetricAccent;
  legend: LegendItem[];
  anchor?: ReactNode;
  trend?: ReactNode;
  height?: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px]"
              style={{ backgroundColor: accent.tint }}
            >
              <Icon className="h-[15px] w-[15px]" style={{ color: accent.ink }} aria-hidden />
            </span>
            <CardTitle className="truncate">{title}</CardTitle>
          </div>
          <div className="flex flex-none items-baseline gap-1.5 text-muted-foreground">
            {anchor}
            {trend}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          {caliber} · 单位 {unit}
        </p>
        <div className="mt-2">
          <TrendLegend items={legend} />
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
