/**
 * Cursor stop hook: if the working tree has changes, commit and push to origin.
 * Runs from repository root. Fail-open on errors (does not block the agent).
 */
const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function drainStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  drainStdin();

  if (tryRun("git rev-parse --is-inside-work-tree") !== "true") {
    return;
  }

  const porcelain = tryRun("git status --porcelain");
  if (!porcelain) {
    return;
  }

  const files = porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const rest = line.slice(3).trim();
      const arrow = rest.indexOf(" -> ");
      return arrow >= 0 ? rest.slice(arrow + 4) : rest;
    });

  tryRun("git add -A");
  tryRun("git reset HEAD -- .env prisma/dev.db");
  tryRun("git reset HEAD -- .env.local prisma/*.db-journal");

  const staged = tryRun("git diff --cached --name-only");
  if (!staged) {
    return;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = files
    .slice(0, 25)
    .map((f) => `- ${f}`)
    .join("\n");
  const message = `chore: 自动同步工作区变更 ${stamp}\n\n${body}`;

  const msgFile = path.join(os.tmpdir(), `cursor-auto-commit-${process.pid}.txt`);
  fs.writeFileSync(msgFile, message, "utf8");
  try {
    const commit = spawnSync("git", ["commit", "-F", msgFile], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (commit.status !== 0) {
      throw new Error(commit.stderr || commit.stdout || "git commit failed");
    }
    const push = spawnSync("git", ["push", "origin", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (push.status !== 0) {
      throw new Error(push.stderr || push.stdout || "git push failed");
    }
    process.stderr.write("[auto-commit-push] committed and pushed\n");
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message;
    process.stderr.write(`[auto-commit-push] skipped or failed: ${detail}\n`);
  } finally {
    try {
      fs.unlinkSync(msgFile);
    } catch {
      /* ignore */
    }
  }
}

main();
