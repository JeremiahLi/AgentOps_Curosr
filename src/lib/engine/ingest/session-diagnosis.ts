import type { FactSpan, SessionFacts, SessionFinding } from "./session-facts";
import { NO_ERROR_TEXT, normalizeSpanRecord } from "./span-record";

export type CauseClass =
  | "missing_error"
  | "permission"
  | "not_found"
  | "is_directory"
  | "bad_invocation"
  | "exit_code"
  | "exception"
  | "validation"
  | "model_failure"
  | "answer_failure"
  | "no_delivery"
  | "unknown";

export interface DiagnosisItem {
  causeClass: CauseClass;
  signature: string;
  spanId: string;
  /** 根因，一句。循环会在句尾补上入参是否重复 */
  cause: string;
  /** 先检查，1 到 2 条 */
  checks: string[];
}

export interface SessionDiagnosis {
  anomalous: boolean;
  /** 无过程异常 / 有过程异常：{主因} */
  headline: string;
  primary: DiagnosisItem | null;
  others: DiagnosisItem[];
}

interface Classified {
  causeClass: CauseClass;
  cause: string;
  checks: string[];
}

function clip(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function toolLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed || "该工具";
}

function errorTextOf(finding: SessionFinding, spans: FactSpan[]): string {
  const headId = finding.spanIds[0] || finding.evidence.spanId;
  const span = spans.find((item) => item.id === headId);
  if (span) {
    const norm = normalizeSpanRecord(span);
    if (norm.error) return norm.error;
  }
  return finding.evidence.errorSummary || "";
}

function exceptionOf(text: string): { type: string; detail: string } | null {
  const matches = [...text.matchAll(/([A-Za-z_][\w.]*(?:Error|Exception))\s*:\s*([^\n]{0,160})/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const type = last[1].split(".").pop() || last[1];
    const detail = last[2].replace(/\s+/g, " ").replace(/:\s*\S.*$/, "").trim();
    return { type, detail: clip(detail, 60) };
  }
  if (/traceback/i.test(text)) return { type: "Exception", detail: "" };
  return null;
}

function validationDetail(text: string): string {
  const file = text.match(/[A-Za-z0-9_./\\-]+\.(?:xml|json|py|ts|tsx|js|md|yaml|yml)\b/);
  if (file) return file[0];
  const quoted = text.match(/['"]([^'"]{2,80})['"]/);
  if (quoted) return quoted[1];
  return clip(text, 80);
}

function classify(finding: SessionFinding, error: string, tool: string): Classified {
  if (finding.kind === "no_delivery") {
    return {
      causeClass: "no_delivery",
      cause: "过程里没有失败 span，但没有交出回答",
      checks: ["看最后一条模型输出停在哪里"],
    };
  }

  const summary = error.replace(/\s+/g, " ").trim();
  if (!summary || summary === NO_ERROR_TEXT) {
    return {
      causeClass: "missing_error",
      cause: "这次失败没有错误文本，原因无法判断",
      checks: ["让采集端在失败 span 写入 error"],
    };
  }

  if (finding.kind === "model_failure") {
    return {
      causeClass: "model_failure",
      cause: `模型调用失败：${clip(summary, 80)}`,
      checks: ["按摘要核对限流、上下文长度或超时"],
    };
  }

  if (finding.kind === "answer_failure") {
    return {
      causeClass: "answer_failure",
      cause: `最终回答失败：${clip(summary, 80)}`,
      checks: ["先看回答 span 的错误"],
    };
  }

  const lower = summary.toLowerCase();

  if (/permission denied|\beacces\b|\beperm\b/.test(lower)) {
    return {
      causeClass: "permission",
      cause: `${tool} 被拒绝访问`,
      checks: [`核对 ${tool} 要写的路径和运行身份是否有权限`],
    };
  }

  if (/enoent|no such file|\bnot found\b/.test(lower)) {
    return {
      causeClass: "not_found",
      cause: `${tool} 找不到目标`,
      checks: ["核对路径是否存在、是否在当前工作目录"],
    };
  }

  if (/eisdir|illegal operation on a directory/.test(lower)) {
    return {
      causeClass: "is_directory",
      cause: `${tool} 把目录当成了文件`,
      checks: ["改读目录里的文件，或先列出目录"],
    };
  }

  if (/unexpected eof|syntax error|looking for matching/.test(lower)) {
    return {
      causeClass: "bad_invocation",
      cause: `${tool} 的命令本身写坏了`,
      checks: ["核对引号和换行", "同一条命令不要原样再跑"],
    };
  }

  if (/validation error|failed\s*-\s*found|质检未通过/.test(lower)) {
    return {
      causeClass: "validation",
      cause: `${tool} 没通过校验：${validationDetail(summary)}`,
      checks: ["改被点名的文件或字段", "通过前不要再跑同一条校验"],
    };
  }

  const exception = exceptionOf(summary);
  if (exception) {
    const detail = exception.detail ? `：${exception.detail}` : "";
    return {
      causeClass: "exception",
      cause: `${tool} 抛出 ${exception.type}${detail}`,
      checks: ["按该异常类型查对应文件和行，而不是重跑整段命令"],
    };
  }

  const exit = summary.match(/command exited with code (\d+)/i);
  if (exit) {
    const rest = summary
      .replace(/\(no output\)/gi, "")
      .replace(/command exited with code \d+/gi, "")
      .trim();
    if (!rest) {
      return {
        causeClass: "exit_code",
        cause: `${tool} 以退出码 ${exit[1]} 结束，没有错误输出`,
        checks: ["退出码不是原因。先让这条命令把 stderr 留下"],
      };
    }
  }

  return {
    causeClass: "unknown",
    cause: `错误文本对不上已知类型：${clip(summary, 80)}`,
    checks: ["人工看这条 span"],
  };
}

function loopSuffix(finding: SessionFinding, spans: FactSpan[]): string | null {
  if (finding.kind !== "loop" && finding.repeatCount < 2) return null;
  const inputs = finding.spanIds.map((id) => {
    const span = spans.find((item) => item.id === id);
    return (span?.input || "").trim();
  });
  const same = inputs.length >= 2 && inputs.every((value) => value === inputs[0]);
  const times = finding.repeatCount;
  return same ? `同一入参连续失败 ${times} 次` : `换了入参仍是同一错误，连续 ${times} 次`;
}

function diagnoseFinding(finding: SessionFinding, spans: FactSpan[]): DiagnosisItem {
  const tool = toolLabel(finding.evidence.spanName);
  const classified = classify(finding, errorTextOf(finding, spans), tool);
  const suffix = loopSuffix(finding, spans);
  const checks = suffix ? ["不要用同一参数再试", ...classified.checks].slice(0, 2) : classified.checks.slice(0, 2);
  return {
    causeClass: classified.causeClass,
    signature: finding.signature,
    spanId: finding.evidence.spanId || finding.spanIds[0] || "",
    cause: suffix ? `${classified.cause}。${suffix}` : classified.cause,
    checks,
  };
}

/**
 * 把过程事实写成诊断。已恢复的失败不进入结果。
 * 未交付和另一条失败同时存在时，未交付是结果，主因取更早的那条失败。
 */
export function diagnoseSession(facts: SessionFacts, spans: FactSpan[]): SessionDiagnosis {
  const failures = facts.candidates.filter((finding) => finding.kind !== "no_delivery");
  const onlyDelivery = facts.candidates.find((finding) => finding.kind === "no_delivery");
  const primaryFinding = failures[0] ?? onlyDelivery ?? null;
  const otherFindings = failures.slice(primaryFinding && primaryFinding.kind !== "no_delivery" ? 1 : 0);

  const primary = primaryFinding ? diagnoseFinding(primaryFinding, spans) : null;
  const others = (primaryFinding && primaryFinding.kind !== "no_delivery" ? otherFindings : []).map((finding) =>
    diagnoseFinding(finding, spans),
  );

  return {
    anomalous: primary !== null,
    headline: primary ? `有过程异常：${primary.cause}` : "无过程异常",
    primary,
    others,
  };
}
