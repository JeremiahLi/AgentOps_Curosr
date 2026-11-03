import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function show(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  console.log(JSON.stringify(out));
}

async function main() {
  const agent = await db.agent.findFirst({ where: { name: "pptagent1022" } });
  if (!agent) {
    console.log("no agent");
    return;
  }
  console.log("agent", agent.id);

  const models = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT COALESCE(sp.model,'') AS model, sp.kind, COUNT(*) AS cnt,
            AVG(sp.duration) AS avgMs,
            MAX(sp.duration) AS maxMs,
            MIN(sp.duration) AS minMs
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ? AND sp.duration > 0
     GROUP BY COALESCE(sp.model,''), sp.kind
     ORDER BY maxMs DESC`,
    agent.id,
  );
  console.log("\n=== model x kind ===");
  for (const row of models) show(row);

  const issues = await db.issue.findMany({
    where: { agentId: agent.id },
    select: { id: true, title: true, signature: true, kind: true, status: true, hitCount: true, sampleError: true, llmNote: true },
  });
  console.log("\n=== issues ===");
  for (const issue of issues) {
    console.log(JSON.stringify({ ...issue, llmNote: (issue.llmNote || "").slice(0, 400) }));
  }

  const perModel = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH calls AS (
       SELECT COALESCE(NULLIF(sp.model,''), '(无模型)') AS model, sp.duration AS v
       FROM Span sp JOIN Session s ON sp.sessionId = s.id
       WHERE s.agentId = ? AND sp.duration > 0 AND sp.kind = 'llm_thinking'
     ), ranked AS (
       SELECT model, v,
              ROW_NUMBER() OVER (PARTITION BY model ORDER BY v) AS rn,
              COUNT(*) OVER (PARTITION BY model) AS cnt
       FROM calls
     )
     SELECT model, MAX(cnt) AS cnt,
            CAST(MAX(CASE WHEN rn = CAST((cnt * 50 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p50,
            CAST(MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INT) THEN v END) AS INTEGER) AS p95,
            MAX(v) AS maxMs
     FROM ranked GROUP BY model`,
    agent.id,
  );
  console.log("\n=== per model p95 llm_thinking ===");
  for (const row of perModel) show(row);

  const answers = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT sp.id, sp.sessionId, sp.model, sp.status, sp.duration, sp.inputTokens, sp.outputTokens,
            length(COALESCE(sp.output,'')) AS outLen
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ? AND sp.kind = 'answer' AND sp.status IN ('failed','error')
     ORDER BY sp.sessionId, sp.duration DESC`,
    agent.id,
  );
  console.log("\n=== failed answers ===");
  for (const row of answers) show(row);

  const sessions = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, status, outcome, model, totalDuration, totalInputTokens, totalOutputTokens, errorCount
     FROM Session WHERE agentId = ?`,
    agent.id,
  );
  console.log("\n=== sessions ===");
  for (const row of sessions) show(row);

  const needles = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT sp.id, sp.kind, sp.model, sp.status,
            CASE
              WHEN sp.error LIKE '%402%' OR sp.error LIKE '%quota%' OR sp.error LIKE '%余额%' OR sp.error LIKE '%rate limit%' OR sp.error LIKE '%429%' THEN 'error'
              WHEN sp.output LIKE '%402%' OR sp.output LIKE '%quota%' OR sp.output LIKE '%余额%' OR sp.output LIKE '%rate limit%' OR lower(sp.output) LIKE '%insufficient%' THEN 'output'
              WHEN sp.input LIKE '%402%' OR sp.input LIKE '%quota%' OR sp.input LIKE '%余额%' THEN 'input'
              ELSE ''
            END AS hit
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ?
       AND (
         sp.error LIKE '%402%' OR sp.error LIKE '%quota%' OR sp.error LIKE '%余额%' OR sp.error LIKE '%429%' OR sp.error LIKE '%rate limit%'
         OR sp.output LIKE '%quota%' OR sp.output LIKE '%余额%' OR sp.output LIKE '%402%' OR lower(sp.output) LIKE '%rate limit%'
         OR sp.input LIKE '%quota%' OR sp.input LIKE '%余额%' OR sp.input LIKE '%402%'
       )
     LIMIT 20`,
    agent.id,
  );
  console.log("\n=== quota-like ===", needles.length);
  for (const row of needles) show(row);

  const head = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, substr(COALESCE(input,''),1,500) AS input FROM Span WHERE id IN ('f5d8f3ba-9515-423f-9f2f-2fa51eab2fa6','2a3318d5-b554-4713-af3f-bda82025670d','dbce7606-e90f-4cd2-80b2-5e0ece7ee9fe')`,
  );
  console.log("\n=== input heads ===");
  for (const row of head) show(row);

  const spark = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT sp.id, sp.sessionId, sp.kind, sp.status, sp.duration, sp.inputTokens, sp.outputTokens,
            length(COALESCE(sp.output,'')) AS outLen, length(COALESCE(sp.input,'')) AS inLen,
            length(COALESCE(sp.content,'')) AS contentLen, length(COALESCE(sp.details,'')) AS detailsLen,
            substr(COALESCE(sp.error,''),1,180) AS error,
            substr(COALESCE(sp.content,''),1,240) AS content,
            substr(COALESCE(sp.details,''),1,400) AS details
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ? AND sp.model = 'spark-x2.6-4b'
     ORDER BY sp.duration DESC`,
    agent.id,
  );
  console.log("\n=== spark spans ===");
  for (const row of spark) show(row);

  const failedAnswers = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT sp.id, sp.sessionId, sp.kind, sp.name, sp.status, sp.model, sp.duration,
            substr(COALESCE(sp.error,''),1,200) AS error,
            substr(COALESCE(sp.output,''),1,180) AS output,
            substr(COALESCE(sp.content,''),1,240) AS content,
            substr(COALESCE(sp.details,''),1,400) AS details
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ? AND sp.status IN ('failed','error')
     ORDER BY sp.kind, sp.duration DESC
     LIMIT 20`,
    agent.id,
  );
  console.log("\n=== failed spans ===");
  for (const row of failedAnswers) show(row);

  const fails = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT sp.id, sp.kind, sp.name, sp.status, sp.model, sp.duration, sp.inputTokens, sp.outputTokens,
            substr(COALESCE(sp.error,''),1,300) AS error,
            substr(COALESCE(sp.output,''),1,200) AS output,
            substr(COALESCE(sp.details,''),1,300) AS details
     FROM Span sp JOIN Session s ON sp.sessionId = s.id
     WHERE s.agentId = ? AND (sp.status IN ('failed','error') OR sp.kind IN ('llm_thinking','answer','llm'))
     ORDER BY sp.duration DESC
     LIMIT 30`,
    agent.id,
  );
  console.log("\n=== llm/fail spans ===");
  for (const row of fails) show(row);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
