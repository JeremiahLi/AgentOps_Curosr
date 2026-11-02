"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidePanel } from "@/components/trace/slide-panel";
import { useEvaluators } from "@/hooks/use-evaluators";
import { EvaluatorPicker } from "@/components/experiments/evaluator-picker";
import {
  EvaluatorConfigForm,
  isConfigValid,
} from "@/components/experiments/evaluator-config-form";

export interface SampleSession {
  id: string;
  agentId: string;
  agentName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: SampleSession[];
  onDone: () => void;
}

interface ExperimentListItem {
  id: string;
  name: string;
  agentId: string;
  status: string;
  caseCount: number;
}

export function SampleToExperimentPanel({ open, onClose, sessions, onDone }: Props) {
  const router = useRouter();
  const { evaluators, byId, loading: evaluatorsLoading } = useEvaluators();

  const [tab, setTab] = useState<"new" | "append">("new");
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selectedEvaluators, setSelectedEvaluators] = useState<string[]>([]);
  const [evaluatorConfig, setEvaluatorConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [experiments, setExperiments] = useState<ExperimentListItem[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sessions) seen.set(s.agentId, s.agentName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [sessions]);

  // 打开时重置 + 拉取实验列表
  useEffect(() => {
    if (!open) return;
    setTab("new");
    setName("");
    setSelectedEvaluators([]);
    setEvaluatorConfig({});
    setSelectedExperimentId("");
    setError(null);
    setAgentId(agentIds.length === 1 ? agentIds[0].id : "");
    fetch("/api/experiments")
      .then((r) => r.json())
      .then((data) => setExperiments(Array.isArray(data) ? data : []))
      .catch(() => setExperiments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessions]);

  const setConfigValue = (evaluatorId: string, key: string, value: unknown) => {
    setEvaluatorConfig((prev) => ({
      ...prev,
      [evaluatorId]: { ...prev[evaluatorId], [key]: value },
    }));
  };

  const caseIds = sessions.map((s) => s.id);

  const canSubmitNew =
    name.trim() !== "" &&
    agentId !== "" &&
    selectedEvaluators.length > 0 &&
    selectedEvaluators.every((id) => {
      const meta = byId[id];
      if (!meta || meta.type !== "rule") return true;
      return isConfigValid(meta, evaluatorConfig[id]);
    });

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          agentId,
          evaluatorIds: selectedEvaluators,
          evaluatorConfigJson: JSON.stringify(evaluatorConfig),
          caseIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        setError(data.error || "创建失败");
        return;
      }
      onDone();
      onClose();
      router.push(`/experiments/${data.id}`);
    } catch {
      setError("创建失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleAppend = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${selectedExperimentId}/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "追加失败");
        return;
      }
      onDone();
      onClose();
      alert(
        `追加完成：新增 ${data.addedCount} 条用例` +
          (data.skippedCount > 0 ? `，跳过重复 ${data.skippedCount} 条` : "")
      );
    } catch {
      setError("追加失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlidePanel open={open} onClose={onClose} width={60} minWidth="640px" maxWidth="900px">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">
            抽样到实验
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              已选 {sessions.length} 个 Session
            </span>
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-border px-5 pt-2">
        {(
          [
            ["new", "新建实验"],
            ["append", "追加已有实验"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setError(null);
            }}
            className={`rounded-t-md px-3.5 py-2 text-[13px] transition-colors ${
              tab === key
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
        {tab === "new" ? (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium">实验名称 *</label>
              <Input
                placeholder="例如：客服 Agent 退款流程回归"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium">目标 Agent *</label>
              {agentIds.length === 1 ? (
                <Badge variant="secondary">{agentIds[0].name}</Badge>
              ) : (
                <Select value={agentId} onValueChange={(v) => setAgentId(v ?? "")}>
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="选中了多个 Agent，请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentIds.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium">评估器 *</label>
              {evaluatorsLoading ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : (
                <>
                  <EvaluatorPicker
                    evaluators={evaluators}
                    selected={selectedEvaluators}
                    onChange={setSelectedEvaluators}
                  />
                  {selectedEvaluators
                    .map((id) => byId[id])
                    .filter((meta) => meta && meta.type === "rule")
                    .map((meta) => (
                      <div key={meta.id} className="mt-3 rounded-md p-3.5 ring-1 ring-foreground/10">
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-[13px] font-medium">{meta.name} · 参数</span>
                          <Badge variant="outline">规则</Badge>
                        </div>
                        <EvaluatorConfigForm
                          meta={meta}
                          value={evaluatorConfig[meta.id] ?? {}}
                          onChange={(key, val) => setConfigValue(meta.id, key, val)}
                        />
                      </div>
                    ))}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              选择要追加到的实验，追加的用例将按该实验已有的评估器与参数执行评测。
            </p>
            <div className="space-y-2">
              {experiments.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无实验</p>
              )}
              {experiments.map((exp) => (
                <button
                  key={exp.id}
                  onClick={() => setSelectedExperimentId(exp.id)}
                  disabled={exp.status === "running"}
                  className={`flex w-full items-center justify-between rounded-md p-3 text-left transition-colors disabled:opacity-50 ${
                    selectedExperimentId === exp.id
                      ? "bg-primary/5 ring-1 ring-primary/40"
                      : "ring-1 ring-foreground/10 hover:ring-foreground/25"
                  }`}
                >
                  <span className="text-[13px] font-medium">{exp.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {exp.status === "running" ? (
                      <Badge variant="default">运行中</Badge>
                    ) : (
                      <>
                        <span className="tabular-nums">{exp.caseCount} 用例</span>
                        <Badge variant="outline">{exp.status}</Badge>
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          取消
        </Button>
        {tab === "new" ? (
          <Button onClick={handleCreate} disabled={busy || !canSubmitNew}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建实验（{sessions.length} 条用例）
          </Button>
        ) : (
          <Button onClick={handleAppend} disabled={busy || !selectedExperimentId}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            追加（{sessions.length} 条）
          </Button>
        )}
      </div>
    </SlidePanel>
  );
}
