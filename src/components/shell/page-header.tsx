import { cn } from "@/lib/utils";

/**
 * 统一页面头部：去掉装饰性图标芯片，靠字号/字重建立层级。
 * 标题 20px semibold + 紧字距；描述 13px 次要色；右侧为操作区（时间范围切换等）。
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 分段式时间范围切换（今日 / 近7天 / 30d ...），供 PageHeader actions 使用 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            value === opt.value
              ? "h-6 rounded-[5px] bg-background px-2.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-foreground/10"
              : "h-6 rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
