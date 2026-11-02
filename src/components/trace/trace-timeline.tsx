"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildCalls,
  buildGroups,
  isFailed,
  spanColor,
  type CallInfo,
  type SpanGroup,
  type TraceSpan,
} from "./trace-helpers";

const LABEL_W = "w-48"; // 标签列宽度：时间轴 / 甘特图 / 图表严格共用，保证纵向对齐
const BAR_H = 18;

interface Props {
  spans: TraceSpan[];
  totalSeconds: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectCall?: (callId: string, view: "prompt" | "new") => void;
  /** 当前高亮的 LLM 调用（call.id = llm_thinking span.id）：左树/甘特/两图同步标记 */
  highlightCallId?: string | null;
  /**
   * 需要「露出来」的 span：深链落地时把甘特缩放域收到该 span 附近。
   * 全量域下一条 50ms 的 span 不足 1px 宽，仅高亮等于看不见。
   * 只在值变化时触发一次，不跟随用户后续的选中项走，避免点树时甘特乱跳。
   */
  revealSpanId?: string | null;
}

interface Domain {
  start: number;
  end: number;
}

export function TraceTimeline({
  spans,
  totalSeconds,
  selectedId,
  onSelect,
  onSelectCall,
  highlightCallId,
  revealSpanId,
}: Props) {
  const groups = useMemo(() => buildGroups(spans), [spans]);

  // 缩放域（秒）：null = 全量。甘特图与下方两张图表各自独立缩放，互不联动。
  const [ganttDomain, setGanttDomain] = useState<Domain | null>(null);
  const [chartDomain, setChartDomain] = useState<Domain | null>(null);
  const gEff = ganttDomain ?? { start: 0, end: totalSeconds };
  const ganttDomainRef = useRef(gEff);
  ganttDomainRef.current = gEff;
  const axisTrackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 会话切换时复位缩放
  useEffect(() => {
    setGanttDomain(null);
    setChartDomain(null);
  }, [spans]);

  // 深链定位：把甘特域收到目标 span 所在分组（声明在复位 effect 之后，保证这一帧以它为准）
  useEffect(() => {
    if (!revealSpanId) return;
    const target = spans.find((s) => s.id === revealSpanId);
    if (!target) return;
    const end = target.relStart + target.timelineMs / 1000;
    const group = groups.find((g) => g.rows.some((r) => r.spans.some((s) => s.id === revealSpanId)));
    // 以「span 本身 + 一个分组宽度的余量」为窗口，太窄时给 2s 兜底
    const groupSpan = group ? group.endSec - group.startSec : 0;
    const pad = Math.max(Math.min(groupSpan, (end - target.relStart) * 4), 1);
    setGanttDomain({
      start: Math.max(0, target.relStart - pad),
      end: Math.min(totalSeconds, end + pad),
    });
  }, [revealSpanId, spans, groups, totalSeconds]);

  // 滚轮缩放：甘特图内 → 缩放甘特时间轴；下方两张柱状图内 → 缩放图表域（两图共用）；
  // 其余位置（中间列空白处等）→ 不拦截，交给浏览器原生上下滚动。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const scope = target?.closest?.("[data-zoom-scope]")?.getAttribute("data-zoom-scope");
      if (scope !== "gantt" && scope !== "charts") return; // 原生滚动，不拦截
      e.preventDefault();
      const wantCharts = scope === "charts";
      const d = wantCharts ? (chartDomain ?? { start: 0, end: totalSeconds }) : ganttDomainRef.current;
      const span0 = Math.max(d.end - d.start, 0.001);
      const factor = Math.exp(e.deltaY * 0.0012); // 向下滚 = 缩小（zoom out）
      const minSpan = Math.max(totalSeconds / 2000, 0.05);
      const newSpan = Math.min(Math.max(span0 * factor, minSpan), totalSeconds);
      // 锚点：光标在当前缩放轨道（data-zoom-track）内的水平位置
      const track = target?.closest?.("[data-zoom-track]") as HTMLElement | null;
      const rect = track?.getBoundingClientRect();
      let frac = 0.5;
      if (rect && rect.width > 0) {
        frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      }
      const anchor = d.start + frac * span0;
      let ns = anchor - (anchor - d.start) * (newSpan / span0);
      let ne = ns + newSpan;
      if (ns < 0) {
        ne -= ns;
        ns = 0;
      }
      if (ne > totalSeconds) {
        const shift = ne - totalSeconds;
        ns = Math.max(ns - shift, 0);
        ne = totalSeconds;
      }
      if (wantCharts) setChartDomain({ start: ns, end: ne });
      else setGanttDomain({ start: ns, end: ne });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [totalSeconds, chartDomain]);

  const spanSec = gEff.end - gEff.start;
  const px = useCallback(
    (t: number) => ((t - gEff.start) / Math.max(spanSec, 0.001)) * 100,
    [gEff, spanSec],
  );
  const fmtTick = useCallback(
    (t: number) => {
      if (spanSec <= 10) return `${t.toFixed(1)}s`;
      if (t < 60) return `${t.toFixed(0)}s`;
      return `${(t / 60).toFixed(1)}m`;
    },
    [spanSec],
  );
  const ticks = Array.from({ length: 6 }, (_, i) => gEff.start + (spanSec * i) / 5);

  /** 双击某个 Round / Branch：以该组起止为左右边界聚焦甘特时间轴（仅甘特图） */
  const focusGroup = useCallback(
    (g: SpanGroup) => {
      const pad = Math.max((g.endSec - g.startSec) * 0.08, 0.5);
      setGanttDomain({
        start: Math.max(0, g.startSec - pad),
        end: Math.min(totalSeconds, g.endSec + pad),
      });
    },
    [totalSeconds],
  );

  /** 双击复位：按光标所在区域只复位对应域 */
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const scope = target?.closest?.("[data-zoom-scope]")?.getAttribute("data-zoom-scope");
    if (scope === "charts") setChartDomain(null);
    else setGanttDomain(null);
  }, []);

  return (
    <div
      ref={scrollRef}
      onDoubleClick={handleDoubleClick}
      className="flex-1 overflow-auto scrollbar-thin"
      title="甘特图内滚轮缩放时间轴 · 柱状图内滚轮缩放图表 · 空白处滚轮上下滚动 · 双击复位 · 点击柱体查看构成 · 选中块后 ←/→ 逐块跳转"
    >
      <div className="relative min-w-[860px] p-4 pb-3 pr-10">
        {/* 时间轴（甘特图专用缩放域） */}
        <div data-zoom-scope="gantt" className="mb-1.5 flex items-center text-[11px] text-muted-foreground">
          <div className={cn(LABEL_W, "shrink-0 pr-3 text-right")}>
            {ganttDomain ? (
              <span className="text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            ) : (
              <span className="text-[10px]">已剔除轮间空闲</span>
            )}
          </div>
          <div ref={axisTrackRef} data-zoom-track="1" className="flex flex-1">
            {ticks.map((t, i) => (
              <div key={i} className={cn("flex-1 pr-1", i === ticks.length - 1 && "text-right")}>
                {fmtTick(t)}
              </div>
            ))}
          </div>
        </div>

        {/* 甘特行：Round / Branch 分组框（缩放域：甘特独立） */}
        <div data-zoom-scope="gantt" className="timeline-grid relative">
          {groups.map((group) => (
            <div
              key={group.id}
              className={cn(
                "my-1.5 rounded-md border py-1",
                group.isBranch
                  ? "border-dashed border-primary/25"
                  : "border-primary/25 bg-primary/5",
              )}
            >
              {/* 分组头：双击以该 Round/Branch 为边界聚焦时间轴 */}
              <div
                className="relative flex h-7 cursor-pointer items-center"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  focusGroup(group);
                }}
                title={`双击以 ${group.title} 的起止时间缩放时间轴`}
              >
                <div
                  className={cn(
                    LABEL_W,
                    "flex shrink-0 items-center justify-end gap-1.5 truncate pr-3 text-[11px] hover:brightness-125",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      group.failed ? "bg-destructive" : "bg-[var(--trace-agent)]",
                    )}
                  />
                  <span
                    className={cn(
                      "font-medium text-[var(--trace-agent)]",
                      group.isBranch && "italic",
                    )}
                  >
                    {group.title}
                  </span>
                </div>
                <div className="relative h-full flex-1 overflow-hidden">
                  <div
                    className="absolute top-[5px] h-[18px] rounded-sm bg-[var(--trace-agent)] opacity-40 transition-[filter] hover:brightness-125"
                    style={{
                      left: `${px(group.startSec)}%`,
                      width: `${Math.max(px(group.endSec) - px(group.startSec), 0.2)}%`,
                    }}
                  />
                </div>
              </div>
              {/* 逻辑行（Tool 归属于 LLM 调用，标签缩进一级；并行执行上下泳道堆叠） */}
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  className="relative flex items-center"
                  style={{ height: 28 * row.laneCount }}
                >
                  <div
                    className={cn(
                      LABEL_W,
                      "flex h-full shrink-0 items-center justify-end gap-1.5 truncate text-[11px]",
                    )}
                    style={{ paddingRight: row.depth > 0 ? 30 : 12 }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: spanColor(row.spans[0]) }}
                    />
                    <span
                      className={cn(
                        "truncate",
                        row.depth > 0 ? "text-muted-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {row.label}
                      {row.laneCount > 1 && (
                        <span className="ml-1 text-[9px] text-muted-foreground/60">
                          ×{row.laneCount} 并行
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="relative h-full flex-1 overflow-hidden">
                    {row.spans.map((s) => {
                      const left = px(s.relStart);
                      const width = Math.max(
                        px(s.relStart + s.timelineMs / 1000) - left,
                        0.2,
                      );
                      const failed = isFailed(s);
                      const lane = row.laneOf[s.id] ?? 0;
                      return (
                        <div
                          key={s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(s.id);
                          }}
                          className={cn(
                            "span-bar absolute cursor-pointer rounded-sm transition-[filter] hover:brightness-125",
                            selectedId === s.id &&
                              "z-[5] outline-2 outline-offset-1 outline-foreground",
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: 5 + lane * 28,
                            height: BAR_H,
                            background: spanColor(s),
                            ...(failed
                              ? { boxShadow: "inset 0 0 0 1px rgba(248,81,73,0.8)" }
                              : {}),
                          }}
                          title={`${s.name}\n${s.relStart.toFixed(1)}s → ${(s.relStart + s.timelineMs / 1000).toFixed(1)}s (${(s.timelineMs / 1000).toFixed(2)}s)${row.laneCount > 1 ? `\n并行泳道 ${(lane ?? 0) + 1}/${row.laneCount}` : ""}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无 Span 数据</p>
          )}
        </div>

        {/* 甘特图底部进度条：拖动平移甘特可视窗口 */}
        <div data-zoom-scope="gantt" className="mt-1.5 flex items-center">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="flex-1">
            <DomainScrollbar domain={gEff} total={totalSeconds} onChange={setGanttDomain} />
          </div>
        </div>

        {/* 累计 Token（折线 + 堆叠柱）与 每次调用增量（构成堆叠柱），独立缩放域 */}
        <div data-zoom-scope="charts">
          <TokenCharts
            spans={spans}
            domain={chartDomain ?? { start: 0, end: totalSeconds }}
            zoomed={chartDomain !== null}
            totalSeconds={totalSeconds}
            onDomainChange={setChartDomain}
            onSelectCall={onSelectCall}
            highlightCallId={highlightCallId}
          />
        </div>
      </div>
    </div>
  );
}

// ==================== Canvas 图表 ====================

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function fmtTokShort(n: number): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

/** 等宽柱布局：可视域内的调用平均分槽位 */
interface Slot {
  call: CallInfo;
  cx: number; // 槽位中心 px
}

function TokenCharts({
  spans,
  domain,
  zoomed,
  totalSeconds,
  onDomainChange,
  onSelectCall,
  highlightCallId,
}: {
  spans: TraceSpan[];
  domain: Domain;
  zoomed: boolean;
  totalSeconds: number;
  onDomainChange: (d: Domain) => void;
  onSelectCall?: (callId: string, view: "prompt" | "new") => void;
  highlightCallId?: string | null;
}) {
  const lineRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const slotsRef = useRef<Slot[]>([]);

  const calls = useMemo(() => buildCalls(spans), [spans]);

  // 可视域内的调用（按调用起点落在域内判定）
  const visible = useMemo(
    () => calls.filter((c) => c.time >= domain.start - 0.001 && c.time <= domain.end + 0.001),
    [calls, domain],
  );

  // Round 分区：可视域内连续同 Round 的调用槽位区间
  const roundRanges = useMemo(() => {
    const ranges: Array<{ roundIndex: number; start: number; end: number }> = [];
    visible.forEach((call, i) => {
      const ri = call.roundIndex;
      const last = ranges[ranges.length - 1];
      if (last && last.roundIndex === ri) last.end = i;
      else ranges.push({ roundIndex: ri, start: i, end: i });
    });
    return ranges;
  }, [visible]);

  const setupCanvas = (canvas: HTMLCanvasElement, cssH: number) => {
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? 0;
    canvas.width = Math.max(cssW, 1) * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH };
  };

  const fmtAxis = (v: number): string => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1000) return (v / 1000).toFixed(1) + "k";
    return String(Math.round(v));
  };

  /** 网格线：纵向铺满，横向对齐柱体缩放区 [top, bottom]，标签完整不裁切 */
  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    maxVal: number,
    yDivisions: number,
    top: number,
    bottom: number,
  ) => {
    ctx.strokeStyle = cssVar("--chart-grid", "rgba(48,54,61,0.55)");
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i <= 10; i++) {
      const x = (w / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 0; i <= yDivisions; i++) {
      const y = top + ((bottom - top) / yDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yDivisions; i++) {
      const val = maxVal * (1 - i / yDivisions);
      const y = top + ((bottom - top) / yDivisions) * i;
      ctx.fillText(fmtAxis(val), 2, y);
    }
    ctx.textBaseline = "alphabetic";
  };

  const slotLayout = (w: number): Slot[] => {
    const n = visible.length;
    if (n === 0) return [];
    const slotW = w / n;
    return visible.map((call, i) => ({ call, cx: slotW * (i + 0.5) }));
  };

  /** Round 分区背景：交替底色 + 分隔线 + 顶部 Round 标签（slotW 为槽位宽） */
  const drawRoundBands = (
    ctx: CanvasRenderingContext2D,
    slotW: number,
    top: number,
    bottom: number,
  ) => {
    if (roundRanges.length === 0) return;
    const h0 = 4; // 槽位布局的整体左偏移（与柱体 x 偏移一致）
    roundRanges.forEach((r, i) => {
      const x0 = h0 + slotW * r.start;
      const w0 = slotW * (r.end - r.start + 1);
      // 交替底色
      if (i % 2 === 1) {
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
        ctx.fillRect(x0, top, w0, bottom - top);
        ctx.globalAlpha = 1;
      }
      // 分隔线（每段起点，首段除外）
      if (i > 0) {
        ctx.strokeStyle = cssVar("--chart-grid", "rgba(48,54,61,0.55)");
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, top);
        ctx.lineTo(x0, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 顶部 Round 标签（区间足够宽时）
      if (w0 > 44) {
        ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`Round ${r.roundIndex + 1}`, x0 + w0 / 2, 9);
      }
    });
    ctx.textAlign = "left";
  };

  /** 图 1：上下文规模——每次调用的 prompt（堆叠：新增在下、复用在上） */
  const drawPrompt = useCallback(() => {
    const canvas = lineRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 140);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const w = cssW;
    const h = cssH;
    const top = 18;
    const bottom = h - 8;
    const slots = slotLayout(w - 8);
    slotsRef.current = slots;
    const maxPrompt = Math.max(...slots.map((s) => s.call.prompt), 1);
    const scale = (v: number) => (v / maxPrompt) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max(((w - 8) / slots.length) * 0.55, 6), 30) : 0;
    const baseY = bottom;
    const showNums = barW >= 12; // 柱宽足够时才绘制数字，避免全览时密集噪点

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxPrompt, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, (w - 8) / slots.length, top, bottom);

    // 堆叠：缓存读（复用）贴基线，新增叠在最上方
    const freshColor = cssVar("--chart-new", "#f0883e");
    const reuseColor = cssVar("--chart-bar-in", "rgba(88,166,255,0.8)");
    for (const s of slots) {
      const freshH = scale(s.call.fresh);
      const reuseH = scale(s.call.reuse);
      const totalH = freshH + reuseH;
      const x = s.cx - barW / 2 + 4;
      if (reuseH > 0) {
        ctx.fillStyle = reuseColor;
        ctx.fillRect(x, baseY - reuseH, barW, reuseH);
      }
      if (freshH > 0) {
        const hFresh = Math.max(freshH, 1);
        ctx.fillStyle = freshColor;
        ctx.fillRect(x, baseY - reuseH - hFresh, barW, hFresh);
      }
      // 同步高亮：当前选中的调用柱描边标记
      if (highlightCallId && s.call.id === highlightCallId) {
        ctx.strokeStyle = cssVar("--foreground", "#e6edf3");
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1.5, baseY - totalH - 2, barW + 3, totalH + 4);
      }
      // 柱顶标注上下文规模
      if (!showNums) continue;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = cssVar("--foreground", "#e6edf3");
      ctx.fillText(fmtTokShort(s.call.prompt), s.cx + 4, Math.max(baseY - totalH - 4, 11));
    }
    ctx.restore();
  }, [visible, roundRanges, highlightCallId]);

  /** 图 2：新增输入构成——柱高为真实新增（未命中缓存），分段为按字符占比分摊的估算 */
  const drawFresh = useCallback(() => {
    const canvas = barRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 120);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const w = cssW;
    const h = cssH;
    const top = 18;
    const bottom = h - 8;
    const slots = slotLayout(w - 8);
    const maxFresh = Math.max(...slots.map((s) => s.call.fresh), 1);
    const scale = (v: number) => (v / maxFresh) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max(((w - 8) / slots.length) * 0.55, 6), 30) : 0;
    const baseY = bottom;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxFresh, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, (w - 8) / slots.length, top, bottom);

    // 新增来源构成：自下而上堆叠（part.value 之和恰等于 call.fresh）
    for (const s of slots) {
      let yCursor = baseY;
      const x = s.cx - barW / 2 + 4;
      for (const part of s.call.parts) {
        const segH = scale(part.value);
        if (segH <= 0) continue;
        ctx.fillStyle = cssVar(part.colorVar, "#8b949e");
        ctx.fillRect(x, yCursor - segH, barW, segH);
        yCursor -= segH;
      }
      // 同步高亮：当前选中的调用柱描边标记
      if (highlightCallId && s.call.id === highlightCallId) {
        ctx.strokeStyle = cssVar("--foreground", "#e6edf3");
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1.5, yCursor - 2, barW + 3, baseY - yCursor + 4);
      }
      // 新增总量标注在柱顶上方（柱宽足够时才绘制，避免全览时密集噪点）
      if (baseY - yCursor > 0 && barW >= 12) {
        ctx.fillStyle = cssVar("--foreground", "#e6edf3");
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(fmtTokShort(s.call.fresh), s.cx + 4, Math.max(yCursor - 4, 12));
      }
    }
    ctx.restore();
  }, [visible, roundRanges, highlightCallId]);

  const drawAll = useCallback(() => {
    drawPrompt();
    drawFresh();
  }, [drawPrompt, drawFresh]);

  useEffect(() => {
    drawAll();
    const wrap = lineRef.current?.parentElement?.parentElement;
    let ro: ResizeObserver | null = null;
    if (wrap && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(drawAll);
      ro.observe(wrap);
    }
    // 主题切换时重绘（颜色来自 CSS 变量）
    const mo = new MutationObserver(drawAll);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [drawAll]);

  /** 点击柱体：按槽位定位调用，通知右栏展示构成明细 */
  const slotIndexFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = e.currentTarget;
    const w = canvas.clientWidth - 8;
    const n = slotsRef.current.length;
    if (n === 0) return -1;
    const slotW = w / n;
    const i = Math.floor(e.nativeEvent.offsetX / slotW);
    return i >= 0 && i < n ? i : -1;
  };

  const handlePromptClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = slotIndexFromEvent(e);
    if (i >= 0) onSelectCall?.(slotsRef.current[i].call.id, "prompt");
  };

  const handleFreshClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = slotIndexFromEvent(e);
    if (i >= 0) onSelectCall?.(slotsRef.current[i].call.id, "new");
  };

  const legendSwatch = (colorVar: string, label: string, title?: string) => (
    <span key={label} className="flex items-center gap-1 whitespace-nowrap" title={title}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: `var(${colorVar})` }}
      />
      {label}
    </span>
  );

  return (
    <>
      {/* 图 1：上下文规模（每次调用的 prompt 总量），柱区全宽 */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex shrink-0 flex-col pl-1">
            <span className="text-xs font-medium text-muted-foreground">上下文规模 · 每次调用</span>
            <span className="text-[10px] text-muted-foreground/60">
              柱高 = input + 缓存读写
            </span>
            {zoomed && (
              <span className="text-[9px] text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 pr-2 text-[10px] text-muted-foreground">
            {legendSwatch("--chart-bar-in", "复用（缓存读）", "命中提示缓存的已有前缀：系统提示、工具定义、历史轮次、旧工具结果，直接复用无需重算。真实值")}
            {legendSwatch("--chart-new", "新增（未命中缓存）", "本次调用新拼入上下文、没能命中提示缓存的部分 = input + 缓存写。真实值")}
            <span className="hidden sm:inline">点击柱体看明细</span>
          </div>
        </div>
        <div className="relative" data-zoom-track="1">
          <canvas
            ref={lineRef}
            className="block cursor-pointer"
            onClick={handlePromptClick}
          />
        </div>
        {/* 柱状图底部进度条 */}
        <div className="mt-1.5">
          <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
        </div>
      </div>

      {/* 图 2：新增输入构成（柱高真实，分段按字符占比分摊估算），柱区全宽 */}
      <div className="mt-3 border-t border-border pb-1 pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex shrink-0 flex-col pl-1">
            <span className="text-xs font-medium text-muted-foreground">新增输入构成</span>
            <span className="text-[10px] text-muted-foreground/60">
              柱高真实 · 分段按字符占比分摊
            </span>
            {zoomed && (
              <span className="text-[9px] text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 pr-2 text-[10px] text-muted-foreground">
            {legendSwatch("--call-assistant", "上轮输出", "上一轮模型输出（含 tool_calls）作为本轮输入重新送入")}
            {legendSwatch("--call-fileread", "文件读取", "read 类工具返回的文件内容（按字符数估算）")}
            {legendSwatch("--call-tool", "工具结果", "bash / grep / 写文件等其余工具的执行结果（按字符数估算）")}
            {legendSwatch("--call-user", "用户输入", "本轮用户提问（按字符数估算）")}
            {legendSwatch("--call-sys", "系统提示", "本轮注入的 System Prompt（按字符数估算）")}
            {legendSwatch("--call-tooldefs", "工具定义", "请求携带的工具/Schema 定义（按采集字符数估算）")}
            {legendSwatch("--call-other", "未归因", "新增里无法归到具体来源的部分：没命中缓存被重算的旧上下文，或采集端截断的系统提示/工具定义")}
          </div>
        </div>
        <div className="relative" data-zoom-track="1">
          <canvas
            ref={barRef}
            className="block cursor-pointer"
            onClick={handleFreshClick}
          />
        </div>
        {/* 柱状图底部进度条 */}
        <div className="mt-1.5">
          <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
        </div>
      </div>
    </>
  );
}

// ==================== 可拖动进度条（可视窗口指示） ====================

function DomainScrollbar({
  domain,
  total,
  onChange,
}: {
  domain: Domain;
  total: number;
  onChange: (d: Domain) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const grabRef = useRef(0);

  const span = Math.max(domain.end - domain.start, 0.001);
  const full = Math.max(total, span, 0.001);
  const leftPct = Math.min(Math.max((domain.start / full) * 100, 0), 100);
  const widthPct = Math.min(Math.max((span / full) * 100, 1.5), 100);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * full;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const t = timeAt(e.clientX);
    const onThumb = !!(e.target as HTMLElement).closest?.("[data-thumb]");
    if (onThumb) {
      grabRef.current = t - domain.start;
    } else {
      // 点击空白处：窗口居中跳转到点击位置，并继续拖动
      const ns = Math.min(Math.max(t - span / 2, 0), Math.max(full - span, 0));
      grabRef.current = t - ns;
      onChange({ start: ns, end: ns + span });
    }
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const t = timeAt(e.clientX);
    const ns = Math.min(Math.max(t - grabRef.current, 0), Math.max(full - span, 0));
    if (ns !== domain.start) onChange({ start: ns, end: ns + span });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="relative h-3 cursor-pointer rounded-full bg-muted/50 hover:bg-muted/70"
      title="拖动平移时间轴"
    >
      <div
        data-thumb="1"
        className="absolute top-0 h-full rounded-full bg-primary/40 transition-colors hover:bg-primary/60"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
    </div>
  );
}
