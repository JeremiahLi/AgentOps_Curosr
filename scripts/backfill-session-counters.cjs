/**
 * 回填 Session.llmCallCount / toolCallCount。
 *
 * 背景：2026-10-22 起 Session 新增两个冗余计数列，历史行为 Prisma 列默认值 0，
 * 列表页与 Session 看板会显示「0 / 0」的假数据。
 *
 * 口径（与 src/app/api/sessions/upload/route.ts 完全一致，改规则时两处必须同步）：
 *   llmCallCount  = COUNT(Span.kind = 'llm_thinking')
 *   toolCallCount = COUNT(Span.kind IN ('tool_call','command'))   -- command 也算工具调用
 *
 * 用法：
 *   node scripts/backfill-session-counters.cjs            # dry-run，只报告不一致行数
 *   node scripts/backfill-session-counters.cjs --apply    # 真正写库
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** 差异巡检：统计库里计数值与 Span 实际数量不一致的行 */
const DIFF_SQL = `
  SELECT COUNT(*) AS sessions,
         COALESCE(SUM(CASE WHEN llmCallCount <> (
           SELECT COUNT(*) FROM Span sp WHERE sp.sessionId = Session.id AND sp.kind = 'llm_thinking'
         ) THEN 1 ELSE 0 END), 0) AS llmDiff,
         COALESCE(SUM(CASE WHEN toolCallCount <> (
           SELECT COUNT(*) FROM Span sp WHERE sp.sessionId = Session.id AND sp.kind IN ('tool_call','command')
         ) THEN 1 ELSE 0 END), 0) AS toolDiff,
         COALESCE(SUM(llmCallCount), 0)  AS llmSum,
         COALESCE(SUM(toolCallCount), 0) AS toolSum
  FROM Session`;

/** 幂等回填：即使重复执行，结果也相同 */
const APPLY_SQL = `
  UPDATE Session SET
    llmCallCount = COALESCE((SELECT COUNT(*) FROM Span sp
      WHERE sp.sessionId = Session.id AND sp.kind = 'llm_thinking'), 0),
    toolCallCount = COALESCE((SELECT COUNT(*) FROM Span sp
      WHERE sp.sessionId = Session.id AND sp.kind IN ('tool_call','command')), 0)`;

const n = (v) => Number(v ?? 0);

(async () => {
  const [before] = await prisma.$queryRawUnsafe(DIFF_SQL);
  console.log(APPLY ? "== 回填模式（会写库）==" : "== DRY-RUN（加 --apply 执行）==");
  console.log(
    `会话 ${n(before.sessions)} 个；llmCallCount 不一致 ${n(before.llmDiff)} 个；` +
      `toolCallCount 不一致 ${n(before.toolDiff)} 个`,
  );
  console.log(`当前合计 llm=${n(before.llmSum)} tool=${n(before.toolSum)}`);

  if (!APPLY) {
    console.log("确认无误后执行：node scripts/backfill-session-counters.cjs --apply");
    return;
  }

  const updated = await prisma.$executeRawUnsafe(APPLY_SQL);
  const [after] = await prisma.$queryRawUnsafe(DIFF_SQL);
  console.log(`已更新 ${updated} 行`);
  console.log(
    `复查：不一致 ${n(after.llmDiff)} / ${n(after.toolDiff)}；` +
      `合计 llm=${n(after.llmSum)} tool=${n(after.toolSum)}`,
  );
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
