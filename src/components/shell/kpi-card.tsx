import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * KPI 指标卡：大号 tabular-nums 数字 + 小标签，靠字号与留白建立层级。
 * 颜色只用于语义（趋势涨跌、异常状态），不做装饰。
 */
export function KpiCard({
  label,
  value,
  sub,
  subTone = "default",
  trend,
  className,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  /** sub 的语义色调 */
  subTone?: "default" | "success" | "warning" | "destructive";
  /** 环比趋势（与 sub 并排显示在底部） */
  trend?: { value: number; direction: "up" | "down" | "flat" };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group flex flex-col justify-between gap-3 rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
        className
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-gradient-brand text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {sub || trend ? (
        <div className="flex items-center justify-between gap-2">
          {sub ? (
            <p
              className={cn(
                "truncate text-xs",
                subTone === "success" && "text-success",
                subTone === "warning" && "text-warning",
                subTone === "destructive" && "text-destructive",
                subTone === "default" && "text-muted-foreground"
              )}
            >
              {sub}
            </p>
          ) : (
            <span />
          )}
          {trend && trend.direction !== "flat" ? (
            <span
              className={cn(
                "flex shrink-0 items-center gap-0.5 font-mono text-xs tabular-nums",
                trend.direction === "up" ? "text-success" : "text-destructive"
              )}
            >
              {trend.direction === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {trend.value.toFixed(1)}%
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
