import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeRow } from "./range";

/**
 * Tool & Skill 看板聚合（/skills）。
 *
 * 回答两件事：
 *   1. 工具哪里在失败 —— 按工具聚合失败率，并把失败样本按「错误签名」聚成簇
 *   2. Skill 谁在用、用得广不广 —— 调用次数 / 覆盖会话 / 覆盖 Agent / 零调用
 *
 * 口径铁律（与 session-board / llm-board 同源）：
 * - 时间过滤一律用 **Session.startTime**（发生时间），不用 Span.createdAt（入库时间）。
 *   因此本模块所有 Span 聚合都 JOIN Session 再按 s.startTime 过滤。
 * - SQLite 的 AVG 返回 REAL，Prisma 反序列化会抛错 → 所有分位计算用
 *   CAST(... AS INTEGER)，比率一律回到 TS 侧算。
 *
 * 数据实况（dev.db 实测，2026-10-22）与由此引入的三道闸门：
 *
 * ① **Skill 有两条识别通道**，历史上只用了第一条：
 *    - A) `name='skill'`，skill 名藏在 `input.path` 的 `skills/<dir>/` 段里（163 次）；
 *    - B) 采集端把 skill 名直接当 tool 名上报（20 个 skill、115 次）。
 *    两条都要算，否则调用量低估约 40%。但 B 通道实测是**测试桩**
 *    （input 恒 `{"query":"test"}`、output 恒 `{"result":"ok"}`），
 *    计入会让 Skill 排行虚增，因此用 STUB_INPUT_RE 识别并单独计数，
 *    不参与排行（KPI 里以「疑似测试桩」披露）。
 *
 * ② **工具名有两代并存**：read/read_file、write/write_file、edit/edit_file。
 *    不归一会把同一能力拆成两行、失败率拆散（read 11 次失败 vs read_file 0 次）。
 *    本模块在 SQL 里用 CASE 归一到 TOOL_CANONICAL，并把被归一的原始名
 *    （含各自调用数）放在 row.variants 里，前端可见，不隐藏信息。
 *
 * ③ **duration 有占位值**（与 LLM 看板的 1500ms 同源）：实测
 *    glob_files/write_file/read_file/grep_search 各自的 distinct(duration) = 1（恒 800ms），
 *    edit_file 只有 2 个取值。这类工具不参与耗时排行，并在 variants 上标出
 *    placeholder = true，避免「某工具恒定 800ms、比 bash 快」的错误结论。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 耗时可信判定：有效样本下限 */
const TRUST_MIN_CALLS = 10;
/** 耗时可信判定：不同取值占比下限（低于此值说明是占位/硬编码） */
const TRUST_MIN_DISTINCT_RATIO = 0.05;
/** 判定为「占位耗时」的原始工具名所需最小样本 */
const PLACEHOLDER_MIN_CALLS = 10;
/**
 * 占位耗时判定：≥10 次调用却只有 ≤2 种耗时取值 → 视为采集端写死的值。
 * 取 2 而不是 1 是因为实测 edit_file 只有 {100, 800} 两个取值（471 次），
 * 按 distinct<=1 判会漏掉它，导致归一后 edit 的 P50 被 800 拖走。
 */
const PLACEHOLDER_MAX_DISTINCT = 2;
/** 失败聚类返回的簇数上限 */
const TOP_FAIL_CLUSTERS = 12;
/** 失败明细拉取上限（聚类用，正常量级 300 上下） */
const FAIL_DETAIL_LIMIT = 3000;
/** 失败率异常阈值：用于行内标红（失败 ≥5 次且失败率 ≥10%） */
const CRITICAL_FAIL_RATE = 10;
const CRITICAL_FAIL_COUNT = 5;

/**
 * 工具名归一表：两代命名合并成同一能力。
 * 只合并语义确凿等价的（read/read_file 等），glob_files 与 grep_search 没有对应
 * 上一代名字，保持原样 —— 否则会凭空造出「glob」这种从未上报过的名字。
 */
export const TOOL_CANONICAL: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
};

/** 采集端的测试桩：skill 名直接当工具名上报，input 恒为 {"query":"test"} */
const STUB_INPUT_RE = /"query"\s*:\s*"test"/i;

/** skill 路径锚点：`.../skills/<dir>/...`（SKILL.md 与 skill 目录下的脚本都算使用） */
const SKILL_PATH_RE = /skills[\\/]([^\\/]+)[\\/]/i;

/** 目录名里的模板变量/占位符，属脏值（实测出现过 `[name]`） */
const DIRTY_NAME_RE = /[[\]{}$<>*?]/;

/* ------------------------------- 类型 ------------------------------- */

export interface SkillToolKpi {
  /** 工具调用次数（口径：kind='tool_call' 且不属于 skill 通道） */
  toolCalls: number;
  toolCallsPrev: number | null;
  tools: number;
  toolFailed: number;
  /** 失败率 % */
  toolFailRate: number;
  toolFailRatePrev: number | null;
  /** 覆盖的会话数 */
  toolSessions: number;
  /** 耗时可信 / 不可信的工具数 */
  trustedTools: number;
  untrustedTools: number;

  /** Skill 调用次数（两条通道合并，剔除测试桩） */
  skillCalls: number;
  skillsRegistered: number;
  skillsUsed: number;
  /** 零调用的已注册 skill 数 */
  skillsZero: number;
  skillSessions: number;
  /** 已注册 skill 中被调用过的会话覆盖数（去重） */
  skillAgents: number;
  /** 疑似测试桩调用次数（未计入 skillCalls） */
  stubCalls: number;
  /** 无法映射到已注册 skill 的名字数（脏值/未注册） */
  dirtySkillNames: number;
}

export interface SkillToolVariant {
  /** 上报时的原始工具名 */
  name: string;
  calls: number;
  failed: number;
  distinctDurations: number;
  /** true = 耗时取值恒定，疑似采集端占位值 */
  placeholder: boolean;
}

export interface ToolRow {
  name: string;
  calls: number;
  /** 调用占比 % */
  callShare: number;
  failed: number;
  /** 失败率 % */
  failRate: number;
  sessions: number;
  agents: number;
  p50: number;
  p90: number;
  /** 参与耗时统计的样本数（已排除占位耗时变体的调用） */
  durationSamples: number;
  /** 因耗时为占位值而被排除的调用数 */
  placeholderCalls: number;
  /** false = 耗时不可信（可用样本不足 / 取值过少） */
  timingTrusted: boolean;
  /** 可用样本的耗时取值种数 */
  distinctDurations: number;
  /** 该工具最主要的错误签名（无失败为 null） */
  topError: string | null;
  /** 被归一前的原始名（只列实际出现过的） */
  variants: SkillToolVariant[];
  lastUsedAt: string | null;
}

export interface SkillAgentRef {
  name: string;
  calls: number;
}

export interface SkillRow {
  name: string;
  /** false = 出现在 span 里但 Skill 表没有注册（命名不一致或未同步） */
  registered: boolean;
  description: string;
  version: number;
  calls: number;
  sessions: number;
  agentCount: number;
  /** 调用最多的 Agent（最多 3 个） */
  topAgents: SkillAgentRef[];
  failed: number;
  /** 加载成功率 %（skill 通道的 span status 成功率） */
  loadSuccessRate: number;
  /** 加载耗时 P50（ms）；样本不足或取值恒定时为 0 */
  p50: number;
  avgDuration: number;
  durationSamples: number;
  timingTrusted: boolean;
  lastUsedAt: string | null;
}

export interface FailCluster {
  tool: string;
  /** 归一后的错误签名 */
  signature: string;
  count: number;
  /** 涉及会话数 */
  sessions: number;
  agents: string[];
  /** 样例 span（深链用） */
  sampleSpanId: string;
  sampleSessionId: string;
  sampleSessionTitle: string;
  sampleError: string;
  lastAt: string;
}

export interface DirtySkill {
  name: string;
  calls: number;
  /** 为什么没算进排行 */
  reason: "未注册" | "脏值";
}

export interface SkillToolBoard {
  range: string;
  rangeKey: string;
  spanDays: number;
  meta: {
    /** 耗时闸门说明 */
    timingNote: string;
    /** 测试桩说明 */
    stubNote: string;
    /** 别名归一说明 */
    aliasNote: string;
    stubCalls: number;
    trustedTools: number;
    untrustedTools: number;
    /** 行内标红阈值：失败 ≥ criticalFailCount 次且失败率 ≥ criticalFailRate% */
    criticalFailRate: number;
    criticalFailCount: number;
  };
  kpi: SkillToolKpi;
  tools: ToolRow[];
  skills: SkillRow[];
  /** Skill 加载次数按 Agent 分布（Top 榜用；跨 skill 汇总，不是单个 skill 的 topAgents） */
  skillAgentUsage: SkillAgentRef[];
  failClusters: FailCluster[];
  dirtySkills: DirtySkill[];
}

export interface SkillToolBoardOptions {
  startMs: number;
  spanDays: number;
}

/* ------------------------------- 工具 ------------------------------- */

/** 工具名归一（TS 侧，与 SQL 里的 CASE 保持同一张表） */
export function canonicalTool(name: string): string {
  return TOOL_CANONICAL[name] ?? name;
}

/** SQL 侧的工具名归一表达式，与 canonicalTool 同源 */
const TOOL_CANON_SQL = Prisma.sql`CASE sp.name
  WHEN 'read_file' THEN 'read'
  WHEN 'write_file' THEN 'write'
  WHEN 'edit_file' THEN 'edit'
  ELSE sp.name END`;

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

function ratio(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/** 最近秩法分位（与 SQL 侧 (cnt*p+99)/100 口径一致） */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((sortedAsc.length * p) / 100);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/** 从 skill span 的 input.path 里取目录名 */
export function extractSkillDir(input: string | null | undefined): string | null {
  try {
    const path = String(JSON.parse(input || "{}").path ?? "");
    const m = path.match(SKILL_PATH_RE);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * 目录名 → 已注册 skill 名。
 * 实测存在 `beautiful-slides-main`（目录带 -main 后缀，Skill 表里叫 beautiful-slides），
 * 用「精确 → 最长的 `name-` 前缀」兜住，仍然映射不上的返回 null（进脏值列表）。
 */
export function canonicalSkill(dir: string, registeredNames: string[]): string | null {
  if (registeredNames.includes(dir)) return dir;
  let best = "";
  for (const name of registeredNames) {
    if (dir.startsWith(`${name}-`) && name.length > best.length) best = name;
  }
  return best || null;
}

/**
 * 错误签名：把 310 条失败样本收敛成可读的簇。
 * 顺序有意义 —— traceback 优先（否则会被首行 "Traceback..." 吃掉全部细节），
 * 退出码次之（bash 最常见），再兜底到首行文本。
 */
export function errorSignature(raw: string): string {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "（无错误信息）";

  if (/Traceback \(most recent call last\)/i.test(text)) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const m = last.match(/^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit))\b/);
    return m ? `Python · ${m[1].split(".").pop()}` : "Python 异常（traceback）";
  }
  const exit = text.match(/exited with code\s+(\d+)/i) ?? text.match(/exit code[:\s]+(\d+)/i);
  if (exit) return `进程退出码 ${exit[1]}`;
  if (/unexpected EOF while looking for matching/i.test(text)) return "bash 语法错误：引号/括号未闭合";
  if (/command not found|不是内部或外部命令/i.test(text)) return "命令不存在";
  if (/Permission denied/i.test(text)) return "权限拒绝";
  const errno = text.match(/\b(EACCES|EPERM|EISDIR|ENOENT|EEXIST|ENOTDIR|EMFILE|ENOSPC)\b/);
  if (errno) return `系统错误 ${errno[1]}`;

  // 排除纯分隔线（实测有 bash 失败的 error 以 `=======` 开头，签名全是等号毫无信息量）
  const usable = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^[=\-_*#~·.\s]{3,}$/.test(l) && /[\w\u4e00-\u9fa5]{2,}/.test(l));
  // 脚本类失败常把报错写在 FAILED/ERROR 行，首行反而是进度信息
  const failLine = usable.find((l) => /^(FAILED|ERROR|Error|错误)/.test(l));
  const pick = failLine ?? usable[0] ?? text.split("\n")[0];
  const cleaned = pick
    .replace(/[A-Za-z]:\\[^\s:",]+/g, "<path>")
    .replace(/(?:^|\s)\/[\w./-]{12,}/g, " <path>")
    .trim();
  return cleaned.length > 46 ? `${cleaned.slice(0, 46)}…` : cleaned || "（无错误信息）";
}

/* ------------------------------ 主函数 ------------------------------ */

export async function getSkillToolBoard(
  prisma: PrismaClient,
  opts: SkillToolBoardOptions,
): Promise<SkillToolBoard> {
  const now = Date.now();
  // 留一天余量，避免采集端时钟偏移导致最新 span 落在窗口外
  const toMs = now + DAY_MS;
  const { startMs, spanDays } = opts;
  const prevStartMs = startMs > 0 && spanDays > 0 ? startMs - spanDays * DAY_MS : 0;
  const prevToMs = startMs;

  const registeredRows = await prisma.skill.findMany({
    select: { name: true, description: true, version: true },
    orderBy: { name: "asc" },
  });
  const registeredMap = new Map(registeredRows.map((r) => [r.name, r]));
  const registeredNames = registeredRows.map((r) => r.name);

  /** 时间窗条件（会话发生时间，不用 Span.createdAt） */
  const win = (from: number, to: number) =>
    Prisma.sql`sp.kind = 'tool_call' AND s.startTime >= ${from} AND s.startTime < ${to}`;

  /** skill 通道：name='skill'（路径解析）或 name 直接等于某个 skill 名 */
  const skillChannel =
    registeredNames.length > 0
      ? Prisma.sql`(sp.name = 'skill' OR sp.name IN (${Prisma.join(registeredNames)}))`
      : Prisma.sql`sp.name = 'skill'`;

  /** 工具通道：排除 skill 通道，避免同名 skill 混进工具排行 */
  const toolChannel =
    registeredNames.length > 0
      ? Prisma.sql`sp.name <> 'skill' AND sp.name NOT IN (${Prisma.join(registeredNames)})`
      : Prisma.sql`sp.name <> 'skill'`;

  const [
    toolAggRaw,
    toolVariantRaw,
    failedRaw,
    skillSpanRaw,
    prevRaw,
    sessionAggRaw,
  ] = await Promise.all([
    /* 1. 工具维度汇总（归一后）
       注意：别名不能叫 name —— Span 本身有 name 列，SQLite 的 GROUP BY 会优先绑到
       原列而不是输出别名，结果是「归一失效、同一个工具被拆成多行」（实测踩过）。 */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${TOOL_CANON_SQL}                                        AS toolName,
             COUNT(*)                                                 AS calls,
             SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failed,
             COUNT(DISTINCT sp.sessionId)                             AS sessions,
             COUNT(DISTINCT s.agentId)                                AS agents,
             COUNT(DISTINCT CASE WHEN sp.duration > 0 THEN sp.duration END) AS distinctDurations,
             SUM(CASE WHEN sp.duration > 0 THEN 1 ELSE 0 END)         AS durSamples,
             MAX(s.startTime)                                         AS lastUsedAt
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${win(startMs, toMs)} AND ${toolChannel}
      GROUP BY toolName
      ORDER BY calls DESC
    `,
    /* 2. 归一前的原始名（用于展示 variants / 识别占位耗时） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.name                                                 AS name,
             COUNT(*)                                                AS calls,
             SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failed,
             COUNT(DISTINCT CASE WHEN sp.duration > 0 THEN sp.duration END)   AS distinctDurations
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${win(startMs, toMs)} AND ${toolChannel}
      GROUP BY sp.name
    `,
    /* 4. 失败明细（聚类用；error 截断 400 字符，避免 traceback 撑爆响应） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.id                                                   AS spanId,
             sp.sessionId                                            AS sessionId,
             s.title                                                 AS sessionTitle,
             a.name                                                  AS agentName,
             ${TOOL_CANON_SQL}                                       AS toolName,
             SUBSTR(COALESCE(sp.error, ''), 1, 400)                  AS error,
             s.startTime                                             AS startTime
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      JOIN Agent a   ON a.id = s.agentId
      WHERE ${win(startMs, toMs)} AND ${toolChannel}
        AND sp.status IN ('failed','error')
      ORDER BY s.startTime DESC
      LIMIT ${FAIL_DETAIL_LIMIT}
    `,
    /* 5. skill 通道原始 span（skill 名需在 TS 侧从路径解析 + 归一） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.id                                                   AS spanId,
             sp.name                                                 AS toolName,
             sp.input                                                AS input,
             sp.status                                               AS status,
             sp.duration                                             AS duration,
             sp.sessionId                                            AS sessionId,
             a.name                                                  AS agentName,
             s.startTime                                             AS startTime
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      JOIN Agent a   ON a.id = s.agentId
      WHERE ${win(startMs, toMs)} AND ${skillChannel}
    `,
    /* 6. 上期工具总量（KPI 环比） */
    prevStartMs > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT COUNT(*)                                            AS calls,
                 SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failed
          FROM Span sp
          JOIN Session s ON s.id = sp.sessionId
          WHERE ${win(prevStartMs, prevToMs)} AND ${toolChannel}
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    /* 7. 工具通道覆盖的会话数（跨工具去重，KPI 用） */
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(DISTINCT sp.sessionId) AS sessions
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${win(startMs, toMs)} AND ${toolChannel}
    `,
  ]);

  /* --------------------------- 工具维度 --------------------------- */

  const variantsByCanon = new Map<string, SkillToolVariant[]>();
  const placeholderNames: string[] = [];
  for (const raw of toolVariantRaw) {
    const r = normalizeRow(raw);
    const rawName = String(r.name);
    const canonical = canonicalTool(rawName);
    const calls = num(r.calls);
    const distinct = num(r.distinctDurations);
    const placeholder = calls >= PLACEHOLDER_MIN_CALLS && distinct <= PLACEHOLDER_MAX_DISTINCT;
    if (placeholder) placeholderNames.push(rawName);
    const list = variantsByCanon.get(canonical) ?? [];
    list.push({
      name: rawName,
      calls,
      failed: num(r.failed),
      distinctDurations: distinct,
      placeholder,
    });
    variantsByCanon.set(canonical, list);
  }

  /**
   * 耗时分位：**排除占位耗时变体**后再算。
   * 原因（实测）：write_file 72 次全为 800ms、write 69 次是真实波动值；两者归一成 write 后
   * 若一起算，P50 会被 800 这个假值拖成 800ms —— 比不归一还误导。因此先识别占位变体，
   * 只对「耗时可信的那部分样本」求分位，并在行上披露样本覆盖（durationSamples / calls）。
   */
  const durExcludeCond =
    placeholderNames.length > 0
      ? Prisma.sql`AND sp.name NOT IN (${Prisma.join(placeholderNames)})`
      : Prisma.empty;

  const toolDurRaw = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH d AS (
      SELECT ${TOOL_CANON_SQL} AS toolName,
             sp.duration       AS dur,
             ROW_NUMBER() OVER (PARTITION BY ${TOOL_CANON_SQL} ORDER BY sp.duration) AS rn,
             COUNT(*) OVER (PARTITION BY ${TOOL_CANON_SQL})                          AS cnt
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE ${win(startMs, toMs)} AND ${toolChannel} AND sp.duration > 0 ${durExcludeCond}
    )
    SELECT toolName,
           MAX(cnt)                  AS cnt,
           COUNT(DISTINCT dur)       AS distinctDur,
           CAST(AVG(CASE WHEN rn IN ((cnt+1)/2, (cnt+2)/2) THEN dur END) AS INTEGER) AS p50,
           MAX(CASE WHEN rn = CAST((cnt*90+99)/100 AS INT) THEN dur END)             AS p90
    FROM d
    GROUP BY toolName
  `;

  const durMap = new Map<string, { cnt: number; distinct: number; p50: number; p90: number }>();
  for (const raw of toolDurRaw) {
    const r = normalizeRow(raw);
    durMap.set(String(r.toolName), {
      cnt: num(r.cnt),
      distinct: num(r.distinctDur),
      p50: num(r.p50),
      p90: num(r.p90),
    });
  }

  // 失败签名（先按 工具 × 签名 聚合，工具表取各自的 topError，簇列表取全局）
  const clusterMap = new Map<
    string,
    {
      tool: string;
      signature: string;
      count: number;
      sessions: Set<string>;
      agents: Set<string>;
      sampleSpanId: string;
      sampleSessionId: string;
      sampleSessionTitle: string;
      sampleError: string;
      lastAt: number;
    }
  >();
  for (const raw of failedRaw) {
    const r = normalizeRow(raw);
    const tool = String(r.toolName);
    const signature = errorSignature(String(r.error ?? ""));
    const key = `${tool}::${signature}`;
    const at = num(r.startTime);
    const hit = clusterMap.get(key);
    if (hit) {
      hit.count += 1;
      hit.sessions.add(String(r.sessionId));
      hit.agents.add(String(r.agentName));
      if (at > hit.lastAt) {
        hit.lastAt = at;
        hit.sampleSpanId = String(r.spanId);
        hit.sampleSessionId = String(r.sessionId);
        hit.sampleSessionTitle = String(r.sampleSessionTitle ?? r.sessionTitle ?? "");
        hit.sampleError = String(r.error ?? "");
      }
    } else {
      clusterMap.set(key, {
        tool,
        signature,
        count: 1,
        sessions: new Set([String(r.sessionId)]),
        agents: new Set([String(r.agentName)]),
        sampleSpanId: String(r.spanId),
        sampleSessionId: String(r.sessionId),
        sampleSessionTitle: String(r.sessionTitle ?? ""),
        sampleError: String(r.error ?? ""),
        lastAt: at,
      });
    }
  }
  const clusters: FailCluster[] = [...clusterMap.values()].map((c) => ({
    tool: c.tool,
    signature: c.signature,
    count: c.count,
    sessions: c.sessions.size,
    agents: [...c.agents].filter(Boolean).slice(0, 3),
    sampleSpanId: c.sampleSpanId,
    sampleSessionId: c.sampleSessionId,
    sampleSessionTitle: c.sampleSessionTitle,
    sampleError: c.sampleError,
    lastAt: new Date(c.lastAt).toISOString(),
  }));
  clusters.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));

  // 每个工具最频繁的错误签名
  const topErrorByTool = new Map<string, string>();
  for (const c of clusters) {
    if (!topErrorByTool.has(c.tool)) topErrorByTool.set(c.tool, c.signature);
  }

  const toolAggs = toolAggRaw.map((raw) => {
    const r = normalizeRow(raw);
    return {
      name: String(r.toolName),
      calls: num(r.calls),
      failed: num(r.failed),
      sessions: num(r.sessions),
      agents: num(r.agents),
      distinctDurations: num(r.distinctDurations),
      durSamples: num(r.durSamples),
      lastUsedAt: num(r.lastUsedAt),
    };
  });
  const totalToolCalls = toolAggs.reduce((a, t) => a + t.calls, 0);

  const tools: ToolRow[] = toolAggs.map((t) => {
    const dur = durMap.get(t.name);
    const samples = dur?.cnt ?? 0;
    const distinct = dur?.distinct ?? 0;
    const variants = (variantsByCanon.get(t.name) ?? []).sort((a, b) => b.calls - a.calls);
    // 耗时可信：可用样本足够 且 取值足够分散（恒定值说明是占位数据）
    const timingTrusted =
      samples >= TRUST_MIN_CALLS &&
      distinct > 1 &&
      distinct / Math.max(1, samples) >= TRUST_MIN_DISTINCT_RATIO;
    return {
      name: t.name,
      calls: t.calls,
      callShare: ratio(t.calls, totalToolCalls),
      failed: t.failed,
      failRate: ratio(t.failed, t.calls),
      sessions: t.sessions,
      agents: t.agents,
      p50: dur?.p50 ?? 0,
      p90: dur?.p90 ?? 0,
      durationSamples: samples,
      placeholderCalls: variants.filter((v) => v.placeholder).reduce((a, v) => a + v.calls, 0),
      timingTrusted,
      distinctDurations: distinct,
      topError: topErrorByTool.get(t.name) ?? null,
      variants,
      lastUsedAt: t.lastUsedAt > 0 ? new Date(t.lastUsedAt).toISOString() : null,
    };
  });

  /* --------------------------- Skill 维度 --------------------------- */

  interface SkillAgg {
    calls: number;
    failed: number;
    sessions: Set<string>;
    agents: Map<string, number>;
    durations: number[];
    lastUsedAt: number;
  }
  const skillAggs = new Map<string, SkillAgg>();
  const dirtyMap = new Map<string, { calls: number; reason: DirtySkill["reason"] }>();
  let stubCalls = 0;

  const ensureAgg = (name: string): SkillAgg => {
    let agg = skillAggs.get(name);
    if (!agg) {
      agg = { calls: 0, failed: 0, sessions: new Set(), agents: new Map(), durations: [], lastUsedAt: 0 };
      skillAggs.set(name, agg);
    }
    return agg;
  };

  for (const raw of skillSpanRaw) {
    const r = normalizeRow(raw);
    const toolName = String(r.toolName ?? "");
    const input = String(r.input ?? "");
    const sessionId = String(r.sessionId ?? "");
    const agentName = String(r.agentName ?? "");
    const at = num(r.startTime);
    const duration = num(r.duration);
    const failed = String(r.status ?? "") === "failed" || String(r.status ?? "") === "error";

    let skillName: string | null = null;
    if (toolName === "skill") {
      const dir = extractSkillDir(input);
      if (!dir) {
        // 4 条实测样本是 skill 目录下的脚本被 read/grep 时的路径，解析不出就跳过
        continue;
      }
      if (DIRTY_NAME_RE.test(dir)) {
        const d = dirtyMap.get(dir) ?? { calls: 0, reason: "脏值" as const };
        d.calls += 1;
        dirtyMap.set(dir, d);
        continue;
      }
      skillName = canonicalSkill(dir, registeredNames);
      if (!skillName) {
        const d = dirtyMap.get(dir) ?? { calls: 0, reason: "未注册" as const };
        d.calls += 1;
        dirtyMap.set(dir, d);
        continue;
      }
    } else {
      // 通道 B：skill 名直接当工具名上报 —— 实测这批是测试桩，单独计数不排行
      if (STUB_INPUT_RE.test(input)) {
        stubCalls += 1;
        continue;
      }
      skillName = registeredMap.has(toolName) ? toolName : null;
      if (!skillName) {
        const d = dirtyMap.get(toolName) ?? { calls: 0, reason: "未注册" as const };
        d.calls += 1;
        dirtyMap.set(toolName, d);
        continue;
      }
    }

    const agg = ensureAgg(skillName);
    agg.calls += 1;
    if (failed) agg.failed += 1;
    agg.sessions.add(sessionId);
    if (agentName) agg.agents.set(agentName, (agg.agents.get(agentName) ?? 0) + 1);
    if (duration > 0) agg.durations.push(duration);
    if (at > agg.lastUsedAt) agg.lastUsedAt = at;
  }

  const allSkillNames = new Set<string>([...registeredNames, ...skillAggs.keys()]);
  const skills: SkillRow[] = [...allSkillNames]
    .map((name) => {
      const agg = skillAggs.get(name);
      const meta = registeredMap.get(name);
      const durations = [...(agg?.durations ?? [])].sort((a, b) => a - b);
      const calls = agg?.calls ?? 0;
      const distinct = new Set(durations).size;
      // skill 的耗时样本天然少（一个 skill 全程也就几次），阈值比工具低：
      // 至少 3 次样本且不是恒定值，才认为可比较
      const timingTrusted = durations.length >= 3 && distinct > 1;
      const topAgents = [...(agg?.agents ?? new Map<string, number>())]
        .map(([agentName, c]) => ({ name: agentName, calls: c }))
        .sort((a, b) => b.calls - a.calls);
      return {
        name,
        registered: registeredMap.has(name),
        description: meta?.description ?? "",
        version: meta?.version ?? 1,
        calls,
        sessions: agg?.sessions.size ?? 0,
        agentCount: topAgents.length,
        topAgents: topAgents.slice(0, 3),
        failed: agg?.failed ?? 0,
        loadSuccessRate: calls > 0 ? ratio(calls - (agg?.failed ?? 0), calls) : 0,
        p50: timingTrusted ? percentile(durations, 50) : 0,
        avgDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        durationSamples: durations.length,
        timingTrusted,
        lastUsedAt: agg && agg.lastUsedAt > 0 ? new Date(agg.lastUsedAt).toISOString() : null,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "zh-CN"));

  const skillSessions = new Set<string>();
  const skillAgents = new Set<string>();
  const agentUsage = new Map<string, number>();
  let skillCalls = 0;
  for (const agg of skillAggs.values()) {
    skillCalls += agg.calls;
    for (const id of agg.sessions) skillSessions.add(id);
    for (const [agentName, c] of agg.agents) {
      skillAgents.add(agentName);
      agentUsage.set(agentName, (agentUsage.get(agentName) ?? 0) + c);
    }
  }
  const skillAgentUsage: SkillAgentRef[] = [...agentUsage.entries()]
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls);

  const dirtySkills: DirtySkill[] = [...dirtyMap.entries()]
    .map(([name, v]) => ({ name, calls: v.calls, reason: v.reason }))
    .sort((a, b) => b.calls - a.calls);

  /* ------------------------------ KPI ------------------------------ */

  const totalToolFailed = tools.reduce((a, t) => a + t.failed, 0);
  const toolSessionCount = sessionAggRaw.length > 0 ? num(normalizeRow(sessionAggRaw[0]).sessions) : 0;

  const prev = prevRaw.length > 0 ? normalizeRow(prevRaw[0]) : null;
  const prevCalls = prev ? num(prev.calls) : 0;
  const prevFailed = prev ? num(prev.failed) : 0;

  const trustedTools = tools.filter((t) => t.timingTrusted).length;

  const kpi: SkillToolKpi = {
    toolCalls: totalToolCalls,
    toolCallsPrev: prev ? prevCalls : null,
    tools: tools.length,
    toolFailed: totalToolFailed,
    toolFailRate: ratio(totalToolFailed, totalToolCalls),
    toolFailRatePrev: prev ? ratio(prevFailed, prevCalls) : null,
    toolSessions: toolSessionCount,
    trustedTools,
    untrustedTools: tools.length - trustedTools,
    skillCalls,
    skillsRegistered: registeredNames.length,
    skillsUsed: skills.filter((s) => s.calls > 0).length,
    skillsZero: skills.filter((s) => s.registered && s.calls === 0).length,
    skillSessions: skillSessions.size,
    skillAgents: skillAgents.size,
    stubCalls,
    dirtySkillNames: dirtySkills.length,
  };

  return {
    range: "",
    rangeKey: "",
    spanDays,
    meta: {
      timingNote:
        "耗时只统计 duration 取值足够分散的工具；取值恒定的工具（实测有 4 个恒定 800ms）多为采集端占位值，不参与耗时排名",
      stubNote:
        "部分采集端把 skill 名直接当工具名上报，且 input 恒为测试串（{\"query\":\"test\"}），已识别为测试桩并从 Skill 调用统计中剔除",
      aliasNote:
        "read/read_file、write/write_file、edit/edit_file 为两代工具命名，已归一到同一行；归一是 SQL 层做的，原始名可在行内展开查看",
      stubCalls,
      trustedTools,
      untrustedTools: tools.length - trustedTools,
      criticalFailRate: CRITICAL_FAIL_RATE,
      criticalFailCount: CRITICAL_FAIL_COUNT,
    },
    kpi,
    tools,
    skills,
    skillAgentUsage,
    failClusters: clusters.slice(0, TOP_FAIL_CLUSTERS),
    dirtySkills,
  };
}

/* ------------------------- 下钻：按 Tag 取会话 ------------------------- */

export interface SessionIdsByTagInput {
  type: "skill" | "tool";
  name: string;
  /** 0 = 不限时间 */
  startMs: number;
}

/**
 * 反查「命中某个 Skill 或 Tool 的会话集合」，供 /trace?skill=|tool= 下钻过滤。
 *
 * 为什么不直接放进 /api/sessions：会话列表本身没有 skill/tool 维度，
 * 塞进去要为一个可选筛选项给每条会话挂全量 span 标签；这里按需单查更便宜。
 */
export async function getSessionIdsByTag(
  prisma: PrismaClient,
  input: SessionIdsByTagInput,
): Promise<{ sessionIds: string[]; calls: number }> {
  const now = Date.now();
  const toMs = now + DAY_MS;
  const { type, name, startMs } = input;

  if (type === "tool") {
    const canonical = canonicalTool(name);
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT sp.sessionId AS sessionId, COUNT(*) AS calls
      FROM Span sp
      JOIN Session s ON s.id = sp.sessionId
      WHERE sp.kind = 'tool_call' AND s.startTime >= ${startMs} AND s.startTime < ${toMs}
        AND ${TOOL_CANON_SQL} = ${canonical}
      GROUP BY sp.sessionId
    `;
    return {
      sessionIds: rows.map((r) => String(normalizeRow(r).sessionId)),
      calls: rows.reduce((a, r) => a + num(normalizeRow(r).calls), 0),
    };
  }

  // skill：需要在 TS 侧解析 path 并归一，SQL 做不了
  const registeredRows = await prisma.skill.findMany({ select: { name: true } });
  const registeredNames = registeredRows.map((r) => r.name);
  const skillChannel =
    registeredNames.length > 0
      ? Prisma.sql`(sp.name = 'skill' OR sp.name IN (${Prisma.join(registeredNames)}))`
      : Prisma.sql`sp.name = 'skill'`;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT sp.sessionId AS sessionId, sp.name AS toolName, sp.input AS input
    FROM Span sp
    JOIN Session s ON s.id = sp.sessionId
    WHERE sp.kind = 'tool_call' AND s.startTime >= ${startMs} AND s.startTime < ${toMs}
      AND ${skillChannel}
  `;

  const ids = new Set<string>();
  let calls = 0;
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const toolName = String(r.toolName ?? "");
    const inputText = String(r.input ?? "");
    let hit: string | null = null;
    if (toolName === "skill") {
      const dir = extractSkillDir(inputText);
      if (!dir || DIRTY_NAME_RE.test(dir)) continue;
      hit = canonicalSkill(dir, registeredNames);
    } else {
      if (STUB_INPUT_RE.test(inputText)) continue;
      hit = registeredNames.includes(toolName) ? toolName : null;
    }
    if (hit !== name) continue;
    calls += 1;
    ids.add(String(r.sessionId));
  }
  return { sessionIds: [...ids], calls };
}
