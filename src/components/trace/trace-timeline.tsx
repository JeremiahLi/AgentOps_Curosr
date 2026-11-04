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

const LABEL_W = "w-32"; // 甘特左侧标题列：左对齐且收窄，把横向空间让给时间轴
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

/** 光标锚点缩放。缩到全量时返回 null。 */
function applyZoom(
  current: Domain,
  total: number,
  factor: number,
  frac: number,
  minSpan: number,
): Domain | null {
  if (!(total > 0)) return null;
  const span0 = Math.max(current.end - current.start, 1e-6);
  const newSpan = Math.min(Math.max(span0 * factor, minSpan), total);
  const f = Math.min(Math.max(frac, 0), 1);
  const anchor = current.start + f * span0;
  let ns = anchor - f * newSpan;
  let ne = ns + newSpan;
  if (ns < 0) {
    ne -= ns;
    ns = 0;
  }
  if (ne > total) {
    const shift = ne - total;
    ns = Math.max(0, ns - shift);
    ne = total;
  }
  if (ns <= 1e-4 && ne >= total - 1e-4) return null;
  return { start: ns, end: ne };
}

/** 平移窗口，碰到两端时夹住，不改变窗口宽度。 */
function applyPan(origin: Domain, total: number, delta: number): Domain | null {
  if (!(total > 0)) return null;
  const span = origin.end - origin.start;
  if (span >= total - 1e-4) return null;
  let ns = origin.start + delta;
  let ne = origin.end + delta;
  if (ns < 0) {
    ne -= ns;
    ns = 0;
  }
  if (ne > total) {
    const shift = ne - total;
    ns = Math.max(0, ns - shift);
    ne = total;
  }
  return { start: ns, end: ne };
}

/** 柱状图画布左右各留 4px，甘特图轨道本身就是时间轴。 */
function trackBox(track: HTMLElement): { width: number; left: number } {
  const rect = track.getBoundingClientRect();
  const inset = track.querySelector("canvas") ? 4 : 0;
  return {
    width: Math.max(rect.width - inset * 2, 1),
    left: rect.left + inset,
  };
}

/** 光标在当前图绘图区上的水平比例（0–1），用作缩放锚点。 */
function anchorFraction(target: EventTarget | null, clientX: number, clientY: number): number {
  const el = target as HTMLElement | null;
  const scope = el?.closest?.("[data-zoom-scope]") as HTMLElement | null;
  let track = el?.closest?.("[data-zoom-track]") as HTMLElement | null;
  if (!track && scope) {
    const tracks = Array.from(scope.querySelectorAll<HTMLElement>("[data-zoom-track]"));
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const t of tracks) {
      const r = t.getBoundingClientRect();
      const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    track = best;
  }
  if (!track) return 0.5;
  const box = trackBox(track);
  return Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
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
  const calls = useMemo(() => buildCalls(spans), [spans]);

  // 甘特域是时间（秒）。下方两张柱状图共用「调用序号」窗口（等宽柱，光标才能钉在柱体上）。
  // null = 全量。两套窗口互不联动。
  const [ganttDomain, setGanttDomain] = useState<Domain | null>(null);
  const [chartDomain, setChartDomain] = useState<Domain | null>(null);
  const gEff = ganttDomain ?? { start: 0, end: totalSeconds };
  const cEff = chartDomain ?? { start: 0, end: calls.length };
  const ganttDomainRef = useRef(gEff);
  const chartDomainRef = useRef(cEff);
  const totalSecondsRef = useRef(totalSeconds);
  const callsLenRef = useRef(calls.length);
  ganttDomainRef.current = gEff;
  chartDomainRef.current = cEff;
  totalSecondsRef.current = totalSeconds;
  callsLenRef.current = calls.length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const panCleanupRef = useRef<(() => void) | null>(null);

  const commitGantt = useCallback((d: Domain | null) => {
    const total = totalSecondsRef.current;
    if (!d || (d.start <= 1e-4 && d.end >= total - 1e-4)) setGanttDomain(null);
    else setGanttDomain(d);
  }, []);

  const commitChart = useCallback((d: Domain | null) => {
    const total = callsLenRef.current;
    if (!d || total <= 0 || (d.start <= 1e-3 && d.end >= total - 1e-3)) setChartDomain(null);
    else setChartDomain(d);
  }, []);

  // 会话切换时复位缩放
  useEffect(() => {
    setGanttDomain(null);
    setChartDomain(null);
  }, [spans]);

  useEffect(() => () => panCleanupRef.current?.(), []);

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

  // 普通滚轮：不拦截，中间列整列上下滚动。
  // Ctrl+滚轮：甘特图内以光标为中心缩放时间轴；柱状图内两图联动，以光标为中心缩放调用窗口。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const scope = target?.closest?.("[data-zoom-scope]")?.getAttribute("data-zoom-scope");
      if (scope !== "gantt" && scope !== "charts") return;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= el.clientHeight || 400;
      const factor = Math.exp(dy * 0.0012); // 向下滚 = 缩小
      const frac = anchorFraction(e.target, e.clientX, e.clientY);
      if (scope === "charts") {
        const total = callsLenRef.current;
        if (total <= 0) return;
        commitChart(applyZoom(chartDomainRef.current, total, factor, frac, 1));
      } else {
        const total = totalSecondsRef.current;
        if (total <= 0) return;
        commitGantt(applyZoom(ganttDomainRef.current, total, factor, frac, Math.max(total / 2000, 0.05)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commitChart, commitGantt]);

  /** 按住左键左右拖动：甘特平移时间轴，柱状图平移共用的调用窗口。 */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("[data-no-pan]")) return;
      const scopeEl = target.closest("[data-zoom-scope]") as HTMLElement | null;
      const scope = scopeEl?.getAttribute("data-zoom-scope");
      if ((scope !== "gantt" && scope !== "charts") || !scopeEl) return;
      const track =
        (target.closest("[data-zoom-track]") as HTMLElement | null) ??
        scopeEl.querySelector<HTMLElement>("[data-zoom-track]");
      if (!track) return;
      const { width } = trackBox(track);
      const isChart = scope === "charts";
      const origin = isChart ? chartDomainRef.current : ganttDomainRef.current;
      const total = isChart ? callsLenRef.current : totalSecondsRef.current;
      const span = origin.end - origin.start;
      if (total <= 0 || span >= total - 1e-4) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      let raf = 0;
      let dx = 0;
      const bag = {
        cleanup: () => {},
        onMove: (_ev: PointerEvent) => {},
        onUp: () => {},
      };

      const apply = () => {
        raf = 0;
        const next = applyPan(origin, total, -(dx / width) * span);
        if (isChart) commitChart(next);
        else commitGantt(next);
      };

      bag.cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", bag.onMove);
        window.removeEventListener("pointerup", bag.onUp);
        window.removeEventListener("pointercancel", bag.onUp);
        if (panCleanupRef.current === bag.cleanup) panCleanupRef.current = null;
      };

      bag.onMove = (ev: PointerEvent) => {
        dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved) {
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          // 更像上下滑动时不抢走点击
          if (Math.abs(dx) < Math.abs(dy)) {
            bag.cleanup();
            return;
          }
          moved = true;
          document.body.style.cursor = "grabbing";
        }
        ev.preventDefault();
        if (!raf) raf = requestAnimationFrame(apply);
      };

      bag.onUp = () => {
        if (moved) suppressClickRef.current = true;
        bag.cleanup();
      };

      panCleanupRef.current?.();
      panCleanupRef.current = bag.cleanup;
      window.addEventListener("pointermove", bag.onMove);
      window.addEventListener("pointerup", bag.onUp);
      window.addEventListener("pointercancel", bag.onUp);
    },
    [commitChart, commitGantt],
  );

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
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className="flex-1 select-none overflow-auto overscroll-contain scrollbar-thin"
      title="滚轮上下滚动整列 · Ctrl+滚轮以光标为中心缩放（甘特独立，下方两张柱状图联动）· 按住左键左右拖动平移 · 双击复位 · 点击柱体查看构成"
    >
      <div className="relative min-w-[860px] py-3 pr-3 pl-1.5">
        {/* 时间轴（甘特图专用缩放域） */}
        <div data-zoom-scope="gantt" className="mb-1.5 flex items-center text-[11px] text-muted-foreground">
          <div className={cn(LABEL_W, "shrink-0 truncate pr-2 pl-1 text-left")}>
            {ganttDomain ? (
              <span className="text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            ) : (
              <span className="text-[10px]">已剔除轮间空闲</span>
            )}
          </div>
          <div data-zoom-track="1" className="flex flex-1">
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
                    "flex min-w-0 shrink-0 items-center justify-start gap-1.5 pr-2 pl-1 text-[11px] hover:brightness-125",
                  )}
                  title={group.title}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      group.failed ? "bg-destructive" : "bg-[var(--trace-agent)]",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 truncate text-left font-medium text-[var(--trace-agent)]",
                      group.isBranch && "italic",
                    )}
                  >
                    {group.title}
                  </span>
                </div>
                <div data-zoom-track="1" className="relative h-full flex-1 overflow-hidden">
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
                      "flex h-full min-w-0 shrink-0 items-center justify-start gap-1.5 pr-2 text-[11px]",
                    )}
                    style={{ paddingLeft: row.depth > 0 ? 16 : 4 }}
                    title={row.label}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: spanColor(row.spans[0]) }}
                    />
                    <span
                      className={cn(
                        "min-w-0 truncate text-left",
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
                  <div data-zoom-track="1" className="relative h-full flex-1 overflow-hidden">
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
            <DomainScrollbar
              domain={gEff}
              total={totalSeconds}
              onChange={commitGantt}
              title="拖动平移甘特图"
            />
          </div>
        </div>

        {/* 累计 Token（折线 + 堆叠柱）与 每次调用增量（构成堆叠柱），独立缩放域 */}
        <div data-zoom-scope="charts">
          <TokenCharts
            spans={spans}
            domain={cEff}
            zoomed={chartDomain !== null}
            windowTotal={calls.length}
            onDomainChange={commitChart}
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
  windowTotal,
  onDomainChange,
  onSelectCall,
  highlightCallId,
}: {
  spans: TraceSpan[];
  /** 调用序号窗口：[start, end)，与甘特时间轴无关；两图共用 */
  domain: Domain;
  zoomed: boolean;
  windowTotal: number;
  onDomainChange: (d: Domain | null) => void;
  onSelectCall?: (callId: string, view: "prompt" | "new") => void;
  highlightCallId?: string | null;
}) {
  const lineRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);

  const calls = useMemo(() => buildCalls(spans), [spans]);

  // Round 分区：窗口内连续同 Round 的调用（下标是全局序号，方便按窗口平移）
  const roundRanges = useMemo(() => {
    const ranges: Array<{ roundIndex: number; start: number; end: number }> = [];
    calls.forEach((call, i) => {
      if (i >= domain.end || i + 1 <= domain.start) return;
      const last = ranges[ranges.length - 1];
      if (last && last.roundIndex === call.roundIndex) last.end = i;
      else ranges.push({ roundIndex: call.roundIndex, start: i, end: i });
    });
    return ranges;
  }, [calls, domain]);

  const setupCanvas = (canvas: HTMLCanvasElement, cssH: number) => {
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(Math.round(parent?.clientWidth ?? 0), 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH, dpr };
  };

  /** 对齐到物理像素，避免 9px 小字落在半像素上发虚 */
  const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

  const drawCrispLabel = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    dpr: number,
    font: string,
  ) => {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const sx = snap(x, dpr);
    const sy = snap(y, dpr);
    const width = ctx.measureText(text).width;
    const height = 16;
    ctx.fillStyle = cssVar("--background", "#0d1117");
    ctx.fillRect(sx - width / 2 - 3, sy - height / 2, width + 6, height);
    ctx.fillStyle = cssVar("--foreground", "#e6edf3");
    ctx.fillText(text, sx, sy);
    ctx.restore();
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
      ctx.moveTo(x, top);
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

  /** 等宽槽位：调用 i 占 [i, i+1)，按窗口平移后中心仍落在光标锚点上 */
  const layoutSlots = useCallback(
    (plotW: number, originX: number): Slot[] => {
      const span = Math.max(domain.end - domain.start, 1e-6);
      const list: Slot[] = [];
      for (let i = 0; i < calls.length; i++) {
        if (i >= domain.end || i + 1 <= domain.start) continue;
        list.push({
          call: calls[i],
          cx: originX + ((i + 0.5 - domain.start) / span) * plotW,
        });
      }
      return list;
    },
    [calls, domain],
  );

  /** Round 分区背景：交替底色 + 分隔线 + 顶部 Round 标签 */
  const drawRoundBands = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      plotW: number,
      originX: number,
      top: number,
      bottom: number,
    ) => {
      if (roundRanges.length === 0) return;
      const span = Math.max(domain.end - domain.start, 1e-6);
      roundRanges.forEach((r, i) => {
        const x0 = originX + ((r.start - domain.start) / span) * plotW;
        const w0 = ((r.end - r.start + 1) / span) * plotW;
        if (i % 2 === 1) {
          ctx.globalAlpha = 0.06;
          ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
          ctx.fillRect(x0, top, w0, bottom - top);
          ctx.globalAlpha = 1;
        }
        if (i > 0) {
          ctx.strokeStyle = cssVar("--chart-grid", "rgba(48,54,61,0.55)");
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x0, top);
          ctx.lineTo(x0, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (w0 > 56) {
          ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = cssVar("--foreground", "#e6edf3");
          ctx.fillText(`Round ${r.roundIndex + 1}`, snap(x0 + w0 / 2, window.devicePixelRatio || 1), snap(11, window.devicePixelRatio || 1));
          ctx.textBaseline = "alphabetic";
        }
      });
      ctx.textAlign = "left";
    },
    [roundRanges, domain],
  );

  /** 图 1：上下文规模——每次调用的 prompt（堆叠：新增在下、复用在上） */
  const drawPrompt = useCallback(() => {
    const canvas = lineRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 156);
    if (!setup) return;
    const { ctx, cssW, cssH, dpr } = setup;
    const w = cssW;
    const h = cssH;
    const top = 26;
    const bottom = h - 8;
    const originX = 4;
    const plotW = Math.max(w - 8, 1);
    const span = Math.max(domain.end - domain.start, 1e-6);
    const slots = layoutSlots(plotW, originX);
    const maxPrompt = Math.max(...slots.map((s) => s.call.prompt), 1);
    const scale = (v: number) => (v / maxPrompt) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max((plotW / span) * 0.55, 6), 30) : 0;
    const baseY = bottom;
    const showNums = barW >= 12; // 柱宽足够时才绘制数字，避免全览时密集噪点

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxPrompt, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, plotW, originX, top, bottom);

    // 堆叠：缓存读（复用）贴基线，新增叠在最上方
    const freshColor = cssVar("--chart-new", "#f0883e");
    const reuseColor = cssVar("--chart-bar-in", "rgba(88,166,255,0.8)");
    for (const s of slots) {
      const freshH = scale(s.call.fresh);
      const reuseH = scale(s.call.reuse);
      const totalH = freshH + reuseH;
      const x = s.cx - barW / 2;
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
      // 柱顶标注上下文规模：衬底 + 对齐像素，避免和网格叠在一起发虚
      if (!showNums) continue;
      drawCrispLabel(
        ctx,
        fmtTokShort(s.call.prompt),
        s.cx,
        Math.max(baseY - totalH - 10, top - 2),
        dpr,
        "600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      );
    }
    ctx.restore();
  }, [layoutSlots, drawRoundBands, domain, highlightCallId]);

  /** 图 2：新增输入构成——柱高为真实新增（未命中缓存），分段为按字符占比分摊的估算 */
  const drawFresh = useCallback(() => {
    const canvas = barRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 136);
    if (!setup) return;
    const { ctx, cssW, cssH, dpr } = setup;
    const w = cssW;
    const h = cssH;
    const top = 26;
    const bottom = h - 8;
    const originX = 4;
    const plotW = Math.max(w - 8, 1);
    const span = Math.max(domain.end - domain.start, 1e-6);
    const slots = layoutSlots(plotW, originX);
    const maxFresh = Math.max(...slots.map((s) => s.call.fresh), 1);
    const scale = (v: number) => (v / maxFresh) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max((plotW / span) * 0.55, 6), 30) : 0;
    const baseY = bottom;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxFresh, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, plotW, originX, top, bottom);

    // 新增来源构成：自下而上堆叠（part.value 之和恰等于 call.fresh）
    for (const s of slots) {
      let yCursor = baseY;
      const x = s.cx - barW / 2;
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
        drawCrispLabel(
          ctx,
          fmtTokShort(s.call.fresh),
          s.cx,
          Math.max(yCursor - 10, top - 2),
          dpr,
          "600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        );
      }
    }
    ctx.restore();
  }, [layoutSlots, drawRoundBands, domain, highlightCallId]);

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

  /** 点击柱体：按窗口内的调用序号定位，通知右栏展示构成明细 */
  const indexFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = e.currentTarget;
    const plotW = Math.max(canvas.clientWidth - 8, 1);
    const span = Math.max(domain.end - domain.start, 1e-6);
    const idx = domain.start + ((e.nativeEvent.offsetX - 4) / plotW) * span;
    const i = Math.floor(idx + 1e-6);
    if (i < 0 || i >= calls.length) return -1;
    if (i >= domain.end || i + 1 <= domain.start) return -1;
    return i;
  };

  const handlePromptClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = indexFromEvent(e);
    if (i >= 0) onSelectCall?.(calls[i].id, "prompt");
  };

  const handleFreshClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = indexFromEvent(e);
    if (i >= 0) onSelectCall?.(calls[i].id, "new");
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
          <DomainScrollbar
            domain={domain}
            total={windowTotal}
            onChange={onDomainChange}
            title="拖动平移柱状图（两图联动）"
          />
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
          <DomainScrollbar
            domain={domain}
            total={windowTotal}
            onChange={onDomainChange}
            title="拖动平移柱状图（两图联动）"
          />
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
  title = "拖动平移",
}: {
  domain: Domain;
  total: number;
  onChange: (d: Domain | null) => void;
  title?: string;
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
      data-no-pan="1"
      className="relative h-3 cursor-pointer rounded-full bg-muted/50 hover:bg-muted/70"
      title={title}
    >
      <div
        data-thumb="1"
        className="absolute top-0 h-full rounded-full bg-primary/40 transition-colors hover:bg-primary/60"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
    </div>
  );
}
