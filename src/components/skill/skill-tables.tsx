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
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SkillRow, ToolRow } from "@/lib/engine/stats/skill-tool-board";

/* ------------------------------ 通用列头 ------------------------------ */

interface Column<K extends string> {
  key: K;
  label: string;
  /** 列头 tooltip：口径说明 */
  hint?: string;
  align?: "left" | "right";
}

function SortableHead<K extends string>({
  col,
  sort,
  onToggle,
}: {
  col: Column<K>;
  sort: { key: K; dir: "asc" | "desc" };
  onToggle: (key: K) => void;
}) {
  const active = sort.key === col.key;
  return (
    <TableHead className={cn(col.align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onToggle(col.key)}
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
}

function useSort<K extends string>(initial: { key: K; dir: "asc" | "desc" }) {
  const [sort, setSort] = useState(initial);
  const toggle = (key: K) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  return { sort, toggle };
}

function sortRows<T, K extends string>(
  rows: T[],
  sort: { key: K; dir: "asc" | "desc" },
  valueOf: (row: T, key: K) => number | string | null,
): T[] {
  const list = [...rows];
  list.sort((a, b) => {
    const av = valueOf(a, sort.key);
    const bv = valueOf(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === "string" || typeof bv === "string"
        ? String(av).localeCompare(String(bv), "zh-CN")
        : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return list;
}

/* ------------------------------- 工具表 ------------------------------- */

type ToolSortKey =
  | "name"
  | "calls"
  | "failRate"
  | "failed"
  | "p50"
  | "sessions"
  | "agents"
  | "lastUsedAt";

const TOOL_COLUMNS: Column<ToolSortKey>[] = [
  { key: "name", label: "工具", align: "left" },
  { key: "calls", label: "调用", hint: "tool_call span 数（skill 通道已排除；两代命名已归一）", align: "right" },
  { key: "failed", label: "失败", hint: "status 为 failed/error 的 span 数", align: "right" },
  { key: "failRate", label: "失败率", hint: "失败 / 调用", align: "right" },
  { key: "p50", label: "耗时 P50", hint: "仅统计耗时可信的工具；占位耗时显示为 —", align: "right" },
  { key: "sessions", label: "会话", hint: "使用该工具的会话数", align: "right" },
  { key: "agents", label: "Agent", hint: "使用该工具的 Agent 数", align: "right" },
  { key: "lastUsedAt", label: "最近使用", align: "right" },
];

function toolSortValue(row: ToolRow, key: ToolSortKey): number | string | null {
  if (key === "name") return row.name;
  if (key === "lastUsedAt") return row.lastUsedAt;
  // 耗时不可信的工具不参与耗时排序（排到末尾），避免「恒定 800ms」抢榜首
  if (key === "p50") return row.timingTrusted ? row.p50 : null;
  return row[key] as number;
}

/**
 * 工具表：Tool 区的定位入口。
 * 默认按调用量排序（先看谁在被用），失败率/耗时列可点列头切换 —— 失败率排序时
 * 小样本（1/1 = 100%）会浮到前面，所以失败率列同时显示失败绝对数，避免误读。
 */
export function ToolTable({
  rows,
  criticalFailRate,
  criticalFailCount,
}: {
  rows: ToolRow[];
  criticalFailRate: number;
  criticalFailCount: number;
}) {
  const { sort, toggle } = useSort<ToolSortKey>({ key: "calls", dir: "desc" });
  const sorted = useMemo(() => sortRows(rows, sort, toolSortValue), [rows, sort]);

  if (rows.length === 0) {
    return (
      <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        该时间段没有工具调用记录
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[980px]">
        <TableHeader>
          <TableRow>
            {TOOL_COLUMNS.map((col) => (
              <SortableHead key={col.key} col={col} sort={sort} onToggle={toggle} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const critical = row.failed >= criticalFailCount && row.failRate >= criticalFailRate;
            // 归一前后名字不同，或有占位耗时的变体，需要让用户知道数字是怎么拼出来的
            const merged = row.variants.length > 1;
            const placeholders = row.variants.filter((v) => v.placeholder);
            return (
              <TableRow key={row.name} className="group hover:bg-muted/30">
                <TableCell className="whitespace-nowrap">
                  <Link href={`/trace?tool=${encodeURIComponent(row.name)}`} className="flex items-center gap-1.5">
                    <span className="font-mono text-[13px] font-medium group-hover:text-primary">{row.name}</span>
                    {merged ? (
                      <span
                        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title={`已归一：${row.variants.map((v) => `${v.name} ×${v.calls}`).join("、")}`}
                      >
                        +{row.variants.length - 1} 别名
                      </span>
                    ) : null}
                    {placeholders.length > 0 ? (
                      <ShieldAlert
                        className="h-3 w-3 shrink-0 text-warning"
                        aria-label="部分变体的耗时是占位值"
                      />
                    ) : null}
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <span className="font-mono text-[13px] tabular-nums">{formatNumber(row.calls)}</span>
                  <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {row.callShare.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] tabular-nums",
                    row.failed > 0 ? "text-destructive" : "text-muted-foreground/40",
                  )}
                >
                  {row.failed}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] tabular-nums",
                    critical ? "text-destructive" : row.failed > 0 ? "text-warning" : "text-muted-foreground/40",
                  )}
                  title={row.topError ?? undefined}
                >
                  {row.calls > 0 ? `${row.failRate.toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "whitespace-nowrap text-right font-mono text-[13px] tabular-nums",
                    row.timingTrusted ? "text-muted-foreground" : "text-muted-foreground/40",
                  )}
                  title={
                    row.timingTrusted
                      ? `P90 ${formatDuration(row.p90)} · 基于 ${row.durationSamples} 次样本（${row.distinctDurations} 种取值）${
                          row.placeholderCalls > 0
                            ? `；另有 ${row.placeholderCalls} 次耗时是占位值（恒定），已从分位中排除`
                            : ""
                        }`
                      : `耗时不可信：可用样本 ${row.durationSamples} 次、${row.distinctDurations} 种取值，疑似采集端占位数据`
                  }
                >
                  {row.timingTrusted ? formatDuration(row.p50) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                  {row.sessions}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                  {row.agents}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-[12px] text-muted-foreground">
                  {row.lastUsedAt ? formatRelativeTime(new Date(row.lastUsedAt).getTime()) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------- Skill 表 ------------------------------- */

type SkillSortKey = "name" | "calls" | "sessions" | "agentCount" | "loadSuccessRate" | "p50" | "lastUsedAt";

const SKILL_COLUMNS: Column<SkillSortKey>[] = [
  { key: "name", label: "Skill", align: "left" },
  { key: "calls", label: "调用", hint: "两条识别通道合并后的加载次数（测试桩已剔除）", align: "right" },
  { key: "sessions", label: "会话", hint: "使用该 Skill 的会话数", align: "right" },
  { key: "agentCount", label: "Agent", hint: "调用过该 Skill 的 Agent 数（悬停看 Top3）", align: "right" },
  { key: "loadSuccessRate", label: "加载成功率", hint: "skill 加载 span 的成功率；实测长期 100%，主要用于发现异常" , align: "right" },
  { key: "p50", label: "加载耗时", hint: "样本 ≥3 且取值有波动才展示", align: "right" },
  { key: "lastUsedAt", label: "最近使用", align: "right" },
];

function skillSortValue(row: SkillRow, key: SkillSortKey): number | string | null {
  if (key === "name") return row.name;
  if (key === "lastUsedAt") return row.lastUsedAt;
  if (key === "p50") return row.timingTrusted ? row.p50 : null;
  return row[key] as number;
}

/**
 * Skill 表：注册表全量 + 使用情况，零调用留在表里而不是单独一块空列表
 * —— 「有这个 Skill 但没人用」本来就是一列事实，不该靠一个可能为空的卡片表达。
 */
export function SkillTable({ rows }: { rows: SkillRow[] }) {
  const { sort, toggle } = useSort<SkillSortKey>({ key: "calls", dir: "desc" });
  const sorted = useMemo(() => sortRows(rows, sort, skillSortValue), [rows, sort]);

  if (rows.length === 0) {
    return (
      <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        还没有同步过 Skill 注册表
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            {SKILL_COLUMNS.map((col) => (
              <SortableHead key={col.key} col={col} sort={sort} onToggle={toggle} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const zero = row.calls === 0;
            return (
              <TableRow key={row.name} className={cn("group hover:bg-muted/30", zero && "opacity-70")}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/trace?skill=${encodeURIComponent(row.name)}`}
                    className="flex items-center gap-1.5"
                    title={row.description || row.name}
                  >
                    <span className="font-mono text-[13px] font-medium group-hover:text-primary">{row.name}</span>
                    {!row.registered ? (
                      <span className="rounded-sm bg-warning/15 px-1 py-0.5 text-[10px] text-warning" title="span 里出现过，但 Skill 注册表没有这个名字">
                        未注册
                      </span>
                    ) : null}
                    {zero ? (
                      <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">零调用</span>
                    ) : null}
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  </Link>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] tabular-nums",
                    zero && "text-muted-foreground/40",
                  )}
                >
                  {row.calls}
                </TableCell>
                <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                  {row.sessions}
                </TableCell>
                <TableCell
                  className="text-right font-mono text-[13px] tabular-nums text-muted-foreground"
                  title={row.topAgents.map((a) => `${a.name} ×${a.calls}`).join("\n") || undefined}
                >
                  {row.agentCount}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] tabular-nums",
                    row.calls === 0 ? "text-muted-foreground/40" : "text-success",
                  )}
                >
                  {row.calls > 0 ? `${row.loadSuccessRate.toFixed(0)}%` : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] tabular-nums",
                    row.timingTrusted ? "text-muted-foreground" : "text-muted-foreground/40",
                  )}
                  title={
                    row.durationSamples === 0
                      ? "无耗时样本"
                      : row.timingTrusted
                        ? `${row.durationSamples} 次加载样本`
                        : `样本 ${row.durationSamples} 次，取值不足，不展示耗时`
                  }
                >
                  {row.timingTrusted ? formatDuration(row.p50) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-[12px] text-muted-foreground">
                  {row.lastUsedAt ? formatRelativeTime(new Date(row.lastUsedAt).getTime()) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
