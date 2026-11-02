"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChangeLayer, DiagnosisItem, SessionDiagnosis } from "@/lib/engine/ingest/session-diagnosis";
import type { FindingKind, SessionFacts } from "@/lib/engine/ingest/session-facts";

const LAYER_LABEL: Record<ChangeLayer, string> = {
  prompt: "提示词",
  skill: "skill",
  tool: "工具参数",
  env: "运行环境",
  collect: "采集",
};

const KIND_LABEL: Record<FindingKind, string> = {
  recovered: "已恢复",
  unrecovered: "未恢复",
  loop: "循环",
  model_failure: "模型失败",
  answer_failure: "回答失败",
  no_delivery: "未交付",
};

/**
 * 会话诊断。有 diagnosis 时展示根因和先检查什么；
 * 已恢复的失败仍可展开，但不写成根因。
 */
export function SessionFactsBar({
  facts,
  diagnosis,
  onSelectSpan,
}: {
  facts?: SessionFacts;
  diagnosis?: SessionDiagnosis;
  onSelectSpan: (spanId: string) => void;
}) {
  const [showRecovered, setShowRecovered] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const recovered = facts?.findings.filter((finding) => finding.kind === "recovered") ?? [];

  if (diagnosis) {
    return (
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-2">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-[11px] leading-5">
          {diagnosis.primary ? (
            <button
              type="button"
              disabled={!diagnosis.primary.spanId}
              onClick={() => diagnosis.primary?.spanId && onSelectSpan(diagnosis.primary.spanId)}
              className="min-w-0 text-left text-foreground disabled:cursor-default"
              title={diagnosis.primary.signature}
            >
              <span className="font-medium text-destructive">过程诊断 · </span>
              {diagnosis.headline}
            </button>
          ) : (
            <span className="text-muted-foreground">过程诊断 · 无过程异常</span>
          )}
          {diagnosis.others.length > 0 && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowOthers((open) => !open)}
            >
              {showOthers ? "收起" : "查看"}其余 {diagnosis.others.length} 条
            </button>
          )}
          {recovered.length > 0 && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowRecovered((open) => !open)}
            >
              {showRecovered ? "收起" : "查看"} {recovered.length} 条已恢复
            </button>
          )}
        </div>
        {diagnosis.primary && diagnosis.primary.checks.length > 0 && (
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            先检查：{diagnosis.primary.checks.join("；")}
            {diagnosis.primary.layer !== "collect" ? `。改动面：${LAYER_LABEL[diagnosis.primary.layer]}` : ""}
          </p>
        )}
        {showOthers && diagnosis.others.length > 0 && (
          <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto scrollbar-thin">
            {diagnosis.others.map((item, index) => (
              <DiagnosisRow key={`${item.signature}-${index}`} item={item} onSelectSpan={onSelectSpan} />
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

  if (!facts || (!facts.hasAnomaly && facts.recoveredCount === 0)) {
    return (
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-1.5 text-[11px] text-muted-foreground">
        过程诊断 · 无过程异常
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

function DiagnosisRow({
  item,
  onSelectSpan,
}: {
  item: DiagnosisItem;
  onSelectSpan: (spanId: string) => void;
}) {
  return (
    <li className="text-[11px] leading-5">
      <button
        type="button"
        disabled={!item.spanId}
        onClick={() => item.spanId && onSelectSpan(item.spanId)}
        className="block max-w-full truncate text-left text-foreground disabled:cursor-default"
        title={item.signature}
      >
        {item.cause}
      </button>
      {item.checks.length > 0 && (
        <p className="truncate text-muted-foreground">先检查：{item.checks.join("；")}</p>
      )}
    </li>
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
