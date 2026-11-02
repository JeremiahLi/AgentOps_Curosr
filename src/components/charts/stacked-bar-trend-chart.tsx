"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartColors, useCategoryPalette } from "@/lib/use-chart-colors";

export interface StackedSeries {
  name: string;
  data: number[];
  /** 不传则按分类色板取色 */
  color?: string;
}

/**
 * 堆叠柱趋势图：用于「成功 / 失败会话」这类构成关系。
 * 与 MultiLineTrendChart 互补：折线看趋势，堆叠柱看构成与总量。
 */
export function StackedBarTrendChart({
  labels,
  series,
  height = 220,
  valueFormatter,
}: {
  labels: string[];
  series: StackedSeries[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const colors = useChartColors();
  const palette = useCategoryPalette();

  const rows = labels.map((label, i) => {
    const row: Record<string, number | string> = { label };
    for (const s of series) row[s.name] = s.data[i] ?? 0;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={44}
          allowDecimals={false}
          tickFormatter={valueFormatter}
        />
        <Tooltip
          cursor={{ fill: colors.grid, opacity: 0.35 }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
          }}
          formatter={valueFormatter ? (v) => valueFormatter(Number(v)) : undefined}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            stackId="stack"
            fill={s.color ?? palette[i % palette.length]}
            fillOpacity={0.85}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
