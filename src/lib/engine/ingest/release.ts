import { createHash } from "node:crypto";

export interface ReleaseDraft {
  fingerprint: string;
  label: string;
  model: string;
  promptHash: string;
  skillSetHash: string;
  configHash: string;
  /** reported = 带了 prompt / skill / config 之一；weak = 只有版本号或模型 */
  quality: "reported" | "weak";
}

function clean(value: string | null | undefined): string {
  return (value || "").trim();
}

/**
 * 一次运行的版本指纹。
 * 有 prompt、skill 或 config 哈希时记为 reported，否则只按版本号和模型记为 weak。
 * 两种质量不会落成同一个指纹。
 */
export function resolveRelease(input: {
  agentVersion?: string | null;
  model?: string | null;
  promptHash?: string | null;
  skillSetHash?: string | null;
  configHash?: string | null;
}): ReleaseDraft {
  const label = clean(input.agentVersion);
  const model = clean(input.model);
  const promptHash = clean(input.promptHash);
  const skillSetHash = clean(input.skillSetHash);
  const configHash = clean(input.configHash);
  const quality = promptHash || skillSetHash || configHash ? "reported" : "weak";
  const fingerprint = createHash("sha256")
    .update([quality, label, model, promptHash, skillSetHash, configHash].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return { fingerprint, label, model, promptHash, skillSetHash, configHash, quality };
}
