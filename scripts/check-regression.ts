/**
 *   npx tsx scripts/check-regression.ts
 */
import { judgeReference, requirePassCriteria, taskKeyOf, RegressionInputError } from "../src/lib/engine/ingest/regression";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(taskKeyOf("  帮我改 E:\\tmp\\a.ts  的 12345 行") === "帮我改 的 行", "分桶键去掉路径、长数字和多余空白");
assert(taskKeyOf("同一句话").length <= 80, "分桶键有长度上限");

let rejected = false;
try {
  requirePassCriteria("   ");
} catch (err) {
  rejected = err instanceof RegressionInputError;
}
assert(rejected, "空的通过标准不能建用例");
assert(requirePassCriteria(" 回答里不再出现权限错误 ") === "回答里不再出现权限错误", "通过标准去掉首尾空白");

const reference = judgeReference("不再拒绝访问", "可以写入文件");
assert(reference.includes("通过标准：") && reference.includes("不再拒绝访问"), "裁判能看到通过标准");
assert(reference.includes("参考答案：") && reference.includes("可以写入文件"), "有参考答案时一并放进裁判文本");
assert(!judgeReference("只看标准", "").includes("参考答案"), "没有参考答案时不补空段");

console.log("regression ok");
