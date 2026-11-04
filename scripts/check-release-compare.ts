/**
 *   npx tsx scripts/check-release-compare.ts
 */
import { compareReleases, compareVerdict, TASK_SAMPLE_MIN } from "../src/lib/engine/stats/release-compare";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(compareVerdict(2, 0) === "improved", "只在基线出现是变好");
assert(compareVerdict(1, 1) === "still", "两边都有是仍失败");
assert(compareVerdict(0, 3) === "worse", "只在新版本出现是变差");
assert(compareVerdict(0, 0) === null, "两边都没有不进对照");

const sessions = [
  { id: "b1", releaseId: "base", taskKey: "改配置", totalDuration: 1000, totalTokens: 100 },
  { id: "b2", releaseId: "base", taskKey: "改配置", totalDuration: 3000, totalTokens: 300 },
  { id: "b3", releaseId: "base", taskKey: "改配置", totalDuration: 5000, totalTokens: 500 },
  { id: "n1", releaseId: "next", taskKey: "改配置", totalDuration: 2000, totalTokens: 200 },
  { id: "n2", releaseId: "next", taskKey: "改配置", totalDuration: 2000, totalTokens: 400 },
  { id: "n3", releaseId: "next", taskKey: "改配置", totalDuration: 2000, totalTokens: 600 },
  { id: "b4", releaseId: "base", taskKey: "只出现一次", totalDuration: 1, totalTokens: 1 },
  { id: "n4", releaseId: "next", taskKey: "只出现一次", totalDuration: 1, totalTokens: 1 },
];
const hits = [
  { issueId: "gone", title: "旧错误", signature: "tool:bash|err:gone", sessionId: "b1" },
  { issueId: "stay", title: "还在", signature: "tool:bash|err:stay", sessionId: "b2" },
  { issueId: "stay", title: "还在", signature: "tool:bash|err:stay", sessionId: "n1" },
  { issueId: "new", title: "新错误", signature: "tool:bash|err:new", sessionId: "n2" },
  { issueId: "thin", title: "样本不够", signature: "tool:bash|err:thin", sessionId: "b4" },
];

const compared = compareReleases({ baseId: "base", nextId: "next", sessions, hits });
const byId = new Map(compared.issues.map((issue) => [issue.issueId, issue]));
assert(byId.get("gone")?.verdict === "improved", "旧错误归到变好");
assert(byId.get("gone")?.base.durationMs === 1000 && byId.get("gone")?.base.tokens === 100, "变好带上命中会话的耗时和 token");
assert(byId.get("gone")?.next.hits === 0, "新版本没有命中时次数是 0");
assert(byId.get("stay")?.verdict === "still", "两边都命中归到仍失败");
assert(byId.get("new")?.verdict === "worse", "新错误归到变差");
assert(byId.get("new")?.next.tokens === 400, "变差带上新版本命中会话的 token");
assert(compared.issues[0]?.verdict === "worse", "变差排在前面");

assert(compared.tasks.length === 1, "只有两边都够样本的任务类型才拆开");
assert(compared.tasks[0]?.taskKey === "改配置", "拆开的是样本够的任务");
assert(compared.tasks[0]?.baseSessions === TASK_SAMPLE_MIN, "任务样本数按会话计");
assert(!compared.tasks.some((task) => task.taskKey === "只出现一次"), "样本不够的任务留在总表，不单拆");
assert(compared.tasks[0]?.issues.some((issue) => issue.issueId === "thin") === false, "不够样本的任务里不出现它的问题");

console.log("release compare ok");
