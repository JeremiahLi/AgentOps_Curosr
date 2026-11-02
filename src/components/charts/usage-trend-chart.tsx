"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useId } from "react";
import { useChartColors } from "@/lib/use-chart-colors";
import { formatNumber } from "@/lib/format";

export interface TrendPointDto {
  label: string;
  sessions: number;
  tokens: number;
  distinct: number;
}

/**
 * 使用趋势图：面积（使用次数，左轴）+ 折线（去重计数，右轴）。
 * - 用户视角：distinct = 使用的 Agent 数
 * - Agent 视角：distinct = 活跃用户数
 */
export function UsageTrendChart({
  data,
  secondaryName,
  height = 220,
}: {
  data: TrendPointDto[];
  secondaryName: string;
  height?: number;
}) {
  const colors = useChartColors();
  const uid = useId().replace(/[:]/g, "");
  const areaId = `trendArea-${uid}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          yAxisId="left"
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={44}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={32}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="sessions"
          name="使用次数"
          stroke="var(--primary)"
          strokeWidth={1.5}
          fill={`url(#${areaId})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="distinct"
          name={secondaryName}
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function formatTrendTooltip(v: number | string): string {
  return formatNumber(Number(v));
}
