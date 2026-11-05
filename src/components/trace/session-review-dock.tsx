"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { kindLabel, type TraceSpan } from "./trace-helpers";

type ReviewPreset = "full" | "reasoning" | "control" | "action" | "explain" | "custom";
type ReviewCategory = "reasoning" | "control" | "action";
type ReviewSeverity = "high" | "medium" | "low";

interface ReviewFinding {
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  detail: string;
  spanId: string;
}

interface ReviewResult {
  model: string;
  question: string;
  summary: string;
  findings: ReviewFinding[];
}

const PRESETS: Array<{ id: Exclude<ReviewPreset, "explain" | "custom">; label: string; hint: string }> = [
  { id: "full", label: "全面体检", hint: "推理、控制流、动作，只报有证据的" },
  { id: "reasoning", label: "推理", hint: "上下文不够 / 用错 / 没听指令 / 漏看证据" },
  { id: "control", label: "控制流", hint: "死循环 / 该停不停 / 不该停却停 / 步数打满" },
  { id: "action", label: "动作", hint: "选错工具 / 参数不合法 / 执行失败 / 结果被无视" },
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

export function SessionReviewDock({
  sessionId,
  spans,
  selectedSpan,
  height,
  onClose,
  onSelectSpan,
}: {
  sessionId: string;
  spans: TraceSpan[];
  selectedSpan: TraceSpan | null;
  height: number;
  onClose: () => void;
  onSelectSpan: (spanId: string) => void;
}) {
  const [preset, setPreset] = useState<ReviewPreset | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const spanById = new Map(spans.map((span) => [span.id, span]));

  const ask = async (next: ReviewPreset, question?: string) => {
    if (next === "explain" && !selectedSpan) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPreset(next);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          preset: next,
          spanId: next === "explain" ? selectedSpan?.id : undefined,
          question,
        }),
      });
      const data = (await res.json().catch(() => null)) as (ReviewResult & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
      if (!data?.question) throw new Error("模型没有返回可显示的结果");
      setResult({
        model: data.model,
        question: data.question,
        summary: data.summary,
        findings: Array.isArray(data.findings) ? data.findings : [],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

  return (
    <section
      className="flex shrink-0 flex-col overflow-hidden border-t border-border bg-card"
      style={{ height }}
      aria-label="质量评审"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-medium">质量评审</h2>
          <span className="truncate text-[10px] text-muted-foreground">
            {result?.model ? `刚才用的是 ${result.model}` : "点问题后，发给设置里当前使用的模型"}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>
          收起
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          <p className="px-1 pb-1 text-[10px] leading-4 text-muted-foreground">
            下面每个按钮都是一个固定问题。点击后连同这条 Session 的轨迹一起发给模型。
          </p>
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={loading}
              aria-pressed={preset === item.id}
              onClick={() => void ask(item.id)}
              className={cn(
                "rounded-md px-2 py-1.5 text-left disabled:opacity-50",
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
              disabled={loading}
              aria-pressed={preset === "explain"}
              onClick={() => void ask("explain")}
              className={cn(
                "rounded-md px-2 py-1.5 text-left disabled:opacity-50",
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

          <form
            className="mt-2 px-1"
            onSubmit={(event) => {
              event.preventDefault();
              const question = draft.trim();
              if (!question || loading) return;
              void ask("custom", question);
            }}
          >
            <label className="block text-[11px] text-muted-foreground">
              自定义问题
              <textarea
                value={draft}
                rows={3}
                disabled={loading}
                placeholder="例如：为什么第三次 read 之后还在改同一份文件？"
                onChange={(event) => setDraft(event.target.value)}
                className="mt-1 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
              />
            </label>
            <Button type="submit" size="sm" className="mt-1 h-6 px-2 text-xs" disabled={loading || !draft.trim()}>
              发给模型
            </Button>
          </form>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="text-xs leading-5 text-muted-foreground">正在把轨迹和这个问题发给模型，通常需要几十秒。</p>
          ) : error ? (
            <p className="text-xs leading-5 text-destructive">{error}</p>
          ) : !result ? (
            <p className="text-xs leading-5 text-muted-foreground">
              还没有发问。模型只会根据这条轨迹里的输入、输出和报错来答，并尽量指出具体的一步。过长的正文会被截断。点「定位」后，右侧仍显示这一步的 Span 详情。
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">发给模型的问题</p>
                <p className="mt-1 text-xs leading-5 text-foreground">{result.question}</p>
              </div>
              <p className="text-xs leading-5 text-foreground">{result.summary}</p>
              {result.findings.length === 0 ? (
                <p className="text-xs leading-5 text-muted-foreground">模型没有列出可以指到某一步的问题。</p>
              ) : (
                <ul className="space-y-2">
                  {result.findings.map((item, index) => {
                    const span = item.spanId ? spanById.get(item.spanId) : undefined;
                    const active = selectedSpan?.id === item.spanId && Boolean(item.spanId);
                    return (
                      <li
                        key={`${item.spanId}-${index}`}
                        className={cn(
                          "rounded-md border px-3 py-2",
                          active ? "border-primary bg-primary/5" : "border-border",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                            {CATEGORY_LABEL[item.category] ?? item.category}
                          </span>
                          <span
                            className={cn(
                              "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                              item.severity === "high" && "bg-destructive/10 text-destructive",
                              item.severity === "medium" && "bg-warning/10 text-warning",
                              item.severity === "low" && "bg-muted text-muted-foreground",
                            )}
                          >
                            {SEVERITY_LABEL[item.severity] ?? item.severity}
                          </span>
                          <span className="text-xs font-medium">{item.title}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                        {span && (
                          <button
                            type="button"
                            className="mt-1.5 text-[11px] text-primary underline-offset-2 hover:underline"
                            onClick={() => onSelectSpan(span.id)}
                          >
                            定位到 {kindLabel(span.kind)} · {span.name}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
