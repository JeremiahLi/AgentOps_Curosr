"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnomalyList, type Anomaly } from "@/components/shell/anomaly-list";

/**
 * 告警中心：展示与概览页相同的实时异常哨兵（/api/stats?range=realtime）。
 * 历史告警持久化、通知渠道等能力尚未接入，本页先承接导航入口并集中展示当前异常。
 */
export default function AlertsPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/stats?range=realtime")
      .then((r) => {
        if (!r.ok) throw new Error("stats failed");
        return r.json();
      })
      .then((d) => setAnomalies(d.anomalies ?? []))
      .catch(() => {
        setFailed(true);
        setAnomalies([]);
      });
  }, []);

  const loading = anomalies === null;
  const criticalCount = anomalies?.filter((a) => a.severity === "critical").length ?? 0;
  const warningCount = anomalies?.filter((a) => a.severity === "warning").length ?? 0;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="告警中心"
        description="实时异常哨兵（与概览页异常栏同源）。历史告警库与推送规则规划中。"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">今日实时异常</CardTitle>
          {!loading && !failed && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {criticalCount > 0 && <span className="text-destructive">{criticalCount} 项严重</span>}
              {criticalCount > 0 && warningCount > 0 && " · "}
              {warningCount > 0 && <span className="text-warning">{warningCount} 项警告</span>}
              {criticalCount === 0 && warningCount === 0 && "无活跃异常"}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : failed ? (
            <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
          ) : (
            <AnomalyList anomalies={anomalies} />
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/70">
        口径说明见{" "}
        <Link href="/" className="underline-offset-2 hover:underline">
          概览仪表盘
        </Link>
        异常栏；Session 级失败与成本异常也可在{" "}
        <Link href="/trace" className="underline-offset-2 hover:underline">
          Session 看板
        </Link>{" "}
        进一步排查。
      </p>
    </div>
  );
}
