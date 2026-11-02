"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowLeft, RefreshCw, ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TraceTimeline } from "./trace-timeline";
import { TraceTranscript } from "./trace-transcript";
import { OutcomeBadge } from "./shared";
import { SlidePanel } from "./slide-panel";
import { SessionTreePanel } from "./session-tree-panel";
import {
  buildCalls,
  compressIdleGaps,
  displayDurationMs,
  flattenSession,
  isFailed,
  isToolKind,
  kindLabel,
  spanColor,
  totalSecondsOf,
  type CallInfo,
  type TraceSpan,
} from "./trace-helpers";
import { formatDuration, formatTokens } from "@/lib/format";
import type { SessionDetail, SpanNode, RoundNode } from "./types";

/**
 * Session 详情（全幅）。
 *
 * 从原来的右侧浮窗（TraceViewerPanel）搬过来的三栏视图：
 *   左 Span 层级树 / 中 Timeline（甘特 + Token 图）或 Transcript / 右 Span 详情。
 * 改成路由页之后去掉遮罩、拖拽宽度和全屏按钮，补上 404 / 加载失败分支
 * （浮窗里 fetch 失败只是不显示，整页失败会白屏）。
 *
 * 支持 ?spanId=xxx 直达：从「失败样例」这类深链进来时自动选中并滚动到该 span。
 */
interface Props {
  sessionId: string;
  onBack?: () => void;
}

export function SessionDetailView({ sessionId, onBack }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  // 选中的 Token 调用柱（view: "cum" = 累计构成 / "delta" = 本次新增构成）
  const [selectedCall, setSelectedCall] = useState<{ id: string; view: "prompt" | "new" } | null>(
    null,
  );
  const [view, setView] = useState<"timeline" | "transcript">("timeline");
  const [reloadToken, setReloadToken] = useState(0);
  // 会话父子链面板（SlidePanel）
  const [treeOpen, setTreeOpen] = useState(false);
  /** 深链要定位的 span：与 selectedSpanId 分开，避免用户点树时甘特反复重新聚焦 */
  const [focusSpanId, setFocusSpanId] = useState<string | null>(null);
  // ?spanId= 只应用一次：之后用户手动点的选中项不能被刷新/重算覆盖
  const appliedLinkRef = useRef(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (res.status === 404) {
        setNotFound(true);
        setDetail(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionDetail = await res.json();
      if (!data || !Array.isArray(data.rounds)) throw new Error("响应结构异常");
      setDetail(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 换会话时彻底重置视图状态
  useEffect(() => {
    setSelectedSpanId(null);
    setSelectedCall(null);
    setFocusSpanId(null);
    setView("timeline");
    appliedLinkRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail, reloadToken]);

  const spans = useMemo(
    () => (detail ? compressIdleGaps(flattenSession(detail)) : []),
    [detail],
  );
  const totalSeconds = useMemo(
    () => (detail ? totalSecondsOf(detail, spans) : 0),
    [detail, spans],
  );
  const selectedSpan = useMemo(
    () => spans.find((s) => s.id === selectedSpanId) ?? null,
    [spans, selectedSpanId],
  );
  const calls = useMemo(() => buildCalls(spans), [spans]);
  const selectedCallInfo = useMemo(
    () => (selectedCall ? (calls.find((c) => c.id === selectedCall.id) ?? null) : null),
    [calls, selectedCall],
  );
  // 跨区域同步标记：点击柱体 → 树/甘特高亮对应 LLM；点击树/甘特中的 LLM → 两图柱体高亮
  const highlightCallId = useMemo(() => {
    if (selectedCall) return selectedCall.id;
    const sp = selectedSpan;
    if (sp && sp.kind === "llm_thinking" && calls.some((c) => c.id === sp.id)) return sp.id;
    return null;
  }, [selectedCall, selectedSpan, calls]);

  /**
   * ←/→ 逐块跳转的次序：按时间线起点排序。
   * 并行块起点相同时按结束时刻、再按名称兜底，保证顺序稳定可复现。
   * 效果：选中某个 LLM 块 → → 落到它之后执行的 Tool 块 → 再 → 落到并行调用的另一个 Tool。
   */
  const navOrder = useMemo(
    () =>
      [...spans].sort(
        (a, b) =>
          a.relStart - b.relStart ||
          a.relStart + a.timelineMs / 1000 - (b.relStart + b.timelineMs / 1000) ||
          a.name.localeCompare(b.name),
      ),
    [spans],
  );

  // 键盘逐块跳转：只在已有选中块时接管方向键，避免抢走页面其它地方的左右键
  useEffect(() => {
    if (!selectedSpanId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const i = navOrder.findIndex((s) => s.id === selectedSpanId);
      if (i < 0) return;
      const next =
        e.key === "ArrowRight" ? Math.min(i + 1, navOrder.length - 1) : Math.max(i - 1, 0);
      if (next === i) return;
      e.preventDefault();
      const id = navOrder[next].id;
      setSelectedSpanId(id);
      setSelectedCall(null);
      // 跳到视口外的块时，把左树的对应条目带到可见位置
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-span-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSpanId, navOrder]);

  const llmCount = useMemo(() => spans.filter((s) => s.kind === "llm_thinking").length, [spans]);
  const toolCount = useMemo(
    () => spans.filter((s) => s.kind === "tool_call" || s.kind === "command").length,
    [spans],
  );
  const failedToolCount = useMemo(
    () => spans.filter((s) => (s.kind === "tool_call" || s.kind === "command") && isFailed(s)).length,
    [spans],
  );

  /** 会话级指标优先用服务端算的值，缺失时用前端统计兜底（老响应/降级场景） */
  const metricOf = useMemo(
    () => ({
      billableTokens: detail?.metrics?.billableTokens ?? (detail ? detail.totalInputTokens + detail.totalOutputTokens : 0),
      durationMs: detail?.metrics?.durationMs ?? detail?.totalDuration ?? 0,
      perRoundMs:
        detail?.metrics?.perRoundMs ??
        (detail && detail.totalRounds > 0 ? Math.round(detail.totalDuration / detail.totalRounds) : 0),
      llmCalls: detail?.metrics?.llmCalls ?? llmCount,
      toolCalls: detail?.metrics?.toolCalls ?? toolCount,
      toolsPerLlm:
        detail?.metrics?.toolsPerLlm ?? (llmCount > 0 ? Number((toolCount / llmCount).toFixed(2)) : 0),
      thinkSharePct: detail?.metrics?.thinkSharePct ?? 0,
      toolFailPct: detail?.metrics?.toolFailPct ?? 0,
    }),
    [detail, llmCount, toolCount],
  );

  /** 构造 chip 的倍数额度：无基准（或样本为 0）时返回 undefined，chip 只显示绝对值 */
  const ratioOf = useCallback(
    (key: keyof NonNullable<SessionDetail["baseline"]>["metrics"], value: number) => {
      const base = detail?.baseline;
      const m = base?.metrics?.[key];
      if (!base || !m || base.samples === 0 || m.median <= 0) return undefined;
      return {
        mult: value / m.median,
        over: m.p90 > 0 && value > m.p90,
        p50: m.median,
        p90: m.p90,
        samples: base.samples,
        scope: base.scope,
      };
    },
    [detail?.baseline],
  );

  // ?spanId= 只应用一次：之后用户手动点的选中项不能被刷新/重算覆盖
  useEffect(() => {
    if (appliedLinkRef.current || spans.length === 0) return;
    appliedLinkRef.current = true;
    const spanId = new URLSearchParams(window.location.search).get("spanId");
    if (!spanId) return;
    // 不在拍平结果里（例如带 branchId 但该 Round 没有 fork 点的 span）就静默退回会话顶部
    if (!spans.some((s) => s.id === spanId)) return;

    setSelectedSpanId(spanId);
    setFocusSpanId(spanId);
    setSelectedCall(null);
    // 参数用完即清，避免刷新后总被拽回这一条
    const url = new URL(window.location.href);
    url.searchParams.delete("spanId");
    window.history.replaceState(null, "", url.pathname + url.search);

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-span-id="${CSS.escape(spanId)}"]`);
      el?.scrollIntoView({ block: "center" });
    });
  }, [spans]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (notFound || errorMsg || !detail) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {notFound ? `Session 未找到：${sessionId}` : `加载失败：${errorMsg ?? "未知错误"}`}
        </p>
        <div className="flex items-center gap-2">
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => setReloadToken((v) => v + 1)}>
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
          )}
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              返回列表
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      {/* Header：统计条（窄屏换行，不再固定单行） */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-b border-border bg-card px-5 py-2">
        {/* min-w-0 + flex-1：标题过长时截断，而不是把右侧整组挤到第二行 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Button>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-base shrink-0">{detail.agentEmoji}</span>
            {/* 标题优先：没有标题时退回 Agent 名，避免出现空 h1 */}
            <h1 className="truncate text-base font-semibold tracking-tight">
              {detail.title || detail.agentName}
            </h1>
            <span className="truncate text-sm text-muted-foreground" title={detail.id}>
              · {detail.agentName} · {detail.projectName} · {detail.userName} · #{detail.id.slice(0, 8)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <StatChip
              label="耗时"
              value={formatDuration(detail.totalDuration)}
              ratio={ratioOf("durationMs", metricOf.durationMs)}
            />
            <StatChip
              label="成本"
              value={formatTokens(metricOf.billableTokens)}
              ratio={ratioOf("billableTokens", metricOf.billableTokens)}
            />
            <StatChip
              label="In"
              value={formatTokens(detail.totalInputTokens)}
              valueClass="text-[var(--trace-llm)]"
            />
            <StatChip
              label="Out"
              value={formatTokens(detail.totalOutputTokens)}
              valueClass="text-[var(--trace-tool)]"
            />
            {/* 单轮耗时：消掉「会话长所以慢」的干扰，是跨会话比较耗时的正确口径 */}
            <StatChip
              label="单轮"
              value={formatDuration(metricOf.perRoundMs)}
              ratio={ratioOf("perRoundMs", metricOf.perRoundMs)}
            />
            <StatChip
              label="LLM"
              value={String(metricOf.llmCalls)}
              ratio={ratioOf("llmCalls", metricOf.llmCalls)}
            />
            {/* 终态与「过程失败」分开看：过程有失败不代表会话失败 */}
            <OutcomeBadge outcome={detail.outcome ?? ""} status={detail.status} />
            {(detail.parentSessionId || detail.parentSpanId || detail.childCount > 0) && (
              <button
                onClick={() => setTreeOpen(true)}
                title={
                  detail.parentSpanId
                    ? "点击查看会话父子链（本会话由父会话的工具调用派生）"
                    : "点击查看会话父子链"
                }
                className="cursor-pointer rounded-sm bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info ring-1 ring-info/30"
              >
                {detail.childCount > 0 ? `子会话 ${detail.childCount}` : "父链"}
              </button>
            )}
            <StatChip
              label="Tool"
              value={
                <>
                  {metricOf.toolCalls}{" "}
                  {failedToolCount > 0 && (
                    <span className="text-destructive">({failedToolCount} failed)</span>
                  )}
                </>
              }
              ratio={ratioOf("toolCalls", metricOf.toolCalls)}
            />
            <StatChip
              label="Tool/LLM"
              value={metricOf.toolsPerLlm.toFixed(2)}
              ratio={ratioOf("toolsPerLlm", metricOf.toolsPerLlm)}
            />
            {/* 排障分叉：慢在模型（思考占比高）还是慢在工具（工具占比高）。
                占比是有界值，不挂倍数徽章——89% 相对中位 52% 的「×1.7」会误导成量级膨胀 */}
            <StatChip
              label="思考占比"
              value={
                metricOf.thinkSharePct > 0
                  ? `${metricOf.thinkSharePct}% / ${100 - metricOf.thinkSharePct}%`
                  : "—"
              }
            />
            {detail.baseline ? (
              <span
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                  detail.baseline.scope === "agent"
                    ? "bg-muted text-muted-foreground"
                    : "bg-warning/10 text-warning ring-1 ring-warning/30",
                )}
                title={
                  detail.baseline.scope === "agent"
                    ? `基准来自该 Agent 近 ${detail.baseline.windowDays} 天的 ${detail.baseline.samples} 个会话`
                    : `该 Agent 近 ${detail.baseline.windowDays} 天仅 ${detail.baseline.agentSamples ?? 0} 个有效会话，不足判定阈值，退回全局基准（n=${detail.baseline.samples}）`
                }
              >
                {detail.baseline.scope === "agent"
                  ? `本 Agent 基准 n=${detail.baseline.samples}`
                  : `全局基准 n=${detail.baseline.samples}`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={detail.status} />
          <div className="mr-1 flex items-center gap-1 rounded-lg bg-muted/50 p-1">
            <Button
              variant={view === "timeline" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("timeline")}
            >
              Timeline
            </Button>
            <Button
              variant={view === "transcript" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("transcript")}
            >
              Transcript
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="刷新"
            onClick={() => setReloadToken((v) => v + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 主体：三栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：Span 层级树 */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card xl:w-72">
          <div className="z-10 border-b border-border bg-card px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Span Hierarchy
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin pb-4">
            <SpanTree
              detail={detail}
              selectedId={selectedSpanId}
              onSelect={(id) => setSelectedSpanId(id)}
              onDeselect={() => setSelectedSpanId(null)}
            />
          </div>
        </aside>

        {/* 中：Timeline / Transcript */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {view === "timeline" ? (
            <TraceTimeline
              spans={spans}
              totalSeconds={totalSeconds}
              selectedId={selectedSpanId}
              onSelect={(id) => {
                setSelectedSpanId(id);
                // 右栏回到 Span 详情；若选中的是 LLM 调用，两图对应柱体仍保持高亮
                setSelectedCall(null);
              }}
              onSelectCall={(id, v) => {
                // 点击柱体：右栏显示构成明细，同时同步高亮左树/甘特中对应的 LLM 条
                setSelectedCall({ id, view: v });
                setSelectedSpanId(id);
              }}
              highlightCallId={highlightCallId}
              revealSpanId={focusSpanId}
            />
          ) : (
            <TraceTranscript
              spans={spans}
              selectedId={selectedSpanId}
              onSelect={setSelectedSpanId}
            />
          )}
        </main>

        {/* 右：Span 详情 */}
        <aside className="w-[340px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card xl:w-96">
          <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {selectedCall ? "Token 构成明细" : "Span 详情"}
            </h2>
          </div>
          <div className="p-4 text-sm">
            {selectedCall && selectedCallInfo ? (
              <CallBreakdownPanel
                call={selectedCallInfo}
                view={selectedCall.view}
                onBack={() => setSelectedCall(null)}
              />
            ) : selectedSpan ? (
              <SpanDetails span={selectedSpan} totalSeconds={totalSeconds} />
            ) : (
              <p className="text-muted-foreground">
                点击左侧树或 Timeline 中的条查看详情；点击下方图表柱体可查看 Token 构成
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* 会话父子链面板 */}
      <SlidePanel
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        width={55}
        minWidth="480px"
        maxWidth="760px"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">会话父子链</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setTreeOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <SessionTreePanel sessionId={detail.id} />
        </div>
      </SlidePanel>
    </div>
  );
}

/**
 * header 指标 chip。
 *
 * ratio 存在时在数值右上角挂一个「×1.8」徽章：倍数跟着数字走，而不是另起一条对比横条
 * ——后者会和这里已有的 耗时/In/Out/Total/LLM/Tool 六个数字重复五项，还白占 40+ px 高度。
 */
function StatChip({
  label,
  value,
  valueClass,
  ratio,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  /** mult = 本会话值 / 中位数；over = 是否超过 P90 */
  ratio?: { mult: number; over: boolean; p50: number; p90: number; samples: number; scope: "agent" | "global" };
}) {
  const tone = !ratio
    ? ""
    : ratio.over
      ? "text-destructive"
      : ratio.mult >= 1.5
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div
      className="flex items-center gap-1.5 whitespace-nowrap"
      title={
        ratio
          ? `相对${ratio.scope === "agent" ? "本 Agent" : "全局（该 Agent 样本不足）"}近 30 天基线：` +
            `中位 ${ratio.p50.toLocaleString()} · P90 ${ratio.p90.toLocaleString()} · 样本 n=${ratio.samples}`
          : undefined
      }
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono font-medium", valueClass)}>{value}</span>
      {ratio && Number.isFinite(ratio.mult) && ratio.mult > 1.1 ? (
        <span
          className={cn(
            "rounded-sm bg-muted px-1 py-[1px] font-mono text-[10px] leading-none tabular-nums",
            tone,
          )}
        >
          ×{ratio.mult.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const text = status === "active" ? "Active" : status === "error" ? "Error" : "Completed";
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium",
        status === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-[var(--trace-tool)]/40 bg-[var(--trace-tool)]/10 text-[var(--trace-tool)]",
      )}
    >
      {text}
    </span>
  );
}

// ==================== 左侧 Span 层级树 ====================

function SpanTree({
  detail,
  selectedId,
  onSelect,
  onDeselect,
}: {
  detail: SessionDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}) {
  // 折叠的 Round（点击 Round 分组头切换）
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set());
  const toggleRound = useCallback((id: string) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      {/* Session 根节点 */}
      <div
        onClick={onDeselect}
        className={cn(
          "flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 transition-colors",
          selectedId === null ? "bg-primary/10" : "bg-muted/20 hover:bg-muted/30",
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
          S
        </span>
        <span className="text-sm font-bold">Session</span>
        <span className="text-xs text-muted-foreground">
          {detail.totalRounds} rounds · {detail.totalSpans} spans
        </span>
      </div>

      {detail.rounds.map((round) => (
        <RoundGroup
          key={round.id}
          round={round}
          collapsed={collapsedRounds.has(round.id)}
          onToggle={() => toggleRound(round.id)}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function RoundGroup({
  round,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  round: RoundNode;
  collapsed: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const roundSpans: SpanNode[] = [
    ...(round.inputSpan ? [round.inputSpan] : []),
    ...(round.systemPromptSpan ? [round.systemPromptSpan] : []),
    ...round.turns.flatMap((t) => t.spans),
    ...(round.answerSpan ? [round.answerSpan] : []),
  ];
  const roundDurationMs = roundSpans.reduce((sum, s) => sum + displayDurationMs(s), 0);
  const hasError = roundSpans.some(isFailed);

  return (
    <div className="mx-1.5 my-1.5 overflow-hidden rounded-lg border border-primary/25 bg-primary/5">
      {/* Round 分组头（点击折叠/展开） */}
      <div
        onClick={onToggle}
        title={collapsed ? "展开" : "折叠"}
        className="flex cursor-pointer select-none items-center gap-1.5 border-b border-primary/25 bg-primary/10 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-[var(--trace-agent)] hover:brightness-110"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        <span className="rounded-sm bg-primary/25 px-1.5 py-0.5 text-[9px] font-medium uppercase">
          Round
        </span>
        <span>{round.index + 1}</span>
        {hasError ? (
          <span className="ml-auto text-[11px] text-destructive">✕ FAILED</span>
        ) : (
          <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
            {formatDuration(roundDurationMs)}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Tool 行缩进一级，归属到其所属的 LLM 思考 */}
          {roundSpans.map((span) => (
            <TreeItem
              key={span.id}
              span={span}
              depth={isToolKind(span.kind) ? 1 : 0}
              selected={selectedId === span.id}
              onSelect={onSelect}
            />
          ))}

          {/* 分支（Fork）子分组 */}
          {(round.branches ?? []).map((branch) => (
            <div
              key={branch.id}
              className="mx-2 mb-2 overflow-hidden rounded-md border border-dashed border-primary/30"
            >
              <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 text-[10px] font-medium italic text-[var(--trace-agent)]">
                ⑂ Branch · {branch.name}
              </div>
              {branch.spans.map((span) => (
                <TreeItem
                  key={span.id}
                  span={span}
                  depth={1}
                  selected={selectedId === span.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TreeItem({
  span,
  depth,
  selected,
  onSelect,
}: {
  span: SpanNode;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = spanColor(span);
  const failed = isFailed(span);

  return (
    <div
      data-span-id={span.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(span.id);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors",
        selected ? "bg-primary/15" : "hover:bg-muted/40",
      )}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className={cn("flex-1 truncate", failed && "font-medium text-destructive")}>
        {span.name}
      </span>
      {span.tokens && (
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-[var(--trace-llm)]">{fmtTok(span.tokens.input)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-[var(--trace-tool)]">{fmtTok(span.tokens.output)}</span>
        </span>
      )}
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {formatDuration(displayDurationMs(span))}
      </span>
      {failed && <span className="text-xs text-destructive">✕</span>}
    </div>
  );
}

function fmtTok(n: number): string {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

// ==================== 右侧 Span 详情 ====================

function SpanDetails({ span, totalSeconds }: { span: TraceSpan; totalSeconds: number }) {
  const color = spanColor(span);
  const failed = isFailed(span);
  const startPct = totalSeconds > 0 ? (span.relStart / totalSeconds) * 100 : 0;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <h3 className="text-[15px] font-medium">{span.name}</h3>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <DetailCell label="类型" value={<span className="font-mono">{kindLabel(span.kind)}</span>} />
        <DetailCell
          label="状态"
          value={
            <span className={failed ? "text-destructive" : "text-[var(--trace-tool)]"}>
              {failed ? "错误" : "正常"}
            </span>
          }
        />
        <DetailCell label="开始" value={<span className="font-mono">{span.relStart.toFixed(2)}s</span>} />
        <DetailCell
          label="耗时"
          value={<span className="font-mono">{formatDuration(span.durationMs)}</span>}
        />
        {span.model && (
          <DetailCell label="模型" value={<span className="font-mono break-all">{span.model}</span>} />
        )}
        {span.roundIndex >= 0 && (
          <DetailCell label="轮次" value={<span className="font-mono">Round {span.roundIndex + 1}</span>} />
        )}
      </div>

      {span.tokens && (
        <div className="mb-4">
          <div className="mb-1 flex items-center gap-3 font-mono text-sm">
            <span>
              <span className="text-[var(--trace-llm)]">{span.tokens.input}</span>{" "}
              <span className="text-xs text-muted-foreground">输入</span>
            </span>
            <span>
              <span className="text-[var(--trace-tool)]">{span.tokens.output}</span>{" "}
              <span className="text-xs text-muted-foreground">输出</span>
            </span>
            <span className="text-muted-foreground">合计 {formatTokens(span.tokens.total)}</span>
          </div>
          <div className="mt-1 flex gap-3 font-mono text-[11px] text-muted-foreground">
            <span>缓存读 {formatTokens(span.tokens.cacheRead)}</span>
            <span>缓存写 {formatTokens(span.tokens.cacheWrite)}</span>
          </div>
          {/* 时间轴位置指示 */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(startPct, 100)}%`, background: color }}
            />
          </div>
        </div>
      )}

      <hr className="my-4 border-border" />

      <div className="space-y-3">
        {failed && span.error && (
          <div>
            <span className="text-xs text-destructive">错误信息</span>
            <pre className="mt-1 rounded bg-destructive/10 p-2.5 text-xs whitespace-pre-wrap text-destructive">
              {span.error}
            </pre>
          </div>
        )}
        {span.input && (
          <div>
            <span className="text-xs text-muted-foreground">
              {span.kind === "tool_call" ? "调用参数" : "输入"}
            </span>
            <Pre text={span.input} />
          </div>
        )}
        {span.output && (
          <div>
            <span className="text-xs text-muted-foreground">
              {span.kind === "tool_call" ? "执行结果" : "输出"}
            </span>
            <Pre text={span.output} />
          </div>
        )}
        {/* 采集端附加字段：老详情页的 SpanDetailPanel 有，浮窗里缺，这里补回来 */}
        {span.content && (
          <div>
            <span className="text-xs text-muted-foreground">内容</span>
            <Pre text={span.content} />
          </div>
        )}
        {span.details && (
          <div>
            <span className="text-xs text-muted-foreground">附加明细</span>
            <Pre text={span.details} />
          </div>
        )}
        {!span.input && !span.output && !span.content && !span.details && !failed && (
          <p className="text-xs text-muted-foreground">该 Span 无记录内容</p>
        )}
        <div className="font-mono text-[10px] text-muted-foreground/70">Span ID: {span.id}</div>
      </div>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function Pre({ text }: { text: string }) {
  const MAX = 4000;
  const shown = text.length > MAX ? text.slice(0, MAX) + `\n…（已截断，共 ${text.length} 字符）` : text;
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-all">
      {shown}
    </pre>
  );
}

// ==================== Token 调用构成明细（点击图表柱体后展示） ====================

function CallBreakdownPanel({
  call,
  view,
  onBack,
}: {
  call: CallInfo;
  view: "prompt" | "new";
  onBack: () => void;
}) {
  // 三档真值：上下文规模 / 新增（未命中缓存）/ 复用（缓存读）
  const prompt = Math.max(call.prompt, 1);
  const freshPct = (call.fresh / prompt) * 100;
  const reusePct = (call.reuse / prompt) * 100;
  const fresh = Math.max(call.fresh, 1);

  return (
    <div>
      {/* 头部：返回 + 调用标识 */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="返回 Span 详情"
        >
          ← 返回
        </button>
        <h3 className="text-[15px] font-medium">
          第 {call.order} 次 LLM 调用 · {view === "prompt" ? "上下文构成" : "新增构成"}
        </h3>
      </div>

      {/* 调用基本信息 */}
      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <DetailCell
          label="时间"
          value={<span className="font-mono">{call.time.toFixed(2)}s</span>}
        />
        <DetailCell
          label="耗时"
          value={<span className="font-mono">{call.duration.toFixed(2)}s</span>}
        />
        <DetailCell label="轮次" value={<span className="font-mono">Round {call.roundIndex + 1}</span>} />
        {call.model && (
          <DetailCell label="模型" value={<span className="font-mono break-all">{call.model}</span>} />
        )}
      </div>

      {/* 三档真实值 */}
      <div className="mb-4 space-y-2.5">
        <TokenRow
          label="上下文规模"
          value={call.prompt}
          pct={100}
          colorVar="--muted-foreground"
          desc="input + 缓存读 + 缓存写"
        />
        <TokenRow
          label="新增（未命中缓存）"
          value={call.fresh}
          pct={freshPct}
          colorVar="--chart-new"
          desc="本次新拼入上下文的部分"
        />
        <TokenRow
          label="复用（缓存读）"
          value={call.reuse}
          pct={reusePct}
          colorVar="--chart-bar-in"
          desc="命中提示缓存的已有前缀，无需重新计算"
        />
        <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
          <span className="text-muted-foreground">本次输出（不计入输入）</span>
          <span className="font-mono">{formatTokens(call.output)}</span>
        </div>
      </div>

      {/* 新增内部构成（估算） */}
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">新增内部构成</span>
        <span className="text-[10px] text-muted-foreground/70">按来源字符数估算</span>
      </div>
      <div className="space-y-2.5">
        {call.parts.length === 0 && (
          <p className="text-xs text-muted-foreground">该调用没有新增输入（全部命中缓存）</p>
        )}
        {call.parts.map((p) => {
          const pct = (p.value / fresh) * 100;
          return (
            <div key={p.key} title={p.desc}>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: `var(${p.colorVar})` }}
                />
                <span className="flex-1 truncate">{p.label}</span>
                <span className="font-mono font-medium">{formatTokens(p.value)}</span>
                <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 ml-[18px] h-1.5 overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(pct, 100)}%`, background: `var(${p.colorVar})` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 合计 + 说明 */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">新增合计</span>
        <span className="font-mono text-sm font-semibold">{formatTokens(call.fresh)}</span>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/70">
        口径：上下文规模 = input + 缓存读 + 缓存写（API 上报真实值）；新增 = 未命中缓存的部分
        = input + 缓存写。新增内部哪部分是文件、哪部分是工具结果，API 不提供，按各来源字符数
        估算（≈4 字符/token，汉字按 0.7 token/字）；填不满的部分记为「未归因」——多为没命中
        缓存被整段重算的旧上下文，或采集端截断的系统提示 / 未记录的工具定义。
      </p>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
        多数采集端不上报缓存写（本库真实会话为 0），因此新增实际等于未缓存的 input，
        量级通常只有几百 token —— 这是正常的，不是漏算。
      </p>
    </div>
  );
}

/** 一行 token 真值：颜色块 + 名称 + 数值 + 占比条 */
function TokenRow({
  label,
  value,
  pct,
  colorVar,
  desc,
}: {
  label: string;
  value: number;
  pct: number;
  colorVar: string;
  desc?: string;
}) {
  return (
    <div title={desc}>
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(${colorVar})` }} />
        <span className="flex-1 truncate">{label}</span>
        <span className="font-mono font-medium">{formatTokens(value)}</span>
        <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 ml-[18px] h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, background: `var(${colorVar})` }}
        />
      </div>
    </div>
  );
}
