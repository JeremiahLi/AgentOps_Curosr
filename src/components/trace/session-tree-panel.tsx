"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { OutcomeBadge } from "./shared";
import { formatTokens } from "@/lib/format";

/**
 * 会话父子树面板：祖先面包屑 + 自身高亮卡 + 后代嵌套树。
 * 数据源 GET /api/sessions/[id]/tree；视觉语言照搬 SpanTree（缩进 + Chevron 折叠）。
 */

interface TreeNode {
  id: string;
  title: string;
  status: string;
  outcome: string;
  startTime: string;
  endTime: string | null;
  agentName: string;
  model: string;
  totalTokens: number;
  parentSessionId: string | null;
  parentSpanId?: string | null;
  parentSpanName?: string | null;
  depth: number;
  childCount?: number;
  children: TreeNode[];
}

interface TreeResponse {
  session: (TreeNode & { parentSpanName?: string | null }) | null;
  ancestors: TreeNode[];
  descendants: TreeNode[];
}

export function SessionTreePanel({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [data, setData] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tree`);
      if (res.status === 404) {
        setError("会话不存在");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as TreeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const go = (id: string) => router.push(`/trace/${id}`);

  if (error) return <p className="text-[13px] text-destructive">{error}</p>;
  if (!data) return <p className="text-[13px] text-muted-foreground">加载中…</p>;
  if (!data.session) return <p className="text-[13px] text-muted-foreground">会话不存在</p>;

  const self = data.session;
  const hasChain = data.ancestors.length > 0 || data.descendants.length > 0;

  return (
    <div className="space-y-4">
      {/* 祖先链（root-first 面包屑） */}
      {data.ancestors.length > 0 && (
        <section>
          <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">祖先链</h3>
          <div className="flex flex-wrap items-center gap-1 text-[13px]">
            {data.ancestors.map((a, i) => (
              <span key={a.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                <button
                  className="max-w-[220px] cursor-pointer truncate rounded px-1 py-0.5 text-left hover:bg-muted"
                  title={`${a.title || a.id}（${a.agentName}）`}
                  onClick={() => go(a.id)}
                >
                  {a.title || `#${a.id.slice(0, 8)}`}
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 自身 */}
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">当前会话</h3>
        <div className="rounded-lg bg-muted/40 p-3 ring-1 ring-primary/20">
          <div className="flex items-center gap-2">
            <OutcomeBadge outcome={self.outcome} status={self.status} />
            <span className="truncate text-[13px] font-medium">{self.title || `#${self.id.slice(0, 8)}`}</span>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {formatTokens(self.totalTokens)}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            #{self.id.slice(0, 8)} · {self.agentName}
          </div>
          {self.parentSpanName && (
            <div className="mt-1 text-[12px] text-muted-foreground">
              派生自父会话的 {self.parentSpanName} 调用
            </div>
          )}
        </div>
      </section>

      {/* 后代嵌套树 */}
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">
          子会话{data.descendants.length > 0 ? `（${data.descendants.length} 个直接子节点）` : ""}
        </h3>
        {data.descendants.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">无子会话</p>
        ) : (
          <div>
            {data.descendants.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
                onGo={go}
              />
            ))}
          </div>
        )}
      </section>

      {!hasChain && self.parentSessionId === null && (
        <p className="text-[12px] text-muted-foreground">
          该会话无父子链路信息（历史数据或单会话运行）。
        </p>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  onGo,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onGo: (id: string) => void;
}) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded py-1 pr-2 hover:bg-muted/60"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          <button
            className="shrink-0 cursor-pointer text-muted-foreground"
            onClick={() => onToggle(node.id)}
            aria-label={isCollapsed ? "展开" : "折叠"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <OutcomeBadge outcome={node.outcome} status={node.status} />
        <button
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] hover:underline"
          title={`${node.title || node.id}（${node.agentName}）`}
          onClick={() => onGo(node.id)}
        >
          {node.title || `#${node.id.slice(0, 8)}`}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          #{node.id.slice(0, 8)}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatTokens(node.totalTokens)}
        </span>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            onGo={onGo}
          />
        ))}
    </div>
  );
}
