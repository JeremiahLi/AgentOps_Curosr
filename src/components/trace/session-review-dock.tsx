"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFailed, kindLabel, type TraceSpan } from "./trace-helpers";

type ReviewPreset = "full" | "reasoning" | "control" | "action" | "explain";
type ReviewCategory = "reasoning" | "control" | "action";
type ReviewSeverity = "high" | "medium" | "low";

interface ReviewFinding {
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  detail: string;
  spanId: string;
  spanName: string;
  spanKind: string;
}

const PRESETS: Array<{ id: Exclude<ReviewPreset, "explain">; label: string; hint: string }> = [
  { id: "full", label: "全面体检", hint: "推理、控制流、动作各看一条" },
  { id: "reasoning", label: "推理", hint: "上下文、指令、已有证据" },
  { id: "control", label: "控制流", hint: "循环、该停不停、步数" },
  { id: "action", label: "动作", hint: "工具选择、参数、结果是否被用上" },
];

const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  reasoning: "推理",
  control: "控制流",
  action: "动作",
};

const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function isTool(span: TraceSpan): boolean {
  return span.kind === "tool_call" || span.kind === "tool_execution" || span.kind === "command";
}

function toolSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.filter(isTool);
}

/** 同名工具出现最多次的最后一次；没有重复时用最后一次工具调用。 */
function repeatedToolSpan(spans: TraceSpan[]): TraceSpan | undefined {
  const groups = new Map<string, TraceSpan[]>();
  for (const span of toolSpans(spans)) {
    const list = groups.get(span.name) ?? [];
    list.push(span);
    groups.set(span.name, list);
  }
  let best: TraceSpan[] = [];
  for (const list of groups.values()) {
    if (list.length > best.length) best = list;
  }
  if (best.length >= 2) return best[best.length - 1];
  const tools = toolSpans(spans);
  return tools[tools.length - 1];
}

function reasoningSpans(spans: TraceSpan[]): TraceSpan[] {
  const llm = spans.filter((span) => span.kind === "llm_thinking");
  if (llm.length > 0) return llm;
  return spans.filter((span) => span.kind === "system_prompt" || span.kind === "user" || span.kind === "answer");
}

function distinct(preferred: Array<TraceSpan | undefined>, limit: number): TraceSpan[] {
  const used = new Set<string>();
  const out: TraceSpan[] = [];
  for (const span of preferred) {
    if (!span || used.has(span.id)) continue;
    used.add(span.id);
    out.push(span);
    if (out.length >= limit) break;
  }
  return out;
}

function finding(
  span: TraceSpan,
  category: ReviewCategory,
  severity: ReviewSeverity,
  title: string,
  detail: string,
): ReviewFinding {
  return {
    id: `${category}-${span.id}-${title}`,
    category,
    severity,
    title,
    detail,
    spanId: span.id,
    spanName: span.name,
    spanKind: span.kind,
  };
}

function reasoningFinding(span: TraceSpan, index: number): ReviewFinding {
  const variants = [
    {
      title: "可能漏看了已有证据",
      detail: "演示：这一步没有点名前面已经拿到的结果。正式评审会核对是上下文不够、用错上下文，还是漏看了已有证据。",
    },
    {
      title: "可能没有遵守指令",
      detail: "演示：系统提示里的约束没有出现在这一步的输出里。正式评审会判断是没遵守指令，还是这一步本来就不用管。",
    },
  ];
  const variant = variants[index % variants.length];
  return finding(span, "reasoning", "medium", variant.title, variant.detail);
}

function controlFinding(span: TraceSpan, index: number): ReviewFinding {
  const variants = [
    {
      title: "同名动作又出现了一次",
      detail: "演示：同名工具再次出现。正式评审会区分死循环、该停却继续，和不该停却停。",
    },
    {
      title: "后段仍在加步骤",
      detail: "演示：轨迹后段还在调用工具。正式评审会看是步数打满，还是任务确实还没做完。",
    },
  ];
  const variant = variants[index % variants.length];
  return finding(span, "control", index === 0 ? "medium" : "low", variant.title, variant.detail);
}

function actionFinding(span: TraceSpan, index: number): ReviewFinding {
  const failed = isFailed(span);
  const variants = [
    {
      title: failed ? "工具执行失败" : "工具选择需要核对",
      detail: failed
        ? "演示：这次工具调用状态是失败。正式评审会核对是工具选错、参数不合法，还是执行本身失败。"
        : "演示：这一步选了这个工具。正式评审会对照任务，看工具和参数是否对得上。",
    },
    {
      title: "工具结果可能没有被后文用上",
      detail: "演示：这次工具有返回。正式评审会看后面的步骤有没有接上，判断结果是被无视了，还是已经够用。",
    },
  ];
  const variant = variants[index % variants.length];
  return finding(span, "action", failed ? "high" : "medium", variant.title, variant.detail);
}

function explainFinding(span: TraceSpan): ReviewFinding {
  if (isTool(span)) {
    return finding(
      span,
      "action",
      isFailed(span) ? "high" : "medium",
      isFailed(span) ? "这一步的工具调用失败了" : "看这一步的工具是否用对",
      `演示：正式评审会对照「${span.name}」的入参、返回和紧接着的下一步，说明是选错工具、参数不合法、执行失败，还是结果被后面无视。`,
    );
  }
  if (span.kind === "llm_thinking" || span.kind === "system_prompt" || span.kind === "user") {
    return finding(
      span,
      "reasoning",
      "medium",
      "看这一步的推理是否接上上下文",
      `演示：正式评审会对照「${span.name}」前后的证据，说明是上下文不够、用错上下文、没遵守指令，还是漏看了已有结果。`,
    );
  }
  return finding(
    span,
    "control",
    "low",
    "看这一步该不该出现",
    `演示：正式评审会对照「${span.name}」在整段轨迹中的位置，说明是该停不停、不该停却停，还是步数已经打满。`,
  );
}

function demoFindings(
  preset: ReviewPreset,
  spans: TraceSpan[],
  selectedSpan: TraceSpan | null,
): ReviewFinding[] {
  if (preset === "explain") return selectedSpan ? [explainFinding(selectedSpan)] : [];
  if (spans.length === 0) return [];

  if (preset === "reasoning") {
    const picked = distinct(reasoningSpans(spans), 2);
    const source = picked.length > 0 ? picked : spans.slice(0, 1);
    return source.map((span, index) => reasoningFinding(span, index));
  }
  if (preset === "control") {
    const tools = toolSpans(spans);
    const picked = distinct([repeatedToolSpan(spans), tools[0], spans[spans.length - 1]], 2);
    return picked.map((span, index) => controlFinding(span, index));
  }
  if (preset === "action") {
    const tools = toolSpans(spans);
    const picked = distinct([tools.find(isFailed), tools[0], spans.find(isFailed)], 2);
    const source = picked.length > 0 ? picked : spans.slice(0, 1);
    return source.map((span, index) => actionFinding(span, index));
  }

  const picked = distinct(
    [
      reasoningSpans(spans)[0],
      repeatedToolSpan(spans),
      toolSpans(spans).find(isFailed) ?? toolSpans(spans)[0],
    ],
    3,
  );
  const source = picked.length > 0 ? picked : spans.slice(0, 1);
  return source.map((span, index) => {
    if (index === 0) return reasoningFinding(span, 0);
    if (index === 1) return controlFinding(span, 0);
    return actionFinding(span, 0);
  });
}

export function SessionReviewDock({
  spans,
  selectedSpan,
  height,
  onClose,
  onSelectSpan,
}: {
  spans: TraceSpan[];
  selectedSpan: TraceSpan | null;
  height: number;
  onClose: () => void;
  onSelectSpan: (spanId: string) => void;
}) {
  const [preset, setPreset] = useState<ReviewPreset | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);

  const ask = (next: ReviewPreset) => {
    setPreset(next);
    setFindings(next === "explain" ? [] : demoFindings(next, spans, selectedSpan));
  };

  const shown = preset === "explain" ? demoFindings("explain", spans, selectedSpan) : findings;

  return (
    <section
      className="flex shrink-0 flex-col overflow-hidden border-t border-border bg-card"
      style={{ height }}
      aria-label="质量评审"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-medium">质量评审</h2>
          <span className="truncate rounded-sm bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning ring-1 ring-warning/30">
            演示数据，尚未调用模型
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>
          收起
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset === item.id}
              onClick={() => ask(item.id)}
              className={cn(
                "rounded-md px-2 py-1.5 text-left",
                preset === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              <span className="block text-xs font-medium">{item.label}</span>
              <span
                className={cn(
                  "mt-0.5 block text-[10px] leading-4",
                  preset === item.id ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {item.hint}
              </span>
            </button>
          ))}

          {selectedSpan && (
            <button
              type="button"
              aria-pressed={preset === "explain"}
              onClick={() => ask("explain")}
              className={cn(
                "rounded-md px-2 py-1.5 text-left",
                preset === "explain" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              <span className="block text-xs font-medium">解释这一步</span>
              <span
                className={cn(
                  "mt-0.5 block truncate text-[10px] leading-4",
                  preset === "explain" ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
                title={selectedSpan.name}
              >
                {kindLabel(selectedSpan.kind)} · {selectedSpan.name}
              </span>
            </button>
          )}

          <label className="mt-2 block px-1 text-[11px] text-muted-foreground">
            自定义问题
            <textarea
              disabled
              rows={3}
              placeholder="接上模型后才能用"
              className="mt-1 w-full resize-none rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
            />
          </label>
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">演示阶段不会把这句话发给模型。</p>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          {preset === null ? (
            <p className="text-xs leading-5 text-muted-foreground">
              选一个预置问题，查看示例结论。结论里的步骤来自当前 Session，点「定位」会选中它，右侧仍显示 Span 详情。
            </p>
          ) : shown.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {preset === "explain" ? "先在左侧树或时间线里选中一步。" : "这个 Session 没有可引用的步骤。"}
            </p>
          ) : (
            <ul className="space-y-2">
              {shown.map((item) => {
                const active = selectedSpan?.id === item.spanId;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      active ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                        {CATEGORY_LABEL[item.category]}
                      </span>
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                          item.severity === "high" && "bg-destructive/10 text-destructive",
                          item.severity === "medium" && "bg-warning/10 text-warning",
                          item.severity === "low" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                      <span className="text-xs font-medium">{item.title}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                    <button
                      type="button"
                      className="mt-1.5 text-[11px] text-primary underline-offset-2 hover:underline"
                      onClick={() => onSelectSpan(item.spanId)}
                    >
                      定位到 {kindLabel(item.spanKind)} · {item.spanName}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
