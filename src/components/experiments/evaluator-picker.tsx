"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { EvaluatorMeta } from "@/hooks/use-evaluators";

interface Props {
  evaluators: EvaluatorMeta[];
  selected: string[];
  onChange: (next: string[]) => void;
}

interface GroupMeta {
  key: "rule" | "llm";
  title: string;
  hint: string;
}

const GROUPS: GroupMeta[] = [
  { key: "rule", title: "基于规则的评估器", hint: "确定性计算 · 即时执行 · 不消耗 LLM 额度" },
  { key: "llm", title: "基于 LLM 的评估器", hint: "由评审模型逐用例打分 · 消耗 token · 需在设置中配置评审模型" },
];

// 推荐组合：规则做回归基线，LLM 只在关键维度抽检，避免 5 个高相关维度全开的冗余开销
interface PresetMeta {
  key: string;
  label: string;
  hint: string;
  build: (grouped: { rule: EvaluatorMeta[]; llm: EvaluatorMeta[] }) => string[];
}

const PRESETS: PresetMeta[] = [
  {
    key: "rule-baseline",
    label: "规则回归基线",
    hint: "全部规则评估器 · 零 LLM 开销 · 适合高频回归",
    build: ({ rule }) => rule.map((e) => e.id),
  },
  {
    key: "rule-plus-llm",
    label: "规则 + LLM 抽检",
    hint: "全部规则 + 准确性 · 兼顾成本与语义评估",
    build: ({ rule }) => [...rule.map((e) => e.id), "accuracy"],
  },
];

/**
 * 评估器选择器：按「规则 / LLM」明显分栏，栏内支持一键全选/取消。
 * 供「新建实验」页与「trace 抽样到实验」弹层共用。
 */
export function EvaluatorPicker({ evaluators, selected, onChange }: Props) {
  const grouped = useMemo(
    () => ({
      rule: evaluators.filter((e) => e.type === "rule"),
      llm: evaluators.filter((e) => e.type === "llm"),
    }),
    [evaluators]
  );

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const allSelected = (list: EvaluatorMeta[]) =>
    list.length > 0 && list.every((e) => selected.includes(e.id));

  const toggleGroup = (list: EvaluatorMeta[]) => {
    const ids = list.map((e) => e.id);
    if (allSelected(list)) {
      onChange(selected.filter((id) => !ids.includes(id)));
    } else {
      onChange(Array.from(new Set([...selected, ...ids])));
    }
  };

  return (
    <div className="space-y-5">
      {/* 推荐组合预设 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2.5 ring-1 ring-foreground/5">
        <span className="text-xs font-medium text-muted-foreground">推荐组合：</span>
        {PRESETS.filter((p) =>
          p.key !== "rule-plus-llm" || grouped.llm.some((e) => e.id === "accuracy")
        ).map((preset) => {
          const ids = preset.build(grouped);
          const active = ids.length > 0 && ids.every((id) => selected.includes(id));
          return (
            <button
              key={preset.key}
              type="button"
              title={preset.hint}
              onClick={() => onChange(ids)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary ring-1 ring-primary/40"
                  : "bg-background text-foreground ring-1 ring-foreground/15 hover:ring-foreground/30"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {GROUPS.map((group) => {
        const list = grouped[group.key];
        if (list.length === 0) return null;
        const all = allSelected(list);
        const selectedCount = list.filter((e) => selected.includes(e.id)).length;
        return (
          <section key={group.key}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                  {group.title}
                  <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
                    {selectedCount}/{list.length}
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{group.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleGroup(list)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  all
                    ? "bg-muted/60 text-muted-foreground hover:text-foreground"
                    : "bg-primary/10 text-primary ring-1 ring-primary/30 hover:bg-primary/15"
                }`}
              >
                {all ? "取消全选" : "全选"}
              </button>
            </div>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {list.map((ev) => {
                const on = selected.includes(ev.id);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => toggle(ev.id)}
                    className={`flex flex-col items-start rounded-md p-3 text-left transition-colors ${
                      on
                        ? "bg-primary/5 ring-1 ring-primary/40"
                        : "ring-1 ring-foreground/10 hover:ring-foreground/25"
                    }`}
                  >
                    <div className="mb-1 flex w-full items-center justify-between gap-1.5">
                      <span className="truncate text-[13px] font-medium">{ev.name}</span>
                      {group.key === "llm" ? (
                        <Badge variant="secondary" className="shrink-0">
                          {ev.category}
                        </Badge>
                      ) : (ev.configSchema?.length ?? 0) > 0 ? (
                        <Badge variant="outline" className="shrink-0">
                          可配参数
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{ev.description}</p>
                    {group.key === "llm" && ev.needsReference && (
                      <p className="mt-1 text-[11px] text-warning">建议填写参考答案</p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
