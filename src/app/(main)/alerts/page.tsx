"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnomalyList, type Anomaly } from "@/components/shell/anomaly-list";

interface AlertEvent {
  id: string;
  type: string;
  severity: string;
  message: string;
  status: string;
  hitCount: number;
  lastSeenAt: string;
  resolvedAt: string | null;
}

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  minSeverity: string;
  types: string[];
  target: string;
  lastError: string;
}

const TYPE_OPTIONS = [
  { id: "error", label: "错误会话" },
  { id: "agent_error", label: "Agent 错误率" },
  { id: "token", label: "Token 偏高" },
  { id: "activity_drop", label: "活跃下降" },
];

export default function AlertsPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/alerts");
    if (!response.ok) throw new Error("alerts failed");
    return response.json() as Promise<{ events: AlertEvent[]; rules: AlertRule[] }>;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats?range=realtime")
      .then((response) => {
        if (!response.ok) throw new Error("stats failed");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setAnomalies(data.anomalies ?? []);
        return loadHistory();
      })
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events);
        setRules(data.rules);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setAnomalies([]);
        setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  async function saveRule(form: FormData) {
    setBusy("save");
    setNotice("");
    try {
      const response = await fetch("/api/alert-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          target: String(form.get("target") || ""),
          minSeverity: String(form.get("minSeverity") || "warning"),
          types: form.getAll("type").map(String),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error || "规则没有保存");
        return;
      }
      const data = await loadHistory();
      setEvents(data.events);
      setRules(data.rules);
      setNotice("规则已保存。新打开的告警会推到这个地址。");
    } finally {
      setBusy("");
    }
  }

  async function toggleRule(rule: AlertRule) {
    setBusy(rule.id);
    const response = await fetch(`/api/alert-rules/${rule.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (response.ok) {
      const data = await loadHistory();
      setRules(data.rules);
    }
    setBusy("");
  }

  async function removeRule(id: string) {
    setBusy(id);
    const response = await fetch(`/api/alert-rules/${id}`, { method: "DELETE" });
    if (response.ok) {
      const data = await loadHistory();
      setEvents(data.events);
      setRules(data.rules);
    }
    setBusy("");
  }

  const loading = anomalies === null;
  const criticalCount = anomalies?.filter((item) => item.severity === "critical").length ?? 0;
  const warningCount = anomalies?.filter((item) => item.severity === "warning").length ?? 0;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="告警中心"
        description="今日异常与概览同源。打开页面时把仍在发生的异常写入历史；消失的标为已恢复。新打开的告警按规则推到 webhook。"
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">历史告警</CardTitle>
        </CardHeader>
        <CardContent>
          {events === null ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有记下来的告警。打开本页或概览后，今日异常会留在这里。</p>
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                  <span>
                    <span className="mr-1.5 rounded-sm bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                      {event.status === "open" ? "发生中" : "已恢复"}
                    </span>
                    {event.message}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {event.hitCount} 次 · {new Date(event.lastSeenAt).toLocaleString("zh-CN", { hour12: false })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">推送规则</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有规则。下面填一个 webhook，只在告警新打开或再次打开时推送。</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span>
                    {rule.name}
                    <span className="ml-2 text-[12px] text-muted-foreground">
                      {rule.enabled ? "启用" : "停用"} · {rule.minSeverity === "critical" ? "仅严重" : "警告及以上"}
                      {rule.target ? ` · ${rule.target}` : " · 未填地址"}
                    </span>
                    {rule.lastError ? <span className="mt-0.5 block text-[12px] text-destructive">{rule.lastError}</span> : null}
                  </span>
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy === rule.id} onClick={() => toggleRule(rule)}>
                      {rule.enabled ? "停用" : "启用"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === rule.id} onClick={() => removeRule(rule.id)}>
                      删除
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-2 border-t border-border/60 pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveRule(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="name" required placeholder="规则名称" className="h-8 rounded-md border border-border bg-background px-2 text-[13px]" />
            <input name="target" placeholder="https://example.com/hooks/alerts" className="h-8 rounded-md border border-border bg-background px-2 text-[13px]" />
            <select name="minSeverity" className="h-8 max-w-48 rounded-md border border-border bg-background px-2 text-[13px]" defaultValue="warning">
              <option value="warning">警告及以上</option>
              <option value="critical">仅严重</option>
            </select>
            <div className="flex flex-wrap gap-2 text-[12px]">
              {TYPE_OPTIONS.map((item) => (
                <label key={item.id} className="inline-flex items-center gap-1">
                  <input type="checkbox" name="type" value={item.id} />
                  {item.label}
                </label>
              ))}
              <span className="text-muted-foreground">不选表示全部类型</span>
            </div>
            {notice ? <p className="text-[12px] text-muted-foreground">{notice}</p> : null}
            <div>
              <Button type="submit" size="sm" disabled={busy === "save"}>
                保存规则
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/70">
        口径说明见{" "}
        <Link href="/" className="underline-offset-2 hover:underline">
          概览仪表盘
        </Link>
        。
      </p>
    </div>
  );
}
