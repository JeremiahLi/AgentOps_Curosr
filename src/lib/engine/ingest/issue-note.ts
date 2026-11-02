import { createHash } from "node:crypto";
import { NO_ERROR_TEXT } from "./span-record";

export type NoteLayer = "prompt" | "skill" | "tool" | "env" | "insufficient";

export interface IssueNote {
  where: string;
  caused: string;
  layer: NoteLayer;
  basis: string;
  grounded: boolean;
}

const LAYERS = new Set<NoteLayer>(["prompt", "skill", "tool", "env", "insufficient"]);

export function evidenceHash(signature: string, corpus: string): string {
  return createHash("sha256").update(`${signature}\n${corpus}`).digest("hex").slice(0, 32);
}

export function missingErrorNote(): IssueNote {
  return {
    where: "",
    caused: "失败没有错误文本，无法判断改哪一层",
    layer: "insufficient",
    basis: "",
    grounded: true,
  };
}

export function isMissingErrorSignature(signature: string): boolean {
  return signature.includes(NO_ERROR_TEXT);
}

/** 模型的 where / basis 必须是证据原文的连续子串，否则整条结论作废。 */
export function groundIssueNote(raw: unknown, corpus: string): IssueNote {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const layer = typeof record.layer === "string" && LAYERS.has(record.layer as NoteLayer) ? (record.layer as NoteLayer) : "insufficient";
  const where = typeof record.where === "string" ? record.where.trim() : "";
  const basis = typeof record.basis === "string" ? record.basis.trim() : "";
  const caused = typeof record.caused === "string" ? record.caused.trim().slice(0, 200) : "";
  if (layer === "insufficient") {
    return { where: "", caused: caused || "证据不足，无法判断改哪一层", layer, basis: "", grounded: true };
  }
  if (where.length < 2 || basis.length < 2 || !corpus.includes(where) || !corpus.includes(basis)) {
    return { where: "", caused: "模型给出的依据对不上原文", layer: "insufficient", basis: "", grounded: false };
  }
  return { where, caused: caused || "证据里能看到这个失败", layer, basis, grounded: true };
}

export function serializeNote(note: IssueNote): string {
  return JSON.stringify(note);
}

/** 已保存的结论直接读，不再用全文做子串校验（保存前已经校验过）。 */
export function readStoredNote(raw: string): IssueNote | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as IssueNote;
    if (!record || !LAYERS.has(record.layer)) return null;
    return {
      where: record.where || "",
      caused: record.caused || "",
      layer: record.layer,
      basis: record.basis || "",
      grounded: record.grounded !== false,
    };
  } catch {
    return null;
  }
}
