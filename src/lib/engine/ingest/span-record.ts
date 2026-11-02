/** 失败 span 在采集端没留下任何文本时的稳定占位，签名用它聚类，而不是各自成簇 */
export const NO_ERROR_TEXT = "（无错误文本）";

/**
 * 失败状态只有一套词：`failed`。
 * 历史行和部分采集端会写成 `error`，或只打 `isError` 而 status 仍是 success。
 */
export function isFailedStatus(status?: string | null, isError?: boolean): boolean {
  if (isError) return true;
  const s = (status ?? "").trim().toLowerCase();
  return s === "failed" || s === "error";
}

function firstNonEmpty(...parts: Array<string | null | undefined>): string | null {
  for (const part of parts) {
    if (typeof part === "string" && part.trim()) return part;
  }
  return null;
}

/**
 * 入库前收敛一条 span：失败一律写成 status=failed，并保证 error 非空。
 * 非失败清掉 error，避免成功 span 残留上一次的错误文本。
 *
 * 工具失败的 output 就是报错输出。模型 / 回答的 output 是正文，
 * 采集端没标 isError、也没给 error 时不能把正文写进错误列。
 */
export function normalizeSpanRecord(input: {
  status?: string | null;
  isError?: boolean;
  error?: string | null;
  output?: string | null;
  details?: string | null;
  kind?: string | null;
}): { status: string; error: string | null } {
  const statusIn = (input.status ?? "").trim();
  if (!isFailedStatus(statusIn, input.isError)) {
    return { status: statusIn || "success", error: null };
  }
  const explicit = firstNonEmpty(input.error);
  if (explicit) return { status: "failed", error: explicit };
  const tool = input.kind === "tool_call" || input.kind === "command";
  const fromBody = tool || input.isError ? firstNonEmpty(input.output, input.details) : firstNonEmpty(input.details);
  return { status: "failed", error: fromBody ?? NO_ERROR_TEXT };
}

/**
 * 会话内因果顺序。startTime 只存到秒，同一秒里的先后会塌掉，不能拿来排序。
 * 次序是 roundIndex → turnId → id（稳定的平局打破，不代表真实先后）。
 */
export function compareSpanOrder(
  a: { roundIndex: number; turnId: number; id: string },
  b: { roundIndex: number; turnId: number; id: string },
): number {
  if (a.roundIndex !== b.roundIndex) return a.roundIndex - b.roundIndex;
  if (a.turnId !== b.turnId) return a.turnId - b.turnId;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
