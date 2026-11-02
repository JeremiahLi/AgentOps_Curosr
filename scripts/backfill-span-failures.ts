/**
 * 回填失败 span 的状态和错误文本，并按当前终态规则重算受影响会话的 outcome / errorCount。
 *
 * 背景：历史上 status 会写成 error，失败 span 的 error 列经常是空的
 * （入库只在 isError 时把 output 抄进 error）。过程事实在读路径上会现算补齐，
 * 但这份脚本把库内行收成同一口径，聚类和看板不再漏掉 status=error 的行。
 *
 * 口径与 src/lib/engine/ingest/span-record.ts、derive.ts 的 computeOutcome 一致。
 *
 * 用法：
 *   npx tsx scripts/backfill-span-failures.ts
 *   npx tsx scripts/backfill-span-failures.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { computeOutcome } from "../src/lib/engine/ingest/derive";
import { normalizeSpanRecord } from "../src/lib/engine/ingest/span-record";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.span.findMany({
    where: {
      OR: [{ status: "error" }, { status: "failed" }],
    },
    select: {
      id: true,
      sessionId: true,
      kind: true,
      status: true,
      error: true,
      output: true,
      details: true,
    },
  });

  const dirty = rows.filter((row) => {
    const norm = normalizeSpanRecord(row);
    return norm.status !== row.status || (norm.error ?? "") !== (row.error ?? "");
  });
  const sessionIds = [...new Set(dirty.map((row) => row.sessionId))];

  console.log(
    `[backfill-span-failures] ${APPLY ? "apply" : "dry-run"} dirtySpans=${dirty.length} sessions=${sessionIds.length}`,
  );
  for (const row of dirty.slice(0, 8)) {
    const norm = normalizeSpanRecord(row);
    console.log(
      `  ${row.id} status ${row.status} -> ${norm.status} error ${JSON.stringify((row.error || "").slice(0, 40))} -> ${JSON.stringify((norm.error || "").slice(0, 40))}`,
    );
  }
  if (dirty.length > 8) console.log(`  … ${dirty.length - 8} more`);
  if (!APPLY || dirty.length === 0) return;

  const BATCH = 100;
  for (let i = 0; i < dirty.length; i += BATCH) {
    const batch = dirty.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((row) => {
        const norm = normalizeSpanRecord(row);
        return prisma.span.update({
          where: { id: row.id },
          data: { status: norm.status, error: norm.error },
        });
      }),
    );
  }

  let outcomes = 0;
  for (const sessionId of sessionIds) {
    const spans = await prisma.span.findMany({
      where: { sessionId },
      select: { kind: true, status: true, input: true, output: true, roundIndex: true, turnId: true },
    });
    const { outcome, errors } = computeOutcome(spans);
    await prisma.session.update({
      where: { id: sessionId },
      data: { outcome, errorCount: errors },
    });
    outcomes += 1;
  }
  console.log(`[backfill-span-failures] updated spans=${dirty.length} sessions=${outcomes}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
