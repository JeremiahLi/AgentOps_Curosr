"use client";

import { Badge } from "@/components/ui/badge";

const VERDICT_META: Record<string, { label: string; className: string }> = {
  pass: { label: "通过", className: "bg-success/15 text-success border-transparent" },
  warn: { label: "警告", className: "bg-warning/15 text-warning border-transparent" },
  fail: { label: "不通过", className: "bg-destructive/15 text-destructive border-transparent" },
};

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  const meta = VERDICT_META[verdict];
  if (!meta) return <Badge variant="outline">{verdict}</Badge>;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}
