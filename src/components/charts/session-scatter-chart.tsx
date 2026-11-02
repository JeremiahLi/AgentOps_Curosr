"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartColors, useOutcomePalette, normalizeOutcome, type OutcomeKey } from "@/lib/use-chart-colors";
import { formatDuration, formatTokens } from "@/lib/format";
import type { SessionScatterPoint } from "@/lib/engine/stats/session-board";

/**
 * Session 成本 × 耗时散点。
 *
 * 为什么值得单独做一张：成本（Token）、时延（耗时）、质量（终态）三个维度在同一屏内可见，
 * 右上角 = 又贵又慢，是运维最先要看的地方。失败点如果聚在右上角，说明失败与长任务相关，
 * 而不是随机抖动。
 *
 * 两个必须处理的坑：
 * - 对数轴遇 0 会算出 NaN 并让整张图空白 → 数据侧已过滤 x/y > 0，这里再兜底 domain 下限。
 * - 点数过多时 hover 掉帧 → 数据侧限 600 点（异常点全保留）。
 */

interface DotProps {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: SessionScatterPoint;
  onSelect?: (id: string) => void;
}

function ScatterDot({ cx, cy, fill, payload, onSelect }: DotProps) {
  if (cx == null || cy == null || !payload) return null;
  // score >= 2 才画外圈：1 项超线在 8 指标下太常见，全员加圈等于没有强调
  const flagged = payload.score >= 2;
  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(payload.id);
      }}
    >
      {/* 放大点击热区：点本身只有 3px，直接点很难命中 */}
      <circle cx={cx} cy={cy} r={9} fill="transparent" />
      {flagged && (
        <circle cx={cx} cy={cy} r={7} fill="none" stroke={fill} strokeOpacity={0.45} strokeWidth={1.5} />
      )}
      <circle cx={cx} cy={cy} r={flagged ? 4 : 2.8} fill={fill} fillOpacity={flagged ? 0.95 : 0.62} />
    </g>
  );
}

const SERIES: { key: OutcomeKey; label: string }[] = [
  { key: "success", label: "成功" },
  { key: "partial", label: "部分成功" },
  { key: "failed", label: "失败" },
];

/**
 * 对数轴的手工刻度：recharts 在 log 模式下自动刻度只会吐出 2~3 个标签，
 * 横轴看起来像坏掉了。这里按 1/2/5 十进制序列生成候选值，再按实际数据域裁剪。
 */
function logTicks(values: number[], candidates: number[]): number[] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  const hit = candidates.filter((v) => v >= min * 0.9 && v <= max * 1.1);
  return hit.length >= 2 ? hit : [];
}

const TOKEN_TICKS = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7];
const DURATION_TICKS = [
  1e3, 2e3, 5e3, 1e4, 3e4, 6e4, 1.8e5, 3e5, 6e5, 1.2e6, 1.8e6, 3.6e6, 7.2e6,
];

export function SessionScatterChart({
  points,
  height = 320,
  onSelect,
}: {
  points: SessionScatterPoint[];
  height?: number;
  onSelect?: (id: string) => void;
}) {
  const colors = useChartColors();
  const palette = useOutcomePalette();
  const xTicks = useMemo(() => logTicks(points.map((p) => p.x), TOKEN_TICKS), [points]);
  const yTicks = useMemo(() => logTicks(points.map((p) => p.y), DURATION_TICKS), [points]);

  // 对数域两端留冗余：贴着数据 min/max 取域时，最边缘的点会被 plot 区裁掉一半。
  // 乘性系数在对数轴上等价于"留出固定比例的视觉空间"，右侧/上方各多留一点。
  const xDomain = useMemo<[number, number] | undefined>(() => {
    const xs = points.map((p) => p.x).filter((v) => v > 0);
    if (xs.length === 0) return undefined;
    return [Math.min(...xs) / 1.5, Math.max(...xs) * 1.5];
  }, [points]);
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const ys = points.map((p) => p.y).filter((v) => v > 0);
    if (ys.length === 0) return undefined;
    return [Math.min(...ys) / 1.4, Math.max(...ys) * 2];
  }, [points]);

  const grouped = SERIES.map((s) => ({
    ...s,
    data: points.filter((p) => normalizeOutcome(p.outcome) === s.key),
  })).filter((s) => s.data.length > 0);

  const unknown = points.filter((p) => normalizeOutcome(p.outcome) === "unknown");

  return (
    <div className="relative">
      {/* 纵轴说明：旋转 90° 贴在刻度左侧（recharts 自带 label 的定位在不同 margin 下不稳，手工摆） */}
      <span className="pointer-events-none absolute left-1 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[11px] text-muted-foreground">
        端到端耗时（对数）
      </span>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 4, right: 24, bottom: 4, left: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
          <XAxis
            type="number"
            dataKey="x"
            scale="log"
            domain={xDomain ?? ["auto", "auto"]}
          ticks={xTicks.length > 0 ? xTicks : undefined}
          allowDataOverflow
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatTokens(Number(v))}
        />
        <YAxis
          type="number"
          dataKey="y"
          scale="log"
          domain={yDomain ?? ["auto", "auto"]}
          ticks={yTicks.length > 0 ? yTicks : undefined}
          allowDataOverflow
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={58}
          tickFormatter={(v) => formatDuration(Number(v))}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: colors.grid }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
            maxWidth: 280,
          }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as SessionScatterPoint;
            return (
              <div className="space-y-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
                <p className="max-w-[240px] truncate font-medium text-foreground">
                  {p.title || "（无标题）"}
                </p>
                <p className="text-muted-foreground">{p.agentName}</p>
                <p className="font-mono tabular-nums text-muted-foreground">
                  {formatTokens(p.x)} tok · {formatDuration(p.y)}
                </p>
                {p.score >= 2 ? (
                  <p className="text-warning">
                    {p.score} 项超 P90 · 最高 {p.ratio.toFixed(1)}×
                  </p>
                ) : null}
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={22}
          wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
        />
        {grouped.map((s) => (
          <Scatter
            key={s.key}
            name={`${s.label}（${s.data.length}）`}
            data={s.data}
            fill={palette[s.key]}
            shape={<ScatterDot onSelect={onSelect} />}
            isAnimationActive={false}
          />
        ))}
        {unknown.length > 0 && (
          <Scatter
            name={`未知（${unknown.length}）`}
            data={unknown}
            fill={palette.unknown}
            shape={<ScatterDot onSelect={onSelect} />}
            isAnimationActive={false}
          />
        )}
        </ScatterChart>
      </ResponsiveContainer>
      {/* 横轴说明：放在刻度下方居中 */}
      <p className="mt-1 text-center text-[11px] text-muted-foreground">可计费 Token（对数）</p>
    </div>
  );
}
