import { cn } from "@/lib/utils";
import type { HealthGrade } from "@/lib/engine/stats/health";

/**
 * 健康等级徽章：A/B/C/D + 分数。
 * 无评分（窗口内无会话）时显示「未使用」，不打 D —— 「没在用」不是「不健康」。
 */
export function HealthBadge({
  total,
  grade,
  size = "sm",
  className,
}: {
  total: number | null;
  grade: HealthGrade | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone =
    grade === "A"
      ? "bg-success/10 text-success"
      : grade === "B"
        ? "bg-info/10 text-info"
        : grade === "C"
          ? "bg-warning/10 text-warning"
          : grade === "D"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono font-medium tabular-nums",
        size === "sm" ? "text-[11px]" : "text-xs",
        tone,
        className,
      )}
    >
      {grade == null ? (
        "未使用"
      ) : (
        <>
          <span className="font-semibold">{grade}</span>
          <span className="opacity-70">{total}</span>
        </>
      )}
    </span>
  );
}

/** 四维迷你条：一列 2px 高的小条，用于表格里的健康列 */
export function HealthBars({
  dims,
  className,
}: {
  dims: { key: string; score: number | null }[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)} aria-hidden="true">
      {dims.map((d) => (
        <span key={d.key} className="h-[3px] w-4 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full",
              d.score == null
                ? "bg-muted"
                : d.score >= 85
                  ? "bg-success"
                  : d.score >= 70
                    ? "bg-info"
                    : d.score >= 55
                      ? "bg-warning"
                      : "bg-destructive",
            )}
            style={{ width: `${d.score ?? 0}%` }}
          />
        </span>
      ))}
    </div>
  );
}
