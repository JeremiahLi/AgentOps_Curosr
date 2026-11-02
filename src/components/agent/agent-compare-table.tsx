"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sparkline } from "@/components/charts/sparkline";
import { HealthBadge, HealthBars } from "@/components/agent/health-badge";
import { formatDuration, formatTokens, rateColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentBoardRow } from "@/lib/engine/stats/agent-board";

type SortKey =
  | "name"
  | "sessions"
  | "users"
  | "successRate"
  | "spanFailRate"
  | "totalTokens"
  | "tokensPerRound"
  | "avgDuration"
  | "p95Duration"
  | "health"
  | "activeDays";

interface Column {
  key: SortKey;
  label: string;
  /** 副标题，用于标注口径 */
  hint?: string;
  align?: "left" | "right";
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Agent", align: "left" },
  { key: "sessions", label: "会话", align: "right" },
  { key: "users", label: "用户", align: "right" },
  { key: "successRate", label: "成功率", hint: "失败会话 = 有失败 span", align: "right" },
  { key: "spanFailRate", label: "Span 失败率", hint: "失败 span / 全部 span", align: "right" },
  { key: "totalTokens", label: "Token", align: "right" },
  { key: "tokensPerRound", label: "Token/轮", hint: "输入+输出，不含缓存", align: "right" },
  { key: "avgDuration", label: "平均耗时", hint: "会话端到端", align: "right" },
  { key: "p95Duration", label: "P95 耗时", hint: "样本 <10 不显示", align: "right" },
  { key: "activeDays", label: "活跃天", align: "right" },
  { key: "health", label: "健康分", hint: "近 30 天四维加权", align: "right" },
];

function sortValue(row: AgentBoardRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name;
    case "health":
      return row.health.total;
    default:
      return row[key] as number | null;
  }
}

/** P95 样本不足时不显示具体数字：essence 是「第二大那个值」，显示有误导性 */
function p95Display(row: AgentBoardRow): { text: string; title: string } {
  if (row.p95Duration <= 0) return { text: "—", title: "无有效耗时样本" };
  if (row.p95SampleCount < 10) {
    return { text: "—", title: `样本仅 ${row.p95SampleCount} 个（<10），P95 无统计意义` };
  }
  const value = formatDuration(row.p95Duration);
  if (row.p95SampleCount < 30) {
    return { text: `~${value}`, title: `样本 ${row.p95SampleCount} 个（<30），数值波动较大` };
  }
  return { text: value, title: `样本 ${row.p95SampleCount} 个` };
}

function Delta({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev == null) return <span className="text-[11px] text-muted-foreground/50">—</span>;
  if (prev === 0) return <span className="text-[11px] text-success">新增</span>;
  const diff = ((cur - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return <span className="text-[11px] text-muted-foreground">持平</span>;
  return (
    <span
      className={cn(
        "font-mono text-[11px] tabular-nums",
        diff > 0 ? "text-success" : "text-destructive",
      )}
    >
      {diff > 0 ? "+" : "-"}
      {Math.abs(Math.round(diff))}%
    </span>
  );
}

/**
 * Agent 对比矩阵：横向视角的核心区块。
 * 一行一个 Agent，列头可排序；健康分列内置四维迷你条与 30 天走势。
 */
export function AgentCompareTable({
  rows,
}: {
  rows: AgentBoardRow[];
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "sessions",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      // null 值固定排在末尾，不受升降序影响
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
        该时间段暂无数据
      </p>
    );
  }

  return (
    <Table className="min-w-[1080px]">
      <TableHeader>
        <TableRow>
          {COLUMNS.map((col) => {
            const active = sort.key === col.key;
            return (
              <TableHead
                key={col.key}
                className={cn(col.align === "right" && "text-right", col.className)}
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
          <TableHead className="text-right text-[11px] font-medium tracking-wide text-muted-foreground">
            30 天走势
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => {
          const p95 = p95Display(row);
          const idle = row.sessions === 0;
          return (
            <TableRow key={row.id} className={cn("group hover:bg-muted/30", idle && "opacity-60")}>
              <TableCell className="whitespace-nowrap">
                <Link
                  href={`/agent-board/${encodeURIComponent(row.name)}`}
                  className="flex items-center gap-1.5"
                >
                  <span className="text-sm">{row.emoji}</span>
                  <span className="max-w-[180px] truncate text-[13px] font-medium group-hover:text-primary">
                    {row.name}
                  </span>
                  <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                    v{row.version}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <span className="font-mono text-[13px] tabular-nums">{row.sessions}</span>
                <span className="ml-1.5 inline-block">
                  <Delta cur={row.sessions} prev={row.prevSessions} />
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {row.users}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono text-[13px] tabular-nums",
                  rateColor(row.successRate),
                )}
              >
                {row.successRate == null ? "—" : `${row.successRate.toFixed(1)}%`}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono text-[13px] tabular-nums",
                  row.spanFailRate == null
                    ? "text-muted-foreground"
                    : row.spanFailRate > 5
                      ? "text-destructive"
                      : row.spanFailRate > 2
                        ? "text-warning"
                        : "text-muted-foreground",
                )}
              >
                {row.spanFailRate == null ? "—" : `${row.spanFailRate.toFixed(1)}%`}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums">
                {formatTokens(row.totalTokens)}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                {row.tokensPerRound > 0 ? formatTokens(row.tokensPerRound) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                {row.avgDuration > 0 ? formatDuration(row.avgDuration) : "—"}
              </TableCell>
              <TableCell
                className="text-right font-mono text-[13px] tabular-nums text-muted-foreground"
                title={p95.title}
              >
                {p95.text}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                {row.activeDays}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <HealthBars dims={row.health.dims} />
                  <HealthBadge total={row.health.total} grade={row.health.grade} />
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end">
                  <Sparkline data={row.daily} width={64} height={20} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
