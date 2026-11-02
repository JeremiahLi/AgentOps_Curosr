import type { PrismaClient } from "@prisma/client";
import { callLlmAsJson, getActiveLlmConfig } from "../experiment/judge-llm";
import {
  evidenceHash,
  groundIssueNote,
  isMissingErrorSignature,
  missingErrorNote,
  readStoredNote,
  serializeNote,
  type IssueNote,
  type NoteLayer,
} from "./issue-note";

type Db = PrismaClient;

export interface GuideItem {
  issueId: string;
  title: string;
  signature: string;
  hitCount: number;
  sessionId: string;
  spanId: string;
  note: IssueNote;
}

export interface AgentGuide {
  blocked: boolean;
  blockedReason: string;
  pending: number;
  groups: { layer: NoteLayer; items: GuideItem[] }[];
}

const LAYER_ORDER: NoteLayer[] = ["prompt", "skill", "tool", "env", "insufficient"];
const CALL_CAP = 8;

export async function buildAgentGuide(db: Db, agentName: string): Promise<AgentGuide | null> {
  const agent = await db.agent.findUnique({ where: { name: agentName }, select: { id: true } });
  if (!agent) return null;
  const issues = await db.issue.findMany({
    where: { agentId: agent.id, status: { in: ["open", "confirmed"] } },
    orderBy: { hitCount: "desc" },
    include: { evidence: { orderBy: { createdAt: "desc" }, take: 3 } },
  });
  const spanIds = issues.flatMap((issue) => issue.evidence.map((item) => item.spanId).filter(Boolean));
  const spans = spanIds.length
    ? await db.span.findMany({
        where: { id: { in: spanIds } },
        select: { id: true, name: true, input: true, output: true, error: true, details: true },
      })
    : [];
  const byId = new Map(spans.map((span) => [span.id, span]));
  const config = await getActiveLlmConfig();
  let calls = 0;
  let pending = 0;
  const items: GuideItem[] = [];

  for (const issue of issues) {
    const parts: string[] = [];
    for (const item of issue.evidence) {
      const span = byId.get(item.spanId);
      if (!span) continue;
      parts.push([span.name, span.input, span.error, span.output, span.details].filter(Boolean).join("\n"));
    }
    if (issue.sampleError) parts.push(issue.sampleError);
    const corpus = parts.join("\n").slice(0, 4000);
    const hash = evidenceHash(issue.signature, corpus);
    let note = issue.llmNoteHash === hash ? readStoredNote(issue.llmNote) : null;

    if (!note) {
      if (isMissingErrorSignature(issue.signature) || corpus.trim().length < 12) {
        note = missingErrorNote();
      } else if (!config) {
        note = {
          where: "",
          caused: "未配置裁判模型，只保留确定性诊断",
          layer: "insufficient",
          basis: "",
          grounded: true,
        };
      } else if (calls >= CALL_CAP) {
        pending += 1;
        continue;
      } else {
        calls += 1;
        note = await askNote(config, issue.title, issue.signature, corpus);
      }
      await db.issue.update({
        where: { id: issue.id },
        data: { llmNote: serializeNote(note), llmNoteHash: hash },
      });
    }

    const evidence = issue.evidence[0];
    items.push({
      issueId: issue.id,
      title: issue.title,
      signature: issue.signature,
      hitCount: issue.hitCount,
      sessionId: evidence?.sessionId || "",
      spanId: evidence?.spanId || "",
      note,
    });
  }

  const missing = items.filter((item) => isMissingErrorSignature(item.signature)).length;
  const blocked = items.length > 0 && missing * 2 >= items.length;
  if (blocked) {
    return {
      blocked: true,
      blockedReason: `${missing} / ${items.length} 条已打开的问题没有错误文本。先补采集，不根据这些记录给 Agent 改法。`,
      pending,
      groups: [],
    };
  }

  const groups = LAYER_ORDER.map((layer) => ({
    layer,
    items: items.filter((item) => item.note.layer === layer),
  })).filter((group) => group.items.length > 0);

  return { blocked: false, blockedReason: "", pending, groups };
}

async function askNote(
  config: NonNullable<Awaited<ReturnType<typeof getActiveLlmConfig>>>,
  title: string,
  signature: string,
  corpus: string,
): Promise<IssueNote> {
  try {
    const raw = await callLlmAsJson<unknown>(
      [
        {
          role: "system",
          content: [
            "你是 Agent 开发教练。只根据给定证据说明这一条问题。",
            "输出 JSON：where, caused, layer, basis。",
            "layer 只能是 prompt、skill、tool、env、insufficient。",
            "prompt 是提示词，skill 是技能说明，tool 是工具参数，env 是运行环境，insufficient 是证据不够。",
            "where 和 basis 必须是证据里的连续子串。证据不够时 layer 用 insufficient，where 和 basis 用空字符串。",
            "不要编路径，不要建议重写整份提示词。caused 只用一句话。",
          ].join("\n"),
        },
        { role: "user", content: `问题：${title}\n签名：${signature}\n证据：\n${corpus}` },
      ],
      config,
      { temperature: 0, maxTokens: 600 },
    );
    return groundIssueNote(raw, corpus);
  } catch {
    return {
      where: "",
      caused: "裁判模型没有返回可用结论",
      layer: "insufficient",
      basis: "",
      grounded: false,
    };
  }
}
