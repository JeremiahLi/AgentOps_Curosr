/**
 * Agent 健康分：四维打分 + 加权综合分。
 *
 * 设计约束（每条都对应实测数据）：
 * 1. 不能跨 framework 用绝对阈值。实测单轮耗时 P95：pi-coding-agent 509s，
 *    业务类 4.4~7.6s，差 70~110 倍；每轮 Token 差 10~70 倍。一套绝对阈值会让
 *    一个 Agent 永远 D、其余永远 A，分数零信息量。因此效率/成本用「自身历史基线
 *    + 绝对上限兜底」，稳定性/活跃度用绝对阈值（这两项跨类可比）。
 * 2. 成本用 input+output，绝不用 totalTokens。pi 每轮 cacheRead 462K 是 input 的
 *    10 倍，用 totalTokens 算成本等于惩罚「上下文复用得好」的 Agent。
 * 3. 窗口固定 30 天，不跟页面 range 联动。健康分是慢变量，跟着 1 天/7 天切换会跳级，
 *    且 1 天窗口下「活跃天数」退化无意义。
 * 4. sessions === 0 不打 0 分，返回 null（「未使用」不是「不健康」）。
 *
 * 纯函数，不依赖 prisma，可被看板与下钻页共用。
 */

export const HEALTH_WINDOW_DAYS = 30;

/** 四维权重，和为 1 */
export const HEALTH_WEIGHTS = {
  stability: 0.4,
  efficiency: 0.2,
  cost: 0.15,
  activity: 0.25,
} as const;

/** 等级阈值：>=85 A / >=70 B / >=55 C / 其余 D */
export const GRADE_CUTS = { A: 85, B: 70, C: 55 } as const;

/** 参与评分的最少已完成会话数（与 anomalies.ts 的 AGENT_ERROR_MIN_SESSIONS 一致） */
export const MIN_SESSIONS = 2;
/** 计算环比基线所需的最少上期会话数 */
export const MIN_BASELINE_SESSIONS = 3;
/** 样本数达到该值时置信度为 high */
const CONFIDENT_SESSIONS = 20;

export type HealthGrade = "A" | "B" | "C" | "D";
export type HealthDimKey = "stability" | "efficiency" | "cost" | "activity";

export interface HealthAnchor {
  /** 原始指标值（百分比或倍数） */
  at: number;
  /** 该锚点对应的得分 */
  score: number;
}

export interface HealthDimension {
  key: HealthDimKey;
  label: string;
  /** 0-100；null 表示样本不足，不参与加权 */
  score: number | null;
  weight: number;
  /** 原始指标名 */
  metricLabel: string;
  metricValue: number | null;
  /** 紧凑展示串，如 "42.2%" / "509.2s" / "45.0K" */
  metricDisplay: string;
  baselineValue: number | null;
  /** 如 "上期 46.1%" */
  baselineDisplay: string | null;
  /** 展开显示的人话解释 */
  detail: string;
  /** 刻度尺锚点（按 at 升序） */
  anchors: HealthAnchor[];
}

export interface HealthScore {
  /** 综合分 0-100；sessions===0 时为 null */
  total: number | null;
  grade: HealthGrade | null;
  confidence: "high" | "low";
  dims: HealthDimension[];
  windowDays: number;
  computedAt: string;
}

export interface HealthInput {
  framework: string;
  /** 窗口内会话数 */
  sessions: number;
  /** 非 active 会话数（成功率分母） */
  finishedSessions: number;
  /** errorCount>0 或 status='error' 的会话数 */
  badSessions: number;
  /** 有交付但过程中出现失败的会话数（partial），按半失败折算；缺省 0 */
  partialSessions?: number;
  toolCalls: number;
  toolFailed: number;
  rounds: number;
  activeDays: number;
  users: number;
  /** 单轮耗时 P95（ms） */
  p95PerRound: number;
  /** 每轮有效 Token（input+output） */
  tokensPerRound: number;
  prev: {
    sessions: number;
    p95PerRound: number;
    tokensPerRound: number;
  } | null;
}

/* ------------------------------- 分段函数 ------------------------------- */

/** 分段线性插值：低于首个锚点取首分，高于末个锚点取末分 */
function interpolate(x: number, anchors: HealthAnchor[]): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= anchors[0].at) return anchors[0].score;
  const last = anchors[anchors.length - 1];
  if (x >= last.at) return last.score;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (x <= b.at) {
      const t = (x - a.at) / (b.at - a.at);
      return a.score + t * (b.score - a.score);
    }
  }
  return last.score;
}

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

/**
 * 会话成功率锚点。
 * 97 / 93 取自 src/lib/format.ts 的 rateColor 绿/黄线（全站成功率语义色同一套）；
 * 70 取自 anomalies.ts 的 AGENT_ERROR_RATE_THRESHOLD = 0.3（错误率 30% 即成功率 70%），
 * 也就是「判定为异常 Agent」的边界，此处给 20 分。
 */
const SESSION_RATE_ANCHORS: HealthAnchor[] = [
  { at: 60, score: 0 },
  { at: 70, score: 20 },
  { at: 85, score: 55 },
  { at: 93, score: 78 },
  { at: 97, score: 92 },
  { at: 99, score: 100 },
];

/** 工具级成功率锚点。工具失败比会话失败更廉价（可重试），因此同分位略宽松。 */
const TOOL_RATE_ANCHORS: HealthAnchor[] = [
  { at: 70, score: 0 },
  { at: 80, score: 30 },
  { at: 90, score: 60 },
  { at: 95, score: 80 },
  { at: 97, score: 90 },
  { at: 99, score: 100 },
];

/** 耗时/成本相对上期的倍数锚点：1.0 倍（持平）给 90 分，允许小幅波动 */
const RATIO_ANCHORS: HealthAnchor[] = [
  { at: 0.8, score: 100 },
  { at: 1.0, score: 90 },
  { at: 1.25, score: 75 },
  { at: 1.5, score: 60 },
  { at: 2.0, score: 35 },
  { at: 3.0, score: 0 },
];

/** 成本倍数锚点：对成本更敏感，提前降分 */
const COST_RATIO_ANCHORS: HealthAnchor[] = [
  { at: 0.85, score: 100 },
  { at: 1.0, score: 90 },
  { at: 1.3, score: 70 },
  { at: 1.6, score: 50 },
  { at: 2.5, score: 0 },
];

/** 活跃天数占比锚点：0.40 / 0.15 复用 user-board.ts tierOf() 的高/中频分层阈值 */
const ACTIVE_DAY_ANCHORS: HealthAnchor[] = [
  { at: 0, score: 0 },
  { at: 0.05, score: 40 },
  { at: 0.15, score: 70 },
  { at: 0.4, score: 100 },
];

/* ------------------------------- 工具函数 ------------------------------- */

/** 编码/命令行类框架：天然单轮耗时长、Token 大，用另一套上限 */
const CODING_FRAMEWORKS = new Set(["pi-coding-agent", "opencode", "claude-code", "hermes"]);

function isCodingFramework(framework: string): boolean {
  return CODING_FRAMEWORKS.has(framework);
}

/** 绝对上限兜底：防止「一直就慢」的 Agent 因为环比稳定而拿满分 */
function efficiencyCap(framework: string, p95PerRound: number): number {
  const coding = isCodingFramework(framework);
  if (coding) {
    if (p95PerRound > 600_000) return 60;
    if (p95PerRound > 300_000) return 80;
    return 100;
  }
  if (p95PerRound > 20_000) return 60;
  if (p95PerRound > 10_000) return 80;
  return 100;
}

function costCap(framework: string, tokensPerRound: number): number {
  const coding = isCodingFramework(framework);
  if (coding) {
    if (tokensPerRound > 80_000) return 60;
    if (tokensPerRound > 40_000) return 80;
    return 100;
  }
  if (tokensPerRound > 12_000) return 60;
  if (tokensPerRound > 8_000) return 80;
  return 100;
}

/** 成功率（0-100）；无已完成会话时为 null。全站唯一口径入口。
 *
 * partialSessions（有交付但过程中出现过失败）按半个失败折算：
 * 这类会话最终交付了产物，判成失败会把「质检回流后修复」误伤成事故；
 * 但过程中的失败确实代表质量下降，也不能当完全成功。0.5 是折中值，
 * 与 health.ts 稳定性锚点的 97%/93% 分档配合，能把 partial 拉到 B 档附近。
 */
export function successRateOf(
  finishedSessions: number,
  badSessions: number,
  partialSessions = 0,
): number | null {
  if (finishedSessions <= 0) return null;
  return clamp((1 - (badSessions + partialSessions * 0.5) / finishedSessions) * 100);
}

export function gradeOf(total: number | null): HealthGrade | null {
  if (total == null) return null;
  if (total >= GRADE_CUTS.A) return "A";
  if (total >= GRADE_CUTS.B) return "B";
  if (total >= GRADE_CUTS.C) return "C";
  return "D";
}

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const mult = (n: number) => `×${n.toFixed(2)}`;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/* ------------------------------- 主函数 ------------------------------- */

export function scoreHealth(input: HealthInput): HealthScore {
  const windowDays = HEALTH_WINDOW_DAYS;
  const {
    framework,
    sessions,
    finishedSessions,
    badSessions,
    partialSessions = 0,
    toolCalls,
    toolFailed,
    rounds,
    activeDays,
    users,
    p95PerRound,
    tokensPerRound,
    prev,
  } = input;

  // 完全未使用：不打 0 分，「未使用」不是「不健康」
  if (sessions <= 0) {
    return {
      total: null,
      grade: null,
      confidence: "low",
      windowDays,
      computedAt: new Date().toISOString(),
      dims: [
        emptyDim("stability", "稳定性", "会话成功率", "窗口内无会话"),
        emptyDim("efficiency", "效率", "单轮耗时 P95", "窗口内无会话"),
        emptyDim("cost", "成本", "每轮 Token", "窗口内无会话"),
        emptyDim("activity", "活跃度", "活跃天数", "窗口内无会话"),
      ],
    };
  }

  /* ---- 1. 稳定性 ---- */
  const sessionRate = successRateOf(finishedSessions, badSessions, partialSessions);
  const toolRate = toolCalls > 0 ? clamp((1 - toolFailed / toolCalls) * 100) : null;

  let stability: number | null;
  if (sessionRate == null) {
    stability = null;
  } else if (toolRate == null || toolCalls < 5) {
    // 无工具调用的 Agent（纯对话类）只按会话成功率算，避免 0/0 拉低
    stability = interpolate(sessionRate, SESSION_RATE_ANCHORS);
  } else {
    stability = 0.7 * interpolate(sessionRate, SESSION_RATE_ANCHORS) + 0.3 * interpolate(toolRate, TOOL_RATE_ANCHORS);
  }
  stability = stability == null ? null : clamp(stability);

  const stabilityDim: HealthDimension = {
    key: "stability",
    label: "稳定性",
    weight: HEALTH_WEIGHTS.stability,
    score: stability,
    metricLabel: "会话成功率",
    metricValue: sessionRate,
    metricDisplay: sessionRate == null ? "—" : pct1(sessionRate),
    baselineValue: null,
    baselineDisplay: null,
    anchors: SESSION_RATE_ANCHORS,
    detail:
      sessionRate == null
        ? "窗口内没有已完成的会话，无法评估稳定性"
        : `会话成功率 ${pct1(sessionRate)}（失败 ${badSessions} / 部分成功 ${partialSessions} / 已完成 ${finishedSessions}，部分成功按半失败折算）` +
          (toolRate != null && toolCalls >= 5 ? `；工具失败率 ${pct1(100 - toolRate)}（${toolFailed}/${toolCalls}）` : "") +
          `。会话成功率按 97%/93% 分档（与全站成功率配色一致），70% 为异常判定边界。`,
  };

  /* ---- 2. 效率 ---- */
  const hasBaseline =
    prev != null && prev.sessions >= MIN_BASELINE_SESSIONS && prev.p95PerRound > 0 && p95PerRound > 0;
  const efficiencyCapScore = efficiencyCap(framework, p95PerRound);
  let efficiency: number | null;
  let efficiencyRatio: number | null = null;
  if (p95PerRound <= 0) {
    efficiency = null;
  } else if (hasBaseline) {
    efficiencyRatio = p95PerRound / prev!.p95PerRound;
    efficiency = clamp(Math.min(interpolate(efficiencyRatio, RATIO_ANCHORS), efficiencyCapScore));
  } else {
    efficiency = efficiencyCapScore;
  }

  const efficiencyDim: HealthDimension = {
    key: "efficiency",
    label: "效率",
    weight: HEALTH_WEIGHTS.efficiency,
    score: efficiency,
    metricLabel: "单轮耗时 P95",
    metricValue: p95PerRound > 0 ? p95PerRound : null,
    metricDisplay: p95PerRound > 0 ? fmtDuration(p95PerRound) : "—",
    baselineValue: hasBaseline ? prev!.p95PerRound : null,
    baselineDisplay: hasBaseline ? `上期 ${fmtDuration(prev!.p95PerRound)}` : null,
    anchors: RATIO_ANCHORS,
    detail:
      p95PerRound <= 0
        ? "窗口内没有有效耗时样本（会话 totalDuration 或 totalRounds 为 0）"
        : `单轮耗时 P95 ${fmtDuration(p95PerRound)}（${rounds} 轮）` +
          (hasBaseline
            ? `，上期 ${fmtDuration(prev!.p95PerRound)}（${mult(efficiencyRatio!)}）`
            : "，上期样本不足，仅按绝对上限评估") +
          `。${isCodingFramework(framework) ? "编码类" : "业务类"}上限：${isCodingFramework(framework) ? ">10min 计 60 / >5min 计 80" : ">20s 计 60 / >10s 计 80"}。`,
  };

  /* ---- 3. 成本 ---- */
  const hasCostBaseline =
    prev != null && prev.sessions >= MIN_BASELINE_SESSIONS && prev.tokensPerRound > 0 && tokensPerRound > 0;
  const costCapScore = costCap(framework, tokensPerRound);
  let cost: number | null;
  let costRatio: number | null = null;
  if (tokensPerRound <= 0) {
    cost = null;
  } else if (hasCostBaseline) {
    costRatio = tokensPerRound / prev!.tokensPerRound;
    cost = clamp(Math.min(interpolate(costRatio, COST_RATIO_ANCHORS), costCapScore));
  } else {
    cost = costCapScore;
  }

  const costDim: HealthDimension = {
    key: "cost",
    label: "成本",
    weight: HEALTH_WEIGHTS.cost,
    score: cost,
    metricLabel: "每轮 Token（输入+输出）",
    metricValue: tokensPerRound > 0 ? Math.round(tokensPerRound) : null,
    metricDisplay: tokensPerRound > 0 ? fmtTokens(tokensPerRound) : "—",
    baselineValue: hasCostBaseline ? Math.round(prev!.tokensPerRound) : null,
    baselineDisplay: hasCostBaseline ? `上期 ${fmtTokens(prev!.tokensPerRound)}` : null,
    anchors: COST_RATIO_ANCHORS,
    detail:
      tokensPerRound <= 0
        ? "窗口内没有 Token 记录"
        : `每轮 ${fmtTokens(tokensPerRound)} Token（仅输入+输出，不含缓存读取 —— 缓存命中高是优点，不能算成本）` +
          (hasCostBaseline ? `，上期 ${fmtTokens(prev!.tokensPerRound)}（${mult(costRatio!)}）` : "，上期样本不足，仅按绝对上限评估") +
          `。${isCodingFramework(framework) ? "编码类" : "业务类"}上限：${isCodingFramework(framework) ? ">80K 计 60 / >40K 计 80" : ">12K 计 60 / >8K 计 80"}。`,
  };

  /* ---- 4. 活跃度 ---- */
  const dayRatio = activeDays / Math.max(windowDays, 1);
  let activity = 0.7 * interpolate(dayRatio, ACTIVE_DAY_ANCHORS) + 0.3 * Math.min(users / 3, 1) * 100;
  const declined =
    prev != null && prev.sessions >= MIN_BASELINE_SESSIONS && (prev.sessions - sessions) / prev.sessions > 0.5;
  // 环比跌幅 > 50% 复用 /api/stats 的 activity_drop 阈值，打七折
  if (declined) activity *= 0.7;
  activity = clamp(activity);

  const activityDim: HealthDimension = {
    key: "activity",
    label: "活跃度",
    weight: HEALTH_WEIGHTS.activity,
    score: activity,
    metricLabel: "活跃天数",
    metricValue: activeDays,
    metricDisplay: `${activeDays}/${windowDays} 天`,
    baselineValue: prev?.sessions ?? null,
    baselineDisplay: prev ? `上期会话 ${prev.sessions}` : null,
    anchors: ACTIVE_DAY_ANCHORS.map((a) => ({ at: a.at * 100, score: a.score })),
    detail:
      `活跃 ${activeDays} / ${windowDays} 天，覆盖 ${users} 个用户。` +
      `按「活跃天占比」70% + 「用户广度（3 人封顶）」30% 加权` +
      (declined ? `；环比跌幅超过 50%（${prev!.sessions} → ${sessions}），已打七折。` : "。"),
  };

  /* ---- 汇总 ---- */
  const dims = [stabilityDim, efficiencyDim, costDim, activityDim];
  const scored = dims.filter((d) => d.score != null);
  const weightSum = scored.reduce((s, d) => s + d.weight, 0);
  const total =
    weightSum > 0 ? clamp(scored.reduce((s, d) => s + d.weight * d.score!, 0) / weightSum) : null;

  return {
    total: total == null ? null : Math.round(total),
    grade: gradeOf(total),
    confidence: finishedSessions >= CONFIDENT_SESSIONS && scored.length === dims.length ? "high" : "low",
    dims,
    windowDays,
    computedAt: new Date().toISOString(),
  };
}

function emptyDim(key: HealthDimKey, label: string, metricLabel: string, detail: string): HealthDimension {
  return {
    key,
    label,
    weight: HEALTH_WEIGHTS[key],
    score: null,
    metricLabel,
    metricValue: null,
    metricDisplay: "—",
    baselineValue: null,
    baselineDisplay: null,
    anchors: [],
    detail,
  };
}
