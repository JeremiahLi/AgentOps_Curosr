"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, ShieldAlert } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatNumber, formatRelativeTime, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LlmModelRow } from "@/lib/engine/stats/llm-board";

type SortKey =
  | "model"
  | "calls"
  | "sessions"
  | "agents"
  | "avgTokensPerCall"
  | "avgCacheReadPerCall"
  | "cacheHitRate"
  | "costIndex"
  | "p50"
  | "failedCalls"
  | "lastUsedAt";

interface Column {
  key: SortKey;
  label: string;
  /** 列头 tooltip：口径说明 */
  hint?: string;
  align?: "left" | "right";
}

const COLUMNS: Column[] = [
  { key: "model", label: "模型", align: "left" },
  { key: "calls", label: "调用", hint: "llm_thinking span 数", align: "right" },
  { key: "sessions", label: "会话", hint: "使用该模型的会话数", align: "right" },
  { key: "agents", label: "Agent", hint: "使用该模型的 Agent 数", align: "right" },
  { key: "avgTokensPerCall", label: "Token/次", hint: "（输入+输出）/ 调用数，不含缓存", align: "right" },
  { key: "avgCacheReadPerCall", label: "缓存读/次", hint: "缓存读取量 / 调用数，缓存型成本的主因", align: "right" },
  { key: "cacheHitRate", label: "命中率", hint: "缓存读 /（输入 + 缓存读）", align: "right" },
  { key: "costIndex", label: "成本指数", hint: "相对权重折算，非实际金额", align: "right" },
  { key: "p50", label: "耗时 P50", hint: "仅统计耗时可信的模型", align: "right" },
  { key: "failedCalls", label: "失败", hint: "LLM 调用失败数 / 终态失败会话数", align: "right" },
  { key: "lastUsedAt", label: "最近使用", align: "right" },
];

function sortValue(row: LlmModelRow, key: SortKey): number | string | null {
  if (key === "model") return row.model;
  if (key === "lastUsedAt") return row.lastUsedAt;
  // 耗时不可信的模型，不参与耗时排序（排到末尾）
  if ((key === "p50") && !row.timingTrusted) return null;
  return row[key] as number | null;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

/**
 * 模型对比表：LLM 看板的核心区块。
 * 默认按成本指数降序 —— 直接回答「钱花在哪」，而不是按调用量把最忙的排最前。
 *
 * 耗时列有可信度闸门：采集端把 duration 写成占位值的模型（实测 5 个模型 100% = 1500ms）
 * 显示为「—」并给出原因，避免「谁更快」的结论被假数据带偏。
 */
export function ModelCompareTable({ rows }: { rows: LlmModelRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "costIndex",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv), "zh-CN");
      } else {
        cmp = av - bv;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, sort]);

  const toggle = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );

  if (rows.length === 0) {
    return (
      <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        该时间段暂无 LLM 调用
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1120px]">
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <TableHead
                  key={col.key}
                  className={cn(col.align === "right" && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    title={col.hint}
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px] font-medium tracking-wide transition-colors",
                      col.align === "right" && "flex-row-reverse",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {col.label}
                    {active ? (
                      sort.dir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : null}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.model} className="group hover:bg-muted/30">
              <TableCell className="whitespace-nowrap">
                <Link
                  href={`/trace?model=${encodeURIComponent(row.model)}`}
                  className="flex items-center gap-1"
                  title="查看使用了该模型的会话"
                >
                  <span className="max-w-[200px] truncate font-mono text-[13px] font-medium group-hover:text-primary">
                    {row.model}
                  </span>
                  {!row.timingTrusted ? (
                    <ShieldAlert
                      className="h-3 w-3 shrink-0 text-warning"
                      aria-label="耗时数据不可信"
                    />
                  ) : null}
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <span className="font-mono text-[13px] tabular-nums">{formatNumber(row.calls)}</span>
                <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                  {pct(row.callShare)}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                {row.sessions}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                {row.agents}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {formatTokens(row.avgTokensPerCall)}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {formatTokens(row.avgCacheReadPerCall)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono text-[13px] tabular-nums",
                  row.cacheHitRate >= 80
                    ? "text-success"
                    : row.cacheHitRate > 0
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50",
                )}
              >
                {row.avgTokensPerCall + row.avgCacheReadPerCall > 0 ? pct(row.cacheHitRate) : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <span className="font-mono text-[13px] tabular-nums">
                  {formatNumber(Math.round(row.costIndex))}
                </span>
                <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                  {pct(row.costShare)}
                </span>
              </TableCell>
              <TableCell
                className={cn(
                  "whitespace-nowrap text-right font-mono text-[13px] tabular-nums",
                  row.timingTrusted ? "text-muted-foreground" : "text-muted-foreground/40",
                )}
                title={
                  row.timingTrusted
                    ? `P90 ${formatDuration(row.p90)}`
                    : `耗时不可信：${row.calls} 次调用只有 ${row.distinctDurations} 种耗时取值，疑似采集端占位数据`
                }
              >
                {row.timingTrusted ? formatDuration(row.p50) : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-[13px] tabular-nums">
                {row.failedCalls > 0 ? (
                  <span className="text-destructive">{row.failedCalls}</span>
                ) : (
                  <span className="text-muted-foreground/40">0</span>
                )}
                <span className="ml-1 text-[11px] text-muted-foreground/70">
                  / {row.failedSessions}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right text-[12px] text-muted-foreground">
                {row.lastUsedAt ? formatRelativeTime(new Date(row.lastUsedAt).getTime()) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
