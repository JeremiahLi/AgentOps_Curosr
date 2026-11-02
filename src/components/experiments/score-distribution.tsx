"use client";

/**
 * 分数分布直方图（纯 CSS，无图表库依赖）：
 * 按 0-59 / 60-69 / 70-79 / 80-89 / 90-100 五档统计，
 * 均值掩盖的"失败聚集"在这里一眼可见。
 */

const BUCKETS: { label: string; min: number; max: number; bar: string }[] = [
  { label: "<60", min: 0, max: 60, bar: "bg-destructive/70" },
  { label: "60-69", min: 60, max: 70, bar: "bg-warning/70" },
  { label: "70-79", min: 70, max: 80, bar: "bg-warning/40" },
  { label: "80-89", min: 80, max: 90, bar: "bg-success/40" },
  { label: "90+", min: 90, max: 101, bar: "bg-success/70" },
];

function bucketOf(score: number): number {
  const i = BUCKETS.findIndex((b) => score >= b.min && score < b.max);
  return i === -1 ? BUCKETS.length - 1 : i;
}

export function ScoreHistogram({ scores }: { scores: number[] }) {
  const counts = BUCKETS.map((b) => scores.filter((s) => s >= b.min && s < b.max).length);
  const max = Math.max(...counts, 1);

  return (
    <div className="flex h-20 items-end gap-1.5">
      {counts.map((count, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span
            className={`text-[10px] tabular-nums ${
              count > 0 ? "text-muted-foreground" : "text-muted-foreground/30"
            }`}
          >
            {count}
          </span>
          <div
            className={`w-full rounded-t-sm ${count > 0 ? BUCKETS[i].bar : "bg-muted/40"}`}
            style={{ height: count > 0 ? `${Math.max((count / max) * 100, 8)}%` : "3px" }}
          />
          <span className="text-[10px] leading-none text-muted-foreground">{BUCKETS[i].label}</span>
        </div>
      ))}
    </div>
  );
}
