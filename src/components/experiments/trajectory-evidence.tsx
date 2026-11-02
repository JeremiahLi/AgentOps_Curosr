"use client";

import { ExternalLink } from "lucide-react";

type TrajEntry = Record<string, unknown>;

function asEntries(v: unknown): TrajEntry[] {
  return Array.isArray(v)
    ? (v.filter((x) => typeof x === "object" && x !== null) as TrajEntry[])
    : [];
}

function str(v: unknown): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {title}（{count}）
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * 轨迹质量评估的专项证据展示：探索目标 / 重复调用 / 无效调用 / 依赖模型知识的主张。
 * 全部为空时不渲染。
 */
export function TrajectoryEvidence({
  evidence,
  sessionId,
}: {
  evidence: Record<string, unknown>;
  sessionId?: string | null;
}) {
  const explored = asEntries(evidence.exploredTargets);
  const duplicates = asEntries(evidence.duplicateCalls);
  const invalid = asEntries(evidence.invalidCalls);
  const knowledge = asEntries(evidence.knowledgeOnlyClaims);

  const empty =
    explored.length === 0 &&
    duplicates.length === 0 &&
    invalid.length === 0 &&
    knowledge.length === 0;
  if (empty) return null;

  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">轨迹证据明细</p>

      {explored.length > 0 && (
        <Group title="探索目标" count={explored.length}>
          {explored.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <div className="min-w-0">
                <span className="break-all font-mono text-xs">{str(it.target)}</span>
                {it.action !== undefined && (
                  <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary">
                    {str(it.action)}
                  </span>
                )}
                {it.purpose !== undefined && it.purpose !== "" && (
                  <span className="ml-1.5 text-xs text-muted-foreground">— {str(it.purpose)}</span>
                )}
              </div>
            </div>
          ))}
        </Group>
      )}

      {duplicates.length > 0 && (
        <Group title="重复调用" count={duplicates.length}>
          {duplicates.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
              <div className="min-w-0">
                <span className="font-medium">{str(it.tool)}</span>
                {it.count !== undefined && (
                  <span className="ml-1.5 font-mono text-xs text-warning">×{str(it.count)}</span>
                )}
                {it.args !== undefined && it.args !== "" && (
                  <div className="break-all font-mono text-xs text-muted-foreground">{str(it.args)}</div>
                )}
                {it.note !== undefined && it.note !== "" && (
                  <div className="text-xs text-muted-foreground">{str(it.note)}</div>
                )}
              </div>
            </div>
          ))}
        </Group>
      )}

      {invalid.length > 0 && (
        <Group title="无效调用" count={invalid.length}>
          {invalid.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
              <div className="min-w-0">
                <span className="font-medium">{str(it.tool)}</span>
                {it.args !== undefined && it.args !== "" && (
                  <div className="break-all font-mono text-xs text-muted-foreground">{str(it.args)}</div>
                )}
                {it.issue !== undefined && it.issue !== "" && (
                  <div className="text-xs text-destructive">{str(it.issue)}</div>
                )}
              </div>
            </div>
          ))}
        </Group>
      )}

      {knowledge.length > 0 && (
        <Group title="依赖模型自带知识的主张（无轨迹实证）" count={knowledge.length}>
          {knowledge.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <div className="min-w-0">
                <div>{str(it.claim)}</div>
                {it.reason !== undefined && it.reason !== "" && (
                  <div className="text-xs text-muted-foreground">判定依据：{str(it.reason)}</div>
                )}
              </div>
            </div>
          ))}
        </Group>
      )}

      {sessionId && (
        <a
          href={`/trace/${sessionId}`}
          className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          在 Trace Viewer 中查看原轨迹
        </a>
      )}
    </div>
  );
}
