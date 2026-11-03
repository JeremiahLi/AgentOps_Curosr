import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { callLlmAsJson, getActiveLlmConfig } from "../src/lib/engine/experiment/judge-llm";
import { groundIssueNote } from "../src/lib/engine/ingest/issue-note";
import { loadSlowCallReport } from "../src/lib/engine/stats/slow-call";
import { resolveRange } from "../src/lib/engine/stats/range";

async function main() {
  const db = new PrismaClient();
  const agent = await db.agent.findUnique({ where: { name: "pptagent1022" }, select: { id: true } });
  if (!agent) throw new Error("missing agent");
  const report = await loadSlowCallReport(db, agent.id, resolveRange("30d").startMs);
  const config = await getActiveLlmConfig();
  if (!report || !config) {
    writeFileSync("scripts/_raw-note.json", JSON.stringify({ hasReport: !!report, hasConfig: !!config }));
    await db.$disconnect();
    return;
  }
  const corpus = report.corpus.slice(0, 2500);
  try {
    const raw = await callLlmAsJson<unknown>(
      [
        {
          role: "system",
          content: "输出 JSON：sessionId, spanId, field, observed, layer, action, verify。值必须从证据原样复制。field 取「字段: 名字=」里的名字。action 必须包含 spanId、field、observed。",
        },
        { role: "user", content: `证据：\n${corpus}` },
      ],
      config,
      { temperature: 0, maxTokens: 700 },
    );
    writeFileSync(
      "scripts/_raw-note.json",
      JSON.stringify({ model: config.model, raw, grounded: groundIssueNote(raw, report.corpus) }, null, 2),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync("scripts/_raw-note.json", JSON.stringify({ model: config.model, message: message.slice(0, 400) }, null, 2));
  }
  await db.$disconnect();
}

main();
