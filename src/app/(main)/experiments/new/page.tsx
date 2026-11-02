"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Check, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useEvaluators } from "@/hooks/use-evaluators";
import { EvaluatorPicker } from "@/components/experiments/evaluator-picker";
import {
  EvaluatorConfigForm,
  isConfigValid,
} from "@/components/experiments/evaluator-config-form";

interface Agent {
  id: string;
  name: string;
  emoji: string;
}

interface Session {
  id: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  startTime: string;
  totalRounds: number;
  totalTokens: number;
}

const steps = ["基本信息", "选择评估器", "选择 Session", "填写参考答案", "确认创建"];

export default function NewExperimentPage() {
  const router = useRouter();
  const { evaluators, byId, nameOf, loading: evaluatorsLoading } = useEvaluators();
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedEvaluators, setSelectedEvaluators] = useState<string[]>([]);
  const [evaluatorConfig, setEvaluatorConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [referenceOutputs, setReferenceOutputs] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => setAgents(data))
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    if (selectedAgentId) {
      fetch(`/api/experiments/sessions?agentId=${selectedAgentId}`)
        .then((r) => r.json())
        .then((data) => setSessions(data))
        .catch(() => setSessions([]));
    } else {
      setSessions([]);
    }
  }, [selectedAgentId]);

  const toggleSession = (id: string) => {
    setSelectedSessions((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const setReferenceOutput = (sessionId: string, value: string) => {
    setReferenceOutputs((prev) => ({ ...prev, [sessionId]: value }));
  };

  const setEvaluatorConfigValue = (evaluatorId: string, key: string, value: unknown) => {
    setEvaluatorConfig((prev) => ({
      ...prev,
      [evaluatorId]: { ...prev[evaluatorId], [key]: value },
    }));
  };

  const needsReference = selectedEvaluators.some((id) => byId[id]?.needsReference);

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return name.trim() && selectedAgentId;
      case 1:
        return (
          selectedEvaluators.length > 0 &&
          selectedEvaluators.every((id) => {
            const meta = byId[id];
            if (!meta || meta.type !== "rule") return true;
            return isConfigValid(meta, evaluatorConfig[id]);
          })
        );
      case 2:
        return selectedSessions.length > 0;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const cases = selectedSessions.map((sessionId) => ({
        sessionId,
        referenceOutput: referenceOutputs[sessionId] || null,
      }));
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          agentId: selectedAgentId,
          evaluatorIds: selectedEvaluators,
          evaluatorConfigJson: JSON.stringify(evaluatorConfig),
          cases,
        }),
      });
      const data = await res.json();
      if (data.id) {
        router.push(`/experiments/${data.id}`);
      }
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">新建实验</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">按步骤配置评测实验</p>
      </div>

      {/* 步骤指示器 */}
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                i === currentStep
                  ? "bg-primary text-primary-foreground"
                  : i < currentStep
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < currentStep ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span
              className={`text-[13px] ${
                i === currentStep ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
          </div>
        ))}
      </div>

      {/* 步骤内容 */}
      <div className="flex-1 min-h-0">
        {currentStep === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">实验名称</label>
                <Input
                  placeholder="输入实验名称..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">选择 Agent</label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`flex items-center gap-2 rounded-md p-3 text-left transition-colors ${
                        selectedAgentId === agent.id
                          ? "bg-primary/5 ring-1 ring-primary/40"
                          : "ring-1 ring-foreground/10 hover:ring-foreground/25"
                      }`}
                    >
                      <span className="truncate text-[13px] font-medium">{agent.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>选择评估器</CardTitle>
            </CardHeader>
            <CardContent>
              {evaluatorsLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">加载评估器中...</p>
              ) : (
                <>
                  <EvaluatorPicker
                  evaluators={evaluators}
                  selected={selectedEvaluators}
                  onChange={setSelectedEvaluators}
                />
                {selectedEvaluators.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    已选择 {selectedEvaluators.length} 个评估器
                  </p>
                )}
                  {/* 规则评估器参数配置（实验级，对该实验全部用例生效） */}
                  {selectedEvaluators
                    .map((id) => byId[id])
                    .filter((meta) => meta && meta.type === "rule")
                    .map((meta) => (
                      <div key={meta.id} className="mt-4 rounded-md p-4 ring-1 ring-foreground/10">
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-[13px] font-medium">{meta.name} · 参数</span>
                          <Badge variant="outline">规则</Badge>
                        </div>
                        <EvaluatorConfigForm
                          meta={meta}
                          value={evaluatorConfig[meta.id] ?? {}}
                          onChange={(key, val) => setEvaluatorConfigValue(meta.id, key, val)}
                        />
                      </div>
                    ))}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>选择 Session</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  该 Agent 暂无可用 Session
                </p>
              ) : (
                <>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => toggleSession(session.id)}
                        className={`flex w-full items-center justify-between rounded-md p-3 text-left transition-colors ${
                          selectedSessions.includes(session.id)
                            ? "bg-primary/5 ring-1 ring-primary/40"
                            : "ring-1 ring-foreground/10 hover:ring-foreground/25"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="font-mono text-[13px] tabular-nums">{session.id.slice(-8)}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {new Date(session.startTime).toLocaleDateString("zh-CN")} · {session.totalRounds} 轮 · {session.totalTokens.toLocaleString()} tokens
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={session.status === "completed" ? "outline" : "destructive"}
                        >
                          {session.status}
                        </Badge>
                      </button>
                    ))}
                  </div>
                  {selectedSessions.length > 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      已选择 {selectedSessions.length} 个 Session
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {currentStep === 3 && (
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle>填写参考答案</CardTitle>
              {needsReference ? (
                <p className="text-sm text-muted-foreground">
                  你选择了需要参考答案的评估器，建议为每个 Session 填写参考答案以获得更准确的评测结果。
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  你未选择需要参考答案的评估器，可以直接跳过此步骤。
                </p>
              )}
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-4">
              {selectedSessions.map((sessionId) => {
                return (
                  <div key={sessionId} className="rounded-md p-4 ring-1 ring-foreground/10">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-mono text-[13px] tabular-nums">{sessionId.slice(-8)}</span>
                      {needsReference && (
                        <Badge variant="outline">建议填写</Badge>
                      )}
                    </div>
                    <Textarea
                      placeholder="输入参考答案（可选）..."
                      value={referenceOutputs[sessionId] || ""}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReferenceOutput(sessionId, e.target.value)}
                      className="min-h-[80px]"
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {currentStep === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>确认创建</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 rounded-md bg-muted/30 p-4 ring-1 ring-foreground/5">
                <div className="flex justify-between">
                  <span className="text-[13px] text-muted-foreground">实验名称</span>
                  <span className="text-[13px] font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[13px] text-muted-foreground">目标 Agent</span>
                  <span className="text-[13px] font-medium">
                    {agents.find((a) => a.id === selectedAgentId)?.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[13px] text-muted-foreground">评估器</span>
                  <span className="text-[13px] font-medium">
                    {selectedEvaluators.map((id) => nameOf(id)).join("、")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[13px] text-muted-foreground">Session 数量</span>
                  <span className="text-[13px] font-medium tabular-nums">{selectedSessions.length} 个</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[13px] text-muted-foreground">已填参考答案</span>
                  <span className="text-[13px] font-medium tabular-nums">
                    {Object.values(referenceOutputs).filter((v) => v.trim()).length} / {selectedSessions.length}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                创建后可在实验详情页手动触发评测执行。
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 底部操作 */}
      <div className="shrink-0 flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1.5" />
          上一步
        </Button>
        <div className="flex items-center gap-2">
          {currentStep === 3 && !needsReference && (
            <Button
              variant="ghost"
              onClick={() => setCurrentStep(4)}
            >
              跳过
              <SkipForward className="h-4 w-4 ml-1.5" />
            </Button>
          )}
          {currentStep < steps.length - 1 ? (
            <Button
              onClick={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
              disabled={!canProceed()}
            >
              下一步
              <ChevronRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "创建中..." : "创建实验"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
