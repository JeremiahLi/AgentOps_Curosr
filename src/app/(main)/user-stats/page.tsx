"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { Sparkline } from "@/components/charts/sparkline";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatTokens, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 用户看板（管理视角）。
 *
 * 与"平台概览"的分工：概览看全局趋势，本页看「人」——谁在用、多久用一次、
 * 谁掉队了、每人贡献多少。因此 KPI 一律用渗透率 / 人均口径，不用总量：
 * 总量回答不了"该催谁"，人均与覆盖率可以。
 *
 * 四个区块对应领导的四个问题：
 *   1. KPI 行   —— 部门渗透了多少、人均节奏如何
 *   2. 使用热度 —— 谁哪天在动、哪段集体沉默
 *   3. 贡献卡位 —— 谁贡献最多（带 14 天走势）
 *   4. 明细表   —— 全量可排序、可下钻
 */

type BoardRange = "weekly" | "30d" | "all";

const BOARD_RANGE_OPTIONS: { value: BoardRange; label: string }[] = [
  { value: "weekly", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "all", label: "全部" },
];

type UserTier = "high" | "mid" | "low" | "none";

interface BoardRow {
  name: string;
  org: string;
  sessions: number;
  prevSessions: number | null;
  tokens: number;
  rounds: number;
  activeDays: number;
  agentCount: number;
  errorSessions: number;
  lastActiveAt: string | null;
  daysSinceActive: number | null;
  daily: number[];
  recent: number[];
  tier: UserTier;
  idle: boolean;
}

interface BoardData {
  range: string;
  spanDays: number;
  days: string[];
  totals: {
    registered: number;
    activeUsers: number;
    sessions: number;
    prevSessions: number | null;
    rounds: number;
    tokens: number;
    avgSessions: number;
    prevAvgSessions: number | null;
    avgActiveDays: number;
    activeAvgDays: number;
    roundsPerSession: number;
    errorSessions: number;
    errorRate: number;
    idleUsers: number;
    idleNames: string[];
  };
  users: BoardRow[];
  tiers: Record<UserTier, string[]>;
}

const TIER_META: Record<UserTier, { label: string; hint: string; dot: string }> = {
  high: { label: "高频", hint: "≥40% 天数有使用", dot: "bg-primary" },
  mid: { label: "中频", hint: "15%~40% 天数", dot: "bg-primary/50" },
  low: { label: "低频", hint: "<15% 天数", dot: "bg-primary/25" },
  none: { label: "未使用", hint: "窗口内无会话", dot: "bg-muted-foreground/30" },
};

/** 环比：|变化| <1% 视为持平 */
function pctChange(cur: number, prev: number | null | undefined) {
  if (prev == null || prev === 0) return undefined;
  const diff = ((cur - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return { value: 0, direction: "flat" as const };
  return { value: Math.abs(diff), direction: diff > 0 ? ("up" as const) : ("down" as const) };
}

function Delta({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev == null) return <span className="text-[11px] text-muted-foreground/60">—</span>;
  if (prev === 0) return <span className="text-[11px] text-success">新增</span>;
  const diff = ((cur - prev) / prev) * 100;
  const flat = Math.abs(diff) < 1;
  const up = diff > 0;
  const cls = flat ? "text-muted-foreground" : up ? "text-success" : "text-destructive";
  return (
    <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", cls)}>
      {flat ? "持平" : `${up ? "+" : "-"}${Math.abs(Math.round(diff))}%`}
    </span>
  );
}

/** 热力图配色：对数缩放，避免头部用户把其他人压成一片浅色 */
function cellColor(n: number, max: number): string {
  if (n <= 0) return "var(--muted)";
  const ratio = Math.log1p(n) / Math.log1p(Math.max(max, 1));
  const pct = ratio > 0.75 ? 92 : ratio > 0.5 ? 70 : ratio > 0.25 ? 46 : 26;
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--card))`;
}

export default function UserBoardPage() {
  const [range, setRange] = useState<BoardRange>("weekly");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/users/board?range=${range}`)
      .then((r) => r.json())
      .then((d: BoardData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [range]);

  if (loading || !data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">{loading ? "加载中..." : "暂无数据"}</p>
      </div>
    );
  }

  const t = data.totals;
  const coverage = t.registered > 0 ? (t.activeUsers / t.registered) * 100 : 0;
  const maxDaily = Math.max(1, ...data.users.flatMap((u) => u.daily));
  const ranked = data.users.filter((u) => u.sessions > 0);
  const topSessions = ranked[0]?.sessions ?? 1;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="用户看板"
        description={`部门成员对 Agent 的使用广度、频率与节奏（${data.range}）`}
        actions={
          <SegmentedControl
            options={BOARD_RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={range}
            onChange={setRange}
          />
        }
      />

      {/* 管理口径 KPI：渗透率 / 人均节奏 / 沉默名单 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="活跃用户"
          value={String(t.activeUsers)}
          sub={`在册 ${t.registered} 人 · 覆盖 ${coverage.toFixed(0)}%`}
        />
        <KpiCard
          label="部门人均会话"
          value={t.avgSessions.toFixed(1)}
          sub={`合计 ${formatNumber(t.sessions)} 次`}
          trend={pctChange(t.avgSessions, t.prevAvgSessions)}
        />
        <KpiCard
          label="部门人均使用天数"
          value={t.avgActiveDays.toFixed(1)}
          sub={`活跃成员人均 ${t.activeAvgDays.toFixed(1)} 天`}
        />
        <KpiCard
          label="未使用成员"
          value={String(t.idleUsers)}
          sub={t.idleUsers > 0 ? t.idleNames.join("、") : "全员有使用"}
          subTone={t.idleUsers > 0 ? "warning" : "success"}
        />
      </div>

      {/* 使用热度 + 活跃度分层 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <div>
              <CardTitle>使用热度</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                每人每日会话数 · 最近 {data.days.length} 天，空白格表示当天没有使用
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>少</span>
              {[26, 46, 70, 92].map((p) => (
                <span
                  key={p}
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: `color-mix(in oklab, var(--primary) ${p}%, var(--card))` }}
                />
              ))}
              <span>多</span>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="space-y-1.5">
              {data.users.map((u) => (
                <div key={u.name} className="flex items-center gap-2">
                  <Link
                    href={`/user-stats/${encodeURIComponent(u.name)}`}
                    className="flex w-20 shrink-0 items-center gap-1.5 truncate text-xs hover:underline"
                    title={u.org || u.name}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TIER_META[u.tier].dot)} />
                    <span className="truncate">{u.name}</span>
                  </Link>
                  <div className="flex min-w-0 flex-1 gap-[3px]">
                    {u.daily.map((n, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-[2px]",
                          data.days.length <= 10 ? "h-5" : "h-3.5",
                        )}
                        style={{ backgroundColor: cellColor(n, maxDaily) }}
                        title={`${data.days[i]} · ${n} 次`}
                      />
                    ))}
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {u.sessions}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="w-20 shrink-0" />
              <div className="flex flex-1 justify-between text-[10px] tabular-nums text-muted-foreground/70">
                <span>{data.days[0]?.slice(5)}</span>
                <span>{data.days[data.days.length - 1]?.slice(5)}</span>
              </div>
              <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground/70">合计</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>活跃度分层</CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              按「有使用的天数 / {data.spanDays} 天」划分
            </p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center gap-3 pt-3">
            {(Object.keys(TIER_META) as UserTier[]).map((tier) => {
              const names = data.tiers[tier] ?? [];
              const meta = TIER_META[tier];
              return (
                <div key={tier} className="flex items-start gap-2">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px]">
                        {meta.label}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">{meta.hint}</span>
                      </span>
                      <span className="font-mono text-xs tabular-nums">{names.length} 人</span>
                    </div>
                    {names.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {names.join("、")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* 成员贡献卡位：含窗口内未使用成员，用灰态形成对比 */}
      {data.users.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[13px] font-medium">成员贡献</h2>
            <span className="text-[11px] text-muted-foreground">
              按会话数 · 走势为最近 14 天 · 灰态为窗口内未使用
            </span>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
            {data.users.slice(0, 6).map((u) => {
              const rank = ranked.findIndex((r) => r.name === u.name);
              const idle = u.sessions === 0;
              return (
                <Link key={u.name} href={`/user-stats/${encodeURIComponent(u.name)}`}>
                  <Card className="h-full transition-colors hover:bg-muted/30">
                    <CardContent className="pt-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-[13px] font-medium",
                              idle && "text-muted-foreground",
                            )}
                          >
                            {u.name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {u.org || "未分组"}
                          </p>
                        </div>
                        {rank >= 0 ? (
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums",
                              rank < 3
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {rank + 1}
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[11px] text-muted-foreground/40">
                            —
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-baseline gap-1.5">
                        <span
                          className={cn(
                            "text-[26px] font-semibold leading-none tracking-tight tabular-nums",
                            idle && "text-muted-foreground/60",
                          )}
                        >
                          {u.sessions}
                        </span>
                        <span className="text-[11px] text-muted-foreground">次</span>
                        <span className="ml-auto">
                          <Delta cur={u.sessions} prev={u.prevSessions} />
                        </span>
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <Sparkline data={u.recent} width={64} height={18} />
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {idle
                            ? u.lastActiveAt
                              ? `${u.daysSinceActive} 天前活跃`
                              : "从未使用"
                            : `${u.activeDays} 天活跃`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex min-h-[18px] flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {idle ? (
                          <span className="text-muted-foreground/70">窗口内未使用</span>
                        ) : (
                          <>
                            <span>{u.agentCount} 个 Agent</span>
                            <span>{formatNumber(u.rounds)} 轮</span>
                            {u.errorSessions > 0 && (
                              <span className="text-destructive">{u.errorSessions} 异常</span>
                            )}
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 全量明细 */}
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b border-border/60 pb-2.5">
          <CardTitle>成员明细</CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            含窗口内未使用的成员 · 点击姓名查看单用户明细
          </p>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {data.users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">该时间段暂无数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">用户</TableHead>
                  <TableHead>活跃度</TableHead>
                  <TableHead className="text-right">会话数</TableHead>
                  <TableHead className="text-right">环比</TableHead>
                  <TableHead className="text-right">活跃天数</TableHead>
                  <TableHead className="text-right">Token</TableHead>
                  <TableHead className="text-right">轮数</TableHead>
                  <TableHead className="text-right">Agent 数</TableHead>
                  <TableHead className="text-right">异常会话</TableHead>
                  <TableHead className="text-right">最后活跃</TableHead>
                  <TableHead className="w-[120px]">贡献占比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.name} className="hover:bg-muted/30">
                    <TableCell>
                      <Link
                        href={`/user-stats/${encodeURIComponent(u.name)}`}
                        className="font-medium hover:underline"
                      >
                        {u.name}
                      </Link>
                      {u.org && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">{u.org}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("h-1.5 w-1.5 rounded-full", TIER_META[u.tier].dot)} />
                        {TIER_META[u.tier].label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(u.sessions)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Delta cur={u.sessions} prev={u.prevSessions} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{u.activeDays}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatTokens(u.tokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(u.rounds)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{u.agentCount}</TableCell>
                    <TableCell className="text-right">
                      {u.errorSessions > 0 ? (
                        <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums text-destructive">
                          {u.errorSessions}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {u.lastActiveAt
                        ? formatRelativeTime(new Date(u.lastActiveAt).getTime())
                        : "从未使用"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${(u.sessions / topSessions) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {t.sessions > 0 ? Math.round((u.sessions / t.sessions) * 100) : 0}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 反馈维度：数据源缺失，如实标注，不做假数据 */}
      <div className="rounded-lg border border-dashed border-border px-4 py-3">
        <p className="text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">用户反馈尚未接入。</span>
          当前库中无 feedback 表，评测中心的 <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">Experiment.userId</code>
          统一写入 <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">default</code>，无法归属到人。
          因此本页暂不含「反馈数 / 响应率 / 反馈提出人排行」；接入采集事件（点赞、点踩、问题上报）后补齐，
          才能回答「谁在用、谁在用得深、谁在反馈」这条链路。
        </p>
      </div>
    </div>
  );
}
