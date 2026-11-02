"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// 已知 evidence key 的中文标签
const KEY_LABELS: Record<string, string> = {
  correctPoints: "正确点",
  incorrectPoints: "错误点",
  missingPoints: "遗漏点",
  noReference: "无参考答案",
  relevance: "相关性",
  completeness: "完整性",
  coherence: "连贯性",
  analysis: "分析",
  claims: "主张核查",
  constraints: "约束核查",
  keyPoints: "关键观点",
  totalClaims: "主张总数",
  supportedClaims: "有支撑的主张",
  metCount: "满足数",
  applicableCount: "适用约束数",
  coveredCount: "覆盖数",
  totalCount: "总数",
  violations: "违规项",
  actualCalls: "实际调用",
  totalCalls: "调用总数",
  metrics: "指标核对",
  stats: "会话统计",
  matches: "关键词命中",
  mode: "匹配模式",
  pattern: "正则",
  flags: "flags",
  matchMode: "匹配方式",
  matched: "命中内容",
  expected: "期望输出",
  actual: "实际输出",
  actualPreview: "实际输出（截断）",
  caseSensitive: "区分大小写",
  trimWhitespace: "忽略首尾空格",
  similarity: "相似度",
  threshold: "阈值",
  distance: "编辑距离",
  actualLength: "实际长度",
  referenceLength: "参考长度",
  valid: "校验结果",
  errors: "校验错误",
  parseError: "JSON 解析错误",
  reason: "原因",
  // LLM 评估器结构化证据
  issues: "问题定位",
  outputSummary: "输出摘要",
  reasoning: "评分推理",
  exploredTargets: "探索目标",
  duplicateCalls: "重复调用",
  invalidCalls: "无效调用",
  knowledgeOnlyClaims: "无轨迹支撑的主张",
};

// 分区展示顺序：可操作的问题清单优先，摘要类置底
const SECTION_ORDER = [
  "issues",
  "incorrectPoints",
  "missingPoints",
  "correctPoints",
  "claims",
  "keyPoints",
  "constraints",
  "violations",
  "duplicateCalls",
  "invalidCalls",
  "knowledgeOnlyClaims",
  "exploredTargets",
  "matches",
  "analysis",
  "reasoning",
  "outputSummary",
];

// 长文本段落型 key：标签在上、整段文字在下
const PROSE_KEYS = new Set(["analysis", "reasoning", "outputSummary"]);

// 列表成员的正文/状态/详情字段
const ITEM_FIELDS = ["text", "claim", "constraint", "pattern", "name", "key", "metric", "label", "target", "tool"];
const STATUS_FIELDS = ["status", "hit", "exceeded", "count"];
const DETAIL_FIELDS = ["evidence", "analysis", "purpose", "note", "issue", "reason"];

// 状态值的中文标签与配色
const STATUS_META: Record<string, { label: string; color: string }> = {
  supported: { label: "有支撑", color: "text-success" },
  contradicted: { label: "与证据矛盾", color: "text-destructive" },
  not_covered: { label: "无相关证据", color: "text-muted-foreground" },
  met: { label: "满足", color: "text-success" },
  not_met: { label: "未满足", color: "text-destructive" },
  not_applicable: { label: "不适用", color: "text-muted-foreground" },
  covered: { label: "已覆盖", color: "text-success" },
  partial: { label: "部分覆盖", color: "text-warning" },
  missing: { label: "未覆盖", color: "text-muted-foreground" },
  wrong: { label: "错误", color: "text-destructive" },
  hit: { label: "命中", color: "text-success" },
  exceeded: { label: "超限", color: "text-destructive" },
  pass: { label: "通过", color: "text-success" },
  fail: { label: "未通过", color: "text-destructive" },
  true: { label: "是", color: "text-success" },
  false: { label: "否", color: "text-destructive" },
};

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface RenderedItem {
  text: string;
  status?: string;
  detail?: string;
}

function renderListItems(items: unknown[]): RenderedItem[] {
  return items.map((item) => {
    if (typeof item !== "object" || item === null) {
      return { text: formatScalar(item) };
    }
    const obj = item as Record<string, unknown>;
    const textKey = ITEM_FIELDS.find((k) => obj[k] !== undefined) ?? Object.keys(obj)[0];
    const statusKey = STATUS_FIELDS.find((k) => obj[k] !== undefined);
    const detailKey = DETAIL_FIELDS.find(
      (k) => typeof obj[k] === "string" && (obj[k] as string).length > 0
    );
    const extra = Object.entries(obj)
      .filter(
        ([k]) =>
          k !== textKey && k !== statusKey && k !== detailKey && !DETAIL_FIELDS.includes(k)
      )
      .slice(0, 2)
      .map(([k, v]) => `${KEY_LABELS[k] ?? k}: ${formatScalar(v)}`);
    return {
      text: [formatScalar(obj[textKey]), ...extra].filter(Boolean).join(" · "),
      status: statusKey ? String(obj[statusKey]) : undefined,
      detail: detailKey ? String(obj[detailKey]) : undefined,
    };
  });
}

function StatusTag({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={`text-[11px] ${meta?.color ?? "text-muted-foreground"}`}>
      [{meta?.label ?? status}]
    </span>
  );
}

/** issues：原文摘录 → 问题 → 修改建议 的可操作问题卡片 */
function IssuesSection({ label, items }: { label: string; items: unknown[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {label}（{items.length}）
      </p>
      <div className="space-y-2">
        {items.map((it, i) => {
          const obj = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
          const quote = typeof obj.quote === "string" ? obj.quote : formatScalar(it);
          return (
            <div key={i} className="rounded-md bg-destructive/5 p-2.5 ring-1 ring-destructive/20">
              {quote && quote !== "—" && (
                <p className="border-l-2 border-destructive/50 pl-2 font-mono text-xs leading-relaxed">
                  “{quote}”
                </p>
              )}
              {typeof obj.problem === "string" && obj.problem && (
                <p className="mt-1.5 text-[13px] leading-relaxed">
                  <span className="font-medium text-destructive">问题：</span>
                  {obj.problem}
                </p>
              )}
              {typeof obj.suggestion === "string" && obj.suggestion && (
                <p className="mt-0.5 text-[13px] leading-relaxed">
                  <span className="font-medium text-info">建议：</span>
                  {obj.suggestion}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceSection({ label, value, entryKey }: { label: string; value: unknown; entryKey: string }) {
  // issues 结构特殊，单独渲染
  if (entryKey === "issues" && Array.isArray(value) && value.length > 0) {
    return <IssuesSection label={label} items={value} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const items = renderListItems(value);
    return (
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
          {label}（{items.length}）
        </p>
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-[13px] leading-relaxed">
              <div className="flex items-start gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>{item.text}</span>
                {item.status && <StatusTag status={item.status} />}
              </div>
              {item.detail && (
                <p className="ml-2.5 mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  ↳ {item.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // 长文本段落：标签在上，正文在下
  if (PROSE_KEYS.has(entryKey) && typeof value === "string") {
    return (
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{value}</p>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="break-all text-right text-[13px]">{formatScalar(value)}</span>
    </div>
  );
}

/**
 * 评估结果 evidence 明细渲染：已知 key 按固定顺序分区展示，
 * issues 渲染为可操作问题卡片，末尾附原始 JSON 折叠视图。
 */
export function EvidenceViewer({ evidenceJson }: { evidenceJson: string | null | undefined }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!evidenceJson) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(evidenceJson);
  } catch {
    return (
      <p className="text-xs text-muted-foreground">evidence 数据异常：{evidenceJson.slice(0, 200)}</p>
    );
  }

  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  // 已知 key 按 SECTION_ORDER 排序，未知 key 保持原始顺序垫底
  const known = entries
    .filter(([k]) => k in KEY_LABELS)
    .sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a[0]);
      const ib = SECTION_ORDER.indexOf(b[0]);
      return (ia === -1 ? SECTION_ORDER.length : ia) - (ib === -1 ? SECTION_ORDER.length : ib);
    });
  const unknown = entries.filter(([k]) => !(k in KEY_LABELS));

  return (
    <div className="space-y-3">
      {known.map(([k, v]) => (
        <EvidenceSection key={k} label={KEY_LABELS[k]} value={v} entryKey={k} />
      ))}
      {unknown.map(([k, v]) => (
        <EvidenceSection key={k} label={KEY_LABELS[k] ?? k} value={v} entryKey={k} />
      ))}
      <button
        type="button"
        onClick={() => setShowRaw((s) => !s)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        查看原始 JSON
      </button>
      {showRaw && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
