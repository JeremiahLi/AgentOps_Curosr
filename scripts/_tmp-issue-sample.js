const { PrismaClient } = require("@prisma/client");
const { getAgentDetail } = require("../src/lib/engine/stats/agent-detail.ts");

async function main() {
  const prisma = new PrismaClient();
  const detail = await getAgentDetail(prisma, "pptagent1022", {
    startMs: 0,
    spanDays: 30,
    granularity: "day",
  });
  for (const issue of detail.issues) {
    console.log("---", issue.severity, issue.kind);
    console.log(issue.title);
    console.log(issue.conclusion);
    for (const line of issue.evidence) console.log(" ·", line);
    console.log("建议:", issue.suggestion);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
