/**
 * 入库派生字段（纯函数，无 prisma 依赖）。
 *
 * 设计背景（每条都对应实测数据）：
 * 1. 采集端从未上报过 session_start span（全库 0 条），agent_name 恒走 fallback，
 *    导致所有 pi 会话都挂在同一个 Agent 上。因此这里补一层「从 span 内容反推工作目录」
 *    的兜底：tool_call 的 input 里有绝对路径（含 .pi/skills 锚点与 cd 命令），
 *    足以还原 agent 所在目录名。
 * 2. Project.name 此前被写成 projectId（16 位 hex），列表完全不可读。
 * 同一函数给出可读目录名。
 * 3. 旧口径「任一 span failed 即整会话失败」会把「质检关卡回流后最终交付」误判为失败：
 *    实测某会话 3 个 answer 全 success，但有 13 个 tool_call 失败（bash 校验退出码 1）。
 *    故引入 outcome 三态，详见 computeOutcome。
 */

export type SessionOutcome = "success" | "partial" | "failed" | "";

export interface InSpanLike {
  kind?: string;
  name?: string;
  status?: string;
  input?: string | null;
  output?: string | null;
  isError?: boolean;
  roundIndex?: number;
  turnId?: number;
  agent_name?: string;
}

/** 标题长度上限（列表列宽约 20 个汉字，留出省略号余量） */
const TITLE_MAX = 60;

function normalizeText(raw: string): string {
  return raw
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 取路径最后一段，兼容 Windows 与 POSIX 分隔符 */
export function basenameOf(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/);
  return parts[parts.length - 1] || "";
}

/**
 * 输出目录 / 构建目录等「子目录名」不是项目根：命中黑名单就回退到上一级。
 * 典型误判：`cd /e/proj/outputs && python tools/x.py` 会把 agent 叫成 outputs。
 */
const IGNORED_LEAF = new Set([
  "output", "outputs", "dist", "build", "node_modules", "src", "tmp", "temp",
  "test", "tests", "doc", "docs", "assets", "tools", "scripts", "logs", "cache",
]);

function projectNameOf(fullPath: string): string {
  let p = fullPath.replace(/[\\/]+$/, "");
  let leaf = basenameOf(p);
  let guard = 0;
  while (IGNORED_LEAF.has(leaf.toLowerCase()) && guard++ < 4) {
    const next = p.replace(/[\\/][^\\/]+$/, "");
    if (next === p) break;
    p = next;
    leaf = basenameOf(p);
  }
  return leaf;
}

/**
 * 从 tool_call 的 input 里提取工作目录候选。
 *
 * 两类锚点（按可靠性排序）：
 * - `.pi/skills/...` 前缀：`<root>\.pi\skills\x\SKILL.md` → `<root>`
 * - bash 的 `cd <path>`：`cd /e/a/b && ...` 或 `cd "E:\a\b"`
 *
 * 只认绝对路径（盘符或根斜杠），相对路径会有歧义。
 */
function cwdCandidatesFrom(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];

  // .pi 锚点：截到 .pi 之前
  const piRe = /([A-Za-z]:[\\/][^\s"'<>|]*?)[\\/]\.pi[\\/]/g;
  let m: RegExpExecArray | null;
  while ((m = piRe.exec(input)) !== null) out.push(m[1]);

  // POSIX 版 .pi 锚点（/e/xxx/.pi/）
  const piPosix = /(\/[^\s"'<>|]*?)\/\.pi\//g;
  while ((m = piPosix.exec(input)) !== null) out.push(m[1]);

  // cd 命令
  const cdRe = /cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))/g;
  while ((m = cdRe.exec(input)) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && (/^[A-Za-z]:[\\/]/.test(p) || /^\/[A-Za-z]?\//.test(p) || /^\/[a-z]\//.test(p))) {
      out.push(p);
    }
  }

  return out.map((s) => s.replace(/[\\/]+$/, "")).filter((s) => s.length > 2);
}

/**
 * 推导会话所属工作目录：所有 tool_call 里出现次数最多的候选。
 * 用众数而非首个，避免单条命令里 cd 到子目录把根目录带偏。
 */
export function deriveWorkspace(spans: InSpanLike[]): string | null {
  const counts = new Map<string, number>();
  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    for (const c of cwdCandidatesFrom(sp.input)) {
      // Windows 路径统一大小写比较，避免 E: 与 e: 分裂
      const key = /^[A-Za-z]:/.test(c) ? c.toLowerCase() : c;
      const hit = counts.get(key);
      if (hit) counts.set(key, hit + 1);
      else counts.set(key, 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** 工作目录 → 可读名（项目根目录 basename，跳过 outputs/build 之类的子目录） */
export function workspaceLabel(spans: InSpanLike[]): string | null {
  const ws = deriveWorkspace(spans);
  if (!ws) return null;
  const name = projectNameOf(ws);
  return name || null;
}

/**
 * Agent 名字四级兜底（越靠前越可信）：
 *   1. session_start span 的 agent_name（契约字段，采集端未来应补齐）
 *   2. 任一 span 上的 agent_name（部分采集端逐条上报）
 *   3. 工作目录 basename（从 tool_call 路径反推，无需采集端改动）
 *   4. 框架名兜底
 */
export function deriveAgentName(spans: InSpanLike[], explicit?: string | null, fallback = "pi-coding-agent"): string {
  if (explicit && explicit.trim()) return explicit.trim();
  for (const sp of spans) {
    if (sp.agent_name && sp.agent_name.trim()) return sp.agent_name.trim();
  }
  return workspaceLabel(spans) ?? fallback;
}

/** 标题：首条用户诉求 → 兜底末条 answer 首句 → 空串 */
export function deriveTitle(spans: InSpanLike[]): string {
  const users = spans
    .filter((s) => s.kind === "user" || s.kind === "input")
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0) || (a.turnId ?? 0) - (b.turnId ?? 0));
  for (const u of users) {
    const t = normalizeText(u.input ?? "");
    if (t) return t.slice(0, TITLE_MAX);
  }
  const answers = spans.filter((s) => s.kind === "answer");
  const last = answers[answers.length - 1];
  const t = normalizeText(last?.output ?? "");
  return t ? t.slice(0, TITLE_MAX) : "";
}

/**
 * 会话终态三态判定。
 *
 * 判定基准是「末条 answer 有没有交付」，而不是「有没有出现过 failed span」：
 * - 无 span：""（未知，不计入成功率分母，避免空会话拉低/抬高）
 * - 有 span 但无 answer，或末条 answer 失败/空输出：failed（真正没交付）
 * - 末条 answer 成功且有输出，过程中无 failed span：success
 * - 末条 answer 成功，但过程中有 failed span：partial（重试后修复、质检回流）
 */
export function computeOutcome(spans: InSpanLike[]): {
  outcome: SessionOutcome;
  /** 致命失败数（answer / llm_thinking 级） */
  fatalErrors: number;
  /** 过程失败总数（含工具级，保留为质量信号） */
  errors: number;
} {
  const errors = spans.filter((s) => s.status === "failed").length;
  const fatalErrors = spans.filter(
    (s) => s.status === "failed" && (s.kind === "answer" || s.kind === "llm_thinking"),
  ).length;

  if (spans.length === 0) return { outcome: "", fatalErrors, errors };

  const answers = spans
    .filter((s) => s.kind === "answer")
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0) || (a.turnId ?? 0) - (b.turnId ?? 0));

  if (answers.length === 0) return { outcome: "failed", fatalErrors, errors };

  const last = answers[answers.length - 1];
  const delivered = last.status !== "failed" && (last.output ?? "").trim().length > 0;
  if (!delivered) return { outcome: "failed", fatalErrors, errors };

  return { outcome: errors > 0 ? "partial" : "success", fatalErrors, errors };
}
