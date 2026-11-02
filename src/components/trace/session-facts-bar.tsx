"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FindingKind, SessionFacts } from "@/lib/engine/ingest/session-facts";

const KIND_LABEL: Record<FindingKind, string> = {
  recovered: "已恢复",
  unrecovered: "未恢复",
  loop: "循环",
  model_failure: "模型失败",
  answer_failure: "回答失败",
  no_delivery: "未交付",
};

/**
 * 会话过程事实。根因候选和已恢复的失败分开：
 * 已恢复默认收起，避免质检重试把真正没交付的失败淹没。
 */
export function SessionFactsBar({
  facts,
  onSelectSpan,
}: {
  facts: SessionFacts;
  onSelectSpan: (spanId: string) => void;
}) {
  const [showRecovered, setShowRecovered] = useState(false);
  const recovered = facts.findings.filter((finding) => finding.kind === "recovered");

  if (!facts.hasAnomaly && facts.recoveredCount === 0) {
    return (
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-1.5 text-[11px] text-muted-foreground">
        过程事实 · 没有失败 span
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border bg-card/60 px-5 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[11px]">
        <span className="font-medium text-foreground">过程事实</span>
        {facts.hasAnomaly ? (
          <span className="text-destructive">{facts.candidates.length} 条异常</span>
        ) : (
          <span className="text-muted-foreground">没有未恢复的异常</span>
        )}
        {facts.recoveredCount > 0 && (
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowRecovered((open) => !open)}
          >
            {showRecovered ? "收起" : "查看"} {facts.recoveredCount} 条已恢复
          </button>
        )}
      </div>
      {facts.candidates.length > 0 && (
        <ul className="max-h-36 space-y-1 overflow-y-auto scrollbar-thin">
          {facts.candidates.map((finding, index) => (
            <FactRow key={`${finding.signature}-${index}`} finding={finding} onSelectSpan={onSelectSpan} />
          ))}
        </ul>
      )}
      {showRecovered && recovered.length > 0 && (
        <ul className="mt-1 max-h-24 space-y-1 overflow-y-auto scrollbar-thin">
          {recovered.map((finding, index) => (
            <FactRow key={`recovered-${finding.signature}-${index}`} finding={finding} onSelectSpan={onSelectSpan} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FactRow({
  finding,
  onSelectSpan,
}: {
  finding: SessionFacts["findings"][number];
  onSelectSpan: (spanId: string) => void;
}) {
  const spanId = finding.evidence.spanId || finding.spanIds[0] || "";
  const candidate = finding.candidate;
  return (
    <li className="flex items-start gap-2 text-[11px] leading-5">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-medium",
          candidate ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {KIND_LABEL[finding.kind]}
        {finding.repeatCount > 1 ? ` ×${finding.repeatCount}` : ""}
      </span>
      <button
        type="button"
        disabled={!spanId}
        onClick={() => spanId && onSelectSpan(spanId)}
        className="min-w-0 flex-1 truncate text-left text-foreground disabled:cursor-default"
        title={`${finding.signature}\n${finding.evidence.errorSummary}`}
      >
        <span className="font-mono text-[10px] text-muted-foreground">{finding.evidence.spanName || finding.kind}</span>
        {" · "}
        {finding.evidence.errorSummary || finding.signature}
        {finding.kind === "loop" && finding.recovered ? " · 之后已补救" : ""}
      </button>
    </li>
  );
}
