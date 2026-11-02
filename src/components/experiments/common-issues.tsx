"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

/**
 * 实验级共性问题聚合：
 * 跨 case 汇总 LLM 评估器 evidence 中的结构化问题
 * （issues / 遗漏点 / 错误点 / 与证据矛盾 / 未满足约束 / 未覆盖要点），
 * 按出现次数排序——单 case 的问题清单价值有限，反复出现的共性问题才指导改 prompt。
 */

interface ResultLike {
  id: string;
  evaluatorId: string;
  status: string;
  verdict: string | null;
  evidenceJson: string | null;
}

interface CaseLike {
  id: string;
  sessionId: string | null;
  results: ResultLike[];
}

interface IssueEntry {
  evaluatorId: string;
  kind: string;
  kindColor: string;
  text: string;
  count: number;
  caseIds: string[];
}

const KIND_EXTRACTORS: {
  kinds: { key: string; label: string; color: string }[];
  pick: (ev: Record<string, unknown>) => { key: string; text: string }[];
}[] = [
  {
    kinds: [{ key: "issue", label: "问题", color: "bg-destructive/10 text-destructive" }],
    pick: (ev) =>
      Array.isArray(ev.issues)
        ? (ev.issues as Record<string, unknown>[])
            .map((it) => ({
              key: "issue",
              text: String(it.problem || it.quote || "").trim(),
            }))
            .filter((x) => x.text)
        : [],
  },
  {
    kinds: [{ key: "missing", label: "遗漏", color: "bg-warning/10 text-warning" }],
    pick: (ev) =>
      Array.isArray(ev.missingPoints)
        ? (ev.missingPoints as unknown[]).map((t) => ({ key: "missing", text: String(t).trim() })).filter((x) => x.text)
        : [],
  },
  {
    kinds: [{ key: "incorrect", label: "错误", color: "bg-destructive/10 text-destructive" }],
    pick: (ev) =>
      Array.isArray(ev.incorrectPoints)
        ? (ev.incorrectPoints as unknown[]).map((t) => ({ key: "incorrect", text: String(t).trim() })).filter((x) => x.text)
        : [],
  },
  {
    kinds: [{ key: "contradicted", label: "与证据矛盾", color: "bg-destructive/10 text-destructive" }],
    pick: (ev) =>
      Array.isArray(ev.claims)
        ? (ev.claims as Record<string, unknown>[])
            .filter((it) => it.status === "contradicted")
            .map((it) => ({ key: "contradicted", text: String(it.text ?? "").trim() }))
            .filter((x) => x.text)
        : [],
  },
  {
    kinds: [{ key: "not_met", label: "未满足约束", color: "bg-warning/10 text-warning" }],
    pick: (ev) =>
      Array.isArray(ev.constraints)
        ? (ev.constraints as Record<string, unknown>[])
            .filter((it) => it.status === "not_met")
            .map((it) => ({ key: "not_met", text: String(it.text ?? "").trim() }))
            .filter((x) => x.text)
        : [],
  },
  {
    kinds: [{ key: "keypoint", label: "未覆盖要点", color: "bg-warning/10 text-warning" }],
    pick: (ev) =>
      Array.isArray(ev.keyPoints)
        ? (ev.keyPoints as Record<string, unknown>[])
            .filter((it) => it.status === "missing" || it.status === "wrong")
            .map((it) => ({ key: "keypoint", text: String(it.text ?? "").trim() }))
            .filter((x) => x.text)
        : [],
  },
];

const KIND_COLOR: Record<string, string> = Object.fromEntries(
  KIND_EXTRACTORS.flatMap((ex) => ex.kinds.map((k) => [k.key, k.color]))
);

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KIND_EXTRACTORS.flatMap((ex) => ex.kinds.map((k) => [k.key, k.label]))
);

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function collectIssues(
  cases: CaseLike[],
  evaluatorId: string
): IssueEntry[] {
  const map = new Map<string, IssueEntry>();
  for (const expCase of cases) {
    for (const result of expCase.results) {
      if (result.evaluatorId !== evaluatorId) continue;
      if (result.status !== "done" || result.verdict === "pass" || !result.evidenceJson) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(result.evidenceJson);
      } catch {
        continue;
      }
      for (const extractor of KIND_EXTRACTORS) {
        for (const { key, text } of extractor.pick(ev)) {
          const norm = normalizeText(text);
          if (!norm) continue;
          const mapKey = `${key}|${norm}`;
          const entry = map.get(mapKey);
          if (entry) {
            entry.count += 1;
            if (!entry.caseIds.includes(expCase.id)) entry.caseIds.push(expCase.id);
          } else {
            map.set(mapKey, {
              evaluatorId,
              kind: key,
              kindColor: KIND_COLOR[key] ?? "",
              text,
              count: 1,
              caseIds: [expCase.id],
            });
          }
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

interface Props {
  experimentId: string;
  evaluatorIds: string[];
  cases: CaseLike[];
  nameOf: (id: string) => string;
  topNPerEvaluator?: number;
}

export function CommonIssues({ experimentId, evaluatorIds, cases, nameOf, topNPerEvaluator = 8 }: Props) {
  const groups = useMemo(
    () =>
      evaluatorIds
        .map((evaluatorId) => {
          const all = collectIssues(cases, evaluatorId);
          return { evaluatorId, issues: all.slice(0, topNPerEvaluator), total: all.length };
        })
        .filter((g) => g.issues.length > 0),
    [evaluatorIds, cases, topNPerEvaluator]
  );

  if (groups.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        暂未发现共性问题（可能尚未完成评测，或所有用例均通过）
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.evaluatorId}>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {nameOf(group.evaluatorId)}
          </p>
          <ul className="space-y-1.5">
            {group.issues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-md px-2.5 py-1.5 ring-1 ring-foreground/5"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Badge className={`shrink-0 border-transparent ${issue.kindColor}`}>
                    {KIND_LABEL[issue.kind] ?? issue.kind}
                  </Badge>
                  <span className="line-clamp-2 break-all text-[13px] leading-relaxed" title={issue.text}>
                    {issue.text}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {issue.caseIds.slice(0, 2).map((cid) => (
                    <Link
                      key={cid}
                      href={`/experiments/${experimentId}/cases/${cid}`}
                      className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      case
                    </Link>
                  ))}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1 ${
                      issue.count >= 3
                        ? "bg-destructive/10 text-destructive ring-destructive/30"
                        : "bg-muted/50 text-muted-foreground ring-foreground/10"
                    }`}
                  >
                    ×{issue.count}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {group.total > group.issues.length && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              另有 {group.total - group.issues.length} 条低频问题未列出
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
