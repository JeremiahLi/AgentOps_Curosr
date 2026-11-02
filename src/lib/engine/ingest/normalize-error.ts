/**
 * 把一条 error 压成可聚类的模式串。
 * 不归一化的话，每条带绝对路径 / 行号的报错都会自成一簇（实测 bash 报错全带 E:\... 路径）。
 */
export function normalizeError(raw: string): string {
  return raw
    .replace(/\r?\n/g, " ")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, "<path>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{12,}/gi, "<uuid>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*/g, "<time>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/["'`][^"'`]{0,80}["'`]/g, "<str>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
