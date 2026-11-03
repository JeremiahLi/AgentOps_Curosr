import Link from "next/link";
import type { IssueNote } from "@/lib/engine/ingest/issue-note";

/** 一条根因：定位到 session / span / 字段，并给出可回看的修改。 */
export function IssueNoteView({ note }: { note: IssueNote }) {
  const href = note.spanId
    ? `/trace/${note.sessionId}?spanId=${encodeURIComponent(note.spanId)}`
    : note.sessionId
      ? `/trace/${note.sessionId}`
      : "";
  if (!note.action && !note.caused && !note.conclusion) return null;
  return (
    <div className="mt-1.5 space-y-0.5 rounded-md bg-background/80 px-2 py-1.5 text-[12px] leading-5">
      {note.conclusion ? (
        <p className="break-words">
          <span className="font-medium">结论：</span>
          {note.conclusion}
        </p>
      ) : null}
      {note.sessionId ? (
        <p className="break-all">
          <span className="font-medium">定位：</span>
          session {note.sessionId}
          {note.spanId ? ` · span ${note.spanId}` : ""}
          {href ? (
            <>
              {" "}
              <Link href={href} className="text-primary hover:underline">
                打开这条
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {note.field ? (
        <p className="break-all">
          <span className="font-medium">字段：</span>
          {note.field}
          {note.observed ? ` = ${note.observed}` : ""}
        </p>
      ) : null}
      <p className="break-words">
        <span className="font-medium">动作：</span>
        {note.action || note.caused}
      </p>
      {note.verify ? (
        <p className="break-words text-muted-foreground">
          <span className="font-medium text-foreground">验证：</span>
          {note.verify}
        </p>
      ) : null}
      {note.modelError ? <p className="break-words text-muted-foreground">{note.modelError}</p> : null}
    </div>
  );
}
