import type { SessionDetail, SpanNode } from "./types";

/**
 * 将 /api/sessions/[sessionId] 返回的 Round → Turn → Span 结构
 * 拍平为 Trace Viewer 使用的扁平 Span（相对会话起点的时间线）。
 */
export interface TraceSpan {
  id: string;
  kind: string;
  name: string;
  status: string;
  model?: string;
  tokens?: NonNullable<SpanNode["tokens"]>;
  input?: string;
  output?: string;
  error?: string;
  details?: string;
  /** 采集端附加的内容段（技能说明 / 回答正文等）；老详情页有，这里一并透传 */
  content?: string;
  startTime: number; // epoch ms
  relStart: number; // 距会话起点的秒数（>= 0）
  durationMs: number; // 展示用时长（tool/answer 有细分时长时优先）
  timelineMs: number; // 甘特图条形实际时长
  roundIndex: number;
  branchId: string | null;
  isSkill: boolean;
}

export function isFailed(span: { status: string }): boolean {
  return span.status === "failed" || span.status === "error";
}

export function displayDurationMs(span: {
  kind: string;
  duration: number;
  llmThinkDuration?: number;
  agentReplyDuration?: number;
  toolDuration?: number;
}): number {
  if (span.kind === "tool_call" && span.toolDuration != null) return span.toolDuration;
  if ((span.kind === "llm_thinking" || span.kind === "answer") && span.agentReplyDuration != null)
    return span.agentReplyDuration;
  return span.duration;
}

export function flattenSession(detail: SessionDetail): TraceSpan[] {
  const result: Array<Omit<TraceSpan, "relStart">> = [];

  const push = (span: SpanNode, branchId: string | null) => {
    result.push({
      id: span.id,
      kind: span.kind,
      name: span.name,
      status: span.status,
      model: span.model,
      tokens: span.tokens,
      input: span.input,
      output: span.output,
      error: span.error,
      details: span.details,
      content: span.content,
      startTime: span.startTime,
      durationMs: displayDurationMs(span),
      timelineMs: span.duration,
      roundIndex: span.roundIndex,
      branchId,
      isSkill: span.kind === "tool_call" && span.name === "skill",
    });
  };

  for (const round of detail.rounds) {
    if (round.inputSpan) push(round.inputSpan, null);
    if (round.systemPromptSpan) push(round.systemPromptSpan, null);
    for (const turn of round.turns) {
      for (const span of turn.spans) push(span, null);
    }
    if (round.answerSpan) push(round.answerSpan, null);
    for (const branch of round.branches ?? []) {
      for (const span of branch.spans) push(span, branch.id);
    }
  }

  // 以最早的 Span 时刻为 0 点基准。
  // session.startTime 可能是入库时间（晚于实际会话开始），不能作为时间线原点；
  // Span 之间相对顺序由采集端保证递增，以此还原真实的穿行时间线。
  const t0 = result.length > 0 ? Math.min(...result.map((r) => r.startTime)) : 0;

  return result
    .map((r) => ({ ...r, relStart: Math.max(0, (r.startTime - t0) / 1000) }))
    .sort((a, b) => a.startTime - b.startTime);
}

/** Span 类型 → 主题色变量（深色为附件配色，浅色为工程配色） */
export function spanColor(span: { kind: string; status: string }): string {
  if (isFailed(span)) return "var(--destructive)";
  switch (span.kind) {
    case "llm_thinking":
      return "var(--trace-llm)";
    case "tool_call":
    case "tool_execution":
    case "command":
      return "var(--trace-tool)";
    case "answer":
      return "var(--trace-agent)";
    case "user":
      return "var(--trace-user)";
    case "system_prompt":
      return "var(--trace-sys)";
    default:
      return "var(--muted-foreground)";
  }
}

const kindLabelMap: Record<string, string> = {
  user: "USER",
  system_prompt: "SYSTEM",
  llm_thinking: "LLM",
  tool_call: "TOOL",
  tool_execution: "EXEC",
  command: "CMD",
  answer: "ANSWER",
  session_start: "SESSION",
  system: "SYS",
  error: "ERROR",
};

export function kindLabel(kind: string): string {
  return kindLabelMap[kind] ?? kind.toUpperCase();
}

/** 同一 Round 内：同名 LLM（模型）/ 同名 Tool 各合并为一行（无论调用多少次） */
export function rowKeyOf(span: TraceSpan): string {
  if (span.kind === "llm_thinking") return `llm:${span.model || span.name}`;
  if (span.kind === "tool_call" || span.kind === "tool_execution" || span.kind === "command")
    return `tool:${span.name}`;
  return `${span.kind}:${span.name}`;
}

export function rowLabelOf(span: TraceSpan): string {
  switch (span.kind) {
    case "llm_thinking":
      return `LLM  ${span.model || span.name}`;
    case "tool_call":
      return span.isSkill ? `Skill ${getSkillDisplayName(span)}` : `Tool ${span.name}`;
    case "command":
      return `Cmd ${span.name}`;
    case "user":
      return "用户输入";
    case "system_prompt":
      return "System Prompt";
    case "answer":
      return "最终回答";
    default:
      return span.name;
  }
}

function getSkillDisplayName(span: TraceSpan): string {
  const input = span.input;
  if (input) {
    const patterns = [/skills[\\\/]+([^\\"\\/,]+)SKILL\.md/i];
    for (const p of patterns) {
      const m = input.match(p);
      if (m && m[1]) return m[1];
    }
  }
  return span.name;
}

// ==================== Timeline 行/分组结构 ====================

export interface SpanRow {
  key: string;
  label: string;
  kind: string;
  depth: number; // 缩进层级：Tool 归属于 LLM 调用，缩进一级
  spans: TraceSpan[];
  laneCount: number; // 泳道数：并行（时间重叠）的 Span 上下堆叠
  laneOf: Record<string, number>; // spanId -> 泳道序号（0-based）
}

export interface SpanGroup {
  id: string;
  title: string;
  isBranch: boolean;
  startSec: number;
  endSec: number;
  failed: boolean;
  rows: SpanRow[];
}

function buildRows(spans: TraceSpan[]): SpanRow[] {
  const rows: SpanRow[] = [];
  const map = new Map<string, SpanRow>();
  for (const s of spans) {
    const key = rowKeyOf(s);
    const existing = map.get(key);
    if (existing) {
      existing.spans.push(s);
    } else {
      const depth =
        s.kind === "tool_call" || s.kind === "tool_execution" || s.kind === "command" ? 1 : 0;
      const row: SpanRow = {
        key,
        label: rowLabelOf(s),
        kind: s.kind,
        depth,
        spans: [s],
        laneCount: 1,
        laneOf: {},
      };
      map.set(key, row);
      rows.push(row);
    }
  }
  // 泳道分配：同一行内时间重叠的 Span 上下堆叠（并行执行可视化）
  for (const row of rows) {
    const sorted = [...row.spans].sort((a, b) => a.relStart - b.relStart);
    const laneEnds: number[] = []; // 每条泳道当前最后一个 Span 的结束时刻（秒）
    for (const s of sorted) {
      const end = s.relStart + s.timelineMs / 1000;
      let lane = laneEnds.findIndex((e) => e <= s.relStart + 0.001);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      row.laneOf[s.id] = lane;
    }
    row.laneCount = laneEnds.length;
    row.spans = sorted;
  }
  return rows;
}

export function buildGroups(spans: TraceSpan[]): SpanGroup[] {
  const groups: SpanGroup[] = [];
  const roundIndices = Array.from(new Set(spans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  for (const idx of roundIndices) {
    const roundSpans = spans.filter((s) => s.roundIndex === idx && !s.branchId);
    if (roundSpans.length > 0) {
      groups.push({
        id: `round-${idx}`,
        title: `Round ${idx + 1}`,
        isBranch: false,
        startSec: Math.min(...roundSpans.map((s) => s.relStart)),
        endSec: Math.max(...roundSpans.map((s) => s.relStart + s.timelineMs / 1000)),
        failed: roundSpans.some(isFailed),
        rows: buildRows(roundSpans),
      });
    }
    // 分支（Fork）作为独立的虚线分组
    const branchIds = Array.from(
      new Set(spans.filter((s) => s.roundIndex === idx && s.branchId).map((s) => s.branchId)),
    ) as string[];
    for (const branchId of branchIds) {
      const branchSpans = spans.filter((s) => s.branchId === branchId);
      if (branchSpans.length === 0) continue;
      groups.push({
        id: `branch-${branchId}`,
        title: `Branch · ${branchSpans[0].name}`,
        isBranch: true,
        startSec: Math.min(...branchSpans.map((s) => s.relStart)),
        endSec: Math.max(...branchSpans.map((s) => s.relStart + s.timelineMs / 1000)),
        failed: branchSpans.some(isFailed),
        rows: buildRows(branchSpans),
      });
    }
  }
  return groups;
}

// ==================== Token 曲线 ====================

export interface TokenEvent {
  time: number; // 结束时刻（秒）
  start: number;
  duration: number; // 秒
  add: number; // total（含缓存）
  in: number;
  out: number;
  cache: number; // cacheRead + cacheWrite
  id: string;
  name: string;
}

export function buildTokenSeries(spans: TraceSpan[], totalSeconds: number) {
  const events: TokenEvent[] = spans
    .filter((s) => s.tokens && (s.tokens.total > 0 || s.tokens.input > 0 || s.tokens.output > 0))
    .map((s) => ({
      time: s.relStart + s.timelineMs / 1000,
      start: s.relStart,
      duration: s.timelineMs / 1000,
      add: s.tokens!.total,
      in: s.tokens!.input,
      out: s.tokens!.output,
      cache: s.tokens!.cacheRead + s.tokens!.cacheWrite,
      id: s.id,
      name: s.name,
    }))
    .sort((a, b) => a.time - b.time);

  let cum = 0;
  const points: Array<TokenEvent & { cum: number } | { time: number; cum: number }> = [
    { time: 0, cum: 0 },
  ];
  for (const e of events) {
    cum += e.add;
    points.push({ ...e, cum });
  }
  points.push({ time: totalSeconds, cum });
  return { points, events };
}

/** 会话总时长（秒）：由 Span 实际跨度决定（session.totalDuration 可能只记活跃时长/不准确） */
export function totalSecondsOf(detail: SessionDetail, spans: TraceSpan[]): number {
  void detail;
  const maxEnd = spans.reduce((m, s) => Math.max(m, s.relStart + s.timelineMs / 1000), 0);
  return Math.max(maxEnd, 0.001);
}

/**
 * 剔除轮与轮之间的无效空闲时间，避免长间隔把整体图示压扁。
 * 规则：Round 按顺序拼接；若下一轮的开始比上一轮的结束晚超过 gapSec，
 * 多出的空闲被剔除（压缩为 gapSec 的分隔）；轮内时间关系保持不变。
 */
export const ROUND_GAP_SEC = 2;

export function compressIdleGaps(spans: TraceSpan[], gapSec: number = ROUND_GAP_SEC): TraceSpan[] {
  if (spans.length === 0) return spans;
  const indices = Array.from(new Set(spans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  // 每个 Round 的真实起止（基于 flattenSession 的相对秒）
  const bounds = new Map<number, { start: number; end: number }>();
  for (const idx of indices) {
    const rs = spans.filter((s) => s.roundIndex === idx);
    if (rs.length === 0) continue;
    bounds.set(idx, {
      start: Math.min(...rs.map((s) => s.relStart)),
      end: Math.max(...rs.map((s) => s.relStart + s.timelineMs / 1000)),
    });
  }

  // 逐轮累计需要前移的偏移量
  const offsets = new Map<number, number>();
  let prevEnd: number | null = null;
  let accumulated = 0;
  for (const idx of indices) {
    const b = bounds.get(idx);
    if (!b) continue;
    if (prevEnd != null) {
      const realGap = b.start - prevEnd;
      if (realGap > gapSec) accumulated += realGap - gapSec;
    }
    offsets.set(idx, accumulated);
    prevEnd = b.end;
  }

  if (accumulated <= 0) return spans;
  return spans.map((s) => ({
    ...s,
    relStart: Math.max(0, s.relStart - (offsets.get(s.roundIndex) ?? 0)),
  }));
}

// ==================== LLM 调用构成分解 ====================

/**
 * 单次调用的 Token 口径（全部走 API 上报的三段，不再用 totalTokens）：
 *
 *   prompt（上下文规模）= input + cacheRead + cacheWrite
 *   fresh（新增）      = input + cacheWrite   ← 未命中缓存的那部分
 *   reuse（复用）      = cacheRead            ← 命中缓存的前缀，无需重新计算
 *   output             = output               ← 模型输出，不计入输入
 *
 * 为什么不用 totalTokens：库里并存两套口径（旧/种子数据是 input+output，
 * 上行链路是四段之和），前端按四段重算可以绕开这个不一致。
 *
 * fresh 的内部来源（上一轮输出 / 文件读取 / 工具结果 / 用户输入 / 系统提示 / 工具定义）
 * API 不提供，只能按各来源字符数占比分摊——合计恰等于 fresh，属估算。
 */

export interface CallPart {
  key: string;
  label: string;
  desc?: string;
  colorVar: string;
  value: number;
}

export interface CallInfo {
  id: string;
  name: string;
  model?: string;
  time: number; // relStart 秒（压缩域）
  duration: number; // 秒
  order: number; // 全局序号（1-based）
  roundIndex: number;
  /** 上下文规模 = input + cacheRead + cacheWrite（真实值） */
  prompt: number;
  /** 新增 = input + cacheWrite（真实值） */
  fresh: number;
  /** 复用 = cacheRead（真实值） */
  reuse: number;
  /** 本次模型输出（真实值，不属于输入） */
  output: number;
  /** 新增部分的来源构成（估算，合计恰等于 fresh） */
  parts: CallPart[];
}

const approxTokens = (text?: string | null): number => {
  if (!text) return 0;
  // CJK 感知估算：汉字 ≈0.7 token/字（现代分词器 1 token ≈ 1.4~1.7 个汉字），
  // 其余字符 ≈4 字符/token。纯 /4 会对中文显著低估，残差被推入"其他"。
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意
      (cp >= 0x3400 && cp <= 0x4dbf) || // 扩展 A
      (cp >= 0x3000 && cp <= 0x303f) || // CJK 标点
      (cp >= 0xff00 && cp <= 0xffef) // 全角字符
    ) {
      cjk++;
    }
  }
  return Math.round(cjk * 0.7 + (text.length - cjk) / 4);
};

const TOOL_KINDS = new Set(["tool_call", "tool_execution", "command"]);

/**
 * 视为「文件读取」的工具名（小写匹配）。
 * 这个场景里 read 的结果常占新增输入的绝大部分，混在「工具结果」里看不出来。
 */
const READ_TOOLS = new Set(["read", "read_file", "readfile", "view_file", "cat"]);

/** 是否为工具类 Span（用于树/甘特缩进归属到所属 LLM 调用） */
export function isToolKind(kind: string): boolean {
  return TOOL_KINDS.has(kind);
}

export function buildCalls(spans: TraceSpan[]): CallInfo[] {
  const calls = spans
    .filter((s) => s.kind === "llm_thinking" && s.tokens)
    .sort((a, b) => a.startTime - b.startTime);

  const result: CallInfo[] = [];
  let prev: TraceSpan | null = null;

  for (const c of calls) {
    const t = c.tokens!;
    const prompt = t.input + t.cacheRead + t.cacheWrite;
    const fresh = Math.max(t.input + t.cacheWrite, 0);
    const reuse = Math.max(t.cacheRead, 0);
    const output = t.output;
    const isFirstOfRound = !prev || prev.roundIndex !== c.roundIndex;
    const assistant = !isFirstOfRound ? prev?.tokens?.output ?? 0 : 0;

    // 两次调用之间的工具结果：read 类工具（文件读取）单独归一类
    let toolReadEst = 0;
    let toolOtherEst = 0;
    const lo = prev ? prev.startTime : -Infinity;
    for (const s of spans) {
      if (!TOOL_KINDS.has(s.kind) || s.roundIndex !== c.roundIndex) continue;
      if (s.startTime > lo && s.startTime <= c.startTime) {
        const est = approxTokens(s.output);
        if (READ_TOOLS.has(s.name.toLowerCase())) toolReadEst += est;
        else toolOtherEst += est;
      }
    }

    // Round 首次调用：用户输入 + 系统提示 + 工具定义
    let userEst = 0;
    let sysEst = 0;
    let toolDefsEst = 0;
    if (isFirstOfRound) {
      for (const s of spans) {
        if (s.roundIndex !== c.roundIndex) continue;
        if (s.kind === "user") userEst += approxTokens(s.input);
        else if (s.kind === "system_prompt") {
          sysEst += approxTokens(s.input);
          // 工具定义：采集端记录在 system_prompt span 的 details.tools（name + 字符数）
          if (s.details) {
            try {
              const d: { tools?: Array<{ chars?: number }> } = JSON.parse(s.details);
              const tools = d && Array.isArray(d.tools) ? d.tools : null;
              if (tools) {
                toolDefsEst = Math.round(
                  tools.reduce((acc: number, t: { chars?: number }) => acc + (typeof t.chars === "number" ? t.chars : JSON.stringify(t).length), 0) / 4,
                );
              }
            } catch {
              /* details 非工具清单 JSON，忽略 */
            }
          }
        }
      }
    }

    // 按各来源字符占比把 fresh 分摊下去：柱高是真实值，分段是估算，合计恰等于 fresh
    const parts = allocateFresh(fresh, [
      {
        key: "assistant",
        label: "上轮模型输出",
        desc: "上一轮模型的输出（含 tool_calls），作为本轮输入重新送入模型",
        colorVar: "--call-assistant",
        est: assistant,
      },
      {
        key: "toolRead",
        label: "文件读取",
        desc: "read 类工具返回的文件内容（按字符数估算）",
        colorVar: "--call-fileread",
        est: toolReadEst,
      },
      {
        key: "tool",
        label: "工具结果（其他）",
        desc: "bash / grep / 写文件等其余工具的执行结果（按字符数估算）",
        colorVar: "--call-tool",
        est: toolOtherEst,
      },
      {
        key: "user",
        label: "用户输入",
        desc: "本轮用户提问（按字符数估算）",
        colorVar: "--call-user",
        est: userEst,
      },
      {
        key: "system",
        label: "系统提示",
        desc: "本轮注入的 System Prompt（按字符数估算）",
        colorVar: "--call-sys",
        est: sysEst,
      },
      {
        key: "toolDefs",
        label: "工具定义",
        desc: "本次请求携带的工具/Schema 定义（按采集到的字符数估算）",
        colorVar: "--call-tooldefs",
        est: toolDefsEst,
      },
    ]);

    result.push({
      id: c.id,
      name: c.name,
      model: c.model,
      time: c.relStart,
      duration: c.timelineMs / 1000,
      order: result.length + 1,
      roundIndex: c.roundIndex,
      prompt,
      fresh,
      reuse,
      output,
      parts,
    });
    prev = c;
  }
  return result;
}

/**
 * 把真实的 fresh 按各来源的字符估算占比分摊。
 *
 * 为什么是分摊而不是直接取值：fresh（input + cacheWrite）是 API 上报的真值，
 * 但它内部哪部分是文件、哪部分是工具结果，API 不提供。若直接画估算值，
 * 柱高会与真实新增对不上（经常超出），所以柱高锁死真值、分段按比例缩放。
 */
function allocateFresh(
  fresh: number,
  items: Array<{ key: string; label: string; desc?: string; colorVar: string; est: number }>,
): CallPart[] {
  if (fresh <= 0) return [];

  /** 没命中缓存、被整段重算的旧上下文（典型：新一轮开始、缓存过期） */
  const miss: CallPart = {
    key: "miss",
    label: "未归因（旧上下文/截断）",
    desc: "新增里无法归到具体来源的部分：可能是没命中缓存、被整段重算的旧上下文，也可能是采集端截断的系统提示 / 未记录的工具定义",
    colorVar: "--call-other",
    value: 0,
  };

  const totalEst = items.reduce((acc, i) => acc + Math.max(i.est, 0), 0);
  if (totalEst <= 0) {
    return [{ ...miss, value: fresh }];
  }

  const toParts = (list: Array<{ key: string; label: string; desc?: string; colorVar: string; value: number }>) =>
    list
      .filter((i) => i.value > 0)
      .map((i) => ({ key: i.key, label: i.label, desc: i.desc, colorVar: i.colorVar, value: i.value }));

  // 新内容估算量没超过真实新增 → 估算值直接用，差额即"旧上下文未命中"
  if (totalEst <= fresh) {
    const kept = items.map((i) => ({
      key: i.key,
      label: i.label,
      desc: i.desc,
      colorVar: i.colorVar,
      value: Math.max(Math.round(i.est), 0),
    }));
    const sum = kept.reduce((acc, i) => acc + i.value, 0);
    if (sum > fresh && kept.length > 0) {
      // 逐项舍入后反超真实值：从最大项里扣回，避免柱子超出坐标轴上沿
      let idx = 0;
      for (let i = 1; i < kept.length; i++) if (kept[i].value > kept[idx].value) idx = i;
      kept[idx].value = Math.max(kept[idx].value - (sum - fresh), 0);
    }
    const rest = fresh - kept.reduce((acc, i) => acc + i.value, 0);
    return toParts([...kept, { ...miss, value: rest }]);
  }

  // 估算量超过真实新增（字符估算偏大）→ 等比缩放，不产生未命中项
  const scaled = items.map((i) => ({
    key: i.key,
    label: i.label,
    desc: i.desc,
    colorVar: i.colorVar,
    value: Math.round((fresh * Math.max(i.est, 0)) / totalEst),
  }));
  const kept = toParts(scaled);
  // 最大余数法：把舍入差补到体量最大的那一项，保证 Σ value === fresh
  const diff = fresh - kept.reduce((acc, i) => acc + i.value, 0);
  if (diff !== 0 && kept.length > 0) {
    let idx = 0;
    for (let i = 1; i < kept.length; i++) if (kept[i].value > kept[idx].value) idx = i;
    kept[idx].value += diff;
  }
  return kept;
}
