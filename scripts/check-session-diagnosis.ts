/**
 * 过程诊断的回归检查。
 *
 *   npx tsx scripts/check-session-diagnosis.ts
 */
import { diagnoseSession } from "../src/lib/engine/ingest/session-diagnosis";
import { analyzeSessionFacts, type FactSpan } from "../src/lib/engine/ingest/session-facts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function diagnose(spans: FactSpan[]) {
  return diagnoseSession(analyzeSessionFacts(spans), spans);
}

function toolFail(partial: Partial<FactSpan> & { id: string; name: string; output?: string; error?: string; input?: string }): FactSpan {
  return {
    kind: "tool_call",
    status: "failed",
    roundIndex: 0,
    turnId: 1,
    ...partial,
  };
}

const answered = (turn: number): FactSpan => ({
  id: "ans",
  kind: "answer",
  status: "success",
  output: "已回答",
  roundIndex: 0,
  turnId: turn,
});

const exitCode = diagnose([
  toolFail({ id: "b", name: "bash", output: "(no output)  Command exited with code 49", turnId: 1 }),
  answered(2),
]);
assert(exitCode.primary?.causeClass === "exit_code", "退出码 49 应归为 exit_code");
assert(exitCode.primary?.cause.includes("49"), "根因应带上退出码");
assert(exitCode.primary?.checks[0].includes("stderr"), "先检查应要求留下 stderr");

const denied = diagnose([
  toolFail({ id: "e", name: "edit_file", error: "Permission denied", turnId: 1 }),
  answered(2),
]);
assert(denied.primary?.causeClass === "permission", "Permission denied 应归为权限");
assert(denied.primary?.cause === "edit_file 被拒绝访问", "权限根因应点名工具");

const quotes = diagnose([
  toolFail({
    id: "q",
    name: "bash",
    output: "/usr/bin/bash: -c: line 1: unexpected EOF while looking for matching `\"'",
    turnId: 1,
  }),
  answered(2),
]);
assert(quotes.primary?.causeClass === "bad_invocation", "引号不匹配应归为命令写坏");
assert(quotes.primary?.checks[0].includes("引号"), "先检查应核对引号");

const dir = diagnose([
  toolFail({ id: "r", name: "read", error: "EISDIR: illegal operation on a directory, read", turnId: 1 }),
  answered(2),
]);
assert(dir.primary?.causeClass === "is_directory", "EISDIR 应归为把目录当文件");
assert(dir.primary?.cause.includes("read"), "根因应点名 read");

const traceback = diagnose([
  toolFail({
    id: "t",
    name: "bash",
    output: [
      "Traceback (most recent call last):",
      '  File "E:\\a\\merge.py", line 4, in <module>',
      "    data = json.load(f)",
      "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    ].join("\n"),
    turnId: 1,
  }),
  answered(2),
]);
assert(traceback.primary?.causeClass === "exception", "Traceback 应归为异常");
assert(traceback.primary?.cause.includes("JSONDecodeError"), "根因应使用最后一行的异常类型");
assert(traceback.primary?.cause.includes("Expecting value"), "根因应带上异常短原因");
assert(!traceback.primary?.cause.includes("Traceback (most recent"), "根因不应停在 Traceback 开头");

const validation = diagnose([
  toolFail({
    id: "v",
    name: "bash",
    output: "FAILED - Found NEW validation errors: ppt\\presentation.xml: 1 new error(s) - 'gb'",
    turnId: 1,
  }),
  answered(2),
]);
assert(validation.primary?.causeClass === "validation", "质检失败应归为校验");
assert(validation.primary?.cause.includes("presentation.xml"), "根因应摘出被点名的文件");

const missing = diagnose([
  toolFail({ id: "m", name: "bash", status: "failed", output: "", error: "", turnId: 1 }),
  answered(2),
]);
assert(missing.primary?.causeClass === "missing_error", "没有错误文本时不能猜测原因");
assert(missing.primary?.checks.length === 1, "无错误文本只给一条采集端检查");
assert(!missing.primary?.cause.includes("退出码"), "无错误文本不应编造退出码原因");

const recovered = diagnose([
  toolFail({ id: "bad", name: "bash", output: "Permission denied", turnId: 1 }),
  { id: "ok", kind: "tool_call", name: "bash", status: "success", output: "ok", roundIndex: 0, turnId: 2 },
  answered(3),
]);
assert(!recovered.anomalous && recovered.primary === null, "已恢复的失败不能进入诊断");

const buried = diagnose([
  toolFail({ id: "bad", name: "edit_file", error: "Permission denied", turnId: 1 }),
  { id: "u", kind: "user", status: "success", input: "写接口", roundIndex: 0, turnId: 0 },
]);
assert(buried.primary?.causeClass === "permission", "同时未交付时主因仍是更早的工具失败");
assert(buried.others.every((item) => item.causeClass !== "no_delivery"), "未交付不应变成第二条根因");

const loop = diagnose([
  toolFail({ id: "a", name: "bash", input: "ls /missing", output: "No such file or directory", turnId: 1 }),
  { id: "llm", kind: "llm_thinking", status: "success", output: "再试", roundIndex: 0, turnId: 2 },
  toolFail({ id: "b", name: "bash", input: "ls /missing", output: "No such file or directory", turnId: 3 }),
  answered(4),
]);
assert(loop.primary?.causeClass === "not_found", "循环仍按错误本身分类");
assert(loop.primary?.cause.includes("同一入参连续失败 2 次"), "入参相同时要写明重复");
assert(loop.primary?.checks[0] === "不要用同一参数再试", "循环的第一条检查是停止原样重试");

const changed = diagnose([
  toolFail({ id: "a", name: "bash", input: "ls /a", output: "No such file or directory", turnId: 1 }),
  toolFail({ id: "b", name: "bash", input: "ls /b", output: "No such file or directory", turnId: 2 }),
  answered(3),
]);
assert(changed.primary?.cause.includes("换了入参仍是同一错误"), "入参变化时要写明换过参数");

console.log("session diagnosis ok");
