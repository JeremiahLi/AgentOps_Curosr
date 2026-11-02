"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { AgentGuide, GuideItem } from "@/lib/engine/ingest/issue-guide";
import type { NoteLayer } from "@/lib/engine/ingest/issue-note";

const LAYER_LABEL: Record<NoteLayer, string> = {
  prompt: "提示词",
  skill: "skill",
  tool: "工具参数",
  env: "运行环境",
  insufficient: "证据不足",
};

function ItemLine({ item }: { item: GuideItem }) {
  const href = item.spanId
    ? `/trace/${item.sessionId}?spanId=${encodeURIComponent(item.spanId)}`
    : item.sessionId
      ? `/trace/${item.sessionId}`
      : "/issues";
  return (
    <li className="text-[13px] leading-5">
      <span className="font-medium">{item.title}</span>
      <span className="text-muted-foreground"> · 命中 {item.hitCount} 次</span>
      <p className="text-muted-foreground">{item.note.caused}</p>
      {item.note.where ? <p className="font-mono text-[11px] text-muted-foreground">依据：{item.note.where}</p> : null}
      <Link href={href} className="text-[12px] text-primary underline-offset-2 hover:underline">
        打开证据
      </Link>
    </li>
  );
}

export function AgentGuidePanel({ guide, failed }: { guide: AgentGuide | null; failed: boolean }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <h2 className="text-sm font-medium">开发指引</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        模型只根据每条问题的证据写结论，依据必须是原文里的句子。
      </p>
      {guide === null && !failed ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在对照历史问题…
        </p>
      ) : failed ? (
        <p className="mt-3 text-[13px] text-destructive">开发指引没有加载出来。</p>
      ) : guide && guide.groups.length === 0 && !guide.blocked ? (
        <p className="mt-3 text-[13px] text-muted-foreground">当前没有可以指导改动的已打开问题。</p>
      ) : (
        <div className="mt-3 space-y-3">
          {guide?.blocked ? <p className="text-[13px]">{guide.blockedReason}</p> : null}
          {guide?.groups.map((group) => (
            <div key={group.layer}>
              <h3 className="text-[12px] font-medium text-muted-foreground">{LAYER_LABEL[group.layer]}</h3>
              <ul className="mt-1 space-y-2">
                {group.items.map((item) => (
                  <ItemLine key={item.issueId} item={item} />
                ))}
              </ul>
            </div>
          ))}
          {guide && guide.pending > 0 ? (
            <p className="text-[12px] text-muted-foreground">还有 {guide.pending} 条没生成。刷新这一页会继续。</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
