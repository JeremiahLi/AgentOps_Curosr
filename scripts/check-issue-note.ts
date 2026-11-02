/**
 *   npx tsx scripts/check-issue-note.ts
 */
import { groundIssueNote, isMissingErrorSignature, missingErrorNote } from "../src/lib/engine/ingest/issue-note";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const corpus = "Permission denied: E:\\data\\a.txt\n模型决定写入 E:\\data\\a.txt";
const ok = groundIssueNote(
  {
    where: "E:\\data\\a.txt",
    caused: "文件没有写成",
    layer: "env",
    basis: "Permission denied",
  },
  corpus,
);
assert(ok.grounded && ok.layer === "env", "原文子串应保留");
assert(ok.where === "E:\\data\\a.txt", "where 保持原文");

const forged = groundIssueNote(
  { where: "请重写整个提示词", caused: "提示词不好", layer: "prompt", basis: "随便一句" },
  corpus,
);
assert(forged.layer === "insufficient" && !forged.grounded, "对不上原文的结论要丢掉");

const thin = groundIssueNote({ layer: "insufficient", caused: "证据不够", where: "", basis: "" }, corpus);
assert(thin.layer === "insufficient" && thin.grounded, "证据不足是合法结论");
assert(isMissingErrorSignature("answer|err:（无错误文本）"), "无错误文本签名要识别出来");
assert(missingErrorNote().caused.includes("没有错误文本"), "没有错误文本时不给改动面");

console.log("issue note ok");
