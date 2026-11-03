"use client";

import { useEffect, useRef } from "react";
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
  Text,
} from "recharts";
import type { YAxisTickContentProps } from "recharts";
import { useChartColors, useCategoryPalette } from "@/lib/use-chart-colors";

export type FancyBarDatum = {
  /** Y 轴上显示的名字（可以是截断后的） */
  name: string;
  value: number;
  color?: string;
  /**
   * 稳定标识。同一实体出现在多张图里时用它做联动高亮和点击跳转，
   * 避免截断后的 name 撞车。不用 id：数据会被铺到 SVG 上，重复 id 不合法。
   * 缺省退回 name。
   */
  agentKey?: string;
};

function datumId(d: FancyBarDatum): string {
  return d.agentKey ?? d.name;
}

/**
 * 横向条形图（升级版）：
 * - 每根柱子独立颜色：默认按分类色板顺序取色，也可由调用方通过 datum.color 指定
 *   （同一实体出现在多张图里时，需要显式指定才能保证两图同色）
 * - 条尾数值标注
 * - Y 轴只显示名称（不带 emoji）
 * - 可选：按 id 联动高亮、点击柱子或名称
 */
export function FancyBarChartH({
  data,
  valueFormatter,
  ariaLabel,
  yAxisInterval,
  xInteger,
  yAxisWidth = 160,
  activeId = null,
  onActiveIdChange,
  onBarClick,
}: {
  data: FancyBarDatum[];
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
  /** 当前高亮的 datum id。由外部持有，才能让两张图同时亮起同名柱。 */
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  /** 点击柱子或 Y 轴名称时回调。传入后柱子与名称显示为可点击。 */
  onBarClick?: (item: FancyBarDatum) => void;
}) {
  const colors = useChartColors();
  const palette = useCategoryPalette();
  const interactive = Boolean(onActiveIdChange || onBarClick);
  const hasActive = activeId != null && data.some((d) => datumId(d) === activeId);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  // 柱子和轴标签之间有空隙，直接 onMouseLeave 会闪一下。
  // 离开后稍等，若马上又进入同一行（或另一行）则取消清除。
  const hover = (id: string | null) => {
    if (!onActiveIdChange) return;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (id == null) {
      leaveTimer.current = setTimeout(() => onActiveIdChange(null), 70);
      return;
    }
    onActiveIdChange(id);
  };

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
          tick={
            interactive
              ? (props: YAxisTickContentProps) => {
                  const item = data[props.index];
                  const id = item ? datumId(item) : String(props.payload?.value ?? "");
                  const hot = hasActive && id === activeId;
                  const dim = hasActive && !hot;
                  return (
                    <Text
                      x={props.x}
                      y={props.y}
                      textAnchor={props.textAnchor}
                      verticalAnchor={props.verticalAnchor}
                      fill={props.fill ?? colors.text}
                      fontSize={12}
                      fontWeight={hot ? 600 : 400}
                      style={{
                        cursor: onBarClick && item ? "pointer" : undefined,
                        opacity: dim ? 0.38 : 1,
                      }}
                      onMouseEnter={() => item && hover(datumId(item))}
                      onMouseLeave={() => hover(null)}
                      onClick={() => item && onBarClick?.(item)}
                    >
                      {String(props.payload?.value ?? "")}
                    </Text>
                  );
                }
              : { fontSize: 12, fill: colors.text }
          }
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
          minPointSize={onBarClick ? 4 : undefined}
          background={interactive ? { fill: "transparent", cursor: onBarClick ? "pointer" : undefined } : false}
          onMouseEnter={(bar) => {
            const datum = bar?.payload as FancyBarDatum | undefined;
            if (datum) hover(datumId(datum));
          }}
          onMouseLeave={() => hover(null)}
          onClick={(bar) => {
            const datum = bar?.payload as FancyBarDatum | undefined;
            if (datum) onBarClick?.(datum);
          }}
        >
          {data.map((d, i) => {
            const id = datumId(d);
            const hot = hasActive && id === activeId;
            const dim = hasActive && !hot;
            return (
              <Cell
                key={`${id}-${i}`}
                fill={d.color ?? palette[i % palette.length]}
                fillOpacity={hot ? 1 : dim ? 0.22 : undefined}
                cursor={onBarClick ? "pointer" : undefined}
                style={{ transition: "fill-opacity 120ms ease" }}
              />
            );
          })}
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
