"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Play, Eye, Loader2, FileText, GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shell/page-header";

interface Experiment {
  id: string;
  name: string;
  type: string;
  agentId: string;
  evaluatorIds: string[];
  status: string;
  caseCount: number;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; variant: string }> = {
  draft: { label: "草稿", variant: "secondary" },
  running: { label: "运行中", variant: "default" },
  done: { label: "已完成", variant: "outline" },
  failed: { label: "失败", variant: "destructive" },
};

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/experiments")
      .then((r) => r.json())
      .then((data) => setExperiments(data))
      .catch(() => setExperiments([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="评测中心"
        description="创建和管理 Agent 评测实验"
        actions={
          <span className="flex items-center gap-2">
            <Link href="/experiments/compare">
              <Button size="sm" variant="outline">
                <GitCompareArrows className="h-3.5 w-3.5" />
                实验对比
              </Button>
            </Link>
            <Link href="/experiments/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                新建实验
              </Button>
            </Link>
          </span>
        }
      />

      {experiments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-4 h-8 w-8 text-muted-foreground/40" />
            <h3 className="mb-1.5 text-sm font-medium">暂无实验</h3>
            <p className="mb-4 text-[13px] text-muted-foreground">创建你的第一个评测实验，开始评估 Agent 表现</p>
            <Link href="/experiments/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                新建实验
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {experiments.map((exp) => {
            const status = statusConfig[exp.status] || statusConfig.draft;
            return (
              <Card key={exp.id} className="gap-3 p-4 transition-colors hover:ring-foreground/25">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate">{exp.name}</CardTitle>
                  <Badge variant={status.variant as never} className="ml-2 shrink-0">
                    {exp.status === "running" && <Loader2 className="animate-spin" />}
                    {status.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>{exp.caseCount} 个 Case</span>
                  <span className="text-border">|</span>
                  <span>{exp.evaluatorIds.length} 个评估器</span>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    创建于 {new Date(exp.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <div className="flex gap-1.5">
                    <Link href={`/experiments/${exp.id}`}>
                      <Button variant="ghost" size="xs">
                        <Eye />
                        详情
                      </Button>
                    </Link>
                    {exp.status === "draft" && (
                      <Button size="xs">
                        <Play />
                        运行
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
