"use client";

import { RefreshCw, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProcessAnomaly } from "@/components/shell/process-anomaly";

/**
 * 全局状态条：极简。左侧服务健康点，右侧刷新。
 * 铃铛在会话详情页开关「过程异常」；有异常时右上角留红点。
 */
export function AppTopbar() {
  const { panel, toggle } = useProcessAnomaly();
  const onSession = panel !== null;
  const anomalyOpen = panel?.open ?? false;
  const showDot = onSession ? panel.hasAnomaly : true;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-background/60 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        <span className="tabular-nums">系统正常</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={onSession ? anomalyOpen : undefined}
          aria-controls={onSession ? "process-anomaly-panel" : undefined}
          title={onSession ? (anomalyOpen ? "收起过程异常" : "展开过程异常") : "通知"}
          onClick={() => {
            if (onSession) toggle();
          }}
          className={cn(
            "relative h-8 w-8 text-muted-foreground hover:text-foreground",
            anomalyOpen && "bg-muted text-foreground",
          )}
        >
          <Bell className="h-3.5 w-3.5" />
          {showDot && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          )}
        </Button>
      </div>
    </header>
  );
}
