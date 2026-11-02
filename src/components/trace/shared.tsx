"use client";

import { cn } from "@/lib/utils";
import type { SpanKind, SpanStatus, AgentStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: "active" | "completed" | "error" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        status === "active" && "bg-success/10 text-success",
        status === "completed" && "bg-muted text-muted-foreground",
        status === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          status === "active" && "bg-success",
          status === "completed" && "bg-muted-foreground",
          status === "error" && "bg-destructive",
        )}
      />
      {status === "active" ? "活跃" : status === "completed" ? "完成" : "异常"}
    </span>
  );
}

/**
 * 会话终态徽章。
 *
 * 与 StatusBadge 的分工：StatusBadge 表达「会话生命周期」（活跃/完成/异常），
 * OutcomeBadge 表达「有没有交付」——partial 单列一档，避免把「过程中踩坑但最终
 * 出了成品」和「真没交付」混成同一个失败统计（实测 pi 的会话里两者占比 1:5）。
 * outcome 为空串表示历史数据未回填，退回按 status 展示。
 */
export function OutcomeBadge({ outcome, status }: { outcome: string; status: string }) {
  const kind: "running" | "success" | "partial" | "failed" | "unknown" =
    status === "active"
      ? "running"
      : outcome === "success"
        ? "success"
        : outcome === "partial"
          ? "partial"
          : outcome === "failed"
            ? "failed"
            : "unknown";

  const label = {
    running: "进行中",
    success: "成功",
    partial: "部分成功",
    failed: "失败",
    unknown: "完成",
  }[kind];

  return (
    <span
      title={
        kind === "partial"
          ? "最终交付了产物，但过程中出现过失败（工具重试 / 质检回流）"
          : kind === "failed"
            ? "末轮回答失败或没有产出内容"
            : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        kind === "running" && "bg-success/10 text-success",
        kind === "success" && "bg-success/10 text-success",
        kind === "partial" && "bg-warning/10 text-warning",
        kind === "failed" && "bg-destructive/10 text-destructive",
        kind === "unknown" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          kind === "running" && "bg-success",
          kind === "success" && "bg-success",
          kind === "partial" && "bg-warning",
          kind === "failed" && "bg-destructive",
          kind === "unknown" && "bg-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}

export function AgentStatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === "healthy" && "bg-success",
        status === "warning" && "bg-warning",
        status === "error" && "bg-destructive animate-pulse",
      )}
    />
  );
}

export function KindBadge({ kind }: { kind: SpanKind }) {
  const config: Record<SpanKind, { label: string; className: string }> = {
    user: { label: "USER", className: "bg-info/10 text-info" },
    llm_thinking: { label: "THINK", className: "bg-primary/10 text-primary" },
    tool_call: { label: "TOOL", className: "bg-success/10 text-success" },
    command: { label: "CMD", className: "bg-warning/10 text-warning" },
    answer: { label: "ANSWER", className: "bg-success/10 text-success" },
    error: { label: "ERROR", className: "bg-destructive/10 text-destructive" },
    system: { label: "SYS", className: "bg-muted text-muted-foreground" },
  };
  const c = config[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1 py-0.5 font-mono text-[10px] font-medium tracking-wide",
        c.className,
      )}
    >
      {c.label}
    </span>
  );
}

export function SpanStatusDot({ status }: { status: SpanStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "success" && "bg-success/60",
        status === "failed" && "bg-destructive",
        status === "running" && "bg-info animate-pulse",
      )}
    />
  );
}
