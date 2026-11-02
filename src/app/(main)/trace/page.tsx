"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Search, FlaskConical, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OutcomeBadge } from "@/components/trace/shared";
import { SampleToExperimentPanel } from "@/components/trace/sample-to-experiment-panel";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { StackedBarTrendChart } from "@/components/charts/stacked-bar-trend-chart";
import { SessionScatterChart } from "@/components/charts/session-scatter-chart";
import { useOutcomePalette } from "@/lib/use-chart-colors";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import type { SessionBoard, SessionDeviation } from "@/lib/engine/stats/session-board";
import {
  formatTokens,
  formatNumber,
  formatDuration,
  formatRelativeTime,
  pctChange,
} from "@/lib/format";

const PAGE_SIZE = 20;

type RangeValue = StatsRange | "custom";
type BoardResponse = SessionBoard & { windowStartMs: number; windowEndMs: number };

const RANGE_SEGMENTS: { value: RangeValue; label: string }[] = [
  ...RANGE_OPTIONS.map((o) => ({ value: o.value as RangeValue, label: o.label })),
  { value: "custom", label: "自定义" },
];

interface SessionItem {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  userOrg: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  /** 会话标题（首条用户诉求），空串时前端回退为短 ID */
  title: string;
  /** success / partial / failed / 空串=未知 */
  outcome: string;
  model: string;
  /** 该会话实际调用过的模型（来自 llm_thinking span，可能多个） */
  models: string[];
  startTime: string;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  llmCallCount: number;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  /** input + output，不含 cache */
  billableTokens: number;
  totalDuration: number;
  forkCount: number;
  /** 父会话 id（跨进程父子链）；null = 无父/未知 */
  parentSessionId: string | null;
  /** 直接子会话数 */
  childCount: number;
}

/** 表格偏离列：mini bar 表达最大倍数，文字表达超线项数，两者缺一不可 */
function DeviationCell({ d }: { d?: SessionDeviation }) {
  if (!d) return <span className="text-[12px] text-muted-foreground/50">—</span>;
  if (d.s === 0) return <span className="text-[12px] text-muted-foreground">正常</span>;
  const tone =
    d.s >= 4 ? "var(--destructive)" : d.s >= 2 ? "var(--warning)" : "var(--muted-foreground)";
  const tip = [
    `超线指标：${d.b.join("、")}（按倍数取前 3）`,
    d.sc === "global" ? `样本不足，按全局基准 n=${d.n}` : `基准：本 Agent n=${d.n}`,
  ].join("\n");
  return (
    <div className="flex items-center gap-1.5" title={tip}>
      <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(d.r / 2, 1) * 100}%`, background: tone }}
        />
      </div>
      <span className="font-mono text-[12px] tabular-nums" style={{ color: tone }}>
        {d.s} 项
      </span>
    </div>
  );
}

export default function SessionBoardPage() {
  const router = useRouter();
  const outcomePalette = useOutcomePalette();

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);

  const [range, setRange] = useState<RangeValue>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  /** 模型过滤：LLM 看板点模型跳过来时带 ?model=xxx */
  const [modelFilter, setModelFilter] = useState("all");
  /**
   * 标签过滤：Tool & Skill 看板点工具/Skill 跳过来时带 ?tool=xxx / ?skill=xxx。
   * 会话本身没有这两个维度，需要向 /api/sessions/by-tag 反查命中的会话 id 集合。
   */
  const [tagFilter, setTagFilter] = useState<{ type: "skill" | "tool"; name: string } | null>(null);
  const [tagIds, setTagIds] = useState<Set<string> | null>(null);
  const [tagInfo, setTagInfo] = useState<{ calls: number; range: string } | null>(null);
  const [page, setPage] = useState(1);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"time" | "anomaly">("time");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [samplePanelOpen, setSamplePanelOpen] = useState(false);

  /* ---------------------------- 数据 ---------------------------- */

  const loadSessions = useCallback(() => {
    setLoading(true);
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data: SessionItem[]) => {
        setSessions(data);
        // 首页异常表 / Agent 详情等深链会带 ?session= 直接预填搜索
        const params = new URLSearchParams(window.location.search);
        const sessionParam = params.get("session");
        if (sessionParam) setSearch(sessionParam);
        // LLM 看板点模型跳过来：?model=xxx 直接落到该模型的会话
        const modelParam = params.get("model");
        if (modelParam) setModelFilter(modelParam);
        // Tool & Skill 看板点工具/Skill 跳过来：?tool=xxx / ?skill=xxx
        const skillParam = params.get("skill");
        const toolParam = params.get("tool");
        if (skillParam) setTagFilter({ type: "skill", name: skillParam });
        else if (toolParam) setTagFilter({ type: "tool", name: toolParam });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadBoard = useCallback(() => {
    const qs =
      range === "custom"
        ? customStart
          ? `from=${customStart}${customEnd ? `&to=${customEnd}` : ""}`
          : null
        : `range=${range}`;
    if (!qs) return; // 自定义区间还没选开始日期，保持上一次结果
    setBoardLoading(true);
    fetch(`/api/sessions/board?${qs}`)
      .then((res) => res.json())
      .then((data: BoardResponse) => {
        if (data && "kpi" in data) setBoard(data);
      })
      .catch(() => {})
      .finally(() => setBoardLoading(false));
  }, [range, customStart, customEnd]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  /* ---------------------- 标签下钻（?skill= / ?tool=） ---------------------- */

  // 自定义区间不传 from/to 给反查接口（按 all 取超集），收窄交给本页自己的时间窗过滤
  const tagRange: string = range === "custom" ? "all" : range;

  useEffect(() => {
    if (!tagFilter) {
      setTagIds(null);
      setTagInfo(null);
      return;
    }
    let cancelled = false;
    const qs = `type=${tagFilter.type}&name=${encodeURIComponent(tagFilter.name)}&range=${tagRange}`;
    fetch(`/api/sessions/by-tag?${qs}`)
      .then((res) => res.json())
      .then((d: { sessionIds?: string[]; calls?: number; range?: string; error?: string }) => {
        if (cancelled) return;
        setTagIds(new Set(d.sessionIds ?? []));
        setTagInfo({ calls: d.calls ?? 0, range: d.range ?? "" });
      })
      .catch(() => {
        if (!cancelled) setTagIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [tagFilter, tagRange]);

  /* ---------------------------- 表格筛选 ---------------------------- */

  const windowStart = board?.windowStartMs ?? 0;
  const windowEnd = board?.windowEndMs ?? Number.POSITIVE_INFINITY;

  const filtered = useMemo(() => {
    let result = sessions;
    // 时间窗与看板保持同一口径，否则会出现「表格有行但没基准」
    if (windowStart > 0 || Number.isFinite(windowEnd)) {
      result = result.filter((s) => {
        const t = new Date(s.startTime).getTime();
        return t >= windowStart && t < windowEnd;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.title ?? "").toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q) ||
          s.userName.toLowerCase().includes(q) ||
          s.agentName.toLowerCase().includes(q),
      );
    }
    if (agentFilter !== "all") result = result.filter((s) => s.agentId === agentFilter);
    // 按 Span 粒度统计的模型集合过滤：Session.model 只有一个值且可能为空，
    // 直接从 LLM 看板跳过来会漏掉「多模型会话」
    if (modelFilter !== "all") {
      result = result.filter((s) => (s.models ?? []).includes(modelFilter));
    }
    // Tool & Skill 看板下钻：只保留命中该工具/Skill 的会话
    if (tagIds) result = result.filter((s) => tagIds.has(s.id));
    if (statusFilter !== "all") {
      // 按终态筛选：success/partial/failed 走 outcome，active 走 status
      result =
        statusFilter === "active"
          ? result.filter((s) => s.status === "active")
          : result.filter((s) => s.outcome === statusFilter);
    }
    if (errorsOnly) result = result.filter((s) => s.errorCount > 0);

    if (sortMode === "anomaly") {
      const dev = board?.rowDeviation ?? {};
      result = [...result].sort((a, b) => {
        const da = dev[a.id];
        const db = dev[b.id];
        return (
          (db?.s ?? 0) - (da?.s ?? 0) ||
          (db?.r ?? 0) - (da?.r ?? 0) ||
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
      });
    }
    return result;
  }, [
    sessions,
    board,
    windowStart,
    windowEnd,
    search,
    agentFilter,
    statusFilter,
    modelFilter,
    tagIds,
    errorsOnly,
    sortMode,
  ]);

  // 筛选变化时，同步清掉已不在筛选结果里的选中项
  useEffect(() => {
    setSelectedIds((prev) => {
      const ids = new Set(filtered.map((s) => s.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const pagedAllSelected = paged.length > 0 && paged.every((s) => selectedIds.has(s.id));
  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pagedAllSelected) paged.forEach((s) => next.delete(s.id));
      else paged.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedIds.has(s.id)),
    [sessions, selectedIds],
  );

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) map.set(s.agentId, s.agentName);
    return Array.from(map.entries());
  }, [sessions]);

  /** 模型选项：按使用该模型的会话数降序，空模型名不上榜 */
  const modelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      for (const m of s.models ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [sessions]);

  const handleDelete = async (sessionId: string) => {
    if (!confirm("确定删除该 Session 及其所有 Span 数据？")) return;
    const res = await fetch("/api/sessions?id=" + encodeURIComponent(sessionId), { method: "DELETE" });
    if (res.ok) {
      loadSessions();
      loadBoard();
    } else {
      alert("删除失败");
    }
  };

  if (loading && !board) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const k = board?.kpi;
  const dailySeries = board
    ? [
        { name: "成功", data: board.daily.success, color: outcomePalette.success },
        { name: "部分成功", data: board.daily.partial, color: outcomePalette.partial },
        { name: "失败", data: board.daily.failed, color: outcomePalette.failed },
      ]
    : [];
  const durationSeries = board
    ? [
        {
          name: "正常",
          data: board.durationBuckets.map((b) => Math.max(0, b.count - b.anomalies)),
          color: "var(--chart-bar-in)",
        },
        { name: "异常", data: board.durationBuckets.map((b) => b.anomalies), color: outcomePalette.failed },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="Session 看板"
        description={`全量 Session 的成本与耗时水位、异常会话排查，可下钻链路详情（${board?.range ?? "—"}）`}
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={RANGE_SEGMENTS}
              value={range}
              onChange={(v) => {
                setRange(v);
                setPage(1);
              }}
            />
            {range === "custom" && (
              <>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 w-[132px]"
                />
                <span className="text-xs text-muted-foreground">至</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 w-[132px]"
                />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadSessions();
                loadBoard();
              }}
            >
              <RefreshCw className={boardLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              刷新
            </Button>
          </div>
        }
      />

      {/* KPI：口径与下方图表完全一致，都是当前时间窗 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Session 总数"
          value={formatNumber(k?.sessions ?? 0)}
          sub={`完成 ${k?.finished ?? 0} · 参与基准 ${k?.sampleSessions ?? 0}`}
          trend={pctChange(k?.sessions ?? 0, k?.sessionsPrev)}
        />
        <KpiCard
          label="会话成功率"
          value={(k?.finished ?? 0) > 0 ? `${(k?.successRate ?? 0).toFixed(1)}%` : "—"}
          sub={`成功 ${k?.success ?? 0} · 部分 ${k?.partial ?? 0} · 失败 ${k?.failed ?? 0}`}
          subTone={
            (k?.finished ?? 0) === 0
              ? "default"
              : (k?.successRate ?? 0) >= 97
                ? "success"
                : (k?.successRate ?? 0) >= 93
                  ? "warning"
                  : "destructive"
          }
          trend={pctChange(k?.successRate ?? 0, k?.successRatePrev)}
        />
        <KpiCard
          label="可计费 Token"
          value={formatTokens(k?.billableTokens ?? 0)}
          sub={`每会话中位 ${formatTokens(k?.billableMedian ?? 0)}`}
          trend={pctChange(k?.billableTokens ?? 0, k?.billableTokensPrev)}
        />
        <KpiCard
          label="异常 Session"
          value={formatNumber(k?.anomalySessions ?? 0)}
          sub={`严重 ${k?.severeSessions ?? 0} · 占 ${(k?.anomalyRate ?? 0).toFixed(0)}%（≥${board?.meta.anomalyMinScore ?? 2} 项超 P90）`}
          subTone={(k?.anomalySessions ?? 0) > 0 ? "warning" : "success"}
        />
      </div>

      {/* 主图 + Agent 基准 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>成本 × 耗时分布</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              大圈 = ≥{board?.meta.anomalyMinScore ?? 2} 项超 P90 · 显示 {board?.meta.scatterReturned ?? 0} /{" "}
              {board?.meta.scatterTotal ?? 0}
            </span>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-center pt-3">
            {!board || board.scatter.length === 0 ? (
              <p className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
                该时间窗没有可绘制的会话（Token 或耗时为 0）
              </p>
            ) : (
              <div className="flex flex-col">
                <SessionScatterChart
                  points={board.scatter}
                  height={320}
                  onSelect={(id) => router.push(`/trace/${id}`)}
                />
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                  * 带外圈的点 = 8 项运行指标中 ≥{board?.meta.anomalyMinScore ?? 2} 项超过同 Agent 同窗口的 P90
                  水位（即比 90% 的同类会话更差）。「显示 a / b」= 实际绘制点数 / 可绘制会话总数，
                  仅当超过绘图上限时才对普通点抽样（异常点全保留）。
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Agent 基准水位</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">中位 / P90</span>
          </CardHeader>
          <CardContent className="p-0">
            {(board?.agents ?? []).length === 0 ? (
              <p className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                该时间窗暂无 Agent 会话
              </p>
            ) : (
              <div className="max-h-[358px] overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-card hover:bg-card">
                    <TableHead className="text-xs">Agent</TableHead>
                    <TableHead className="w-[44px] text-right text-xs">会话</TableHead>
                    <TableHead className="w-[64px] text-right text-xs">中位</TableHead>
                    <TableHead className="w-[64px] text-right text-xs">P90</TableHead>
                    <TableHead className="w-[44px] text-right text-xs">异常</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(board?.agents ?? []).map((a) => (
                    <TableRow key={a.id} className="h-9">
                      <TableCell className="max-w-0 truncate text-[12px]" title={`${a.name}${a.baselineScope === "global" ? `（样本 ${a.samples} < 8，按全局基准）` : ""}`}>
                        <span className="mr-1">{a.emoji}</span>
                        {a.name}
                        {a.baselineScope === "global" && (
                          <span className="ml-1 text-[10px] text-warning">*</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {a.sessions}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums">
                        {a.baselineScope === "agent" ? (
                          formatTokens(a.billableMedian)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {a.baselineScope === "agent" ? (
                          formatTokens(a.billableP90)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[12px] tabular-nums">
                        {a.anomalySessions > 0 ? (
                          <span className="text-warning">{a.anomalySessions}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
            <p className="border-t border-border/60 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
              * 该 Agent 有效会话不足 {board?.meta.minSamples ?? 8} 个，中位/P90 不成立（显示 —），
              异常判定退回全局基准
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 趋势 + 耗时分布 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>每日会话终态构成</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">按会话发生日 · 口径见 session-outcome</span>
          </CardHeader>
          <CardContent className="pt-3">
            {!board || board.daily.sessions.every((v) => v === 0) ? (
              <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                该时间窗暂无会话
              </p>
            ) : (
              <StackedBarTrendChart labels={board.daily.days} series={dailySeries} height={220} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>端到端耗时分布</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              中位 {formatDuration(k?.durationMedian ?? 0)} · P90 {formatDuration(k?.durationP90 ?? 0)}
            </span>
          </CardHeader>
          <CardContent className="pt-3">
            {!board || board.durationBuckets.every((b) => b.count === 0) ? (
              <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                该时间窗暂无会话
              </p>
            ) : (
              <StackedBarTrendChart
                labels={board.durationBuckets.map((b) => b.label)}
                series={durationSeries}
                height={220}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 异常榜单 */}
      <Card>
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            异常 Session 榜单
          </CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            超过本 Agent P90 计 1 项 · 并列按最大倍数 · 样本 &lt;{board?.meta.minSamples ?? 8} 用全局基准
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {!board || board.anomalies.length === 0 ? (
            <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {board?.meta.baselineReady === false
                ? `有效会话不足 ${board.meta.minSamples} 个，暂不判定异常`
                : "当前时间窗没有明显偏离基线（≥2 项超 P90）的会话"}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {board.anomalies.map((r, i) => (
                <li
                  key={r.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30"
                  onClick={() => router.push(`/trace/${r.id}`)}
                >
                  <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {r.title || "（无标题）"}
                      </span>
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                          r.score >= 4
                            ? "bg-destructive/10 text-destructive ring-1 ring-destructive/30"
                            : "bg-warning/10 text-warning ring-1 ring-warning/30"
                        }`}
                      >
                        {r.score} 项超线
                      </span>
                      {r.baselineScope === "global" && (
                        <span
                          className="shrink-0 text-[10px] text-warning/80"
                          title={`该 Agent 有效会话不足 ${board.meta.minSamples} 个，退回全局基准（n=${r.baselineSamples}）`}
                        >
                          全局基准
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{r.agentName}</span>
                      <span className="font-mono tabular-nums">{formatTokens(r.billableTokens)} tok</span>
                      <span className="font-mono tabular-nums">{formatDuration(r.durationMs)}</span>
                      <span className="font-mono tabular-nums">
                        LLM {r.llmCalls} / Tool {r.toolCalls}
                      </span>
                      {r.failedSpans > 0 && (
                        <span className="text-warning">失败 span {r.failedSpans}</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                    {r.breaches.slice(0, 3).map((b) => (
                      <span
                        key={b.key}
                        className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
                        title={`本会话 ${formatMetric(b.value, b.unit)} · 中位 ${formatMetric(b.median, b.unit)} · P90 ${formatMetric(b.p90, b.unit)}`}
                      >
                        {b.label} {b.ratio.toFixed(1)}×
                      </span>
                    ))}
                  </div>
                  <OutcomeBadge outcome={r.outcome} status={r.status} />
                  <span className="w-[64px] shrink-0 text-right text-[11px] text-muted-foreground">
                    {formatRelativeTime(new Date(r.startTime).getTime())}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索 Session ID、任务、项目、用户、Agent..."
            className="h-8 pl-8"
          />
        </div>
        <Select
          value={agentFilter}
          onValueChange={(v) => {
            setAgentFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue>
              {(v) =>
                v === "all" || !v
                  ? "全部 Agent"
                  : (agentOptions.find(([id]) => id === v)?.[1] ?? String(v))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部 Agent</SelectItem>
            {agentOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue>
              {(v) =>
                v === "all" || !v
                  ? "全部状态"
                  : ({ active: "进行中", success: "成功", partial: "部分成功", failed: "失败" } as Record<
                      string,
                      string
                    >)[String(v)] ?? String(v)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">进行中</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="partial">部分成功</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={modelFilter}
          onValueChange={(v) => {
            setModelFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue>
              {(v) => (v === "all" || !v ? "全部模型" : String(v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模型</SelectItem>
            {modelOptions.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                {name}（{count}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tagFilter ? (
          <span className="flex h-8 items-center gap-1.5 rounded-md bg-primary/10 pl-2.5 pr-1.5 text-xs text-primary ring-1 ring-primary/30">
            <span className="truncate">
              {tagFilter.type === "skill" ? "Skill" : "Tool"}：{tagFilter.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary/80">
              {tagIds
                ? `${tagIds.size} 会话${tagInfo && tagInfo.calls > 0 ? ` · ${tagInfo.calls} 次调用` : ""}`
                : "查询中…"}
            </span>
            <button
              type="button"
              aria-label="清除工具/Skill 筛选"
              onClick={() => {
                setTagFilter(null);
                setTagIds(null);
                setTagInfo(null);
                setPage(1);
                const url = new URL(window.location.href);
                url.searchParams.delete("skill");
                url.searchParams.delete("tool");
                window.history.replaceState({}, "", url.toString());
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
            >
              ×
            </button>
          </span>
        ) : null}
        <button
          onClick={() => {
            setErrorsOnly((v) => !v);
            setPage(1);
          }}
          className={`h-8 rounded-md px-3 text-xs transition-colors ${
            errorsOnly
              ? "bg-destructive/10 text-destructive ring-1 ring-destructive/40"
              : "bg-muted/40 text-muted-foreground ring-1 ring-foreground/10 hover:ring-foreground/25"
          }`}
        >
          仅看过程失败
        </button>
        <button
          onClick={() => {
            setSortMode((v) => (v === "anomaly" ? "time" : "anomaly"));
            setPage(1);
          }}
          className={`h-8 rounded-md px-3 text-xs transition-colors ${
            sortMode === "anomaly"
              ? "bg-warning/10 text-warning ring-1 ring-warning/40"
              : "bg-muted/40 text-muted-foreground ring-1 ring-foreground/10 hover:ring-foreground/25"
          }`}
        >
          异常优先
        </button>
        <div className="flex-1" />
        <Button
          size="sm"
          className="h-8"
          disabled={selectedIds.size === 0}
          onClick={() => setSamplePanelOpen(true)}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          抽样到实验({selectedIds.size})
        </Button>
      </div>

      <SampleToExperimentPanel
        open={samplePanelOpen}
        onClose={() => setSamplePanelOpen(false)}
        sessions={selectedSessions.map((s) => ({
          id: s.id,
          agentId: s.agentId,
          agentName: s.agentName,
        }))}
        onDone={() => setSelectedIds(new Set())}
      />

      {/* Session 表格 */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>Session 列表</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            共 {filtered.length} 条 · Token 口径为 input+output（不含 cache）
          </span>
        </CardHeader>
        {/*
          表头 sticky 只能相对最近的纵向滚动容器生效，所以这个 max-h 容器必须保留；
          去掉它会让 Table 自带的 overflow-x-auto 成为滚动容器，sticky 静默失效。
        */}
        <div className="max-h-[min(70vh,720px)] overflow-auto scrollbar-thin">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-card hover:bg-card">
                <TableHead className="w-[40px] text-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectPage();
                    }}
                    aria-label="全选当前页"
                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                      pagedAllSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-foreground/30 hover:border-foreground/60"
                    }`}
                  >
                    {pagedAllSelected && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                        <path
                          d="M2.5 6.5L5 9L9.5 3.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </TableHead>
                <TableHead className="w-[86px] text-xs">Session</TableHead>
                <TableHead className="w-[200px] text-xs">任务</TableHead>
                <TableHead className="w-[110px] text-xs">Agent</TableHead>
                <TableHead className="w-[180px] text-xs">用户 · 项目</TableHead>
                <TableHead className="w-[52px] text-center text-xs">轮次</TableHead>
                <TableHead className="w-[92px] text-center text-xs">LLM / Tool</TableHead>
                <TableHead className="w-[60px] text-center text-xs">过程失败</TableHead>
                <TableHead className="w-[72px] text-right text-xs">Token</TableHead>
                <TableHead className="w-[72px] text-right text-xs">耗时</TableHead>
                <TableHead className="w-[104px] text-xs">偏离基准</TableHead>
                <TableHead className="w-[84px] text-center text-xs">结果</TableHead>
                <TableHead className="w-[72px] text-right text-xs">时间</TableHead>
                <TableHead className="w-[52px] text-center text-xs">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {paged.map((session) => (
                <TableRow
                  key={session.id}
                  className="h-11 cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => router.push(`/trace/${session.id}`)}
                >
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(session.id);
                      }}
                      aria-label="选择该 Session"
                      className={`mx-auto flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                        selectedIds.has(session.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-foreground/30 hover:border-foreground/60"
                      }`}
                    >
                      {selectedIds.has(session.id) && (
                        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                          <path
                            d="M2.5 6.5L5 9L9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </TableCell>
                  <TableCell
                    className="font-mono text-[11px] text-muted-foreground"
                    title={session.id}
                  >
                    {session.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    {session.title ? (
                      <span className="line-clamp-1 text-[13px]" title={session.title}>
                        {session.title}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground/60">（无标题）</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="line-clamp-1 text-[13px] font-medium" title={session.agentName}>
                      {session.agentName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate text-[13px] leading-tight">
                      {session.userName}
                    </span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      {session.projectName}
                    </span>
                  </TableCell>
                  <TableCell className="text-center font-mono text-[13px] tabular-nums">
                    {session.totalRounds}
                  </TableCell>
                  <TableCell
                    className="text-center font-mono text-[13px] tabular-nums"
                    title="LLM 调用次数 / 工具调用次数（工具含 command）"
                  >
                    {session.llmCallCount} / {session.toolCallCount}
                  </TableCell>
                  <TableCell className="text-center">
                    {session.errorCount > 0 ? (
                      <span
                        className="font-mono text-[13px] font-medium tabular-nums text-warning"
                        title="过程中失败的 span 数（工具重试、质检回流等），不代表会话失败"
                      >
                        {session.errorCount}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right font-mono text-[13px] tabular-nums"
                    title="可计费 Token = input + output，不含 cache"
                  >
                    {formatTokens(session.billableTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                    {formatDuration(session.totalDuration)}
                  </TableCell>
                  <TableCell>
                    <DeviationCell d={board?.rowDeviation[session.id]} />
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <OutcomeBadge outcome={session.outcome} status={session.status} />
                      {(session.childCount > 0 || session.parentSessionId) && (
                        <span
                          className="font-mono text-[10px] text-muted-foreground"
                          title={
                            session.childCount > 0
                              ? `有 ${session.childCount} 个子会话`
                              : "由父会话派生"
                          }
                        >
                          {session.childCount > 0 && `↳${session.childCount}`}
                          {session.parentSessionId && "↱"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(session.startTime).getTime())}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(session.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-card px-4 py-2.5">
          <p className="text-xs text-muted-foreground tabular-nums">
            共 <span className="font-medium text-foreground">{filtered.length}</span> 条
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="px-2 text-xs text-muted-foreground tabular-nums">
              {page} / {Math.ceil(filtered.length / PAGE_SIZE) || 1}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page >= Math.ceil(filtered.length / PAGE_SIZE)}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** 榜单 chip 的 title 里用的数值格式化：按量纲选单位 */
function formatMetric(v: number, unit: "tokens" | "ms" | "count" | "ratio" | "pct"): string {
  if (unit === "tokens") return formatTokens(Math.round(v));
  if (unit === "ms") return formatDuration(Math.round(v));
  if (unit === "ratio") return v.toFixed(2);
  if (unit === "pct") return `${v.toFixed(1)}%`;
  return String(Math.round(v));
}
