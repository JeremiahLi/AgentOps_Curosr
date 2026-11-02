/**
 * 历史数据回填：Agent 归属 / 项目名 / 会话标题 / 会话终态。
 *
 * 背景：2026-10-22 之前的三处缺陷让历史数据失真
 *   1. 采集端从未上报 session_start，agent_name 恒走 fallback，全部 pi 会话挂在同一个 Agent；
 *   2. Project.name 被写成 projectId（16 位 hex）；
 *   3. 会话成败按「任一 span failed」判定，把「质检回流后交付」的会话算成失败。
 *
 * 本脚本按与 src/lib/engine/ingest/derive.ts 完全一致的规则重算（改规则时两处要同步）：
 *   - Agent 名：从 tool_call input 的 .pi/skills 锚点与 cd 命令反推工作目录 basename；
 *   - 标题：首条 user span 的 input 截断 60 字；
 *   - 终态：末条 answer 成功且有输出 → success（无 failed） / partial（有 failed），否则 failed。
 *
 * 父子链（Session.parentSessionId，2026-10 起）不做回填：历史采集记录与库内均无
 * 链接信息，时间窗 + cwd 启发式误判率不可接受（宁缺毋假），历史行保持 null。
 *
 * 用法：
 *   node scripts/backfill-sessions.cjs            # dry-run，只打印将要做的改动
 *   node scripts/backfill-sessions.cjs --apply    # 真正写库
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const FALLBACK_AGENT_NAME = "pi-coding-agent";
const TITLE_MAX = 60;

/* ------------------------------ 与 derive.ts 同规则 ------------------------------ */

function normalizeText(raw) {
  return String(raw || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function basenameOf(p) {
  const cleaned = String(p).replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/);
  return parts[parts.length - 1] || "";
}

/**
 * 输出目录 / 构建目录等「子目录名」不是项目根：命中黑名单就回退到上一级。
 * 典型误判：`cd /e/proj/outputs && python tools/x.py` 会把 agent 叫成 outputs。
 */
const IGNORED_LEAF = new Set([
  "output", "outputs", "dist", "build", "node_modules", "src", "tmp", "temp",
  "test", "tests", "doc", "docs", "assets", "tools", "scripts", "logs", "cache",
]);

function projectNameOf(fullPath) {
  let p = String(fullPath).replace(/[\\/]+$/, "");
  let leaf = basenameOf(p);
  let guard = 0;
  while (IGNORED_LEAF.has(leaf.toLowerCase()) && guard++ < 4) {
    const next = p.replace(/[\\/][^\\/]+$/, "");
    if (next === p) break;
    p = next;
    leaf = basenameOf(p);
  }
  return leaf;
}

function cwdCandidatesFrom(input) {
  if (!input) return [];
  const out = [];
  const piRe = /([A-Za-z]:[\\/][^\s"'<>|]*?)[\\/]\.pi[\\/]/g;
  let m;
  while ((m = piRe.exec(input)) !== null) out.push(m[1]);
  const piPosix = /(\/[^\s"'<>|]*?)\/\.pi\//g;
  while ((m = piPosix.exec(input)) !== null) out.push(m[1]);
  const cdRe = /cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))/g;
  while ((m = cdRe.exec(input)) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && (/^[A-Za-z]:[\\/]/.test(p) || /^\/[A-Za-z]?\//.test(p) || /^\/[a-z]\//.test(p))) out.push(p);
  }
  return out.map((s) => s.replace(/[\\/]+$/, "")).filter((s) => s.length > 2);
}

function deriveWorkspace(spans) {
  const counts = new Map();
  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    for (const c of cwdCandidatesFrom(sp.input)) {
      const key = /^[A-Za-z]:/.test(c) ? c.toLowerCase() : c;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

function deriveTitle(spans) {
  const users = spans
    .filter((s) => s.kind === "user" || s.kind === "input")
    .sort((a, b) => (a.roundIndex || 0) - (b.roundIndex || 0) || (a.turnId || 0) - (b.turnId || 0));
  for (const u of users) {
    const t = normalizeText(u.input);
    if (t) return t.slice(0, TITLE_MAX);
  }
  const answers = spans.filter((s) => s.kind === "answer");
  const last = answers[answers.length - 1];
  const t = normalizeText(last && last.output);
  return t ? t.slice(0, TITLE_MAX) : "";
}

function computeOutcome(spans) {
  if (spans.length === 0) return "";
  const answers = spans
    .filter((s) => s.kind === "answer")
    .sort((a, b) => (a.roundIndex || 0) - (b.roundIndex || 0) || (a.turnId || 0) - (b.turnId || 0));
  if (answers.length === 0) return "failed";
  const last = answers[answers.length - 1];
  const delivered = last.status !== "failed" && normalizeText(last.output).length > 0;
  if (!delivered) return "failed";
  return spans.some((s) => s.status === "failed") ? "partial" : "success";
}

/* --------------------------------- 主流程 --------------------------------- */

(async () => {
  console.log(APPLY ? "== 回填模式（会写库）==" : "== DRY-RUN（只打印，不写库；加 --apply 执行）==");

  const agents = await prisma.agent.findMany({ select: { id: true, name: true, framework: true } });
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByName = new Map(agents.map((a) => [a.name, a]));

  const sessions = await prisma.session.findMany({
    select: {
      id: true, agentId: true, projectId: true, title: true, outcome: true, status: true,
      totalSpans: true, startTime: true, project: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const spans = await prisma.span.findMany({
    select: { sessionId: true, kind: true, status: true, roundIndex: true, turnId: true, input: true, output: true },
  });
  const spansBySession = new Map();
  for (const sp of spans) {
    let arr = spansBySession.get(sp.sessionId);
    if (!arr) spansBySession.set(sp.sessionId, (arr = []));
    arr.push(sp);
  }

  // Agent 拆分目标：按 projectId 分组推导名字（同一 cwd 的会话必然同 projectId）
  const planByProject = new Map(); // projectId -> { agentName, projectName, sessionIds[] }
  const ops = []; // 待执行的 session 更新
  // Windows 路径大小写不敏感：ChatWithLongCat / chatwithlongcat 必须归一到同一个 Agent
  const nameVariants = new Map(); // lower -> 首次出现的原样写法

  const canonicalName = (raw) => {
    const key = raw.toLowerCase();
    if (!nameVariants.has(key)) nameVariants.set(key, raw);
    return nameVariants.get(key);
  };

  for (const s of sessions) {
    const list = spansBySession.get(s.id) || [];
    const curAgent = agentById.get(s.agentId);
    const isFallback = curAgent && curAgent.name === FALLBACK_AGENT_NAME;

    const ws = list.length > 0 ? deriveWorkspace(list) : null;
    const wsName = ws ? canonicalName(projectNameOf(ws)) : "";

    // 只有挂在框架名兜底记录上的会话才允许被拆分，避免动到人工维护的 Agent
    const nextAgentName = isFallback && wsName ? wsName : curAgent ? curAgent.name : FALLBACK_AGENT_NAME;

    const nextTitle = s.title || deriveTitle(list);
    const nextOutcome = computeOutcome(list);
    const nextStatus =
      nextOutcome === "failed" ? "error" : nextOutcome === "" ? s.status : "completed";

    const nextProjectName =
      s.project && s.project.name === s.projectId && wsName ? wsName : s.project ? s.project.name : s.projectId;

    const changed =
      nextAgentName !== (curAgent ? curAgent.name : "") ||
      nextTitle !== s.title ||
      nextOutcome !== s.outcome ||
      nextStatus !== s.status ||
      nextProjectName !== (s.project ? s.project.name : "");

    if (!changed) continue;

    if (isFallback && wsName) {
      let entry = planByProject.get(s.projectId);
      if (!entry) planByProject.set(s.projectId, (entry = { agentName: wsName, projectName: nextProjectName, sessionIds: [] }));
      entry.sessionIds.push(s.id);
    }
    ops.push({
      id: s.id, curAgent: curAgent ? curAgent.name : "(无)",
      nextAgentName, nextTitle, prevTitle: s.title,
      nextOutcome, prevOutcome: s.outcome,
      nextStatus, prevStatus: s.status,
      nextProjectName, prevProjectName: s.project ? s.project.name : "",
      nextAgentId: null,
    });
  }

  /* ---- 汇总打印 ---- */
  const agentSplits = new Map();
  for (const op of ops) {
    if (op.nextAgentName !== op.curAgent) {
      const k = `${op.curAgent} → ${op.nextAgentName}`;
      agentSplits.set(k, (agentSplits.get(k) || 0) + 1);
    }
  }
  console.log(`\n[A] Agent 归属变更（${agentSplits.size} 组）`);
  for (const [k, n] of [...agentSplits].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ${n} 个会话`);

  const outcomeShift = { success: 0, partial: 0, failed: 0, "": 0 };
  let outcomeChanged = 0;
  for (const op of ops) {
    if (op.nextOutcome !== op.prevOutcome) {
      outcomeChanged++;
      outcomeShift[op.nextOutcome] = (outcomeShift[op.nextOutcome] || 0) + 1;
    }
  }
  console.log(`\n[B] 终态重算：${outcomeChanged} 个会话发生变化`);
  console.log(`  变更后分布：success ${outcomeShift.success} / partial ${outcomeShift.partial} / failed ${outcomeShift.failed} / 空 ${outcomeShift[""]}`);

  const titleAdded = ops.filter((o) => !o.prevTitle && o.nextTitle).length;
  console.log(`\n[C] 标题：补出 ${titleAdded} 个会话标题`);
  for (const o of ops.filter((x) => !x.prevTitle && x.nextTitle).slice(0, 8)) {
    console.log(`  ${o.id.slice(0, 8)}  ${o.nextTitle.slice(0, 50)}`);
  }

  const projRenamed = new Set(ops.filter((o) => o.nextProjectName !== o.prevProjectName).map((o) => o.nextProjectName));
  console.log(`\n[D] 项目名：${projRenamed.size} 个可读名（示例 ${[...projRenamed].slice(0, 6).join("、") || "无"}）`);

  console.log(`\n合计待更新 ${ops.length} / ${sessions.length} 个会话`);

  if (!APPLY) {
    console.log("\nDRY-RUN 结束。确认无误后执行：node scripts/backfill-sessions.cjs --apply");
    return;
  }

  /* ---- 落库 ---- */
  let updated = 0;
  const createdAgents = new Map();
  const createdProjects = new Set();

  for (const op of ops) {
    // 1. 需要时创建/复用目标 Agent
    let targetAgent = agentByName.get(op.nextAgentName);
    if (!targetAgent) {
      targetAgent = await prisma.agent.create({
        data: {
          name: op.nextAgentName,
          emoji: "🤖",
          description: "",
          framework: FALLBACK_AGENT_NAME,
          version: "1.0.0",
        },
      });
      agentByName.set(targetAgent.name, targetAgent);
      createdAgents.set(targetAgent.name, targetAgent.id);
    }

    // 2. 会话本身
    await prisma.session.update({
      where: { id: op.id },
      data: {
        agentId: targetAgent.id,
        ...(op.nextTitle ? { title: op.nextTitle } : {}),
        ...(op.nextOutcome ? { outcome: op.nextOutcome } : {}),
        status: op.nextStatus,
      },
    });
    updated++;

    // 3. 项目名（只在还是 hex 名时改）
    if (!createdProjects.has(op.nextProjectName) && op.nextProjectName !== op.prevProjectName) {
      createdProjects.add(op.nextProjectName);
    }
  }

  // 项目名统一刷新：把所有 name===id 且能推导出目录名的项目改名
  for (const [projectId, entry] of planByProject) {
    if (entry.projectName && entry.projectName !== projectId) {
      await prisma.project.update({ where: { id: projectId }, data: { name: entry.projectName } }).catch(() => {});
    }
  }

  // 4. 空的框架名兜底记录清理：迁移后没有任何会话引用时删除，避免看板出现「沉默 Agent」
  const fallback = agentByName.get(FALLBACK_AGENT_NAME);
  let removedAgent = null;
  if (fallback) {
    const left = await prisma.session.count({ where: { agentId: fallback.id } });
    if (left === 0) {
      await prisma.agent.delete({ where: { id: fallback.id } });
      removedAgent = fallback.name;
    }
  }

  console.log(`\n完成：更新 ${updated} 个会话，新建 ${createdAgents.size} 个 Agent` +
    (removedAgent ? `，删除已空的兜底 Agent「${removedAgent}」` : ""));
})().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
