/**
 * 把近 30 天的未恢复失败收成问题库。来源记为 backfill。
 *
 *   npx tsx scripts/backfill-issues.ts
 *   npx tsx scripts/backfill-issues.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { selectIssueHits } from "../src/lib/engine/ingest/issue-rules";
import { recordSessionIssues } from "../src/lib/engine/ingest/record-issues";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const SPAN_SELECT = {
  id: true,
  kind: true,
  name: true,
  status: true,
  input: true,
  output: true,
  error: true,
  details: true,
  content: true,
  roundIndex: true,
  turnId: true,
  parentId: true,
  branchId: true,
} as const;

async function main() {
  const since = new Date(Date.now() - WINDOW_MS);
  const sessions = await prisma.session.findMany({
    where: { startTime: { gte: since } },
    select: { id: true, agentId: true, releaseId: true },
    orderBy: { startTime: "asc" },
  });

  let withHits = 0;
  let evidence = 0;
  const signatures = new Set<string>();
  for (const session of sessions) {
    const spans = await prisma.span.findMany({ where: { sessionId: session.id }, select: SPAN_SELECT });
    const hits = selectIssueHits(spans);
    if (hits.length === 0) continue;
    withHits += 1;
    evidence += hits.length;
    for (const hit of hits) signatures.add(`${session.agentId}\0${hit.signature}`);
  }

  console.log(
    `[backfill-issues] ${APPLY ? "apply" : "dry-run"} sessions=${sessions.length} withHits=${withHits} evidence=${evidence} signatures=${signatures.size}`,
  );
  if (!APPLY || withHits === 0) return;

  let added = 0;
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const result = await recordSessionIssues(prisma, {
      agentId: session.agentId,
      sessionId: session.id,
      releaseId: session.releaseId,
      source: "backfill",
    });
    added += result.evidenceAdded;
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${sessions.length}`);
  }
  const open = await prisma.issue.count({ where: { status: { in: ["open", "confirmed"] } } });
  const candidate = await prisma.issue.count({ where: { status: "candidate" } });
  console.log(`[backfill-issues] evidenceAdded=${added} open=${open} candidate=${candidate}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
