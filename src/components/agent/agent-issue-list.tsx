"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentIssue, IssueSeverity } from "@/lib/engine/stats/agent-detail";

const SEVERITY_META: Record<IssueSeverity, { label: string; bar: string; text: string; badge: string }> = {
  critical: {
    label: "严重",
    bar: "bg-destructive",
    text: "text-destructive",
    badge: "bg-destructive/10 text-destructive",
  },
  warning: {
    label: "关注",
    bar: "bg-warning",
    text: "text-warning",
    badge: "bg-warning/10 text-warning",
  },
  info: {
    label: "提示",
    bar: "bg-info",
    text: "text-info",
    badge: "bg-info/10 text-info",
  },
};

const KIND_LABEL: Record<string, string> = {
  tool_failure: "工具失败",
  error_cluster: "重复错误",
  slow_span: "慢调用",
  decline: "使用衰退",
  idle: "零使用",
  data_quality: "数据质量",
};

/**
 * 问题列表：问题 → 证据 → 建议 → 链路深链。
 * 默认只展开前 3 条，避免一屏全是红色警告把真正严重的淹掉。
 */
export function AgentIssueList({ issues }: { issues: AgentIssue[] }) {
  const [expanded, setExpanded] = useState(false);

  if (issues.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        未发现明显问题
      </div>
    );
  }

  const visible = expanded ? issues : issues.slice(0, 3);
  const hiddenCount = issues.length - visible.length;

  return (
    <div>
      <ul className="space-y-2">
        {visible.map((issue) => {
          const meta = SEVERITY_META[issue.severity];
          return (
            <li
              key={issue.id}
              className="relative flex gap-3 rounded-lg bg-muted/30 py-2.5 pl-3 pr-3 ring-1 ring-foreground/[0.04]"
            >
              <span className={cn("absolute left-0 top-2 bottom-2 w-[3px] rounded-full", meta.bar)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-sm px-1 py-px text-[10px] font-medium", meta.badge)}>
                    {meta.label}
                  </span>
                  <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                    {KIND_LABEL[issue.kind] ?? issue.kind}
                  </span>
                  <span className="text-[13px] font-medium leading-snug">{issue.title}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {issue.evidence.map((e, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                      <span className="min-w-0 break-words">{e}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/70">
                  建议：{issue.suggestion}
                </p>
                {issue.links.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {issue.links.map((l) => (
                      <Link
                        key={`${issue.id}-${l.sessionId}-${l.spanId ?? l.label}`}
                        href={
                          l.spanId
                            ? `/trace/${l.sessionId}?spanId=${encodeURIComponent(l.spanId)}`
                            : `/trace/${l.sessionId}`
                        }
                        className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                      >
                        {l.label}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {issues.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "收起" : `还有 ${hiddenCount} 条`}
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
