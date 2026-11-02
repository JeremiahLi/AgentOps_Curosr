import { redirect } from "next/navigation";

/**
 * 旧路由兜底。「Agent 性能看板」已改造为「Agent 看板」（/agent-board）。
 * next.config.ts 里另有 307 重定向，这里再兜一层客户端跳转 —— 两处并存，
 * 任何入口（外链 / 书签 / router.push）都能到位。
 */
export default function LegacyAgentStatsPage() {
  redirect("/agent-board");
}
