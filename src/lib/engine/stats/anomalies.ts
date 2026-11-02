/**
 * Agent 异常判定的统一口径。
 * 概览页的异常预警（/api/stats）走这里的阈值。
 *
 * 注意：Agent 看板（/agent-board）不使用本模块，改由
 * src/lib/engine/stats/health.ts 的四维打分表达严重程度 —— 二值「异常/正常」
 * 无法区分「刚过线」和「已经崩了」，也排序不了。这里的 0.3 阈值在
 * health.ts 的稳定性锚点里被复用为「70 分对应 30% 错误率」。
 */

/** 单 Agent 错误率阈值（占比） */
export const AGENT_ERROR_RATE_THRESHOLD = 0.3;

/** 触发判定的最少 Session 数（样本过小不判异常） */
export const AGENT_ERROR_MIN_SESSIONS = 2;

export interface AgentErrorStat {
  total: number;
  errors: number;
}

/** 判定某 Agent 是否异常：错误率超过阈值且样本量足够 */
export function isAgentAnomalous({ total, errors }: AgentErrorStat): boolean {
  return total >= AGENT_ERROR_MIN_SESSIONS && errors / total > AGENT_ERROR_RATE_THRESHOLD;
}
