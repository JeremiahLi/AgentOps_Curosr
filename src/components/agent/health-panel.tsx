"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HealthDimension, HealthScore } from "@/lib/engine/stats/health";

const GRADE_TEXT: Record<string, string> = {
  A: "运行良好",
  B: "基本健康",
  C: "需要关注",
  D: "问题明显",
};

function scoreTone(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-success";
  if (score >= 70) return "text-info";
  if (score >= 55) return "text-warning";
  return "text-destructive";
}

function barTone(score: number | null): string {
  if (score == null) return "bg-muted";
  if (score >= 85) return "bg-success";
  if (score >= 70) return "bg-info";
  if (score >= 55) return "bg-warning";
  return "bg-destructive";
}

/** 环形进度：96px，纯 SVG，不引图表库 */
function ScoreRing({ total, grade }: { total: number | null; grade: string | null }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const pct = total == null ? 0 : Math.max(0, Math.min(100, total)) / 100;
  return (
    <div className="relative h-[96px] w-[96px] shrink-0">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`}
          className={cn(
            "transition-[stroke-dasharray] duration-500",
            grade === "A"
              ? "text-success"
              : grade === "B"
                ? "text-info"
                : grade === "C"
                  ? "text-warning"
                  : grade === "D"
                    ? "text-destructive"
                    : "text-muted-foreground",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[26px] font-semibold leading-none tabular-nums">
          {total ?? "—"}
        </span>
        <span className="mt-0.5 text-[10px] text-muted-foreground">{grade ? `等级 ${grade}` : "未使用"}</span>
      </div>
    </div>
  );
}

function DimRow({ dim }: { dim: HealthDimension }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="w-12 shrink-0 text-[13px] text-muted-foreground">{dim.label}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full transition-all duration-500", barTone(dim.score))}
            style={{ width: `${dim.score ?? 0}%` }}
          />
        </span>
        <span className={cn("w-8 shrink-0 text-right font-mono text-[13px] tabular-nums", scoreTone(dim.score))}>
          {dim.score == null ? "—" : Math.round(dim.score)}
        </span>
        <span className="hidden w-[92px] shrink-0 truncate text-right font-mono text-[11px] text-muted-foreground sm:block">
          {dim.metricDisplay}
        </span>
        <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground/70">
          {Math.round(dim.weight * 100)}%
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>{dim.detail}</p>
          {dim.anchors.length > 0 && (
            <p className="mt-1 font-mono">
              刻度：{dim.anchors.map((a) => `${a.at}→${a.score}`).join("  ")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 健康仪表盘：左环形总分 + 右四维分解。
 * 每维可展开看原始数值、上期基线与打分刻度 —— 分数必须能追溯到数据，不能是黑箱。
 */
export function HealthPanel({ health }: { health: HealthScore }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex items-center gap-3 sm:flex-col sm:gap-1">
        <ScoreRing total={health.total} grade={health.grade} />
        <div className="text-center">
          <p className={cn("text-[13px] font-medium", scoreTone(health.total))}>
            {health.grade ? GRADE_TEXT[health.grade] : "窗口内无会话"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            近 {health.windowDays} 天 · {health.confidence === "high" ? "样本充足" : "样本偏少，仅供参考"}
          </p>
        </div>
      </div>
      <ul className="min-w-0 flex-1 divide-y divide-border/40">
        {health.dims.map((d) => (
          <DimRow key={d.key} dim={d} />
        ))}
      </ul>
    </div>
  );
}
