import { redirect } from "next/navigation";

/**
 * 旧路由兜底。「Skill 使用看板」（/skill-stats）已升级为「Tool & Skill 看板」（/skills），
 * 纳入 Tool 维度与失败聚类；老书签/外链通过这里跳转，不 404。
 */
export default function LegacySkillStatsPage() {
  redirect("/skills");
}
