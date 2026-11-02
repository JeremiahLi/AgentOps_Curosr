import { Prisma } from "@prisma/client";

/**
 * 会话成败口径的唯一来源（SQL 片段，均假设表别名是 s）。
 *
 * 为什么单独抽出来：agent-board / agent-detail / trend 三处都要算成功率，
 * 口径一旦分裂就会出现「看板 96%、下钻 91%」这类自相矛盾的数字。
 *
 * 三条规则：
 * 1. 完成会话 = 非 active 且非空会话。空会话（采集端建了 session 但没上传 span）
 *    既没成功也没失败，不进分母。
 * 2. 失败会话 = outcome='failed'，即末条 answer 失败/无交付。
 *    outcome='' 表示历史数据未回填，回退到旧口径（errorCount>0 或 status='error'），
 *    保证回填脚本执行前看板数字不跳变。
 * 3. 部分成功 = outcome='partial'，有交付但过程中出现过 failed span。
 *    折算权重在 TS 侧（health.ts 的 successRateOf，按半失败计）。
 */
export const SQL_FINISHED = Prisma.sql`(s.status <> 'active' AND (s.outcome <> '' OR s.totalSpans > 0))`;
export const SQL_BAD = Prisma.sql`(s.outcome = 'failed' OR (s.outcome = '' AND (s.errorCount > 0 OR s.status = 'error')))`;
export const SQL_PARTIAL = Prisma.sql`(s.outcome = 'partial')`;
