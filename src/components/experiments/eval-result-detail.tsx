"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EvidenceViewer } from "./evidence-viewer";
import { TrajectoryEvidence } from "./trajectory-evidence";

// 由本组件专属渲染的 evidence key，透传给通用 EvidenceViewer 时需剔除，避免重复展示
const RENDERED_KEYS = new Set([
  "outputSummary",
  "reasoning",
  "issues",
  "exploredTargets",
  "duplicateCalls",
  "invalidCalls",
  "knowledgeOnlyClaims",
]);

const NEW_FORMAT_KEYS = [
  "outputSummary",
  "reasoning",
  "issues",
  "exploredTargets",
  "duplicateCalls",
  "invalidCalls",
  "knowledgeOnlyClaims",
];

interface IssueItem {
  quote?: string;
  problem?: string;
  suggestion?: string;
}

function normalizeText(s: string): string {
  return (s || "").replace(/\s+/g, "");
}

// 将全文按 quote 出现位置分段渲染，全部匹配片段高亮
function renderHighlighted(text: string, quote: string | null): React.ReactNode {
  if (!quote || !text.includes(quote)) return text;
  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (true) {
    const idx = text.indexOf(quote, from);
    if (idx === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark key={key++} className="rounded-sm bg-warning/30 px-0.5">
        {quote}
      </mark>
    );
    from = idx + quote.length;
  }
  return parts;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{children}</p>;
}

/**
 * 评估结果明细（仅 done 状态调用）：
 * 评估理由 → 原文摘要（可展开全文）→ 问题定位（引用校验 + 高亮定位）→
 * 轨迹专项（仅轨迹质量）→ 通用证据明细。旧版格式数据给出重跑提示。
 */
export function EvalResultDetail({
  evaluatorId,
  summary,
  evidenceJson,
  actualOutput,
  sessionId,
}: {
  evaluatorId: string;
  summary: string | null;
  evidenceJson: string | null;
  actualOutput: string;
  sessionId?: string | null;
}) {
  const [showFull, setShowFull] = useState(false);
  const [highlightQuote, setHighlightQuote] = useState<string | null>(null);
  const fullTextRef = useRef<HTMLDivElement>(null);

  let data: Record<string, unknown> | null = null;
  try {
    data = evidenceJson ? (JSON.parse(evidenceJson) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  useEffect(() => {
    if (showFull && highlightQuote) {
      const t = setTimeout(() => {
        fullTextRef.current
          ?.querySelector("mark")
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [showFull, highlightQuote]);

  if (!data || Object.keys(data).length === 0) {
    return summary ? (
      <p className="text-[13px] leading-relaxed text-muted-foreground">{summary}</p>
    ) : null;
  }

  const isNewFormat = NEW_FORMAT_KEYS.some((k) => k in data);

  // 旧版格式：保留原有展示 + 重跑提示
  if (!isNewFormat) {
    return (
      <div className="space-y-2">
        {summary && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{summary}</p>
        )}
        <p className="text-xs text-warning">
          该结果为旧版评估明细，重新运行实验后可查看原文摘要与问题定位。
        </p>
        <div className="rounded-md bg-muted/30 p-3">
          <SectionLabel>评分依据</SectionLabel>
          <EvidenceViewer evidenceJson={JSON.stringify(data)} />
        </div>
      </div>
    );
  }

  const outputSummary = typeof data.outputSummary === "string" ? data.outputSummary : "";
  const reasoning = typeof data.reasoning === "string" ? data.reasoning : "";
  const issues = Array.isArray(data.issues)
    ? (data.issues.filter(
        (i) => typeof i === "object" && i !== null
      ) as IssueItem[])
    : [];
  const rest = Object.fromEntries(
    Object.entries(data).filter(([k]) => !RENDERED_KEYS.has(k))
  );
  const hasRest = Object.keys(rest).length > 0;

  return (
    <div className="space-y-3">
      {/* 评估理由 */}
      {(summary || reasoning) && (
        <div>
          <SectionLabel>评估理由</SectionLabel>
          {summary && (
            <p className="text-[13px] leading-relaxed text-foreground">{summary}</p>
          )}
          {reasoning && (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {reasoning}
            </p>
          )}
        </div>
      )}

      {/* 原文摘要 + 全文展开 */}
      {outputSummary && (
        <div>
          <SectionLabel>原文摘要</SectionLabel>
          <p className="text-[13px] leading-relaxed">{outputSummary}</p>
          <button
            type="button"
            onClick={() => setShowFull((s) => !s)}
            className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showFull ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {showFull ? "收起完整原文" : "查看完整原文"}
          </button>
          {showFull && (
            <div
              ref={fullTextRef}
              className="mt-2 max-h-[320px] overflow-y-auto rounded-md bg-muted/40 p-3 scrollbar-thin"
            >
              <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-muted-foreground">
                {renderHighlighted(actualOutput || "（暂无输出）", highlightQuote)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 问题定位 */}
      {issues.length > 0 && (
        <div>
          <SectionLabel>问题定位（{issues.length}）</SectionLabel>
          <div className="space-y-2">
            {issues.map((issue, i) => {
              const quote = typeof issue.quote === "string" ? issue.quote : "";
              const verified = quote
                ? normalizeText(actualOutput).includes(normalizeText(quote))
                : true;
              return (
                <div key={i} className="space-y-1.5 rounded-md bg-muted/30 p-3">
                  {quote && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setHighlightQuote(quote);
                          setShowFull(true);
                        }}
                        className="group flex w-full items-start gap-2 text-left"
                        title="点击在完整原文中定位"
                      >
                        <span className="mt-0.5 w-0.5 shrink-0 self-stretch rounded bg-warning/50" />
                        <span className="break-all rounded bg-warning/10 px-2 py-1 font-mono text-xs leading-relaxed group-hover:bg-warning/20">
                          {quote}
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        {verified ? (
                          <span className="text-[11px] text-muted-foreground">已核对原文</span>
                        ) : (
                          <span className="text-[11px] text-destructive">
                            引用未在原文中找到
                          </span>
                        )}
                        {outputSummary && (
                          <span className="text-[11px] text-muted-foreground">
                            点击引用可在完整原文中高亮定位
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  {issue.problem && (
                    <p className="text-[13px] leading-relaxed">{issue.problem}</p>
                  )}
                  {issue.suggestion && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      建议：{issue.suggestion}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 轨迹质量专项 */}
      {evaluatorId === "trajectory-quality" && (
        <TrajectoryEvidence evidence={data} sessionId={sessionId} />
      )}

      {/* 其余通用证据（子分数、正确/错误/遗漏点等） */}
      {hasRest && (
        <div className="rounded-md bg-muted/30 p-3">
          <SectionLabel>评分依据</SectionLabel>
          <EvidenceViewer evidenceJson={JSON.stringify(rest)} />
        </div>
      )}
    </div>
  );
}
