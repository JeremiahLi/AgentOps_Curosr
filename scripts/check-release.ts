/**
 *   npx tsx scripts/check-release.ts
 */
import { resolveRelease } from "../src/lib/engine/ingest/release";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const weak = resolveRelease({ agentVersion: "1.0.0", model: "m" });
const reported = resolveRelease({
  agentVersion: "1.0.0",
  model: "m",
  promptHash: "abc",
});
assert(weak.quality === "weak", "没有哈希时应是弱指纹");
assert(reported.quality === "reported", "有 prompt 哈希时应是完整指纹");
assert(weak.fingerprint !== reported.fingerprint, "弱指纹和完整指纹不能相同");
assert(
  resolveRelease({ agentVersion: "1.0.0", model: "m" }).fingerprint === weak.fingerprint,
  "同样的输入指纹应稳定",
);

console.log("release ok");
