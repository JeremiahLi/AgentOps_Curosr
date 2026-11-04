"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, formatTokens } from "@/lib/format";
import { isFailed, kindLabel, spanColor, type TraceSpan } from "./trace-helpers";

interface Props {
  spans: TraceSpan[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Transcript 视图：按时间顺序展示每个 Span 的内容卡片 */
export function TraceTranscript({ spans, selectedId, onSelect }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 从 Timeline / 左树带着选中项打开时，直接滚到对应卡片。
  // 卡片已经完整落在视口里时不动，避免点卡片本身把列表拽来拽去。
  useEffect(() => {
    if (!selectedId || !scrollerRef.current) return;
    const root = scrollerRef.current;
    const el = root.querySelector(`[data-span-id="${CSS.escape(selectedId)}"]`);
    if (!(el instanceof HTMLElement)) return;
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const fullyVisible = elRect.top >= rootRect.top && elRect.bottom <= rootRect.bottom;
    if (fullyVisible) return;
    // 卡片比视口还高时贴顶，保证标题露出来；否则居中
    const block = elRect.height > rootRect.height * 0.85 ? "start" : "center";
    el.scrollIntoView({ block });
  }, [selectedId]);

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto scrollbar-thin p-5">
      <div className="mx-auto max-w-3xl space-y-3 pb-4">
        {spans.map((s) => (
          <TranscriptCard key={s.id} span={s} selected={selectedId === s.id} onSelect={onSelect} />
        ))}
        {spans.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无 Span 数据</p>
        )}
      </div>
    </div>
  );
}

function TranscriptCard({
  span,
  selected,
  onSelect,
}: {
  span: TraceSpan;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const failed = isFailed(span);
  const color = spanColor(span);

  let body: React.ReactNode = null;
  if (span.kind === "llm_thinking") {
    body = (
      <>
        <div className="mb-1 text-[11px] text-muted-foreground">
          Model: {span.model || span.name} ·{" "}
          <span className="text-[var(--trace-llm)]">In {span.tokens ? span.tokens.input : "—"}</span>
          {" / "}
          <span className="text-[var(--trace-tool)]">
            Out {span.tokens ? span.tokens.output : "—"}
          </span>
        </div>
        {span.output && (
          <PreBlock text={span.output} maxHeight="max-h-44" muted={!span.output} />
        )}
      </>
    );
  } else if (span.kind === "tool_call" || span.kind === "command" || span.kind === "tool_execution") {
    body = (
      <>
        <div className="mb-1 text-[11px] text-muted-foreground">
          {span.isSkill ? "Skill" : "Tool"}: {span.name}
          {span.tokens && (
            <span className="ml-2 font-mono">
              {formatTokens(span.tokens.total)} tokens
            </span>
          )}
        </div>
        {span.input && <PreBlock text={truncate(span.input, 1200)} maxHeight="max-h-44" />}
        {span.output && <PreBlock text={truncate(span.output, 1200)} maxHeight="max-h-44" />}
        {failed && span.error && <div className="mt-1.5 text-xs text-destructive">{span.error}</div>}
      </>
    );
  } else if (span.kind === "answer") {
    body = span.output ? (
      <div className="whitespace-pre-wrap text-sm">{truncate(span.output, 2000)}</div>
    ) : (
      <div className="text-sm text-muted-foreground">…</div>
    );
  } else if (span.kind === "user") {
    body = span.input ? <PreBlock text={truncate(span.input, 1500)} maxHeight="max-h-40" /> : null;
  } else if (span.kind === "system_prompt") {
    body = span.input ? (
      <PreBlock text={truncate(span.input, 600)} maxHeight="max-h-28" />
    ) : null;
  }

  return (
    <div
      data-span-id={span.id}
      onClick={() => onSelect(span.id)}
      className={cn(
        "cursor-pointer scroll-mt-3 rounded-lg border p-3.5 transition",
        selected
          ? "border-[var(--trace-llm)] bg-[var(--trace-llm)]/10"
          : "border-border hover:border-muted-foreground/40",
        span.branchId && "ml-4 border-dashed",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-sm font-medium">{span.name}</span>
        <span className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">
          {kindLabel(span.kind)}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {formatDuration(span.durationMs)}
        </span>
        {failed && (
          <span className="text-xs font-medium text-destructive">FAILED</span>
        )}
      </div>
      {body}
    </div>
  );
}

function PreBlock({ text, maxHeight, muted }: { text: string; maxHeight?: string; muted?: boolean }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed",
        maxHeight ?? "max-h-44",
        muted && "text-muted-foreground",
      )}
    >
      {text}
    </pre>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…（已截断，共 ${text.length} 字符）`;
}
