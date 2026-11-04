const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const rows = await p.$queryRawUnsafe(
    `SELECT a.name AS agent,
            sp.name AS tool,
            COUNT(*) AS calls,
            SUM(CASE WHEN sp.status IN ('failed','error') THEN 1 ELSE 0 END) AS failed
     FROM Span sp
     JOIN Session s ON sp.sessionId = s.id
     JOIN Agent a ON s.agentId = a.id
     WHERE sp.kind = 'tool_call'
     GROUP BY a.name, sp.name
     HAVING failed >= 3
     ORDER BY failed DESC
     LIMIT 40`,
  );
  for (const r of rows) {
    const calls = Number(r.calls);
    const failed = Number(r.failed);
    const rate = calls ? ((failed / calls) * 100).toFixed(1) : "0";
    console.log(`${r.agent}\t${r.tool}\t${failed}/${calls}\t${rate}%`);
  }
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
