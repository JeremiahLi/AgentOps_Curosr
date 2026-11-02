"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatTokens } from "@/lib/format";

export interface Anomaly {
  type: string;
  severity: "critical" | "warning";
  message: string;
  sessionIds?: string[];
  details?: {
    sessionId?: string;
    agentName?: string;
    tokens?: number;
    excessPercent?: number;
    errorRate?: number;
  }[];
}

export function AnomalyItem({ anomaly }: { anomaly: Anomaly }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = anomaly.details && anomaly.details.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${anomaly.severity === "critical" ? "bg-destructive" : "bg-warning"}`}
        />
        <span className="text-muted-foreground">{anomaly.message}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="ml-3.5 mt-1.5 max-w-xl overflow-hidden rounded-md ring-1 ring-foreground/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                {anomaly.details![0].sessionId != null && (
                  <th className="px-2.5 py-1.5 text-left font-medium">Session ID</th>
                )}
                {anomaly.details![0].agentName != null && (
                  <th className="px-2.5 py-1.5 text-left font-medium">Agent</th>
                )}
                {anomaly.details![0].tokens != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">Token</th>
                )}
                {anomaly.details![0].excessPercent != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">超出均值</th>
                )}
                {anomaly.details![0].errorRate != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">错误率</th>
                )}
              </tr>
            </thead>
            <tbody>
              {anomaly.details!.map((d, i) => (
                <tr key={i} className="border-t border-border/60">
                  {d.sessionId != null && (
                    <td className="px-2.5 py-1.5">
                      <Link
                        href={`/trace?session=${d.sessionId}`}
                        className="font-mono text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {d.sessionId.slice(-6)}
                      </Link>
                    </td>
                  )}
                  {d.agentName != null && <td className="px-2.5 py-1.5">{d.agentName}</td>}
                  {d.tokens != null && (
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{formatTokens(d.tokens)}</td>
                  )}
                  {d.excessPercent != null && (
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-warning">
                      +{d.excessPercent}%
                    </td>
                  )}
                  {d.errorRate != null && (
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-destructive">
                      {d.errorRate}%
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return <p className="text-sm text-muted-foreground">当前实时口径下暂无异常。</p>;
  }
  return (
    <div className="space-y-3">
      {anomalies.map((a, i) => (
        <AnomalyItem key={`${a.type}-${i}`} anomaly={a} />
      ))}
    </div>
  );
}
