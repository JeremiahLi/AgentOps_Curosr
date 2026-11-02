"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { SkillTable, ToolTable } from "@/components/skill/skill-tables";
import { formatNumber, pctChange } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import type { SkillToolBoard } from "@/lib/engine/stats/skill-tool-board";
import { cn } from "@/lib/utils";

/** 失败率排行的最小样本：1 次失败 / 1 次调用 = 100% 会永远霸榜，没有决策价值 */
const MIN_FAIL_RATE_SAMPLE = 10;
/** 排行榜展示条数 */
const TOP_N = 10;

/**
 * Tool & Skill 看板（/skills）。
 *
 * 定位：从「谁在被用」到「哪里在失败」的定位入口。
 *   1. KPI      —— 工具调用/失败率、skill 调用/覆盖
 *   2. Tool 区  —— 调用量、失败率排行、耗时排行、工具表、失败聚类（带样例链路深链）
 *   3. Skill 区 —— 调用排行、Agent 分布、注册表全量（含零调用）
 *
 * 本页多处数字带闸门，都是踩过的坑（详见 engine/stats/skill-tool-board.ts 头注释）：
 * - skill 有两条识别通道，其中一条实测是测试桩，已剔除；
 * - 工具有两代命名（read/read_file），已归一，别名可在表内悬停查看；
 * - 4 个工具的 duration 恒为 800ms（采集端占位值），不参与耗时排名。
 */
export default function SkillToolBoardPage() {
  const [range, setRange] = useState<StatsRange>("30d");
  const [data, setData] = useState<SkillToolBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // 进入页面先同步一次 skill 注册表，「零调用 / 未注册」的判断依赖这份名单
  useEffect(() => {
    fetch("/api/skills/sync", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/skills/board?range=${range}`)
      .then((r) => r.json())
      .then((d: SkillToolBoard & { error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setFailed(true);
          return;
        }
        setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {loading ? "加载中..." : failed ? "加载失败，请刷新重试" : "暂无数据"}
        </p>
      </div>
    );
  }

  const { kpi, meta } = data;

  /* ---------------------------- 排行榜数据 ---------------------------- */

  const callData = data.tools.slice(0, TOP_N).map((t) => ({ name: t.name, value: t.calls }));

  const failRateData = data.tools
    .filter((t) => t.calls >= MIN_FAIL_RATE_SAMPLE && t.failed > 0)
    .map((t) => ({ name: t.name, value: Number(t.failRate.toFixed(1)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  // 耗时排行只放耗时可信的工具，否则「恒定 800ms」会占据榜首
  const durationData = data.tools
    .filter((t) => t.timingTrusted && t.p50 > 0)
    .map((t) => ({ name: t.name, value: t.p50 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  // skill 名普遍比工具名长，图表里截断（全名在下方注册表里）+ 放大 Y 轴刻度区，否则左侧被裁字
  const skillCallData = data.skills
    .filter((s) => s.calls > 0)
    .slice(0, TOP_N)
    .map((s) => ({
      name: s.name.length > 22 ? `${s.name.slice(0, 22)}…` : s.name,
      value: s.calls,
    }));

  const agentSkillData = data.skillAgentUsage.slice(0, TOP_N).map((a) => ({
    name: a.name.length > 22 ? `${a.name.slice(0, 22)}…` : a.name,
    value: a.calls,
  }));

  const chartH = (n: number) => Math.min(Math.max(150, n * 26), 320);

  const failDelta =
    kpi.toolFailRatePrev == null ? null : Number((kpi.toolFailRate - kpi.toolFailRatePrev).toFixed(1));

  const qualityIssue = meta.stubCalls > 0 || meta.untrustedTools > 0;

  return (
    <div className={cn("flex flex-col gap-5 p-6 transition-opacity", loading && "opacity-60")}>
      <PageHeader
        title="Tool & Skill 看板"
        description={`工具调用与 Skill 使用的健康度（${data.range}）· 失败定位优先，耗时只统计数据可信的工具`}
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={range}
            onChange={setRange}
          />
        }
      />

      {/* 1. KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="工具调用"
          value={formatNumber(kpi.toolCalls)}
          sub={`${kpi.tools} 个工具 · ${formatNumber(kpi.toolSessions)} 个会话`}
          // 当天 0 调用时环比必然是 -100%，纯噪音，不画箭头
          trend={kpi.toolCalls > 0 ? pctChange(kpi.toolCalls, kpi.toolCallsPrev) : undefined}
        />
        <KpiCard
          label="工具失败率"
          value={`${kpi.toolFailRate.toFixed(1)}%`}
          sub={
            failDelta == null
              ? `${formatNumber(kpi.toolFailed)} 次失败`
              : `${formatNumber(kpi.toolFailed)} 次失败 · 较上期 ${failDelta > 0 ? "+" : ""}${failDelta}pp`
          }
          subTone={kpi.toolFailRate >= 10 ? "destructive" : kpi.toolFailRate >= 3 ? "warning" : "default"}
        />
        <KpiCard
          label="Skill 加载"
          value={formatNumber(kpi.skillCalls)}
          sub={`已用 ${kpi.skillsUsed}/${kpi.skillsRegistered} 个 · ${formatNumber(kpi.skillSessions)} 个会话`}
        />
        <KpiCard
          label="Skill 覆盖 Agent"
          value={formatNumber(kpi.skillAgents)}
          sub={`零调用 ${kpi.skillsZero} 个 · 未纳入统计 ${kpi.dirtySkillNames} 个`}
          subTone={kpi.dirtySkillNames > 0 ? "warning" : "default"}
        />
      </div>

      {/* 数据质量闸门说明：只在确实剔除了数据时出现，避免变成长期噪音 */}
      {qualityIssue ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-warning ring-1 ring-warning/25">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {meta.stubCalls > 0 ? (
              <>
                已识别并剔除 <b>{meta.stubCalls}</b> 次测试桩调用（采集端把 skill 名当工具名上报，input 恒为测试串），
                未计入 Skill 排行。
              </>
            ) : null}
            {meta.stubCalls > 0 && meta.untrustedTools > 0 ? " " : null}
            {meta.untrustedTools > 0 ? (
              <>
                <b>{meta.untrustedTools}</b> 个工具的 duration 取值恒定（采集端占位值），已从耗时统计与排名中排除
                —— 否则会得出「某工具恒定 800ms、比 bash 快」的错误结论。
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* 2. Tool 区 */}
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">Tool 调用</h2>
        <span className="text-[11px] text-muted-foreground/80">
          {formatNumber(kpi.toolCalls)} 次 · 失败 {formatNumber(kpi.toolFailed)} 次 · 点工具名进 Session 列表
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>调用量 Top {TOP_N}</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">两代命名已归一</span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH(callData.length) }}>
            {callData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段没有工具调用
              </p>
            ) : (
              <FancyBarChartH
                data={callData}
                valueFormatter={(v) => formatNumber(v)}
                ariaLabel="调用次数"
                yAxisInterval={0}
                xInteger
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>失败率排行</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">调用 ≥{MIN_FAIL_RATE_SAMPLE} 次</span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH(failRateData.length) }}>
            {failRateData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段没有工具失败
              </p>
            ) : (
              <FancyBarChartH
                data={failRateData}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                ariaLabel="失败率"
                yAxisInterval={0}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>工具清单</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            默认按调用量排序 · 点列头切换 · 点工具名进入相关 Session
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <ToolTable
            rows={data.tools}
            criticalFailRate={meta.criticalFailRate}
            criticalFailCount={meta.criticalFailCount}
          />
        </CardContent>
        <div className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
          {meta.aliasNote}。{meta.timingNote}。
        </div>
      </Card>

      {/* 失败聚类：真正的定位入口 —— 逐条列 300 行没法读，按签名收敛成十几簇 */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>失败聚类</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            按「工具 × 错误签名」聚合 · 点样例链路定位到具体 Span
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {data.failClusters.length === 0 ? (
            <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              该时间段没有工具失败记录
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.failClusters.map((c) => (
                <li key={`${c.tool}-${c.signature}`} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <Link
                        href={`/trace?tool=${encodeURIComponent(c.tool)}`}
                        className="shrink-0 font-mono text-[12px] font-medium text-muted-foreground hover:text-primary"
                      >
                        {c.tool}
                      </Link>
                      <span className="truncate text-[13px] font-medium" title={c.signature}>
                        {c.signature}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[13px] tabular-nums text-destructive">
                      {formatNumber(c.count)} 次
                    </span>
                  </div>
                  <p
                    className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-muted-foreground/80"
                    title={c.sampleError}
                  >
                    {c.sampleError.replace(/\s+/g, " ").slice(0, 200) || "（无错误文本）"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
                    <span>
                      {c.sessions} 个会话{c.agents.length > 0 ? ` · ${c.agents.join("、")}` : ""}
                    </span>
                    <Link
                      href={`/trace/${c.sampleSessionId}?spanId=${c.sampleSpanId}`}
                      className="text-primary hover:underline"
                    >
                      查看样例链路 →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <div className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
          签名归一规则：Python traceback 取末行异常类型、进程退出码取数字、bash 语法错误/权限/系统 errno
          单独归类，其余取首个有信息量的行（去除绝对路径）。最深的一簇通常就是最该修的那个工具。
        </div>
      </Card>

      {/* 3. Skill 区 */}
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">Skill 使用</h2>
        <span className="text-[11px] text-muted-foreground/80">
          {formatNumber(kpi.skillCalls)} 次加载 · {kpi.skillsUsed}/{kpi.skillsRegistered} 个被使用 · 点 Skill 名进 Session 列表
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>加载次数 Top {TOP_N}</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">两条识别通道合并</span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH(skillCallData.length) }}>
            {skillCallData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段没有 Skill 加载
              </p>
            ) : (
              <FancyBarChartH
                data={skillCallData}
                valueFormatter={(v) => formatNumber(v)}
                ariaLabel="加载次数"
                yAxisInterval={0}
                yAxisWidth={200}
                xInteger
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>谁在用 Skill</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">按 Agent 汇总加载次数</span>
          </CardHeader>
          <CardContent className="pt-4" style={{ height: chartH(agentSkillData.length) }}>
            {agentSkillData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段没有 Skill 使用
              </p>
            ) : (
              <FancyBarChartH
                data={agentSkillData}
                valueFormatter={(v) => formatNumber(v)}
                ariaLabel="加载次数"
                yAxisInterval={0}
                yAxisWidth={190}
                xInteger
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>Skill 注册表与使用</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            共 {kpi.skillsRegistered} 个注册 Skill · 零调用 {kpi.skillsZero} 个
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <SkillTable rows={data.skills} />
        </CardContent>
        <div className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
          「加载成功率」统计的是 skill 文件被读取的成功率（实测长期 100%，主要用于发现异常），
          不代表 skill 执行效果 —— skill 被加载后的执行不会再产生独立 span。
        </div>
      </Card>

      {/* 未纳入统计的名字：脏值 / 名字对不上注册表，属数据质量，不混进排行 */}
      {data.dirtySkills.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>未纳入统计的名字</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {data.dirtySkills.length} 个 · 路径解析出脏值或与注册表对不上
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border/60">
              {data.dirtySkills.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 truncate font-mono text-[12px]">{d.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-sm px-1 py-0.5",
                        d.reason === "脏值" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.reason}
                    </span>
                    <span className="font-mono tabular-nums">{d.calls} 次</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <div className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
            脏值 = 路径里是模板变量（实测出现过 <span className="font-mono">[name]</span>，说明采集端未替换占位符）；
            未注册 = 目录名在 Skill 表里找不到（命名不一致或注册表未同步）。
          </div>
        </Card>
      ) : null}

      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground/70">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        时间口径按会话发生时间（Session.startTime）归属，与其它看板一致；采集端占位耗时与测试桩都会让本页数字偏离真实值，
        已在页内单独标注。
      </p>
    </div>
  );
}
