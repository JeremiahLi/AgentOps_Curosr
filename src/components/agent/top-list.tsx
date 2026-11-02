import { cn } from "@/lib/utils";
import type { AgentTopItem } from "@/lib/engine/stats/agent-detail";

/**
 * 通用 Top N 榜：工具 / 用户 / 项目 / 模型四处复用。
 * 横向条形用相对宽度表达占比，不引图表库（列表形态比柱状图更适合窄卡）。
 */
export function TopList({
  items,
  valueFormatter,
  emptyText = "暂无数据",
  showFailRate = false,
}: {
  items: AgentTopItem[];
  valueFormatter?: (v: number) => string;
  emptyText?: string;
  /** 工具榜专用：展示失败率，超过 10% 标红（与问题列表同一阈值） */
  showFailRate?: boolean;
}) {
  if (items.length === 0) {
    return <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);
  const fmt = valueFormatter ?? ((v: number) => String(v));

  return (
    <ul className="space-y-1.5">
      {items.map((item, idx) => {
        const failRate = item.failRate ?? 0;
        return (
          <li key={`${item.name}-${idx}`} className="group">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="min-w-0 truncate">
                <span className="mr-1.5 font-mono text-[10px] text-muted-foreground/60">{idx + 1}</span>
                {item.name}
                {item.sub ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground/70">{item.sub}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {fmt(item.value)}
                {showFailRate && item.failed != null && item.failed > 0 ? (
                  <span
                    className={cn(
                      "ml-1.5 text-[10px]",
                      failRate >= 10 ? "text-destructive" : "text-warning",
                    )}
                  >
                    ✕{item.failed}（{failRate.toFixed(0)}%）
                  </span>
                ) : null}
              </span>
            </div>
            <span className="mt-0.5 block h-[3px] overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/45 transition-all group-hover:bg-primary/70"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
