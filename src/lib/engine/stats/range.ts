/**
 * 统计时间范围解析。
 * 与现有 /api/stats 的 range 约定保持一致，并扩展 3d / 30d 档位。
 */

export type StatsRange = "realtime" | "3d" | "weekly" | "30d" | "all";

export interface ResolvedRange {
  /** 起始时间（Unix 毫秒）；all 时为 0 表示不过滤 */
  startMs: number;
  label: string;
}

export function resolveRange(range: string | null | undefined): ResolvedRange {
  if (range === "weekly") {
    return { startMs: Date.now() - 7 * 24 * 60 * 60 * 1000, label: "近7天" };
  }
  if (range === "3d") {
    return { startMs: Date.now() - 3 * 24 * 60 * 60 * 1000, label: "近3天" };
  }
  if (range === "30d") {
    return { startMs: Date.now() - 30 * 24 * 60 * 60 * 1000, label: "近30天" };
  }
  if (range === "realtime") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime(), label: "今日" };
  }
  return { startMs: 0, label: "全部" };
}

/** UI 通用时间档位（value 与后端 range 参数一致） */
export const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: "realtime", label: "今日" },
  { value: "3d", label: "近3天" },
  { value: "weekly", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "all", label: "全部" },
];

/** 有明确时间窗的档位（排除 all），供概览切换器、详情面板等复用 */
export const RANGED_OPTIONS: { value: Exclude<StatsRange, "all">; label: string }[] =
  RANGE_OPTIONS.filter((o): o is { value: Exclude<StatsRange, "all">; label: string } => o.value !== "all");

/** 概览仪表盘档位（今日 / 近7天；后端 /api/stats 仅为这两档计算环比） */
export const OVERVIEW_RANGE_OPTIONS: { value: "realtime" | "weekly"; label: string }[] = [
  { value: "realtime", label: "今日" },
  { value: "weekly", label: "近7天" },
];

/**
 * 将 $queryRaw 返回的行中所有 BigInt/大整数字段安全转为 number。
 * SQLite 的 SUM/COUNT 在 Prisma raw 查询中可能返回 BigInt，直接 JSON 序列化会抛错。
 */
export function normalizeRow<T extends Record<string, unknown>>(row: T): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : (v as number | string);
  }
  return out;
}
