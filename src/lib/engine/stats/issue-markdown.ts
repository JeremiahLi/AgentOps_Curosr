import type { AgentIssue } from "./agent-detail";
import type { IssueNote } from "../ingest/issue-note";
import type { IssueSample } from "../ingest/issue-cause";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "严重",
  warning: "关注",
  info: "提示",
};

const KIND_LABEL: Record<string, string> = {
  tool_failure: "工具失败",
  tool_scene: "工具失败",
  error_cluster: "模型或重复错误",
  slow_span: "慢调用",
  decline: "使用衰退",
  idle: "零使用",
  data_quality: "数据质量",
};

export interface IssueMarkdownInput {
  agentName: string;
  range: string;
  totals: {
    sessions: number;
    successRate: number | null;
    spans: number;
    failedSpans: number;
    spanFailRate: number;
    toolCalls: number;
    toolFailed: number;
    toolFailRate: number;
  };
  issues: AgentIssue[];
  notes?: Record<string, IssueNote>;
}

function fence(text: string): string {
  const body = text.replace(/\r\n/g, "\n").trim();
  return body ? `\`\`\`\n${body}\n\`\`\`` : "（空）";
}

function sampleBlock(sample: IssueSample, index: number): string {
  return [
    `#### 样例 ${index + 1}`,
    "",
    `- sessionId: \`${sample.sessionId}\``,
    `- spanId: \`${sample.spanId}\``,
    `- kind: ${sample.kind || "—"}`,
    `- name: ${sample.name || "—"}`,
    `- model: ${sample.model || "—"}`,
    `- duration: ${sample.duration} ms`,
    `- inputTokens: ${sample.inputTokens}`,
    `- outputTokens: ${sample.outputTokens}`,
    "",
    "error:",
    "",
    fence(sample.error),
    "",
    "input:",
    "",
    fence(sample.input),
  ].join("\n");
}

/**
 * 问题全集。给另一个模型看：计数口径、原因归类、样例原文都在，不只有页面上的一句话。
 */
export function renderIssuesMarkdown(input: IssueMarkdownInput): string {
  const { totals } = input;
  const success = totals.successRate == null ? "—" : `${totals.successRate.toFixed(1)}%`;
  const lines = [
    `# ${input.agentName} 问题全集`,
    "",
    "这份文档给另一个分析模型用。每条都带计数口径、原因归类和样例 span。样例是抽取，不是全量。",
    "",
    "## 这个 Agent 的数",
    "",
    `- 时间范围：${input.range || "—"}`,
    `- 会话 ${totals.sessions}，成功率 ${success}`,
    `- Span 失败率 ${totals.spanFailRate.toFixed(1)}%（${totals.failedSpans} / ${totals.spans}）`,
    `- 工具失败 ${totals.toolFailed} / ${totals.toolCalls}（${totals.toolFailRate.toFixed(1)}%）`,
    "",
    "## 列表怎么来的",
    "",
    "- 工具问题按当前时间窗、按工具名汇总。打开条件是失败至少 5 次，并且占该工具调用的 10% 以上。同一次 bash 若按错误文本拆开，每条签名往往到不了这个阈值。",
    "- 模型 / 回答问题来自问题库里已打开的签名。标题里的「模型调用失败」经常只是采集写下的包装句。原因要看样例的耗时、token 和 error 原文：有 402 / quota 才是额度，有 socket / fetch 才是断连，耗时长且 token 为 0 且没有状态码才是超时或中途断连。",
    "",
    `共 ${input.issues.length} 条。`,
    "",
  ];

  if (input.issues.length === 0) {
    lines.push("当前没有达到阈值的问题。");
    return lines.join("\n");
  }

  input.issues.forEach((issue, index) => {
    const note = input.notes?.[issue.id];
    lines.push(`## ${index + 1}. ${SEVERITY_LABEL[issue.severity] || issue.severity} · ${KIND_LABEL[issue.kind] || issue.kind}`);
    lines.push("");
    lines.push(issue.title);
    lines.push("");
    lines.push(`- id: \`${issue.id}\``);
    if (issue.conclusion) {
      lines.push("");
      lines.push(`结论：${issue.conclusion}`);
    }
    if (issue.evidence.length > 0) {
      lines.push("");
      lines.push("证据：");
      lines.push("");
      for (const line of issue.evidence) lines.push(`- ${line}`);
    }
    lines.push("");
    lines.push(`建议：${issue.suggestion}`);
    if (issue.report) {
      lines.push("");
      lines.push(`口径：${issue.report.source}`);
      if (issue.report.causes.length > 0) {
        lines.push("");
        lines.push("原因分布：");
        lines.push("");
        for (const cause of issue.report.causes) lines.push(`- ${cause.label} × ${cause.count}`);
      }
      if (issue.report.targets.length > 0) {
        lines.push("");
        lines.push("调用分布：");
        lines.push("");
        for (const target of issue.report.targets) lines.push(`- ${target.label} × ${target.count}`);
      }
    }
    if (issue.links.length > 0) {
      lines.push("");
      lines.push("链接：");
      lines.push("");
      for (const link of issue.links) {
        const span = link.spanId ? `?spanId=${link.spanId}` : "";
        lines.push(`- ${link.label}：/trace/${link.sessionId}${span}`);
      }
    }
    if (note) {
      lines.push("");
      lines.push("开发指引：");
      lines.push("");
      if (note.conclusion) lines.push(`- 结论：${note.conclusion}`);
      if (note.field) lines.push(`- 字段：${note.field}${note.observed ? ` = ${note.observed}` : ""}`);
      if (note.action || note.caused) lines.push(`- 动作：${note.action || note.caused}`);
      if (note.verify) lines.push(`- 验证：${note.verify}`);
      lines.push(`- 改动面：${note.layer}`);
    }
    const samples = issue.report?.samples ?? [];
    if (samples.length > 0) {
      lines.push("");
      lines.push(`### 样例原文（${samples.length} 条）`);
      lines.push("");
      samples.forEach((sample, sampleIndex) => {
        lines.push(sampleBlock(sample, sampleIndex));
        lines.push("");
      });
    }
    lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
