"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SessionFeedback({
  sessionId,
  userId,
  agentId,
}: {
  sessionId: string;
  userId: string;
  agentId: string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  async function send(kind: "up" | "down" | "report") {
    setBusy(kind);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, sessionId, agentId, kind, body: note }),
      });
      if (response.ok) setNote(kind === "up" ? "已记为有用" : kind === "down" ? "已记为无用" : "已上报");
      else setNote("没有记上");
    } finally {
      setBusy("");
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === "up"} onClick={() => send("up")}>
        有用
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === "down"} onClick={() => send("down")}>
        无用
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy === "report"} onClick={() => send("report")}>
        上报
      </Button>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </span>
  );
}
