"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";
import { useChartColors, useCategoryPalette } from "@/lib/use-chart-colors";

/**
 * 横向条形图（升级版）：
 * - 每根柱子独立颜色：默认按分类色板顺序取色，也可由调用方通过 datum.color 指定
 *   （同一实体出现在多张图里时，需要显式指定才能保证两图同色）
 * - 条尾数值标注
 * - Y 轴只显示名称（不带 emoji）
 */
export function FancyBarChartH({
  data,
  valueFormatter,
  ariaLabel,
  yAxisInterval,
  xInteger,
  yAxisWidth = 160,
}: {
  data: { name: string; value: number; color?: string }[];
  valueFormatter: (v: number) => string;
  ariaLabel?: string;
  /**
   * Y 轴类目标签的显示间隔。recharts 默认自动抽稀，卡片较矮时会隔一个漏一个，
   * 看起来像"某几根柱子没有名字"。行数固定且不多时传 0 强制全显示。
   */
  yAxisInterval?: number;
  /**
   * X 轴只出整数刻度。计数类指标（如会话数）最大只有个位数时，
   * 自动分档会画出 0.75 / 1.5 这种刻度；且刻度与条尾标注共用同一个 formatter，
   * 四舍五入后会出现重复标签。
   */
  xInteger?: boolean;
  /**
   * Y 轴刻度区宽度。默认 160 适合短名（工具名/模型名）；
   * 类目名较长（如 Skill 名）时标签会从左侧被裁掉（实测 recharts 不省略而是溢出裁切），
   * 需要调用方放大并按需截断类目名。
   */
  yAxisWidth?: number;
}) {
  const colors = useChartColors();
  const palette = useCategoryPalette();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          allowDecimals={xInteger ? false : undefined}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={yAxisWidth}
          interval={yAxisInterval}
        />
        <Tooltip
          cursor={{ fill: colors.grid, opacity: 0.4 }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
          }}
          formatter={(value) => [valueFormatter(value as number), ariaLabel ?? "数值"]}
        />
        <Bar
          dataKey="value"
          radius={[0, 3, 3, 0]}
          barSize={14}
          fillOpacity={0.85}
        >
          {data.map((d, i) => (
            <Cell key={`${d.name}-${i}`} fill={d.color ?? palette[i % palette.length]} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => valueFormatter(Number(v))}
            style={{ fontSize: 11, fill: colors.text, fontWeight: 500 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
