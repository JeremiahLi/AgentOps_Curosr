import { normalizeError } from "./normalize-error";
import { NO_ERROR_TEXT } from "./span-record";
import { TOOL_FAIL_MIN_COUNT, TOOL_FAIL_RATE_THRESHOLD } from "./issue-rules";

/**
 * 把一条失败说清楚：模型侧区分额度、限流、断连、超时、空调用和「只写下了包装句」；
 * 工具侧区分权限、找不到、命令写坏、退出码、异常类型。
 * 结论只引用 span 上已经有的耗时、token 和 error 原文。
 */

export interface IssueSample {
  sessionId: string;
  spanId: string;
  kind: string;
  name: string;
  model: string;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  error: string;
  input: string;
}

export interface IssueReport {
  /** 计数口径，写给人和其他模型看 */
  source: string;
  causes: { label: string; count: number }[];
  targets: { label: string; count: number }[];
  samples: IssueSample[];
}

export interface IssueBrief {
  id: string;
  severity: "critical" | "warning" | "info";
  kind: "tool_scene";
  title: string;
  conclusion: string;
  evidence: string[];
  suggestion: string;
  links: { sessionId: string; label: string; spanId?: string }[];
  report: IssueReport;
}

interface FailureClass {
  label: string;
  /** 同一标签下再拆开的名字，例如异常类型 */
  detail: string;
  proof: string;
  suggestion: string;
}

const GENERIC_MODEL = /^(模型调用失败|model call failed)$/i;
const QUOTA_RE = /402|insufficient[_\s-]*balance|quota|余额不足|额度不足|insufficient quota/i;
const RATE_RE = /429|rate limit|too many requests|限流/i;
const DISCONNECT_RE =
  /econnreset|econnrefused|enotfound|eai_again|socket hang up|fetch failed|network error|und_err|connection reset|连接被重置|连接中断|连接失败|断连|\bepipe\b/i;
const TIMEOUT_RE = /timeout|timed out|etimedout|deadline exceeded|context deadline|超时/i;
const CONTEXT_RE =
  /context length|maximum context|context window|too many tokens|prompt is too long|上下文超限|上下文过长/i;
const AUTH_RE = /401|invalid api key|unauthorized|authentication|鉴权失败/i;
const OVERLOAD_RE = /\b503\b|\b529\b|overloaded|server overloaded|服务过载/i;
const FILTER_RE = /content filter|content_policy|safety|审核未通过/i;
const PERMISSION_RE = /permission denied|\beacces\b|\beperm\b/i;
const NOT_FOUND_RE = /enoent|no such file|\bnot found\b|couldn't find|could not find/i;
const DIR_RE = /eisdir|illegal operation on a directory/i;
const INVOCATION_RE = /unexpected eof|syntax error|looking for matching/i;
const VALIDATION_RE = /validation error|failed\s*-\s*found|质检未通过|must match exactly|must be unique/i;
const EXIT_RE = /command exited with code (\d+)/i;
const EXCEPTION_RE = /([A-Za-z_][\w.]*(?:Error|Exception))\s*:\s*([^\n]{0,160})/g;

const SAMPLE_CAP = 8;
const LONG_SILENT_MS = 20_000;

function clip(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

export function isGenericModelError(error: string): boolean {
  const text = error.replace(/\s+/g, " ").trim();
  return !text || text === NO_ERROR_TEXT || GENERIC_MODEL.test(text);
}

function exceptionOf(text: string): { type: string; message: string } | null {
  const matches = [...text.matchAll(EXCEPTION_RE)];
  if (matches.length === 0) {
    if (/traceback/i.test(text)) return { type: "Exception", message: "" };
    return null;
  }
  const last = matches[matches.length - 1];
  const type = last[1].split(".").pop() || last[1];
  return { type, message: clip(last[2] || "", 80) };
}

function isToolKind(kind: string): boolean {
  return kind === "tool_call" || kind === "command";
}

/** 从工具入参里抽出脚本名、路径或命令开头，用来看失败集中在哪一次调用。 */
export function invocationTarget(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "null") return "";
  let raw = trimmed;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      for (const key of ["command", "cmd", "path", "file_path", "filePath", "target"]) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) {
          raw = value.trim();
          break;
        }
      }
    }
  } catch {
    raw = trimmed;
  }
  const python = raw.match(/\bpython(?:3)?(?:\.exe)?\s+(?:-\S+\s+)*["']?([^\s"']+\.py)/i);
  if (python) return python[1].split(/[/\\]/).pop() || python[1];
  const file = raw.match(/[^\s"']+\.(?:py|json|ts|tsx|js|md|yaml|yml)\b/);
  if (file) return file[0].split(/[/\\]/).pop() || file[0];
  const head = raw.split(/\s+/).slice(0, 2).join(" ");
  return clip(head, 48);
}

export function classifyFailure(sample: IssueSample): FailureClass {
  const error = sample.error.replace(/\s+/g, " ").trim();
  const tool = isToolKind(sample.kind);
  const generic = isGenericModelError(error);

  if (!tool && QUOTA_RE.test(error)) {
    const marker = QUOTA_RE.exec(error)?.[0] || "额度";
    return {
      label: "额度不足",
      detail: marker,
      proof: `error 含「${marker}」，模型 ${sample.model || "未标注"}。这是额度或配额，不是断连。`,
      suggestion: `给模型 ${sample.model || "这次调用"} 充值或换成仍有额度的模型。error 里已经写了额度原文。`,
    };
  }
  if (!tool && RATE_RE.test(error)) {
    return {
      label: "限流",
      detail: RATE_RE.exec(error)?.[0] || "429",
      proof: `error 含限流原文，模型 ${sample.model || "未标注"}。这是 429 / rate limit，不是额度用完，也不是网络断开。`,
      suggestion: "降低这个模型的并发或拉长重试间隔。不要按余额去充值。",
    };
  }
  if (!tool && DISCONNECT_RE.test(error)) {
    return {
      label: "连接中断",
      detail: DISCONNECT_RE.exec(error)?.[0] || "disconnect",
      proof: `error 是连接错误「${clip(error, 80)}」，不是额度。`,
      suggestion: "查网关、DNS 和这次调用的超时设置。error 已经是 socket / fetch 失败。",
    };
  }
  if (!tool && TIMEOUT_RE.test(error)) {
    return {
      label: "超时",
      detail: "timeout",
      proof: `error 写了超时：${clip(error, 80)}`,
      suggestion: "把这次调用的超时调大，或减少单次输入。原文已经是超时，不是额度。",
    };
  }
  if (!tool && CONTEXT_RE.test(error)) {
    return {
      label: "上下文超长",
      detail: "context",
      proof: `error 写了上下文长度：${clip(error, 80)}`,
      suggestion: "缩短这次请求的上下文。这是长度限制，不是断连或额度。",
    };
  }
  if (!tool && AUTH_RE.test(error)) {
    return {
      label: "鉴权失败",
      detail: AUTH_RE.exec(error)?.[0] || "auth",
      proof: `error 是鉴权失败：${clip(error, 80)}`,
      suggestion: "核对这个模型的 API Key 是否有效。不要按网络或额度处理。",
    };
  }
  if (!tool && OVERLOAD_RE.test(error)) {
    return {
      label: "服务过载",
      detail: OVERLOAD_RE.exec(error)?.[0] || "503",
      proof: `error 是服务过载：${clip(error, 80)}`,
      suggestion: "稍后重试或换一个未过载的接入点。这不是额度用完。",
    };
  }
  if (!tool && FILTER_RE.test(error)) {
    return {
      label: "内容审核",
      detail: "filter",
      proof: `error 是审核拦截：${clip(error, 80)}`,
      suggestion: "看被拦截的那段输入。这不是调用断了。",
    };
  }

  if (PERMISSION_RE.test(error)) {
    return {
      label: "权限拒绝",
      detail: "permission",
      proof: `error 是权限拒绝：${clip(error, 80)}`,
      suggestion: "核对路径和运行身份的写权限。这是工具被拒绝，不是模型调用失败。",
    };
  }
  if (NOT_FOUND_RE.test(error)) {
    return {
      label: "找不到目标",
      detail: "not_found",
      proof: `error 是找不到目标：${clip(error, 80)}`,
      suggestion: "核对路径是否存在、是否在当前工作目录。不要重跑同一条命令。",
    };
  }
  if (DIR_RE.test(error)) {
    return {
      label: "把目录当文件",
      detail: "directory",
      proof: `error 是对目录做了文件操作：${clip(error, 80)}`,
      suggestion: "改成读目录里的文件，或先列出目录。",
    };
  }
  if (INVOCATION_RE.test(error)) {
    return {
      label: "命令写坏",
      detail: "invocation",
      proof: `命令本身不完整：${clip(error, 80)}`,
      suggestion: "改这条命令的引号和换行。同一条不要原样再跑。",
    };
  }
  if (VALIDATION_RE.test(error)) {
    return {
      label: "校验未通过",
      detail: "validation",
      proof: `校验没过：${clip(error, 80)}`,
      suggestion: "改被点名的文件或字段。通过之前不要再跑同一条校验。",
    };
  }

  const exception = exceptionOf(sample.error);
  if (exception) {
    const syntax = /syntax|indent|taberror|compile/i.test(exception.type);
    const message = exception.message ? `：${exception.message}` : "";
    return {
      label: syntax ? "编译/语法错误" : "运行时异常",
      detail: exception.type,
      proof: `抛出 ${exception.type}${message}`,
      suggestion: syntax
        ? `按 ${exception.type} 改脚本，不要重跑整段命令。`
        : `按 ${exception.type} 查对应文件和行。这是脚本异常，不是模型额度或断连。`,
    };
  }

  const exit = error.match(EXIT_RE);
  if (exit) {
    const rest = error.replace(/\(no output\)/gi, "").replace(EXIT_RE, "").trim();
    if (!rest) {
      return {
        label: "命令失败（无输出）",
        detail: `exit ${exit[1]}`,
        proof: `退出码 ${exit[1]}，没有 stderr。退出码本身不是原因。`,
        suggestion: "让这条命令把 stderr 留下。现在只能看到退出码，看不出脚本错在哪。",
      };
    }
  }

  if (!tool && generic && sample.duration >= LONG_SILENT_MS && sample.inputTokens === 0 && sample.outputTokens === 0) {
    return {
      label: "超时或连接中断",
      detail: "no status",
      proof: `耗时 ${fmtMs(sample.duration)}，inputTokens=0，outputTokens=0，error 只有「${error || NO_ERROR_TEXT}」。没有 402、quota、429 或 socket 原文。请求没有返回正文，形态是超时或中途断连，不是额度用完。`,
      suggestion:
        "先让采集把网关的状态码、超时或 socket 错误写进 error，不要收成「模型调用失败」。在那之前按网关超时查这批调用，不要按额度充值。",
    };
  }
  if (!tool && generic && sample.duration < 1000 && sample.inputTokens === 0 && sample.outputTokens === 0) {
    return {
      label: "调用没有发出",
      detail: "empty",
      proof: `duration=${sample.duration}ms，inputTokens=0，outputTokens=0，error=${error || NO_ERROR_TEXT}。没有形成一次真实模型请求。`,
      suggestion: "不要把它当成模型能力或额度问题。先查这次 span 为什么在发出请求前就被标成失败。",
    };
  }
  if (!tool && generic) {
    return {
      label: "原因未采集",
      detail: "wrapper",
      proof: `耗时 ${fmtMs(sample.duration)}，inputTokens=${sample.inputTokens}，outputTokens=${sample.outputTokens}，error 只有「${error || NO_ERROR_TEXT}」。没有额度、限流、断连或超时的原文，无法判断是哪一种。`,
      suggestion: "让采集保留网关返回的状态码和错误体。现在这句「模型调用失败」没有指导性。",
    };
  }
  if (!tool && !generic && /[\u4e00-\u9fff]/.test(error) && !/error|exception|failed|exit code/i.test(error)) {
    return {
      label: "错误字段是模型原文",
      detail: "prose",
      proof: `error 以「${clip(error, 60)}」开头。这是模型输出被记进了 error，不是额度、断连或超时。`,
      suggestion: "看这条 span 的状态为什么被标成失败。error 里没有失败原因。",
    };
  }
  if (generic || !error) {
    return {
      label: "没有错误文本",
      detail: "missing",
      proof: "error 为空，原因无法判断。",
      suggestion: "让采集在失败 span 写入 error 原文。",
    };
  }
  return {
    label: "其他错误",
    detail: clip(error, 40),
    proof: clip(error, 120),
    suggestion: "按这段 error 原文处理，不要再概括成「调用失败」。",
  };
}

function countLabels(items: FailureClass[]): { label: string; count: number; detail: string }[] {
  const buckets = new Map<string, { count: number; details: Map<string, number>; proof: string; suggestion: string }>();
  for (const item of items) {
    const bucket = buckets.get(item.label) ?? {
      count: 0,
      details: new Map<string, number>(),
      proof: item.proof,
      suggestion: item.suggestion,
    };
    bucket.count += 1;
    if (item.detail) bucket.details.set(item.detail, (bucket.details.get(item.detail) ?? 0) + 1);
    buckets.set(item.label, bucket);
  }
  return [...buckets.entries()]
    .map(([label, bucket]) => {
      const details = [...bucket.details.entries()].sort((a, b) => b[1] - a[1]);
      const detailText = details
        .filter(([, count]) => count > 0)
        .slice(0, 3)
        .map(([name, count]) => `${name} ×${count}`)
        .join("，");
      return { label: detailText ? `${label}（${detailText}）` : label, count: bucket.count, detail: bucket.suggestion };
    })
    .sort((a, b) => b.count - a.count);
}

function countTargets(samples: IssueSample[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const target = invocationTarget(sample.input) || "未采到入参";
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  if (rows.length <= 4) return rows;
  const head = rows.slice(0, 3);
  const rest = rows.slice(3).reduce((sum, row) => sum + row.count, 0);
  return [...head, { label: "其他", count: rest }];
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export interface ToolCallStat {
  name: string;
  calls: number;
  failed: number;
  avgFailDuration: number;
}

/** 当前时间窗里，按工具名汇总失败。签名级问题库会把同一次 bash 拆成几十条，这里合成一条。 */
export function buildToolSceneIssues(samples: IssueSample[], stats: ToolCallStat[]): IssueBrief[] {
  const byName = new Map<string, IssueSample[]>();
  for (const sample of samples) {
    if (!isToolKind(sample.kind)) continue;
    const name = sample.name || "(未命名)";
    const list = byName.get(name) ?? [];
    list.push(sample);
    byName.set(name, list);
  }
  const toolFailedTotal = stats.reduce((sum, stat) => sum + stat.failed, 0);
  const briefs: IssueBrief[] = [];

  for (const stat of stats) {
    const name = stat.name || "(未命名)";
    if (stat.failed < TOOL_FAIL_MIN_COUNT) continue;
    const rate = stat.calls > 0 ? (stat.failed / stat.calls) * 100 : 0;
    if (rate < TOOL_FAIL_RATE_THRESHOLD) continue;
    const group = byName.get(name) ?? [];
    const classes = group.map(classifyFailure);
    const causes = countLabels(classes);
    const targets = countTargets(group);
    const topTarget = targets.find((item) => item.label !== "其他" && item.label !== "未采到入参");
    const targetShare = topTarget && group.length > 0 ? topTarget.count / group.length : 0;
    const topCause = causes[0];
    const share = toolFailedTotal > 0 ? (stat.failed / toolFailedTotal) * 100 : 0;
    const title = [
      `${name} 失败 ${stat.failed} 次（${rate.toFixed(1)}%）`,
      topTarget && targetShare >= 0.3 ? `${topTarget.label} 占 ${Math.round(targetShare * 100)}%` : "",
    ]
      .filter(Boolean)
      .join("，");
    const causeLine = causes.map((item) => `${item.label} ×${item.count}`).join("，");
    const targetLine = targets.map((item) => `${item.label} ×${item.count}（${pct(item.count, group.length || 1)}）`).join("，");
    const patterns = topPatterns(group);
    const sampled = group.length < stat.failed;
    const conclusion = [
      `这是工具 ${name} 的失败，不是模型调用。`,
      `本区间 ${stat.failed}/${stat.calls} 次失败（${rate.toFixed(1)}%），占工具失败的 ${share.toFixed(0)}%。`,
      topTarget && targetShare >= 0.3 ? `失败集中在 ${topTarget.label}（抽到的 ${group.length} 条里 ${topTarget.count} 条）。` : "",
      topCause ? `主要是${topCause.label}。` : "抽到的失败 span 里没有足够的 error 可归类。",
    ]
      .filter(Boolean)
      .join("");
    const evidence = [
      `本区间调用 ${stat.calls} 次，失败 ${stat.failed} 次，失败平均耗时 ${fmtMs(stat.avgFailDuration)}，占该 Agent 工具失败的 ${share.toFixed(0)}%`,
      targetLine ? `调用集中在 ${targetLine}` : "这批失败没有采到命令或路径",
      causeLine ? `错误类型：${causeLine}` : "没有可归类的错误文本",
      patterns[0] ? `重复原文 ×${patterns[0].count}：${patterns[0].label}` : "",
      sampled ? `原因和调用分布来自最近 ${group.length} 条，失败次数 ${stat.failed} 是整个时间窗的计数` : "",
    ].filter(Boolean);
    const shown = group.slice(0, SAMPLE_CAP);
    briefs.push({
      id: `tool-scene:${name}`,
      severity: stat.failed >= 20 || rate >= 20 ? "critical" : "warning",
      kind: "tool_scene",
      title,
      conclusion,
      evidence,
      suggestion: topTarget
        ? `先看 ${topTarget.label}。${topCause?.detail || "按上面的错误类型改这一处，不要概括成模型调用失败。"}`
        : topCause?.detail || "先看失败 span 的 error 原文。",
      links: shown.slice(0, 3).map((sample, index) => ({
        sessionId: sample.sessionId,
        spanId: sample.spanId,
        label: `失败样例 ${index + 1}`,
      })),
      report: {
        source: `当前时间窗内工具 ${name} 的全部失败计数；原因分布来自其中 ${group.length} 条 span`,
        causes: causes.map(({ label, count }) => ({ label, count })),
        targets,
        samples: shown,
      },
    });
  }

  briefs.sort((a, b) => b.report.causes.reduce((sum, item) => sum + item.count, 0) - a.report.causes.reduce((s, i) => s + i.count, 0));
  return briefs;
}

function topPatterns(samples: IssueSample[]): { label: string; count: number }[] {
  const counts = new Map<string, { count: number; raw: string }>();
  for (const sample of samples) {
    const key = normalizeError(sample.error) || NO_ERROR_TEXT;
    const found = counts.get(key) ?? { count: 0, raw: clip(sample.error, 100) || NO_ERROR_TEXT };
    found.count += 1;
    counts.set(key, found);
  }
  return [...counts.values()]
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 1)
    .map((item) => ({ label: item.raw, count: item.count }));
}

export interface ClusterBrief {
  title: string;
  conclusion: string;
  evidence: string[];
  suggestion: string;
  report: IssueReport;
}

/** 问题库里的模型/回答失败。标题常常只是「模型调用失败」，这里用样例把原因拆开。 */
export function describeFailureCluster(
  samples: IssueSample[],
  meta: { title: string; signature: string; hitCount: number },
): ClusterBrief | null {
  if (samples.length === 0) return null;
  const classes = samples.map(classifyFailure);
  const rawCauses = countLabels(classes);
  const causes = rawCauses.map(({ label, count }) => ({ label, count }));
  const top = rawCauses[0];
  const genericTitle = /模型调用失败|无错误文本/.test(meta.title) || isGenericModelError(meta.title);
  const mix = rawCauses.length > 1 && top.count / samples.length < 0.6;
  const title = genericTitle
    ? mix
      ? `模型调用失败：样例里混有 ${rawCauses
          .slice(0, 3)
          .map((item) => `${item.label.split("（")[0]} ${item.count}`)
          .join("、")}`
      : `模型调用失败：${top.label.split("（")[0]}（${top.count}/${samples.length} 条样例）`
    : meta.title;
  const noQuota = !causes.some((item) => item.label.startsWith("额度"));
  const conclusion = [
    `问题库累计 ${meta.hitCount} 次，下面是抽到的 ${samples.length} 条。`,
    mix
      ? `原因不只有一种：${causes.map((item) => `${item.label} ${item.count} 条`).join("，")}。`
      : `${top.label.split("（")[0]} ${top.count} 条。`,
    classes[0]?.proof || "",
    noQuota ? "样例 error 里没有 402、quota、余额或 429。" : "",
  ]
    .filter(Boolean)
    .join("");
  const evidence = [
    `累计命中 ${meta.hitCount} 次（问题库，不随页面时间窗重算），样例 ${samples.length} 条`,
    ...rawCauses.slice(0, 4).map((item) => `${item.label} ×${item.count}`),
  ];
  const shown = samples.slice(0, SAMPLE_CAP);
  return {
    title,
    conclusion,
    evidence,
    suggestion: top.detail,
    report: {
      source: `问题库签名 ${meta.signature}，累计 ${meta.hitCount} 次；原因由 ${samples.length} 条证据 span 的 error、耗时和 token 归类`,
      causes,
      targets: countTargets(samples).filter((item) => item.label !== "未采到入参"),
      samples: shown,
    },
  };
}
