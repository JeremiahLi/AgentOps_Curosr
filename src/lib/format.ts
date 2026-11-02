export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

export function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatNumber(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1000000000) return `${(n / 1000000).toFixed(2)}M`;
  return `${(n / 1000000000).toFixed(2)}B`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

/** 成功率语义色：>=97 绿 / >=93 黄 / 其余红，null 灰 */
export function rateColor(rate: number | null): string {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 97) return "text-success";
  if (rate >= 93) return "text-warning";
  return "text-destructive";
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface PctChange {
  value: number;
  direction: "up" | "down" | "flat";
}

/**
 * 环比变化：|变化| < 1% 视为持平；上期为 0 或无上期时返回 undefined（不画趋势箭头，
 * 避免把「从 0 到有」渲染成 +∞%）。
 */
export function pctChange(cur: number, prev: number | null | undefined): PctChange | undefined {
  if (prev == null || prev === 0) return undefined;
  const diff = ((cur - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return { value: 0, direction: "flat" };
  return { value: Math.abs(diff), direction: diff > 0 ? "up" : "down" };
}

