const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  await p.span.deleteMany();
  await p.session.deleteMany();
  await p.project.deleteMany();
  await p.agent.deleteMany();
  await p.user.deleteMany();
  await p.skill.deleteMany();

  // Users
  const user1 = await p.user.create({ data: { name: "Lenovo", org: "PiLabs" } });
  const user2 = await p.user.create({ data: { name: "hfeng", org: "InnoAI" } });
  const user3 = await p.user.create({ data: { name: "wkhao", org: "DevOps Co" } });
  const user4 = await p.user.create({ data: { name: "wzrong", org: "PiLabs" } });
  const user5 = await p.user.create({ data: { name: "ygze", org: "ContentHub" } });

  // Agents
  const agent1 = await p.agent.create({ data: { name: "产品质量审计智能体", emoji: "🔍", description: "产品质量审计专家", framework: "opencode", version: "1.0.0" } });
  const agent2 = await p.agent.create({ data: { name: "通用文档审计智能体", emoji: "📋", description: "通用文档审计专家", framework: "hermes", version: "1.0.0" } });
  const agent3 = await p.agent.create({ data: { name: "Coding Agent -AcoreOS", emoji: "💻", description: "全栈开发专家", framework: "claude-code", version: "2.0.0" } });
  const agent4 = await p.agent.create({ data: { name: "CBB治理智能体", emoji: "🛡️", description: "CBB治理专家", framework: "opencode", version: "1.2.0" } });
  const agent5 = await p.agent.create({ data: { name: "MVP Builder智能体", emoji: "🚀", description: "MVP构建专家", framework: "langgraph", version: "1.0.0" } });
  const agent6 = await p.agent.create({ data: { name: "Simulink建模智能体", emoji: "📐", description: "Simulink建模专家", framework: "opencode", version: "1.1.0" } });
  const agent7 = await p.agent.create({ data: { name: "SpecWeave", emoji: "🧵", description: "规格编织专家", framework: "hermes", version: "1.0.0" } });

  // Projects
  const proj1 = await p.project.create({ data: { name: "客服系统开发", userId: user1.id, agentId: agent3.id } });
  const proj2 = await p.project.create({ data: { name: "数据看板重构", userId: user2.id, agentId: agent1.id } });
  const proj3 = await p.project.create({ data: { name: "K8s 集群运维", userId: user3.id, agentId: agent4.id } });
  const proj4 = await p.project.create({ data: { name: "竞品分析报告", userId: user4.id, agentId: agent2.id } });
  const proj5 = await p.project.create({ data: { name: "支付网关优化", userId: user5.id, agentId: agent5.id } });

  // Session 1: simple Q&A
  const s1 = await p.session.create({ data: { projectId: proj1.id, userId: user1.id, agentId: agent3.id, status: "completed", model: "claude-sonnet-4.5", startTime: new Date(Date.now() - 3600000) } });
  await seedSession(s1.id, [
    { turns: [{ spans: ["system_prompt", "user", "answer"] }] },
    { turns: [{ spans: ["system_prompt", "user", "answer"] }] },
  ]);

  // Session 2: with tools
  const s2 = await p.session.create({ data: { projectId: proj2.id, userId: user2.id, agentId: agent1.id, status: "active", model: "gpt-4o", startTime: new Date(Date.now() - 7200000) } });
  await seedSession(s2.id, [
    { turns: [
      { spans: ["system_prompt", "user", "llm_thinking", "tool_call", "tool_result"] },
      { spans: ["llm_thinking", "answer"] },
    ]},
    { turns: [
      { spans: ["system_prompt", "user", "llm_thinking", "tool_call", "tool_result", "tool_call", "tool_result"] },
      { spans: ["llm_thinking", "answer"] },
    ]},
    { turns: [{ spans: ["system_prompt", "user", "answer"] }] },
  ]);

  // Session 3: with error
  const s3 = await p.session.create({ data: { projectId: proj3.id, userId: user3.id, agentId: agent4.id, status: "error", model: "claude-sonnet-4.5", startTime: new Date(Date.now() - 1800000) } });
  await seedSession(s3.id, [
    { turns: [
      { spans: ["system_prompt", "user", "llm_thinking", "tool_call", "tool_result_failed"] },
      { spans: ["llm_thinking", "tool_call", "tool_result_failed"] },
      { spans: ["answer"] },
    ]},
  ]);

  // Session 4: more data
  const s4 = await p.session.create({ data: { projectId: proj4.id, userId: user4.id, agentId: agent2.id, status: "completed", model: "deepseek-v3", startTime: new Date(Date.now() - 5400000) } });
  await seedSession(s4.id, [
    { turns: [
      { spans: ["system_prompt", "user", "llm_thinking", "tool_call", "tool_result"] },
      { spans: ["llm_thinking", "answer"] },
    ]},
    { turns: [{ spans: ["system_prompt", "user", "answer"] }] },
  ]);

  // Session 5
  const s5 = await p.session.create({ data: { projectId: proj5.id, userId: user5.id, agentId: agent5.id, status: "active", model: "qwen-max", startTime: new Date(Date.now() - 900000) } });
  await seedSession(s5.id, [
    { turns: [
      { spans: ["system_prompt", "user", "llm_thinking", "tool_call", "tool_result", "tool_call", "tool_result"] },
      { spans: ["llm_thinking", "tool_call", "tool_result"] },
      { spans: ["llm_thinking", "answer"] },
    ]},
  ]);

  // Seed Skill Spans (realistic small counts)
  const sessions = [s1, s2, s3, s4, s5];
  const now = Date.now();

  // brainstorming: 2 calls
  {
    const skillMd0 = `---
name: brainstorming
description: "在任何创造性工作之前必须使用此技能——创建功能、构建组件、添加功能或修改行为。在实现之前先探索用户意图、需求和设计。"
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [design, planning]
---

# 头脑风暴：将想法转化为设计

通过自然的协作对话，帮助将想法转化为完整的设计和规格说明。

首先了解当前项目的上下文，然后逐一提问来完善想法。一旦你理解了要构建的内容，就展示设计方案并获得用户批准。

<HARD-GATE>
在你展示设计方案并获得用户批准之前，不要调用任何实现技能、编写任何代码、搭建任何项目或采取任何实现行动。这适用于所有项目，无论看起来多简单。
</HARD-GATE>

## 反模式："这个太简单了，不需要设计"

每个项目都要经过这个流程。一个待办事项列表、一个单函数工具、一个配置变更——全都需要。"简单"的项目恰恰是未经检验的假设造成最多浪费的地方。设计可以很简短（对于真正简单的项目几句话就够了），但你必须展示出来并获得批准。

## 检查清单

你必须为以下每个条目创建任务，并按顺序完成：

1. **探索项目上下文** — 检查文件、文档、最近的 commit
2. **提供视觉伴侣**（如果主题涉及视觉问题）— 这是一条独立的消息，不要与澄清问题合并。参见下方的"视觉伴侣"部分。
3. **提出澄清问题** — 每次一个，了解目的/约束/成功标准
4. **提出 2-3 种方案** — 附带权衡分析和你的推荐
5. **展示设计** — 按复杂度分节展示，每节展示后获得用户批准
6. **编写设计文档** — 保存到 \`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md\` 并 commit
7. **规格自检** — 快速内联检查占位符、矛盾、模糊性、范围（详见下方）
8. **用户审查书面规格** — 在继续之前请用户审查规格文件
9. **过渡到实现** — 调用 writing-plans 技能创建实现计划

## 流程图

\`\`\`dot
digraph brainstorming {
    "探索项目上下文" [shape=box];
    "有视觉相关问题?" [shape=diamond];
    "提供视觉伴侣\\n（独立消息，不含其他内容）" [shape=box];
    "提出澄清问题" [shape=box];
    "提出 2-3 种方案" [shape=box];
    "分节展示设计" [shape=box];
    "用户批准设计?" [shape=diamond];
    "编写设计文档" [shape=box];
    "规格自检\\n（内联修复）" [shape=box];
    "用户审查规格?" [shape=diamond];
    "调用 writing-plans 技能" [shape=doublecircle];

    "探索项目上下文" -> "有视觉相关问题?";
    "有视觉相关问题?" -> "提供视觉伴侣\\n（独立消息，不含其他内容）" [label="是"];
    "有视觉相关问题?" -> "提出澄清问题" [label="否"];
    "提供视觉伴侣\\n（独立消息，不含其他内容）" -> "提出澄清问题";
    "提出澄清问题" -> "提出 2-3 种方案";
    "提出 2-3 种方案" -> "分节展示设计";
    "分节展示设计" -> "用户批准设计?";
    "用户批准设计?" -> "分节展示设计" [label="否，修改"];
    "用户批准设计?" -> "编写设计文档" [label="是"];
    "编写设计文档" -> "规格自检\\n（内联修复）";
    "规格自检\\n（内联修复）" -> "用户审查规格?";
    "用户审查规格?" -> "编写设计文档" [label="要求修改"];
    "用户审查规格?" -> "调用 writing-plans 技能" [label="批准"];
}
\`\`\`

**终止状态是调用 writing-plans。** 不要调用 frontend-design、mcp-builder 或任何其他实现技能。头脑风暴之后你唯一要调用的技能是 writing-plans。

## 流程详述

**理解想法：**

- 首先查看当前项目状态（文件、文档、最近的 commit）
- 在提出详细问题之前，先评估范围：如果需求描述了多个独立子系统（例如"构建一个包含聊天、文件存储、计费和分析的平台"），立即指出这一点。不要花时间用问题去细化一个需要先拆分的项目。
- 如果项目规模过大，单个规格说明无法覆盖，帮助用户分解为子项目：有哪些独立的部分，它们之间有什么关系，应该按什么顺序构建？然后通过正常的设计流程进行第一个子项目的头脑风暴。每个子项目都有自己的规格 → 计划 → 实现周期。
- 对于范围适当的项目，每次提一个问题来完善想法
- 尽量使用选择题，开放式问题也可以
- 每条消息只提一个问题——如果一个主题需要更多探索，拆分成多个问题
- 重点理解：目的、约束、成功标准

**探索方案：**

- 提出 2-3 种不同的方案及其权衡
- 以对话的方式展示选项，附上你的推荐和理由
- 先展示你推荐的方案并解释原因

**展示设计：**

- 一旦你认为理解了要构建的内容，就展示设计
- 每个部分的篇幅与其复杂度匹配：简单的几句话，复杂的最多 200-300 字
- 每个部分展示后询问是否正确
- 涵盖：架构、组件、数据流、错误处理、测试
- 随时准备回头澄清不明确的地方

**面向隔离和清晰的设计：**

- 将系统拆分为更小的单元，每个单元有一个明确的职责，通过定义良好的接口通信，可以独立理解和测试
- 对于每个单元，你应该能回答：它做什么，如何使用，它依赖什么？
- 别人能否不看内部实现就理解一个单元的功能？你能否在不影响调用者的情况下修改内部实现？如果不能，边界需要调整。
- 更小、边界清晰的单元也更便于你工作——你对能一次放入上下文的代码推理得更好，文件越专注你的编辑越可靠。当文件变大时，这通常意味着它承担了过多职责。

**在现有代码库中工作：**

- 在提出更改之前先探索现有结构。遵循现有模式。
- 如果现有代码存在影响当前工作的问题（例如文件过大、边界不清、职责纠缠），在设计中包含有针对性的改进——就像一个优秀的开发者在工作中改进经手的代码一样。
- 不要提议无关的重构。专注于服务当前目标的事情。

## 设计之后

**文档：**

- 将验证通过的设计（规格说明）写入 \`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md\`
  - （用户对规格位置的偏好优先于此默认值）
- 如果可用，使用 elements-of-style:writing-clearly-and-concisely 技能
- 将设计文档 commit 到 git

**规格自检：**
编写规格文档后，以全新的视角审视它：

1. **占位符扫描：** 有没有"待定"、"TODO"、未完成的章节或模糊的需求？修复它们。
2. **内部一致性：** 各章节之间有矛盾吗？架构和功能描述匹配吗？
3. **范围检查：** 这是否聚焦到可以用一个实现计划覆盖，还是需要进一步拆分？
4. **模糊性检查：** 有没有需求可以被两种方式理解？如果有，选择一种并明确写出来。

发现问题就直接内联修复。无需重新审查——修好继续推进。

**用户审查关卡：**
规格自检完成后，请用户在继续之前审查书面规格：

> "规格已编写并 commit 到 \`<path>\`。请审查一下，如果在我们开始编写实现计划之前你想做任何修改，请告诉我。"

等待用户回复。如果他们要求修改，做出修改并重新运行规格自检。只有在用户批准后才继续。

**实现：**

- 调用 writing-plans 技能创建详细的实现计划
- 不要调用任何其他技能。writing-plans 是下一步。

## 核心原则

- **每次一个问题** — 不要同时抛出多个问题
- **优先选择题** — 在可能的情况下比开放式问题更容易回答
- **严格遵循 YAGNI** — 从所有设计中移除不必要的功能
- **探索替代方案** — 在做决定之前始终提出 2-3 种方案
- **增量验证** — 展示设计，获得批准后再继续
- **保持灵活** — 有不明确的地方就回头澄清

## 视觉伴侣

一个基于浏览器的伴侣工具，用于在头脑风暴过程中展示原型、图表和视觉选项。它是一个工具——不是一种模式。接受伴侣意味着它可用于适合视觉呈现的问题；并不意味着每个问题都要通过浏览器。

**提供伴侣：** 当你预计后续问题会涉及视觉内容（原型、布局、图表）时，提供一次以获得同意：
> "我们接下来讨论的一些内容，如果能在浏览器中展示给你看可能会更直观。我可以在讨论过程中为你制作原型、图表、对比图和其他视觉材料。这个功能还比较新，可能会消耗较多 token。要试试吗？（需要打开一个本地 URL）"

**此提议必须是一条独立的消息。** 不要将它与澄清问题、上下文摘要或任何其他内容合并。消息中应该只包含上述提议，没有其他内容。等待用户回复后再继续。如果他们拒绝，继续纯文本的头脑风暴。

**逐问题决策：** 即使用户接受了，也要对每个问题单独决定是使用浏览器还是终端。判断标准：**用户看到它是否比读到它更容易理解？**

- **使用浏览器** 展示本身就是视觉的内容——原型、线框图、布局对比、架构图、并排视觉设计
- **使用终端** 展示文本内容——需求问题、概念选择、权衡列表、A/B/C/D 文字选项、范围决策

关于 UI 主题的问题不一定是视觉问题。"在这个上下文中个性化是什么意思？"是一个概念问题——使用终端。"哪种向导布局更好？"是一个视觉问题——使用浏览器。

如果他们同意使用伴侣，在继续之前阅读详细指南：
\`skills/brainstorming/visual-companion.md\`
`;
    const contentHash0 = "8a1f4629b85b760bc62984a5f418630de04c669bffb705f6f1fcdc65944ec5fd";
    await p.skill.create({ data: { name: "brainstorming", description: "在任何创造性工作之前必须使用此技能——创建功能、构建组件、添加功能或修改行为。在实现之前先探索用户意图、需求和设计。", skillMd: skillMd0, contentHash: contentHash0, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "brainstorming", status: "success", startTime: 100, duration: 1455, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "brainstorming", status: "success", startTime: 100, duration: 1466, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
  }

  // chinese-code-review: 4 calls
  {
    const skillMd1 = `---
name: chinese-code-review
description: 中文 review 沟通参考——话术模板、分级标注（必须修复/建议修改/仅供参考）、国内团队常见反模式应对。仅在用户显式 /chinese-code-review 时调用，不要根据上下文自动触发。
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [code-review, chinese]
---

# 中文代码审查规范

## 概述

国内团队做 Code Review 常遇到两个极端：要么过度客气导致关键问题被放过，要么照搬西方直白风格让同事下不来台。本技能帮你找到平衡点——**既不回避问题，又让人愿意接受反馈**。

**核心原则：** 用"建议"代替"命令"，用"提问"代替"否定"，但绝不因为面子而放过 bug。

## 审查反馈的表达方式

### 用建议代替命令

| 避免（命令式） | 推荐（建议式） |
|---------------|---------------|
| 你必须改成 X | 建议考虑用 X，因为 Y |
| 这里写错了 | 这里可能存在一个问题，是否考虑过 Z 的情况？ |
| 不要用这个方法 | 这个方法在 A 场景下可能有性能问题，可以看看 B 方案 |
| 这段代码不行 | 这段逻辑我理解得对吗？如果输入为空的话会怎样？ |

### 用提问代替否定

当你不确定对方意图时，先问再评：

\`\`\`
# 好的方式
这里用 sync 方式读文件是出于什么考虑？如果并发量上来，可能会阻塞事件循环。

# 不好的方式
这里不应该用 sync 方式读文件。
\`\`\`

### 分级标注

统一使用优先级标记，让作者快速判断轻重缓急：

- **[必须修复]** — 安全漏洞、数据丢失风险、逻辑错误（不修不能合）
- **[建议修改]** — 性能问题、可维护性、缺少校验（本次或下次迭代修复）
- **[仅供参考]** — 命名优化、风格建议、替代方案（不改也行）
- **[问题]** — 不确定的地方，需要作者解释意图

### 审查评论模板

\`\`\`
[必须修复] SQL 注入风险

第 42 行：用户输入直接拼接到 SQL 语句中。

原因：攻击者可以通过 name 参数注入 \`'; DROP TABLE users; --\`。

建议：使用参数化查询：
  db.query('SELECT * FROM users WHERE name = $1', [name])

参考：https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
\`\`\`

## 中英混排代码注释规范

### 何时用中文

- **业务逻辑说明** — 用中文解释业务背景和需求来源
- **复杂算法注释** — 用中文写思路，确保团队成员都能理解
- **TODO / FIXME** — 用中文描述待办事项，方便搜索和追踪
- **文档注释（内部项目）** — JSDoc / Javadoc 中的描述文字用中文

\`\`\`typescript
/**
 * 计算用户的会员等级折扣
 *
 * 业务规则：
 * - 普通会员 9.5 折
 * - 银卡会员 9 折
 * - 金卡会员 8.5 折
 * - 钻石会员 8 折
 *
 * @param level - 会员等级（MemberLevel enum）
 * @param amount - 原始金额（单位：分）
 * @returns 折后金额（单位：分）
 */
function calculateDiscount(level: MemberLevel, amount: number): number {
  // ...
}
\`\`\`

### 何时用英文

- **变量名、函数名、类名** — 始终用英文命名，遵循团队命名规范
- **Git commit message** — 参考下方 commit 规范
- **开源项目注释** — 面向国际社区的项目，注释统一用英文
- **错误信息和日志** — 生产环境的 error message 用英文（避免编码问题）
- **API 接口文档** — 对外暴露的 API 用英文

### 混排格式要求

\`\`\`typescript
// 好：中英文之间加空格
// 使用 Redis 缓存来减少 MySQL 的查询压力

// 坏：中英文之间没有空格
// 使用Redis缓存来减少MySQL的查询压力

// 好：技术术语保留英文
// 这里用 debounce 防抖处理，避免频繁触发 API 请求

// 坏：强行翻译技术术语
// 这里用防抖动处理，避免频繁触发应用程序接口请求
\`\`\`

## Commit Message 中英双语格式

### 推荐格式

团队内部项目使用中文 commit message，采用约定式提交（Conventional Commits）的中文版：

\`\`\`
<类型>(<范围>): <简要描述>

<详细说明（可选）>

<关联信息（可选）>
\`\`\`

### 类型对照表

| 类型 | 含义 | 示例 |
|------|------|------|
| feat | 新功能 | feat(用户): 新增手机号登录功能 |
| fix | 修复 Bug | fix(支付): 修复微信支付回调重复处理的问题 |
| docs | 文档变更 | docs: 更新 API 接口文档 |
| style | 代码格式 | style: 统一缩进为 2 个空格 |
| refactor | 重构 | refactor(订单): 拆分订单服务，提取公共逻辑 |
| perf | 性能优化 | perf(列表): 虚拟滚动优化长列表渲染性能 |
| test | 测试 | test(auth): 补充登录模块单元测试 |
| chore | 构建/工具 | chore: 升级 Node.js 至 v20 |

### 示例

\`\`\`
fix(支付): 修复支付宝异步回调签名校验失败的问题

原因：升级 SDK 后签名算法从 RSA 变为 RSA2，但回调校验仍使用旧算法。
方案：回调处理中同时兼容 RSA 和 RSA2 签名校验。

Closes #1234
\`\`\`

### 面向国际社区的项目

如果项目面向国际社区或有外籍成员，commit message 用英文，PR 描述中可附加中文说明：

\`\`\`
fix(payment): fix Alipay async callback signature verification failure

The SDK upgrade changed the signature algorithm from RSA to RSA2,
but the callback handler still used the old algorithm.

Closes #1234
\`\`\`

## 常见反模式与对策

### 反模式一：过度客气

**表现：** 所有评论都是"我觉得可能也许大概好像这里有个小问题"。

**后果：** 关键 bug 被隐藏在一堆委婉语里，作者根本不知道哪些必须改。

**对策：** 使用分级标注。[必须修复] 就是必须修复，语气可以温和，但级别必须准确。

\`\`\`
# 坏：过度客气
不知道我理解得对不对，这里好像可能有一点点并发问题，不过也许我看错了...

# 好：温和但清晰
[必须修复] 并发安全问题

这里的 map 在多个 goroutine 中同时读写，会触发 panic。
建议加 sync.RWMutex，或者换成 sync.Map。

复现方式：加 -race flag 跑测试就能看到。
\`\`\`

### 反模式二：不敢给高级开发者提意见

**表现：** 高级开发者或 Leader 的代码直接 Approve，不仔细看。

**后果：** 代码质量双标，团队对 Code Review 失去信任。

**对策：** Code Review 对事不对人。可以换个表达方式：

\`\`\`
# 提问式（适合给资深同事的反馈）
想请教一下，这里选择用递归而不是迭代，是出于什么考虑？
我在想如果递归深度超过 1000 层会不会有栈溢出的风险？

# 学习式
学到了一个新写法！不过有个小疑问——这里的类型断言在运行时不会做检查，
如果上游数据结构变了，这里会静默通过。是否考虑加个 runtime validation？
\`\`\`

### 反模式三：审查变成风格之争

**表现：** 大量评论纠结于缩进、空格、花括号位置。

**后果：** 浪费时间，忽略真正的问题。

**对策：** 风格问题交给 ESLint / Prettier / gofmt 等工具自动处理。Code Review 聚焦逻辑、安全、性能。

### 反模式四：只写"LGTM"

**表现：** 随手一个 LGTM 就 Approve，没有实质性审查。

**后果：** Code Review 形同虚设，出了问题没人兜底。

**对策：** 即使代码质量很好，也要写出你关注了哪些方面：

\`\`\`
LGTM

审查了以下方面：
- 并发安全：锁的粒度合理
- 错误处理：所有外部调用都有 error handling
- 向下兼容：新增字段都有默认值，不影响老版本

一个小建议 [仅供参考]：第 78 行的变量名 \`d\` 可以改成 \`duration\`，更易读。
\`\`\`

## 审查流程建议

### 开始审查前

1. **先看 PR 描述**，理解改动的背景和目的
2. **看关联的 Issue 或需求文档**
3. **先整体浏览**，再逐文件细看

### 审查顺序

1. **架构层面** — 方案是否合理？有没有更好的方式？
2. **正确性** — 逻辑对不对？边界条件处理了吗？
3. **安全性** — 有没有注入、越权、信息泄露？
4. **性能** — 有没有 N+1 查询、内存泄漏、不必要的循环？
5. **可维护性** — 半年后能看懂吗？测试覆盖了吗？
6. **风格** — 只关注工具无法自动处理的部分

### 给出总结

审查结束后，给一段总结，包括：
- 整体评价（一句话）
- 值得学习的地方（先扬后抑）
- 主要问题列表（按优先级）
- 建议的修改方向

\`\`\`
总结：整体实现思路清晰，支付回调的幂等处理很到位。

主要问题：
1. [必须修复] 并发写 map 的问题（2 处）
2. [建议修改] 缺少对空值的校验（3 处）
3. [仅供参考] 几个变量命名可以更语义化

建议先修复并发问题，校验的部分可以本次一起改或者拆到下个迭代。
\`\`\`

## 检查清单

在提交审查意见前，确认：

- [ ] 每条评论都标注了优先级
- [ ] [必须修复] 的问题都给出了具体的修复建议
- [ ] 没有因为面子而跳过关键问题
- [ ] 没有纠结于工具能自动处理的风格问题
- [ ] 对好的代码给予了肯定
- [ ] 给出了整体总结
`;
    const contentHash1 = "51326bc6e097ff69251b36335c31c768ba0dc8ca8204d2c81b8a4826ffab0682";
    await p.skill.create({ data: { name: "chinese-code-review", description: "中文 review 沟通参考——话术模板、分级标注（必须修复/建议修改/仅供参考）、国内团队常见反模式应对。仅在用户显式 /chinese-code-revie", skillMd: skillMd1, contentHash: contentHash1, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-code-review", status: "success", startTime: 100, duration: 1239, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-code-review", status: "success", startTime: 100, duration: 447, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-code-review", status: "success", startTime: 100, duration: 1271, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-code-review", status: "success", startTime: 100, duration: 1121, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
  }

  // chinese-commit-conventions: 9 calls
  {
    const skillMd2 = `---
name: chinese-commit-conventions
description: 中文 commit 与 changelog 配置参考——Conventional Commits 中文适配、commitlint/husky/commitizen 中文模板、conventional-changelog 中文配置。仅在用户显式 /chinese-commit-conventions 时调用，不要根据上下文自动触发。
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [git, chinese]
---

# 中文 Git 提交规范

## 1. Conventional Commits 中文适配

基于 Conventional Commits 1.0.0 规范，针对中文团队的实际使用习惯进行适配。

### 类型（type）定义

| 类型       | 说明                         | 示例场景                   |
| ---------- | ---------------------------- | -------------------------- |
| \`feat\`     | 新功能                       | 添加用户注册模块           |
| \`fix\`      | 修复缺陷                     | 修复登录页白屏问题         |
| \`docs\`     | 文档变更                     | 更新 API 接口文档          |
| \`style\`    | 代码格式（不影响逻辑）       | 调整缩进、补充分号         |
| \`refactor\` | 重构（非新功能、非修复）     | 拆分过长的服务类           |
| \`perf\`     | 性能优化                     | 优化首页列表查询速度       |
| \`test\`     | 测试相关                     | 补充用户模块单元测试       |
| \`chore\`    | 构建/工具/依赖变更           | 升级 webpack 到 v5         |
| \`ci\`       | 持续集成配置                 | 修改 GitHub Actions 流程   |
| \`revert\`   | 回滚提交                     | 回滚 v2.1.0 的登录重构     |

### 原则

- type 保留英文关键字（工具链兼容性好）
- scope 和 description 使用中文
- body 使用中文完整描述

## 2. 中文 commit message 模板

\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

### 完整示例

\`\`\`
feat(用户模块): 添加手机号一键登录功能

- 接入运营商一键登录 SDK
- 支持移动、联通、电信三网
- 登录失败自动降级到短信验证码

Closes #128
\`\`\`

\`\`\`
fix(订单): 修复并发下单导致库存超卖的问题

在高并发场景下，原有的库存扣减逻辑存在竞态条件。
改用 Redis 分布式锁 + 数据库乐观锁双重保障。

影响范围：订单服务、库存服务
测试确认：已通过 500 并发压测验证

Closes #256
\`\`\`

## 3. Subject 行规范

### 格式

\`\`\`
<type>(<scope>): <description>
\`\`\`

### 规则

- **type**: 必填，从上方类型表中选取
- **scope**: 选填，表示影响范围，使用中文模块名
  - 示例：\`用户模块\`、\`订单\`、\`支付\`、\`基础组件\`
- **description**: 必填，中文简述，不超过 50 个字符
  - 使用动宾短语：「添加 xxx」「修复 xxx」「优化 xxx」
  - 不加句号结尾
  - 不要写「修改了代码」这种无意义描述

### 好的示例

\`\`\`
feat(权限): 添加基于 RBAC 的细粒度权限控制
fix(支付): 修复微信支付回调签名验证失败的问题
perf(列表页): 优化大数据量表格的虚拟滚动渲染
refactor(网关): 将单体网关拆分为独立微服务
\`\`\`

### 反面示例

\`\`\`
# 以下写法应避免
fix: 修了一个 bug
feat: 更新代码
chore: 改了点东西
\`\`\`

## 4. Body 编写规范

Body 用于详细说明本次变更的动机、方案和影响。

### 编写要点

- 说明**为什么**要做这个改动（背景/原因）
- 说明**怎么做**的（技术方案摘要）
- 说明**影响范围**（哪些模块、接口受影响）
- 每行不超过 72 个字符（中文约 36 个汉字）
- 正文与标题之间空一行

### Body 模板

\`\`\`
<改动背景和原因>

技术方案：
- <方案要点 1>
- <方案要点 2>

影响范围：<受影响的模块或服务>
\`\`\`

## 5. Breaking Changes 标注

当提交包含不兼容变更时，必须在 footer 中标注。

### 格式一：footer 标注

\`\`\`
feat(接口): 重构用户信息返回结构

将用户接口返回的扁平结构改为嵌套结构，前端需同步调整字段取值路径。

BREAKING CHANGE: /api/user/info 返回结构变更
- avatar 字段移入 profile 对象
- 移除已废弃的 nickname 字段，统一使用 displayName
\`\`\`

### 格式二：type 后加感叹号

\`\`\`
feat(接口)!: 重构用户信息返回结构
\`\`\`

### 团队约定

- 涉及数据库表结构变更 -> 必须标注 BREAKING CHANGE
- 涉及公共 API 参数/返回值变更 -> 必须标注
- 涉及配置文件格式变更 -> 必须标注
- 标注时须写明迁移方法或升级步骤

## 6. Issue 关联

### GitHub 格式

\`\`\`
Closes #128
Refs #129, #130
\`\`\`

### Gitee 格式

\`\`\`
Closes #I5ABC1
相关需求: https://gitee.com/org/repo/issues/I5ABC1
\`\`\`

### Coding 格式

\`\`\`
关联 Coding 缺陷 #12345
fixed=project-2024/issues/678
\`\`\`

### 通用写法

\`\`\`
# footer 中关联多个平台
Closes #128
Jira: PROJ-456
禅道: #789
\`\`\`

## 7. Changelog 自动生成配置

### 安装 conventional-changelog

\`\`\`bash
npm install -D conventional-changelog-cli conventional-changelog-conventionalcommits
\`\`\`

### package.json 脚本

\`\`\`json
{
  "scripts": {
    "changelog": "conventional-changelog -p conventionalcommits -i CHANGELOG.md -s",
    "changelog:all": "conventional-changelog -p conventionalcommits -i CHANGELOG.md -s -r 0",
    "release": "standard-version"
  }
}
\`\`\`

### .versionrc.js 中文配置

\`\`\`javascript
module.exports = {
  types: [
    { type: 'feat', section: '新功能' },
    { type: 'fix', section: '缺陷修复' },
    { type: 'perf', section: '性能优化' },
    { type: 'refactor', section: '代码重构' },
    { type: 'docs', section: '文档更新' },
    { type: 'test', section: '测试' },
    { type: 'chore', section: '构建/工具', hidden: true },
    { type: 'ci', section: '持续集成', hidden: true },
    { type: 'style', section: '代码格式', hidden: true }
  ],
  commitUrlFormat: '{{host}}/{{owner}}/{{repository}}/commit/{{hash}}',
  compareUrlFormat: '{{host}}/{{owner}}/{{repository}}/compare/{{previousTag}}...{{currentTag}}'
}
\`\`\`

## 8. commitlint 中文配置

### 安装

\`\`\`bash
npm install -D @commitlint/cli @commitlint/config-conventional
\`\`\`

### commitlint.config.js

\`\`\`javascript
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor',
      'perf', 'test', 'chore', 'ci', 'revert'
    ]],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-max-length': [2, 'always', 100],
    // 允许中文字符，关闭 subject-case 限制
    'subject-case': [0],
    // 关闭 header-max-length 或放宽（中文占宽较大）
    'header-max-length': [2, 'always', 120],
    'body-max-line-length': [1, 'always', 200],
    'footer-max-line-length': [1, 'always', 200]
  },
  prompt: {
    messages: {
      type: '选择提交类型:',
      scope: '输入影响范围（可选）:',
      subject: '填写简短描述:',
      body: '填写详细描述（可选，使用 "|" 换行）:',
      breaking: '列出不兼容变更（可选）:',
      footer: '关联的 Issue（可选，例如 #123）:',
      confirmCommit: '确认提交以上信息？'
    }
  }
}
\`\`\`

## 9. husky + lint-staged 集成

### 安装与初始化

\`\`\`bash
npm install -D husky lint-staged
npx husky init
\`\`\`

### 配置 commit-msg 钩子

\`\`\`bash
# .husky/commit-msg
npx --no -- commitlint --edit "$1"
\`\`\`

### 配置 pre-commit 钩子

\`\`\`bash
# .husky/pre-commit
npx lint-staged
\`\`\`

### lint-staged 配置（package.json）

\`\`\`json
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx,vue}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,scss,less}": [
      "stylelint --fix",
      "prettier --write"
    ],
    "*.md": [
      "prettier --write"
    ]
  }
}
\`\`\`

### 交互式提交（可选）

\`\`\`bash
npm install -D commitizen cz-conventional-changelog

# package.json 中添加
{
  "config": {
    "commitizen": {
      "path": "cz-conventional-changelog"
    }
  },
  "scripts": {
    "commit": "cz"
  }
}
\`\`\`

运行 \`npm run commit\` 即可进入交互式提交引导。

## 10. 团队规范检查清单

### 提交前自查

- [ ] type 是否正确选择（feat/fix/docs/...）
- [ ] scope 是否准确描述了影响模块
- [ ] subject 是否为动宾短语且不超过 50 字符
- [ ] subject 末尾是否去掉了句号
- [ ] body 是否说明了变更原因和方案
- [ ] 不兼容变更是否标注了 BREAKING CHANGE
- [ ] 相关 Issue 是否已关联
- [ ] 一次提交是否只做了一件事（原子性）

### 团队落地步骤

1. **工具链配置**：按上述步骤配置 commitlint + husky，让规范可执行
2. **模板共享**：将 \`.commitlintrc\`、\`.husky/\` 等配置提交到仓库
3. **团队培训**：组织 15 分钟的规范说明会，演示工具使用
4. **Code Review**：Review 时关注 commit message 质量
5. **持续迭代**：每季度回顾规范执行情况，根据团队反馈调整

### 常见问题

**Q: 中英文混排时空格怎么处理？**
A: 中文与英文/数字之间加一个空格，如「添加 Redis 缓存」。

**Q: scope 用中文还是英文？**
A: 团队内统一即可。推荐中文（可读性好），但需在 commitlint 中关闭 scope-case 检查。

**Q: 多人协作时如何保证规范一致？**
A: 靠工具而非靠自觉。配置好 husky + commitlint，不符合规范的提交会被拦截。
`;
    const contentHash2 = "64dad78d77bb872394322f79b580078eea1739bed01111894ffffbfdec492e4f";
    await p.skill.create({ data: { name: "chinese-commit-conventions", description: "中文 commit 与 changelog 配置参考——Conventional Commits 中文适配、commitlint/husky/commitize", skillMd: skillMd2, contentHash: contentHash2, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 1761, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 475, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 1612, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 1329, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 1662, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 1043, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 970, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 617, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-commit-conventions", status: "success", startTime: 100, duration: 870, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // chinese-documentation: 8 calls
  {
    const skillMd3 = `---
name: chinese-documentation
description: 中文文档排版参考——中英文空格、全半角标点、术语保留、链接格式、中文文案排版指北约定。仅在用户显式 /chinese-documentation 时调用，不要根据上下文自动触发。
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [documentation, chinese]
---

# 中文技术文档写作规范

## 概述

中文技术文档最常见的问题不是内容不够，而是**读起来别扭**——中英文挤在一起没有空格、全角半角混用、一股机翻味。本技能提供一套完整的中文技术文档写作规范，让你的文档**专业、好读、不出戏**。

**核心原则：** 排版服务于阅读体验，规范服务于一致性，内容服务于读者。

**参考标准：** [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines)

## 中文排版规范

### 空格

**中英文之间加空格：**

\`\`\`
# 好
使用 Git 进行版本管理，配合 Jenkins 实现持续集成。

# 坏
使用Git进行版本管理，配合Jenkins实现持续集成。
\`\`\`

**中文与数字之间加空格：**

\`\`\`
# 好
本次更新包含 3 个新功能和 12 个 Bug 修复。

# 坏
本次更新包含3个新功能和12个Bug修复。
\`\`\`

**数字与单位之间加空格：**

\`\`\`
# 好
文件大小不超过 5 MB，响应时间控制在 200 ms 以内。

# 坏
文件大小不超过5MB，响应时间控制在200ms以内。
\`\`\`

**例外：度数、百分比等不加空格：**

\`\`\`
# 好
今天气温 32°C，CPU 使用率 95%。

# 坏
今天气温 32 °C，CPU 使用率 95 %。
\`\`\`

**链接前后加空格：**

\`\`\`
# 好
请参考 [官方文档](https://example.com) 获取更多信息。

# 坏
请参考[官方文档](https://example.com)获取更多信息。
\`\`\`

### 标点符号

**中文语境使用全角标点：**

\`\`\`
# 好
注意：该接口需要鉴权，请先获取 Token。

# 坏
注意:该接口需要鉴权,请先获取 Token.
\`\`\`

**全角标点与英文/数字之间不加空格：**

\`\`\`
# 好
项目使用 MIT 协议，详见 LICENSE 文件。

# 坏
项目使用 MIT 协议 ，详见 LICENSE 文件 。
\`\`\`

**括号的使用：**

\`\`\`
# 中文语境用全角括号
请运行安装命令（详见下方说明）。

# 括号内有英文或数字时用半角括号
该项目基于 Spring Boot (v3.2.0) 开发。

# 纯英文内容用半角括号
See the documentation (README.md) for details.
\`\`\`

**引号的使用：**

\`\`\`
# 中文使用直角引号（推荐）
「确定」按钮触发表单提交，「取消」按钮关闭弹窗。

# 也可以使用弯引号（视团队规范而定）
"确定"按钮触发表单提交，"取消"按钮关闭弹窗。

# 嵌套引号
他说：「请点击『确定』按钮。」
\`\`\`

### 数字

\`\`\`
# 阿拉伯数字（技术文档中统一使用半角数字）
支持最多 100 个并发连接。

# 不要用中文数字写技术参数
# 坏：支持最多一百个并发连接。

# 数字使用半角字符
版本号 v2.1.0，端口号 8080，HTTP 状态码 200。
\`\`\`

## 中英混排最佳实践

### 术语处理原则

**保留英文的情况：**

- 专有名词：React、Kubernetes、Redis、MySQL
- 行业通用缩写：API、SDK、CLI、ORM、CI/CD
- 命令和代码：\`npm install\`、\`git commit\`
- 协议和标准：HTTP、TCP/IP、JSON、REST
- 没有公认中文翻译的术语：debounce、throttle、middleware

**翻译为中文的情况：**

- 有公认翻译的通用概念：数据库、服务器、浏览器、框架
- 描述性短语：version control → 版本控制，load balancing → 负载均衡
- 文档标题和章节名（尽量中文，技术名词可保留英文）

### 首次出现标注翻译

技术术语首次出现时，标注中英对照：

\`\`\`
# 好
本系统采用消息队列（Message Queue）实现异步通信，
使用死信队列（Dead Letter Queue）处理消费失败的消息。

# 后续出现直接使用
消息队列的消费者需要实现幂等性……
\`\`\`

### 避免过度翻译

\`\`\`
# 好：保留业界通用英文术语
在 Controller 层做参数校验，Service 层处理业务逻辑。

# 坏：强行翻译反而看不懂
在控制器层做参数校验，服务层处理业务逻辑。

# 好
使用 Redis 做 Session 缓存。

# 坏
使用"远程字典服务"做"会话"缓存。
\`\`\`

## API 文档中英对照格式

### 接口文档模板

\`\`\`markdown
## 创建订单 / Create Order

### 基本信息

- **请求方式 (Method):** POST
- **请求路径 (Path):** \`/api/v1/orders\`
- **鉴权方式 (Auth):** Bearer Token
- **Content-Type:** application/json

### 请求参数 (Request Parameters)

| 参数名 (Field) | 类型 (Type) | 必填 (Required) | 说明 (Description) |
|----------------|-------------|-----------------|-------------------|
| product_id | string | 是 | 商品 ID (Product ID) |
| quantity | integer | 是 | 购买数量 (Quantity)，最小值为 1 |
| address_id | string | 是 | 收货地址 ID (Shipping address ID) |
| coupon_code | string | 否 | 优惠券码 (Coupon code) |

### 请求示例 (Request Example)

\\\`\`\`json
{
  "product_id": "prod_abc123",
  "quantity": 2,
  "address_id": "addr_xyz789",
  "coupon_code": "SUMMER2024"
}
\\\`\`\`

### 响应参数 (Response Parameters)

| 参数名 (Field) | 类型 (Type) | 说明 (Description) |
|----------------|-------------|-------------------|
| order_id | string | 订单 ID (Order ID) |
| status | string | 订单状态 (Order status): pending / paid / shipped |
| total_amount | integer | 订单总金额，单位：分 (Total amount in cents) |
| created_at | string | 创建时间 (Created at)，ISO 8601 格式 |

### 响应示例 (Response Example)

\\\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": {
    "order_id": "ord_20240315001",
    "status": "pending",
    "total_amount": 9900,
    "created_at": "2024-03-15T10:30:00+08:00"
  }
}
\\\`\`\`

### 错误码 (Error Codes)

| 错误码 (Code) | 说明 (Description) | 处理建议 (Suggestion) |
|---------------|--------------------|--------------------|
| 40001 | 商品不存在 (Product not found) | 检查 product_id 是否正确 |
| 40002 | 库存不足 (Insufficient stock) | 减少购买数量或稍后重试 |
| 40003 | 优惠券已过期 (Coupon expired) | 移除 coupon_code 或更换优惠券 |
\`\`\`

### 金额表示约定

\`\`\`
# 好：明确说明单位
total_amount: 9900  // 单位：分（即 99.00 元）

# 坏：不说明单位，造成歧义
total_amount: 99.00  // 是元还是分？浮点数会有精度问题
\`\`\`

## README.md 中文模板

国内开源项目常用的 README 结构：

\`\`\`markdown
# 项目名称

[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()

简短一句话介绍项目是什么、解决什么问题。

## 特性

- 特性一：简要描述
- 特性二：简要描述
- 特性三：简要描述

## 快速开始

### 环境要求

- Node.js >= 20
- MySQL >= 8.0

### 安装

\\\`\`\`bash
npm install your-package
\\\`\`\`

### 基本用法

\\\`\`\`typescript
import { YourPackage } from 'your-package';

const client = new YourPackage({ apiKey: 'your-key' });
const result = await client.doSomething();
\\\`\`\`

## 文档

- [使用指南](./docs/guide.md)
- [API 参考](./docs/api.md)
- [常见问题](./docs/faq.md)
- [更新日志](./CHANGELOG.md)

## 示例

更多示例请查看 [examples](./examples) 目录。

## 贡献指南

欢迎提交 Issue 和 Pull Request。请先阅读 [贡献指南](./CONTRIBUTING.md)。

### 本地开发

\\\`\`\`bash
# 克隆项目
git clone https://gitee.com/your-org/your-project.git

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm test
\\\`\`\`

## 致谢

- [依赖项目一](https://example.com) — 简要说明
- [依赖项目二](https://example.com) — 简要说明

## 许可证

[MIT](./LICENSE)
\`\`\`

## 常见问题与避坑指南

### 问题一：机翻味

**特征：** 句式生硬、不符合中文表达习惯。

\`\`\`
# 机翻味
这个函数被用来计算用户的折扣。如果你想要获取更多信息，请参考文档。

# 自然中文
这个函数用于计算用户折扣。更多信息请参考文档。
\`\`\`

**要点：**
- 避免被动语态（"被用来" → "用于"）
- 避免冗余代词（"你想要" → 直接说）
- 避免直译英文句式

### 问题二：句式欧化

**特征：** 长定语、多重从句、一句话说不完。

\`\`\`
# 欧化句式
这是一个可以帮助开发者在不需要手动配置复杂的构建工具链的情况下
快速搭建现代化前端项目的脚手架工具。

# 正常中文
这是一个前端脚手架工具，帮助开发者快速搭建项目，免去手动配置构建工具链的麻烦。
\`\`\`

**要点：**
- 长句拆成短句
- 把定语从句改成并列句
- 一句话只说一件事

### 问题三：过度翻译

\`\`\`
# 过度翻译
请打开您的"终端模拟器"，运行"节点包管理器"的安装命令。

# 正常写法
请打开终端，运行 npm install。
\`\`\`

### 问题四：中英标点混用

\`\`\`
# 坏：中文句子用了英文逗号和句号
请先安装依赖,然后运行测试.

# 好：中文句子用全角标点
请先安装依赖，然后运行测试。

# 坏：英文内容用了中文标点
Run \`npm install\`，then \`npm test\`。

# 好：英文内容用半角标点
Run \`npm install\`, then \`npm test\`.
\`\`\`

### 问题五：缺乏结构化

\`\`\`
# 坏：一大段文字没有分段
本系统使用 Redis 做缓存提高查询性能同时使用 MySQL 做持久化存储
数据写入时先写 MySQL 再异步更新 Redis 缓存读取时先查 Redis 如果
未命中再查 MySQL 并将结果回写缓存设置过期时间为 30 分钟……

# 好：用列表和分段组织信息
本系统的缓存策略如下：

- **存储层：** MySQL（持久化）+ Redis（缓存）
- **写入流程：** 先写 MySQL，再异步更新 Redis
- **读取流程：** 先查 Redis → 未命中则查 MySQL → 回写 Redis
- **缓存过期：** TTL 设为 30 分钟
\`\`\`

## 写作检查清单

在发布文档前，逐项检查：

### 排版

- [ ] 中英文之间有空格
- [ ] 中文与数字之间有空格
- [ ] 中文语境使用全角标点
- [ ] 英文/代码部分使用半角标点
- [ ] 没有全角半角标点混用

### 术语

- [ ] 专有名词保留英文原文
- [ ] 首次出现的术语标注了中英对照
- [ ] 没有过度翻译业界通用术语
- [ ] 术语使用前后一致

### 内容

- [ ] 句子简短，没有欧化长句
- [ ] 没有不必要的被动语态
- [ ] 用列表和表格组织结构化信息
- [ ] 代码示例可以直接运行
- [ ] 没有"机翻味"

### 格式

- [ ] 标题层级正确（不跳级）
- [ ] 代码块标注了语言类型
- [ ] 链接可以正常访问
- [ ] 图片有 alt 文本
`;
    const contentHash3 = "58323397177b6343bd3234f9e4acd8891d58f08cf8076b26fd98296308203a0a";
    await p.skill.create({ data: { name: "chinese-documentation", description: "中文文档排版参考——中英文空格、全半角标点、术语保留、链接格式、中文文案排版指北约定。仅在用户显式 /chinese-documentation 时调用，不要根", skillMd: skillMd3, contentHash: contentHash3, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1278, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1543, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1077, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 353, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1542, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1270, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 1395, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-documentation", status: "success", startTime: 100, duration: 369, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
  }

  // chinese-git-workflow: 8 calls
  {
    const skillMd4 = `---
name: chinese-git-workflow
description: 国内 Git 平台配置参考——Gitee、Coding.net、极狐 GitLab、CNB 的 SSH/HTTPS/凭据/CI 接入差异与镜像同步配置。仅在用户显式 /chinese-git-workflow 时调用，不要根据上下文自动触发。
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [git, chinese]
---

# 国内 Git 工作流规范

## 概述

国内团队用 Git 经常踩的坑：GitHub 访问不稳定、CI/CD 方案照搬国外水土不服、commit message 中英混杂没有规范。本技能提供一套**完整适配国内平台和团队习惯的 Git 工作流**。

**核心原则：** 工作流服务于团队效率，不是为了流程而流程。选适合团队规模的，别硬套大厂方案。

## 国内 Git 平台适配

### 平台对比

| 特性 | Gitee | Coding.net | 极狐 GitLab | CNB | GitHub |
|------|-------|------------|-------------|-----|--------|
| 国内访问 | 快 | 快 | 快 | 快 | 不稳定 |
| 免费私有仓库 | 有 | 有 | 有 | 有 | 有 |
| CI/CD | Gitee Go | Coding CI | 内置 GitLab CI | 内置（.cnb.yml） | GitHub Actions |
| 代码审查 | PR | MR | MR | MR | PR |
| 制品库 | 有限 | 完整 | 完整 | 完整 | Packages |
| 适合场景 | 开源/小团队 | 中大型团队 | 企业私有化 | 云原生 / Docker 流水线 | 国际项目 |

### Gitee 特有配置

\`\`\`bash
# 设置 Gitee 远程仓库
git remote add origin https://gitee.com/<org>/<repo>.git

# Gitee 的 SSH 配置
# ~/.ssh/config
Host gitee.com
    HostName gitee.com
    User git
    IdentityFile ~/.ssh/gitee_rsa
    PreferredAuthentications publickey

# 同时推送到 Gitee 和 GitHub（镜像同步）
git remote set-url --add --push origin https://gitee.com/<org>/<repo>.git
git remote set-url --add --push origin https://github.com/<org>/<repo>.git
\`\`\`

### Coding.net 特有配置

\`\`\`bash
# Coding 的仓库地址格式
git remote add origin https://e.coding.net/<team>/<project>/<repo>.git

# Coding 支持的 SSH 地址
git remote add origin git@e.coding.net:<team>/<project>/<repo>.git
\`\`\`

### 极狐 GitLab 特有配置

\`\`\`bash
# 极狐 GitLab 私有化部署常见地址格式
git remote add origin https://jihulab.com/<group>/<repo>.git

# 或者企业内部部署
git remote add origin https://gitlab.yourcompany.com/<group>/<repo>.git
\`\`\`

### CNB（Cloud Native Build）特有配置

\`\`\`bash
# CNB 仓库地址（仅支持 HTTPS，不提供 SSH 协议）
git remote add origin https://cnb.cool/<org>/<repo>.git

# HTTPS 认证：用户名固定为 cnb，密码为个人访问令牌（Access Token）
# 在 CNB 平台 → 个人设置 → 访问令牌 中生成
git config credential.helper store
\`\`\`

## 工作流选择

### 方案一：主干开发（Trunk-Based Development）

**适合：** 小团队（2-8 人）、迭代速度快、有完善的自动化测试。

\`\`\`
main ──●──●──●──●──●──●──●──●──●──
        \\   /  \\   /       \\   /
feat/x  ●─●   ●─●    fix/y ●─●
（短命分支，1-2 天内合回）
\`\`\`

**规则：**
- 主干（main）始终保持可发布状态
- 功能分支生命周期不超过 2 天
- 每天至少合并一次到主干
- 用 Feature Flag 控制未完成功能的可见性

\`\`\`bash
# 从 main 拉分支
git checkout -b feat/user-login main

# 开发完成后，rebase 到最新 main
git fetch origin
git rebase origin/main

# 提交 PR/MR，合并后删除分支
\`\`\`

### 方案二：Git Flow（经典分支模型）

**适合：** 中大团队、版本发布节奏固定（如双周迭代）、需要维护多个版本。

\`\`\`
main     ──●────────────────●────────────── 生产环境
            \\              / \\
release     ●──●──●──●──●    ●──●──●──●── 发布分支
            \\              /
develop  ──●──●──●──●──●──●──●──●──●──●── 开发主线
             \\   /  \\       /
feat/x       ●─●    ●─────●               功能分支
                      \\   /
                  fix/y ●─●                修复分支
\`\`\`

**分支说明：**
- \`main\` — 生产环境代码，只接受 release 和 hotfix 的合并
- \`develop\` — 开发主线，功能分支从这里拉出，合回这里
- \`release/*\` — 发布分支，从 develop 拉出，只修 bug 不加功能
- \`feat/*\` — 功能分支
- \`hotfix/*\` — 紧急修复，从 main 拉出，同时合回 main 和 develop

### 方案三：国内团队常用简化流程

**适合：** 大多数国内中小团队的实际情况。

\`\`\`
main     ──●──────●──────●──── 生产环境（受保护）
            \\    / \\    /
dev      ──●──●─●──●──●─●──── 开发/测试环境
             \\  /    \\  /
feat/x       ●●      ●●       功能分支
\`\`\`

**规则：**
- \`main\` 分支受保护，只能通过 PR/MR 合并
- \`dev\` 分支对应测试环境，自动部署
- 功能分支从 \`dev\` 拉出，合回 \`dev\`
- \`dev\` 测试通过后，合并到 \`main\` 进行发布

## 分支命名规范

### 国内团队常用命名

\`\`\`bash
# 功能分支
feat/user-login              # 新功能
feat/JIRA-1234-order-refund  # 关联任务编号

# 修复分支
fix/payment-callback         # Bug 修复
fix/JIRA-5678-null-pointer   # 关联 Bug 编号

# 发布分支
release/v2.1.0               # 版本发布
release/2024-03-sprint       # 按迭代命名

# 紧急修复
hotfix/v2.0.1                # 线上紧急修复
hotfix/fix-login-crash       # 描述性命名

# 个人分支（部分团队使用）
dev/zhangsan/feat-login      # 个人开发分支
\`\`\`

### 命名规则

1. 全部小写，用 \`-\` 连接单词（不用下划线或驼峰）
2. 前缀明确分支类型：\`feat/\`、\`fix/\`、\`hotfix/\`、\`release/\`
3. 关联任务管理平台的编号（如有）：\`feat/TAPD-12345-description\`
4. 长度适中，能看出分支目的即可

## 中文 Commit Message 规范

### 约定式提交（Conventional Commits）中文版

\`\`\`
<类型>(<范围>): <简要描述>
                                    ← 空行
<正文（可选）>
                                    ← 空行
<脚注（可选）>
\`\`\`

### 类型清单

| 类型 | 说明 | emoji（可选） |
|------|------|--------------|
| feat | 新增功能 | ✨ |
| fix | 修复 Bug | 🐛 |
| docs | 文档更新 | 📝 |
| style | 代码格式（不影响逻辑） | 💄 |
| refactor | 重构（不是新功能也不是修 Bug） | ♻️ |
| perf | 性能优化 | ⚡ |
| test | 测试相关 | ✅ |
| build | 构建系统或外部依赖 | 📦 |
| ci | CI/CD 配置 | 👷 |
| chore | 其他杂项 | 🔧 |
| revert | 回滚 | ⏪ |

### 好的 commit message

\`\`\`
feat(购物车): 支持批量删除商品

- 新增全选/反选功能
- 删除操作增加二次确认弹窗
- 批量删除接口使用 POST /cart/batch-delete

关联需求：TAPD-12345
\`\`\`

\`\`\`
fix(支付): 修复微信支付在 iOS 16 上无法唤起的问题

原因：微信 SDK 8.0.33 版本在 iOS 16 上 Universal Links 校验逻辑变更，
导致 openURL 回调失败。

方案：升级 SDK 至 8.0.38，并更新 Associated Domains 配置。

Closes #567
\`\`\`

### 不好的 commit message

\`\`\`
# 太笼统
update code
fix bug
修改了一些东西

# 没有上下文
fix: 修复问题
feat: 新增功能

# 中英混杂无规范
fix：修复了一个bug，因为user login的时候会crash
\`\`\`

## CI/CD 平台适配

### Gitee Go

\`\`\`yaml
# .gitee/pipelines/pipeline.yml
name: 构建与测试
displayName: '构建与测试流水线'

triggers:
  push:
    branches:
      include:
        - main
        - dev

stages:
  - name: 测试
    jobs:
      - name: 单元测试
        steps:
          - step: npmbuild@1
            name: install_and_test
            displayName: '安装依赖并执行测试'
            inputs:
              nodeVersion: 20
              commands:
                - npm ci
                - npm test
\`\`\`

### Coding CI

\`\`\`groovy
// Jenkinsfile（Coding CI 支持 Jenkinsfile 语法）
pipeline {
    agent any

    stages {
        stage('安装依赖') {
            steps {
                sh 'npm ci'
            }
        }

        stage('单元测试') {
            steps {
                sh 'npm test'
            }
        }

        stage('构建') {
            steps {
                sh 'npm run build'
            }
        }

        stage('部署到测试环境') {
            when {
                branch 'dev'
            }
            steps {
                sh './scripts/deploy-staging.sh'
            }
        }

        stage('部署到生产环境') {
            when {
                branch 'main'
            }
            steps {
                sh './scripts/deploy-production.sh'
            }
        }
    }

    post {
        failure {
            // 企业微信/钉钉通知
            sh './scripts/notify-failure.sh'
        }
    }
}
\`\`\`

### 极狐 GitLab CI

\`\`\`yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - deploy

variables:
  NODE_IMAGE: node:20-alpine
  # 使用国内镜像加速
  NPM_REGISTRY: https://registry.npmmirror.com

单元测试:
  stage: test
  image: $NODE_IMAGE
  script:
    - npm config set registry $NPM_REGISTRY
    - npm ci
    - npm test
  coverage: '/Lines\\s*:\\s*(\\d+\\.?\\d*)%/'

构建:
  stage: build
  image: $NODE_IMAGE
  script:
    - npm config set registry $NPM_REGISTRY
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/

部署测试环境:
  stage: deploy
  script:
    - ./scripts/deploy-staging.sh
  only:
    - dev
  environment:
    name: staging

部署生产环境:
  stage: deploy
  script:
    - ./scripts/deploy-production.sh
  only:
    - main
  environment:
    name: production
  when: manual  # 生产环境手动触发
\`\`\`

### CNB（Cloud Native Build）

\`\`\`yaml
# .cnb.yml — branch-first 结构，直接指定 Docker 镜像跑流水线
main:
  push:
    - docker:
        image: node:20
      stages:
        - npm ci
        - npm test
        - npm run build
  pull_request:
    - docker:
        image: node:20
      stages:
        - npm run lint
        - npm test
\`\`\`

**特点：**
- 每个流水线独立指定 Docker 镜像，天然云原生
- 支持 \`push\` / \`pull_request\` 触发
- 同一事件可并行多条流水线
- \`stages\` 也支持 \`- name: xxx\` + \`script:\` 的展开形式，复杂场景见官方文档

### GitHub Actions 国内替代方案对照

| GitHub Actions 功能 | Gitee Go | Coding CI | 极狐 GitLab CI | CNB |
|---------------------|----------|-----------|----------------|-----|
| 触发条件 | triggers | Jenkinsfile triggers | only/rules | push / pull_request |
| 缓存依赖 | cache step | stash/unstash | cache | 见官方文档 |
| 制品存储 | artifacts | 制品库 | artifacts | 见官方文档 |
| 环境变量 | env | environment | variables | env |
| 密钥管理 | 环境变量配置 | 凭据管理 | CI/CD Variables | Access Token |
| 手动触发 | 手动运行 | 手动触发 | when: manual | 页面手动运行 |

## PR/MR 描述模板

### 中文模板

在仓库中创建 PR/MR 模板文件：

**Gitee：** \`.gitee/PULL_REQUEST_TEMPLATE.md\`

**Coding / GitLab：** \`.gitlab/merge_request_templates/default.md\`

\`\`\`markdown
## 变更说明

<!-- 简要描述这次改动做了什么，解决了什么问题 -->

## 变更类型

- [ ] 新功能（feat）
- [ ] Bug 修复（fix）
- [ ] 重构（refactor）
- [ ] 性能优化（perf）
- [ ] 文档更新（docs）
- [ ] 其他：

## 关联信息

- 需求/Bug 链接：
- 设计文档：

## 改动范围

<!-- 列出主要改动的模块和文件 -->

## 测试情况

- [ ] 单元测试通过
- [ ] 手动测试通过
- [ ] 相关模块回归测试通过

## 测试方法

<!-- 描述如何验证这次改动 -->

## 影响范围

<!-- 这次改动可能影响哪些功能？是否需要通知其他团队？ -->

## 部署注意事项

- [ ] 需要执行数据库迁移
- [ ] 需要更新配置文件
- [ ] 需要更新环境变量
- [ ] 无特殊注意事项

## 截图/录屏

<!-- 如果涉及 UI 变更，贴截图或录屏 -->
\`\`\`

## 常用 Git 配置

### 国内环境优化

\`\`\`bash
# 设置用户信息
git config --global user.name "张三"
git config --global user.email "zhangsan@company.com"

# commit message 编辑器设置为 VS Code
git config --global core.editor "code --wait"

# 解决中文文件名显示为转义字符的问题
git config --global core.quotepath false

# 设置默认分支名
git config --global init.defaultBranch main

# 代理设置（如果需要同时使用 GitHub）
git config --global http.https://github.com.proxy socks5://127.0.0.1:7890

# NPM 使用国内镜像
npm config set registry https://registry.npmmirror.com
\`\`\`

### .gitignore 国内项目常见配置

\`\`\`gitignore
# IDE
.idea/
.vscode/
*.swp

# 依赖
node_modules/
vendor/

# 构建产物
dist/
build/
*.exe

# 环境配置
.env
.env.local
.env.*.local

# 系统文件
.DS_Store
Thumbs.db
desktop.ini

# 国内平台特有
.coding/
\`\`\`

## 检查清单

在推送代码前，确认：

- [ ] 分支命名符合团队规范
- [ ] commit message 格式正确，类型和范围准确
- [ ] 关联了对应的需求/Bug 编号
- [ ] PR/MR 描述填写完整
- [ ] CI 流水线通过
- [ ] 已请求相关同事 Review
`;
    const contentHash4 = "e428dc6f0c3883941e15598db5f5d9ec066a3d3528cbbd565d98273aad900aa1";
    await p.skill.create({ data: { name: "chinese-git-workflow", description: "国内 Git 平台配置参考——Gitee、Coding.net、极狐 GitLab、CNB 的 SSH/HTTPS/凭据/CI 接入差异与镜像同步配置。仅在用户", skillMd: skillMd4, contentHash: contentHash4, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 441, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 1714, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 407, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 1632, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 372, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 636, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 656, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "chinese-git-workflow", status: "success", startTime: 100, duration: 1255, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // dispatching-parallel-agents: 3 calls
  {
    const skillMd5 = `---
name: dispatching-parallel-agents
description: 当面对 2 个以上可以独立进行、无共享状态或顺序依赖的任务时使用
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [agents, parallel]
---

# 并行分派智能体

## 概述

你将任务委派给具有隔离上下文的专用智能体。通过精心设计它们的指令和上下文，确保它们专注并成功完成任务。它们不应继承你的会话上下文或历史记录——你要精确构造它们所需的一切。这样也能为你自己保留用于协调工作的上下文。

当你遇到多个不相关的失败（不同的测试文件、不同的子系统、不同的 bug），逐一排查会浪费时间。每个排查都是独立的，可以并行进行。

**核心原则：** 每个独立问题域分派一个智能体，让它们并发工作。

## 何时使用

\`\`\`dot
digraph when_to_use {
    "存在多个失败?" [shape=diamond];
    "它们是否独立?" [shape=diamond];
    "单个智能体排查所有问题" [shape=box];
    "每个问题域一个智能体" [shape=box];
    "能否并行工作?" [shape=diamond];
    "顺序执行智能体" [shape=box];
    "并行分派" [shape=box];

    "存在多个失败?" -> "它们是否独立?" [label="是"];
    "它们是否独立?" -> "单个智能体排查所有问题" [label="否 - 有关联"];
    "它们是否独立?" -> "能否并行工作?" [label="是"];
    "能否并行工作?" -> "并行分派" [label="是"];
    "能否并行工作?" -> "顺序执行智能体" [label="否 - 有共享状态"];
}
\`\`\`

**适用场景：**
- 3 个以上测试文件因不同根因失败
- 多个子系统独立出现故障
- 每个问题无需其他问题的上下文即可理解
- 排查之间无共享状态

**不适用场景：**
- 失败是相关的（修复一个可能修复其他的）
- 需要理解完整的系统状态
- 智能体之间会互相干扰

## 模式

### 1. 识别独立的问题域

按故障分组：
- 文件 A 测试：工具审批流程
- 文件 B 测试：批量完成行为
- 文件 C 测试：中止功能

每个问题域是独立的——修复工具审批不会影响中止测试。

### 2. 创建聚焦的智能体任务

每个智能体获得：
- **明确范围：** 一个测试文件或子系统
- **清晰目标：** 让这些测试通过
- **约束条件：** 不修改其他代码
- **预期输出：** 你发现和修复内容的总结

### 3. 并行分派

\`\`\`typescript
// 在 Claude Code / AI 环境中
Task("修复 agent-tool-abort.test.ts 的失败")
Task("修复 batch-completion-behavior.test.ts 的失败")
Task("修复 tool-approval-race-conditions.test.ts 的失败")
// 三个任务并发运行
\`\`\`

### 4. 审查与集成

当智能体返回时：
- 阅读每个总结
- 验证修复之间没有冲突
- 运行完整测试套件
- 集成所有更改

## 智能体提示词结构

好的智能体提示词应该是：
1. **聚焦的** - 一个清晰的问题域
2. **自包含的** - 包含理解问题所需的所有上下文
3. **明确输出要求** - 智能体应该返回什么？

\`\`\`markdown
修复 src/agents/agent-tool-abort.test.ts 中 3 个失败的测试：

1. "should abort tool with partial output capture" - 期望消息中包含 'interrupted at'
2. "should handle mixed completed and aborted tools" - 快速工具被中止而非完成
3. "should properly track pendingToolCount" - 期望 3 个结果但得到 0 个

这些是时序/竞态条件问题。你的任务：

1. 阅读测试文件，理解每个测试验证的内容
2. 找到根因——是时序问题还是实际 bug？
3. 修复方式：
   - 用基于事件的等待替换任意超时
   - 如果发现中止实现中的 bug 则修复
   - 如果测试的是已变更的行为则调整测试期望

不要只是增加超时时间——找到真正的问题。

返回：你发现了什么以及修复了什么的总结。
\`\`\`

## 常见错误

**错误做法：太宽泛：** "修复所有测试" - 智能体会迷失方向
**正确做法：具体明确：** "修复 agent-tool-abort.test.ts" - 聚焦的范围

**错误做法：无上下文：** "修复竞态条件" - 智能体不知道在哪里
**正确做法：提供上下文：** 粘贴错误信息和测试名称

**错误做法：无约束：** 智能体可能会重构所有代码
**正确做法：设置约束：** "不要修改生产代码" 或 "只修复测试"

**错误做法：模糊的输出要求：** "修好它" - 你不知道改了什么
**正确做法：明确要求：** "返回根因和修改内容的总结"

## 不适用的场景

**关联性失败：** 修复一个可能修复其他的——先一起排查
**需要完整上下文：** 理解问题需要看到整个系统
**探索性调试：** 你还不知道什么坏了
**共享状态：** 智能体会互相干扰（编辑同一文件、使用同一资源）

## 实际案例

**场景：** 大规模重构后，3 个文件中出现 6 个测试失败

**失败情况：**
- agent-tool-abort.test.ts：3 个失败（时序问题）
- batch-completion-behavior.test.ts：2 个失败（工具未执行）
- tool-approval-race-conditions.test.ts：1 个失败（执行计数 = 0）

**决策：** 独立的问题域——中止逻辑、批量完成、竞态条件各自独立

**分派：**
\`\`\`
智能体 1 → 修复 agent-tool-abort.test.ts
智能体 2 → 修复 batch-completion-behavior.test.ts
智能体 3 → 修复 tool-approval-race-conditions.test.ts
\`\`\`

**结果：**
- 智能体 1：用基于事件的等待替换了超时
- 智能体 2：修复了事件结构 bug（threadId 位置不对）
- 智能体 3：添加了等待异步工具执行完成的逻辑

**集成：** 所有修复互相独立，无冲突，完整测试套件全部通过

**节省的时间：** 3 个问题并行解决 vs 顺序解决

## 核心优势

1. **并行化** - 多个排查同时进行
2. **聚焦** - 每个智能体范围窄，需要跟踪的上下文少
3. **独立性** - 智能体之间互不干扰
4. **速度** - 3 个问题在 1 个问题的时间内解决

## 验证

智能体返回后：
1. **审查每个总结** - 理解改了什么
2. **检查冲突** - 智能体是否编辑了同一段代码？
3. **运行完整套件** - 验证所有修复协同工作
4. **抽查** - 智能体可能犯系统性错误

## 实际效果

来自调试会话（2025-10-03）：
- 3 个文件中 6 个失败
- 并行分派 3 个智能体
- 所有排查并发完成
- 所有修复成功集成
- 智能体之间的更改零冲突
`;
    const contentHash5 = "45cad941126196d4f9b98db0dbd45152a63a4306c993d1027db3b56463700b6c";
    await p.skill.create({ data: { name: "dispatching-parallel-agents", description: "当面对 2 个以上可以独立进行、无共享状态或顺序依赖的任务时使用", skillMd: skillMd5, contentHash: contentHash5, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "dispatching-parallel-agents", status: "success", startTime: 100, duration: 680, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "dispatching-parallel-agents", status: "success", startTime: 100, duration: 600, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "dispatching-parallel-agents", status: "success", startTime: 100, duration: 1616, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
  }

  // executing-plans: 9 calls
  {
    const skillMd6 = `---
name: executing-plans
description: 当你有一份书面实现计划需要在单独的会话中执行，并设有审查检查点时使用
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [execution, planning]
---

# 执行计划

## 概述

加载计划，批判性审查，执行所有任务，完成后报告。

**开始时宣布：** "我正在使用 executing-plans 技能来实现此计划。"

**注意：** 告诉你的人类伙伴，Superpowers 在有子代理支持时效果好得多。如果在支持子代理的平台上运行（如 Claude Code 或 Codex），其工作质量会显著提高。如果子代理可用，请使用 superpowers:subagent-driven-development 而非此技能。

## 流程

### 步骤 1：加载并审查计划

1. 读取计划文件
2. 批判性审查——识别计划中的任何问题或疑虑
3. 如果有疑虑：在开始之前向你的人类伙伴提出
4. 如果没有疑虑：创建 TodoWrite 并继续

**审查时重点检查：**
- 步骤之间是否有依赖遗漏？（A 依赖 B，但 B 排在 A 之后）
- 验证条件是否明确？（"确认可用"不算，"运行 \`npm test\` 全部通过"才算）
- 是否有隐含的环境假设？（Node 版本、数据库连接、API Key）

**审查示例：**
\`\`\`
计划文件：docs/plan.md
任务清单：5 个任务

审查发现：
- 任务 3（添加数据库迁移）应在任务 2（编写数据模型）之后，顺序正确 ✓
- 任务 4 的验证条件写的是"确认功能正常"→ 需澄清：具体跑什么测试？
- 计划未提及 Python 版本要求 → 需确认

向伙伴提出：
"计划整体可执行。有两个问题：(1) 任务 4 的验证条件不够具体，建议改为
'运行 pytest tests/test_api.py 全部通过'；(2) 需要确认 Python 版本要求。"
\`\`\`

### 步骤 2：执行任务

对于每个任务：

1. **标记为进行中** — 更新 TodoWrite
2. **理解目标** — 重读任务描述，明确完成标准
3. **执行实现** — 严格按照计划步骤执行（计划已有小步骤）
4. **运行验证** — 按要求运行测试或检查
5. **提交变更** — 每完成一个任务提交一次，commit message 引用任务编号
6. **标记为已完成** — 更新 TodoWrite

**每个任务的节奏：**
\`\`\`
--- 任务 2/5：添加用户验证 ---
[标记进行中]

目标：为 /api/users 添加输入验证
完成标准：所有验证测试通过，无效输入返回 400

[实现]
- 添加 validateUser() 中间件
- 编写 3 个验证规则（email 格式、密码强度、用户名长度）

[验证]
$ npm test -- --grep "validation"
  ✓ 拒绝无效 email (12ms)
  ✓ 拒绝弱密码 (8ms)
  ✓ 拒绝过长用户名 (5ms)
  3 passing

[提交]
$ git add src/middleware/validate.js tests/validation.test.js
$ git commit -m "feat: 添加用户输入验证（任务 2/5）"

[标记完成]
--- 任务 2/5 完成 ---
\`\`\`

**持续自查：**
- 执行过程中持续留意：整体方向还对吗？有没有偏离计划？
- 如果发现前面的实现有问题，先修复再继续，不要带着问题往下走

### 步骤 3：处理常见异常

**测试失败：**
1. 读错误信息，定位失败原因
2. 区分：是实现 bug？还是测试本身有问题？还是计划描述有误？
3. 实现 bug → 修复并重跑
4. 测试有问题 → 修复测试，向伙伴说明
5. 计划有误 → 停下来，向伙伴报告并建议修正

**依赖缺失：**
\`\`\`
任务 3 需要 Redis 连接，但计划中没有提及 Redis 配置。
→ 停止执行
→ 向伙伴报告："任务 3 需要 Redis，计划中未包含配置步骤。
   建议：在任务 3 前插入 '配置 Redis 连接' 步骤。"
\`\`\`

**指令不清：**
- 不要猜测意图，不要"合理推断"
- 列出你的理解和困惑，让伙伴澄清
- 等待回复后再继续

### 步骤 4：完成开发

所有任务完成并验证后：
- 宣布："我正在使用 finishing-a-development-branch 技能来完成此工作。"
- **必需子技能：** 使用 superpowers:finishing-a-development-branch
- 按照该技能的指引验证测试、展示选项、执行选择

**完成报告模板：**
\`\`\`
## 执行报告

**计划：** docs/plan.md
**分支：** feature/user-validation
**任务：** 5/5 已完成

### 完成的任务
1. ✅ 初始化项目结构
2. ✅ 添加用户验证
3. ✅ 添加数据库迁移
4. ✅ 实现 API 端点
5. ✅ 添加集成测试

### 验证结果
- 单元测试：23/23 通过
- 集成测试：8/8 通过
- lint 检查：0 个警告

### 偏离计划的地方
- 任务 3：Redis 配置从 env 改为 config.yaml（经伙伴同意）

### 下一步
按 finishing-a-development-branch 技能处理合并/PR
\`\`\`

## 何时停下来求助

**在以下情况立即停止执行：**
- 遇到阻塞（缺少依赖、测试失败、指令不清）
- 计划有严重缺陷导致无法开始
- 你不理解某条指令
- 验证反复失败（同一测试失败 2 次以上）

**不确定时就问，不要猜测。**

## 何时回到之前的步骤

**回到审查（步骤 1）当：**
- 伙伴根据你的反馈更新了计划
- 根本性的方案需要重新考虑

**不要硬闯阻塞** — 停下来问。

## 注意事项
- 先批判性审查计划
- 严格按照计划步骤执行
- 不要跳过验证
- 每个任务单独提交，commit message 引用任务编号
- 计划要求时引用相应技能
- 遇到阻塞时停下来，不要猜测
- 未经用户明确同意，绝不在 main/master 分支上开始实现

## 集成

**必需的工作流技能：**
- **superpowers:using-git-worktrees** - 必需：开始前建立隔离的工作空间
- **superpowers:writing-plans** - 创建此技能要执行的计划
- **superpowers:finishing-a-development-branch** - 所有任务完成后收尾开发
`;
    const contentHash6 = "e0f37751973bdc23e9381bb0d1394f6260fc5e56b5847248c2ae5fc8ee0cb46a";
    await p.skill.create({ data: { name: "executing-plans", description: "当你有一份书面实现计划需要在单独的会话中执行，并设有审查检查点时使用", skillMd: skillMd6, contentHash: contentHash6, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 898, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 341, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 1000, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 501, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 678, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 1306, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 779, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 1092, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "executing-plans", status: "success", startTime: 100, duration: 1252, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
  }

  // finishing-a-development-branch: 2 calls
  {
    const skillMd7 = `---
name: finishing-a-development-branch
description: 当实现完成、所有测试通过、需要决定如何集成工作时使用——通过提供合并、PR 或清理等结构化选项来引导开发工作的收尾
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [git, workflow]
---

# 完成开发分支

## 概述

通过提供清晰的选项并执行所选工作流来引导开发工作的收尾。

**核心原则：** 验证测试 → 检测环境 → 展示选项 → 执行选择 → 清理。

**开始时宣布：** "我正在使用 finishing-a-development-branch 技能来完成这项工作。"

## 流程

### 步骤 1：验证测试

**在展示选项之前，验证测试通过：**

\`\`\`bash
# 运行项目的测试套件
npm test / cargo test / pytest / go test ./...
\`\`\`

**如果测试失败：**

\`\`\`
测试失败（<N> 个失败）。必须先修复才能继续：

[显示失败信息]

在测试通过之前无法进行合并/PR。
\`\`\`

停止。不要继续到步骤 2。

**如果测试通过：** 继续步骤 2。

### 步骤 2：检测环境

**在展示选项之前，先确定工作区状态：**

\`\`\`bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
\`\`\`

这决定了展示哪种菜单、以及清理方式：

| 状态 | 菜单 | 清理 |
|------|------|------|
| \`GIT_DIR == GIT_COMMON\`（普通仓库） | 标准 4 个选项 | 无 worktree 可清理 |
| \`GIT_DIR != GIT_COMMON\`，命名分支 | 标准 4 个选项 | 按来源判断（见步骤 6） |
| \`GIT_DIR != GIT_COMMON\`，分离 HEAD | 收敛 3 个选项（无合并） | 无清理（由外部管理） |

### 步骤 3：确定基础分支

\`\`\`bash
# 尝试常见的基础分支
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
\`\`\`

或者询问："这个分支是从 main 分出来的——对吗？"

### 步骤 4：展示选项

**普通仓库和命名分支 worktree —— 准确展示以下 4 个选项：**

\`\`\`
实现已完成。你想怎么做？

1. 在本地合并回 <base-branch>
2. 推送并创建 Pull Request
3. 保持分支现状（我稍后处理）
4. 丢弃这项工作

选哪个？
\`\`\`

**分离 HEAD —— 准确展示以下 3 个选项：**

\`\`\`
实现已完成。你在分离 HEAD 上（由外部管理的工作区）。

1. 作为新分支推送并创建 Pull Request
2. 保持现状（我稍后处理）
3. 丢弃这项工作

选哪个？
\`\`\`

**不要添加解释** —— 保持选项简洁。

### 步骤 5：执行选择

#### 选项 1：本地合并

\`\`\`bash
# 切到主仓库根目录，保证 CWD 安全
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# 先合并 —— 在删除任何东西之前先验证合并成功
git checkout <base-branch>
git pull
git merge <feature-branch>

# 在合并结果上验证测试
<test command>

# 合并成功之后再：清理 worktree（步骤 6），然后删除分支
\`\`\`

然后：清理 worktree（步骤 6），再删除分支：

\`\`\`bash
git branch -d <feature-branch>
\`\`\`

#### 选项 2：推送并创建 PR

\`\`\`bash
# 推送分支
git push -u origin <feature-branch>

# 创建 PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## 摘要
<2-3 条变更要点>

## 测试计划
- [ ] <验证步骤>
EOF
)"
\`\`\`

**不要清理 worktree** —— 用户在 PR 反馈迭代时还需要它存活。

#### 选项 3：保持现状

报告："保留分支 <name>。工作树保留在 <path>。"

**不要清理工作树。**

#### 选项 4：丢弃

**先确认：**

\`\`\`
这将永久删除：
- 分支 <name>
- 所有提交：<commit-list>
- 工作树 <path>

输入 'discard' 确认。
\`\`\`

等待精确的确认。

确认后：

\`\`\`bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
\`\`\`

然后：清理 worktree（步骤 6），再强制删除分支：

\`\`\`bash
git branch -D <feature-branch>
\`\`\`

### 步骤 6：清理工作区

**只对选项 1 和 4 执行。** 选项 2 和 3 始终保留 worktree。

\`\`\`bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)
\`\`\`

**如果 \`GIT_DIR == GIT_COMMON\`：** 普通仓库，无 worktree 可清理。结束。

**如果 worktree 路径在 \`.worktrees/\` 或 \`worktrees/\` 之下：** 这是 Superpowers 创建的 worktree —— 我们负责清理。

\`\`\`bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git worktree remove "$WORKTREE_PATH"
git worktree prune  # 自愈：清理任何过期的注册记录
\`\`\`

**否则：** 这个工作区由宿主环境（harness）管理。**不要**移除它。如果你的平台提供了工作区退出工具，用它。否则原样保留工作区。

## 快速参考

| 选项 | 合并 | 推送 | 保留工作树 | 清理分支 |
|------|------|------|-----------|---------|
| 1. 本地合并 | ✓ | - | - | ✓ |
| 2. 创建 PR | - | ✓ | ✓ | - |
| 3. 保持现状 | - | - | ✓ | - |
| 4. 丢弃 | - | - | - | ✓（强制） |

## 常见错误

**跳过测试验证**

- **问题：** 合并损坏的代码、创建失败的 PR
- **修复：** 在提供选项前始终验证测试

**开放式问题**

- **问题：** "接下来该做什么？" → 含糊不清
- **修复：** 准确展示 4 个结构化选项（分离 HEAD 时是 3 个）

**为选项 2 清理 worktree**

- **问题：** 删掉用户 PR 迭代还需要的 worktree
- **修复：** 只在选项 1 和 4 时清理

**先删分支再删 worktree**

- **问题：** \`git branch -d\` 失败，因为 worktree 还引用着该分支
- **修复：** 先合并，再删 worktree，最后删分支

**在 worktree 内部跑 \`git worktree remove\`**

- **问题：** 当 CWD 在被删除的 worktree 内时，命令静默失败
- **修复：** 跑 \`git worktree remove\` 前先 \`cd\` 到主仓库根目录

**清理 harness 拥有的 worktree**

- **问题：** 移除 harness 创建的 worktree 会造成幻影状态
- **修复：** 只清理 \`.worktrees/\` 或 \`worktrees/\` 下的 worktree

**丢弃时不确认**

- **问题：** 意外删除工作成果
- **修复：** 要求输入 'discard' 确认

## 红线

**绝不：**

- 在测试失败时继续
- 合并前不验证合并结果上的测试
- 不确认就删除工作成果
- 未经明确请求就强制推送
- 在确认合并成功之前移除 worktree
- 清理不是你创建的 worktree（按来源判断）
- 在 worktree 内部跑 \`git worktree remove\`

**始终：**

- 在提供选项前验证测试
- 展示菜单前检测环境
- 准确展示 4 个选项（分离 HEAD 时是 3 个）
- 选项 4 要求输入确认
- 只在选项 1 和 4 时清理 worktree
- 移除 worktree 前 \`cd\` 到主仓库根目录
- 移除后跑 \`git worktree prune\`

## 集成

**被以下技能调用：**

- **subagent-driven-development**（步骤 7）- 所有任务完成后
- **executing-plans**（步骤 5）- 所有批次完成后

**配合使用：**

- **using-git-worktrees** - 清理由该技能创建的工作树
`;
    const contentHash7 = "e0d6769c1e544637d943c4e4064879ec200bdcbbbe10f216fd7dfc201bdae5ab";
    await p.skill.create({ data: { name: "finishing-a-development-branch", description: "当实现完成、所有测试通过、需要决定如何集成工作时使用——通过提供合并、PR 或清理等结构化选项来引导开发工作的收尾", skillMd: skillMd7, contentHash: contentHash7, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "finishing-a-development-branch", status: "success", startTime: 100, duration: 490, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "finishing-a-development-branch", status: "success", startTime: 100, duration: 802, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // mcp-builder: 5 calls
  {
    const skillMd8 = `---
name: mcp-builder
description: MCP 服务器构建方法论 — 系统化构建生产级 MCP 工具，让 AI 助手连接外部能力
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [mcp, development]
---

# MCP 服务器构建

系统化设计、实现、测试和部署 Model Context Protocol 服务器的方法论。

## 1. 协议核心概念

MCP 定义三种原语：

- **Tools（工具）**：AI 助手主动调用的函数，有副作用。如搜索、创建、删除操作。
- **Resources（资源）**：AI 助手只读访问的数据源，用 URI 标识。如 \`users://{id}/profile\`。
- **Prompts（提示词模板）**：预定义交互模板，引导用户触发工作流。

**选择原则：** 执行操作 → Tool | 读取数据 → Resource | 引导交互 → Prompt

## 2. 项目结构规范

### TypeScript
\`\`\`
my-mcp-server/
├── src/
│   ├── index.ts          # 入口，注册 tools/resources
│   ├── tools/             # 按功能拆分
│   ├── resources/
│   └── lib/               # 客户端封装、校验逻辑
├── tests/
├── package.json
└── tsconfig.json
\`\`\`

关键依赖：\`@modelcontextprotocol/sdk\` + \`zod\`

### Python
\`\`\`
my-mcp-server/
├── src/my_mcp_server/
│   ├── server.py
│   ├── tools/
│   └── lib/
├── tests/
└── pyproject.toml
\`\`\`

关键依赖：\`mcp\` + \`pydantic\`

## 3. Tool 设计原则

### 命名
- \`snake_case\` 格式，动词开头：\`search_users\`、\`create_issue\`、\`delete_file\`
- 名称自解释，AI 助手靠名称选工具，模糊命名导致误调用

### 参数
- 每个参数有类型约束和 \`.describe()\` 描述
- 可选参数给默认值，减少 AI 决策负担
- 用枚举代替布尔开关

\`\`\`typescript
server.tool("search_issues", {
  query: z.string().describe("搜索关键词"),
  status: z.enum(["open", "closed", "all"]).default("open").describe("状态筛选"),
  limit: z.number().min(1).max(100).default(20).describe("返回上限"),
}, async ({ query, status, limit }) => { /* ... */ });
\`\`\`

### 描述
说明**用途 + 返回内容 + 限制**，这是 AI 选择工具的关键依据：

\`\`\`typescript
server.tool("search_users",
  "根据姓名或邮箱搜索用户。返回 ID、姓名、邮箱列表。模糊匹配，最多 50 条。",
  schema, handler);
\`\`\`

### 输出
- 结构化数据 → JSON，人类可读内容 → Markdown
- 始终用 \`content: [{ type: "text", text: "..." }]\` 格式返回

## 4. 输入验证和错误处理

用 Zod/Pydantic 做 Schema 级校验，业务级校验放 handler 开头：

\`\`\`typescript
server.tool("get_user", { id: z.string() }, async ({ id }) => {
  try {
    const user = await db.getUser(id);
    if (!user) {
      return {
        content: [{ type: "text", text: \`用户 \${id} 不存在，请检查 ID。\` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(user, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: \`查询失败：\${err.message}\` }],
      isError: true,
    };
  }
});
\`\`\`

**错误处理四原则：**
1. 永远不让服务器崩溃 — try/catch 包裹所有外部调用
2. 返回可操作的错误信息 — 告诉 AI 问题是什么、能做什么
3. 使用 \`isError: true\` — 让 AI 知道调用失败
4. 区分错误类型 — 参数错误、权限不足、资源不存在、服务不可用

## 5. 资源管理和生命周期

\`\`\`typescript
// 资源注册
server.resource("user-profile", "users://{userId}/profile", async (uri) => {
  const profile = await db.getProfile(extractId(uri));
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(profile) }] };
});

// 生命周期：先初始化 → 再 connect → 监听关闭信号
const db = await Database.connect(config.dbUrl);
await server.connect(new StdioServerTransport());
process.on("SIGINT", async () => { await db.disconnect(); await server.close(); process.exit(0); });
\`\`\`

关键点：使用连接池、所有外部调用设超时、优雅关闭清理资源。

## 6. 测试策略

### 单元测试 — 业务逻辑与 MCP 注册分离
\`\`\`typescript
// tools/search.ts 导出纯函数
export async function searchUsers(query: string, limit: number) { /* ... */ }

// search.test.ts 独立测试
test("返回匹配结果", async () => {
  const results = await searchUsers("alice", 10);
  expect(results[0].name).toContain("Alice");
});
\`\`\`

### 集成测试 — 用 SDK Client 做端到端验证
\`\`\`typescript
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(clientTransport);
const result = await client.callTool("search_users", { query: "test" });
expect(result.isError).toBeFalsy();
\`\`\`

### MCP Inspector — 交互式调试
\`\`\`bash
npx @modelcontextprotocol/inspector node dist/index.js
\`\`\`

在浏览器中查看所有 tools/resources，手动调用并查看结果。

**测试要点：** 每个 Tool 覆盖正常 + 异常路径、边界值、外部服务失败模拟。

## 7. 安全考虑

**权限控制：**
- 最小权限原则，读写 Tool 分离
- 危险操作要求确认参数（如 \`confirm: true\`）

**输入安全：**
- SQL 注入 → 参数化查询，绝不拼接
- 路径遍历 → 校验路径，禁止 \`../\`
- 命令注入 → 用 \`execFile\` 而非 \`exec\`

**敏感数据：**
- 密钥通过环境变量传入，不硬编码
- 日志不打印完整敏感信息
- 返回数据做脱敏处理

**沙箱：** 文件操作限制目录、网络请求限制白名单、设置资源配额。

## 8. 部署和分发

### npm 发布
\`\`\`json
{ "bin": { "mcp-server-myservice": "dist/index.js" }, "files": ["dist"] }
\`\`\`

用户配置：
\`\`\`json
{ "mcpServers": { "myservice": { "command": "npx", "args": ["@yourorg/mcp-server-myservice"], "env": { "API_KEY": "xxx" } } } }
\`\`\`

### pip 发布
\`\`\`toml
[project.scripts]
mcp-server-myservice = "my_mcp_server.server:main"
\`\`\`

### Docker — 适用于复杂依赖或隔离场景
\`\`\`dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./ && RUN npm ci --production
COPY dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
\`\`\`

## 9. 调试技巧

**关键：MCP 用 stdio 通信，不能用 \`console.log\`，会破坏协议流。**

\`\`\`typescript
// 错误
console.log("debug");
// 正确
console.error("[DEBUG]", info);
// 更好
server.sendLoggingMessage({ level: "info", data: "处理中" });
\`\`\`

**常见问题：**

| 症状 | 原因 | 解决 |
|------|------|------|
| 启动无响应 | transport 未连接 | 检查 \`server.connect()\` |
| Tool 不出现 | 注册在 connect 之后 | 先注册再 connect |
| AI 不调用 Tool | 描述不清晰 | 改善名称和描述 |
| 参数总错 | Schema 不明确 | 添加 \`.describe()\` |
| 调用超时 | 外部服务慢 | 加超时和缓存 |

**调试流程：** Inspector 验证基本功能 → 手动调用确认输入输出 → 连接真实 AI 客户端观察调用模式 → 根据实际行为调整设计。

## 10. 构建检查清单

### 设计
- [ ] 明确 Tools vs Resources vs Prompts 分工
- [ ] Tool 命名 \`动词_名词\`，描述说明用途和返回内容
- [ ] 参数简洁，可选参数有合理默认值

### 实现
- [ ] 输入用 Zod/Pydantic 校验
- [ ] 外部调用有 try/catch 和超时
- [ ] 错误返回 \`isError: true\` 并附可操作信息
- [ ] 不用 \`console.log\`（用 stderr 或 SDK 日志）
- [ ] 敏感数据走环境变量

### 测试
- [ ] 核心逻辑有单元测试
- [ ] 有集成测试验证 MCP 协议交互
- [ ] 用 MCP Inspector 手动验证过
- [ ] 用真实 AI 客户端测试过

### 部署
- [ ] README 含安装和配置说明
- [ ] 提供客户端配置 JSON 示例
- [ ] 遵循 semver，无硬编码密钥
`;
    const contentHash8 = "42a4afe5def8a3469a983fc80b29792ab9d7a876b2c03ea8bb5ad187fbb3ba5c";
    await p.skill.create({ data: { name: "mcp-builder", description: "MCP 服务器构建方法论 — 系统化构建生产级 MCP 工具，让 AI 助手连接外部能力", skillMd: skillMd8, contentHash: contentHash8, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "mcp-builder", status: "success", startTime: 100, duration: 1563, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "mcp-builder", status: "success", startTime: 100, duration: 1013, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "mcp-builder", status: "success", startTime: 100, duration: 533, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "mcp-builder", status: "success", startTime: 100, duration: 488, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "mcp-builder", status: "success", startTime: 100, duration: 1207, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
  }

  // receiving-code-review: 7 calls
  {
    const skillMd9 = `---
name: receiving-code-review
description: 收到代码审查反馈后、实施建议之前使用，尤其当反馈不明确或技术上有疑问时——需要技术严谨性和验证，而非敷衍附和或盲目执行
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [code-review]
---

# 接收代码审查

## 概述

代码审查需要的是技术评估，不是情绪表演。

**核心原则：** 先验证再实施。先提问再假设。技术正确性优先于社交舒适度。

## 响应模式

\`\`\`
收到代码审查反馈时：

1. 阅读：完整阅读反馈，不急于反应
2. 理解：用自己的话复述需求（或提问）
3. 验证：对照代码库的实际情况检查
4. 评估：对这个代码库来说技术上合理吗？
5. 回应：技术性确认或有理有据的反驳
6. 实施：一次一项，逐个测试
\`\`\`

## 禁止的回应

**绝不要说：**
- "你说得太对了！"（明确违反 CLAUDE.md 规定）
- "好观点！"/"反馈很棒！"（敷衍表演）
- "让我立刻实施"（在验证之前）

**应该这样做：**
- 复述技术需求
- 提出澄清性问题
- 如果审查意见有误，用技术理由反驳
- 直接动手做（行动胜于言辞）

## 处理不明确的反馈

\`\`\`
如果有任何一项不明确：
  停下来——先不要实施任何内容
  就不明确的项目提出澄清

为什么：各项之间可能有关联。部分理解 = 错误实施。
\`\`\`

**示例：**
\`\`\`
搭档："修复第 1-6 项"
你理解 1、2、3、6。对 4、5 不确定。

❌ 错误做法：先实施 1、2、3、6，稍后再问 4、5
✅ 正确做法："第 1、2、3、6 项我理解了。第 4 和第 5 项需要澄清后再动手。"
\`\`\`

## 按来源区别处理

### 来自搭档的反馈
- **可信赖** —— 理解后直接实施
- **仍然要问** 如果范围不明确
- **不要敷衍附和**
- **直接行动** 或给出技术性确认

### 来自外部审查者的反馈
\`\`\`
实施之前：
  1. 检查：对这个代码库来说技术上正确吗？
  2. 检查：是否会破坏现有功能？
  3. 检查：当前实现这样写是否有原因？
  4. 检查：在所有平台/版本上都适用吗？
  5. 检查：审查者了解完整上下文吗？

如果建议似乎有误：
  用技术理由反驳

如果无法轻易验证：
  说明情况："没有 [X] 我无法验证这一点。我应该 [调查/提问/先做]？"

如果与搭档之前的决策冲突：
  先停下来和搭档讨论
\`\`\`

**搭档的原则：** "对外部反馈要持怀疑态度，但要仔细核实"

## YAGNI 检查——针对"专业化"功能建议

\`\`\`
如果审查者建议"正规地实现"：
  在代码库中 grep 实际使用情况

  如果没人用："这个接口没有被调用。删掉它（YAGNI）？"
  如果有人用：那就正规实现
\`\`\`

**搭档的原则：** "你和审查者都对我负责。如果我们不需要这个功能，就不要加。"

## 实施顺序

\`\`\`
对于包含多项的反馈：
  1. 先澄清所有不明确的项
  2. 然后按以下顺序实施：
     - 阻塞性问题（崩溃、安全）
     - 简单修复（拼写、导入）
     - 复杂修复（重构、逻辑）
  3. 逐个测试每项修复
  4. 验证没有回归
\`\`\`

## 何时反驳

在以下情况反驳：
- 建议会破坏现有功能
- 审查者缺少完整上下文
- 违反 YAGNI（功能没人用）
- 对当前技术栈来说技术上不正确
- 存在遗留/兼容性原因
- 与搭档的架构决策冲突

**如何反驳：**
- 用技术理由，不要带防御情绪
- 提出具体问题
- 引用可正常工作的测试/代码
- 如果涉及架构问题，让搭档参与

**如果觉得不方便当众反驳，暗号是：** "Strange things are afoot at the Circle K"

## 确认正确的反馈

当反馈确实正确时：
\`\`\`
✅ "已修复。[简要说明改了什么]"
✅ "发现得好——[具体问题]。已在 [位置] 修复。"
✅ [直接修复并在代码中体现]

❌ "你说得太对了！"
❌ "好观点！"
❌ "感谢你发现了这个！"
❌ "感谢你 [任何内容]"
❌ 任何感谢的表达
\`\`\`

**为什么不用感谢：** 行动说明一切。直接修复。代码本身就能表明你收到了反馈。

**如果你发现自己要写"感谢"：** 删掉它。直接说明修复内容。

## 优雅地纠正自己的反驳

如果你反驳了但事后发现自己错了：
\`\`\`
✅ "你是对的——我检查了 [X]，确实 [Y]。正在实施。"
✅ "验证后确认你是对的。我最初的理解有误，因为 [原因]。正在修复。"

❌ 长篇道歉
❌ 为自己的反驳辩护
❌ 过度解释
\`\`\`

如实陈述纠正，然后继续。

## 常见错误

| 错误 | 修正 |
|------|------|
| 敷衍附和 | 复述需求或直接行动 |
| 盲目实施 | 先对照代码库验证 |
| 批量实施不测试 | 一次一项，逐个测试 |
| 假设审查者一定对 | 检查是否会破坏现有功能 |
| 回避反驳 | 技术正确性 > 社交舒适度 |
| 部分理解就开始实施 | 先澄清所有项 |
| 无法验证却继续推进 | 说明限制，请求指导 |

## 真实案例

**敷衍附和（反面例子）：**
\`\`\`
审查者："删除遗留代码"
❌ "你说得太对了！让我删掉它……"
\`\`\`

**技术验证（正面例子）：**
\`\`\`
审查者："删除遗留代码"
✅ "查了一下……构建目标是 10.15+，这个 API 需要 13+。向后兼容需要保留遗留代码。当前实现有错误的 bundle ID——修复它还是放弃 pre-13 支持？"
\`\`\`

**YAGNI（正面例子）：**
\`\`\`
审查者："实现完善的指标追踪，包括数据库、日期过滤、CSV 导出"
✅ "在代码库中 grep 了一下——没有任何地方调用这个接口。删掉它（YAGNI）？还是有我遗漏的调用？"
\`\`\`

**不明确的项（正面例子）：**
\`\`\`
搭档："修复第 1-6 项"
你理解 1、2、3、6。对 4、5 不确定。
✅ "第 1、2、3、6 项我理解了。第 4 和第 5 项需要澄清后再动手。"
\`\`\`

## GitHub 评论回复

在 GitHub 上回复行内审查评论时，在评论线程中回复（\`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies\`），不要发顶层 PR 评论。

## 底线

**外部反馈 = 待评估的建议，不是必须执行的命令。**

验证。质疑。然后实施。

不要敷衍附和。始终保持技术严谨。
`;
    const contentHash9 = "e5ae2f27ed62bf6e05711404752d39a7f126c7bc2f64d88d999616f8b07a2cec";
    await p.skill.create({ data: { name: "receiving-code-review", description: "收到代码审查反馈后、实施建议之前使用，尤其当反馈不明确或技术上有疑问时——需要技术严谨性和验证，而非敷衍附和或盲目执行", skillMd: skillMd9, contentHash: contentHash9, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 1510, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 905, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 781, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 603, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 470, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 1327, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "receiving-code-review", status: "success", startTime: 100, duration: 1305, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // requesting-code-review: 9 calls
  {
    const skillMd10 = `---
name: requesting-code-review
description: 完成任务、实现重要功能或合并前使用，用于验证工作成果是否符合要求
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [code-review]
---

# 请求代码审查

派遣代码审查子代理，在问题扩散之前发现它们。审查者获得的是精心组织的评估上下文——绝不是你的会话历史。这样可以让审查者专注于工作成果而非你的思考过程，同时保留你自己的上下文以便继续工作。

**核心原则：** 早审查，勤审查。

## 何时请求审查

**必须审查：**
- 子代理驱动开发中每个任务完成后
- 完成重要功能后
- 合并到 main 之前

**可选但有价值：**
- 卡住时（换个视角）
- 重构之前（建立基线）
- 修复复杂 bug 之后

## 如何请求

**1. 获取 git SHA：**
\`\`\`bash
BASE_SHA=$(git rev-parse HEAD~1)  # 或 origin/main
HEAD_SHA=$(git rev-parse HEAD)
\`\`\`

**2. 派遣代码审查子代理：**

使用 Task 工具，指定 \`general-purpose\` 类型，填写 \`code-reviewer.md\` 中的模板

**占位符说明：**
- \`{DESCRIPTION}\` - 你刚完成的内容简要说明
- \`{PLAN_OR_REQUIREMENTS}\` - 预期功能
- \`{BASE_SHA}\` - 起始提交
- \`{HEAD_SHA}\` - 结束提交

**3. 处理反馈：**
- Critical 问题立即修复
- Important 问题在继续之前修复
- Minor 问题记录下来稍后处理
- 如果审查者有误，用技术理由反驳

## 示例

\`\`\`
[刚完成任务 2：添加验证功能]

你：让我在继续之前请求代码审查。

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[派遣代码审查子代理]
  DESCRIPTION: 添加了 verifyIndex() 和 repairIndex()，支持 4 种问题类型
  PLAN_OR_REQUIREMENTS: docs/superpowers/plans/deployment-plan.md 中的任务 2
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[子代理返回]:
  优点：架构清晰，测试真实
  问题：
    Important：缺少进度指示器
    Minor：报告间隔使用了魔法数字 (100)
  评估：可以继续

你：[修复进度指示器]
[继续任务 3]
\`\`\`

## 与工作流的集成

**子代理驱动开发：**
- 每个任务完成后审查
- 在问题叠加之前发现它们
- 修复后再进入下一个任务

**执行计划：**
- 每个任务完成后或在自然 checkpoint 审查
- 获取反馈，应用，继续

**临时开发：**
- 合并前审查
- 卡住时审查

## 红线

**绝不要：**
- 因为"很简单"就跳过审查
- 忽略 Critical 问题
- 带着未修复的 Important 问题继续推进
- 对合理的技术反馈进行争辩

**如果审查者有误：**
- 用技术理由反驳
- 展示证明其可行的代码/测试
- 要求澄清

参见模板：requesting-code-review/code-reviewer.md
`;
    const contentHash10 = "1a9c5cdf6bde755c8847589af634335f85db0a843707b78b3771517046e3d6b5";
    await p.skill.create({ data: { name: "requesting-code-review", description: "完成任务、实现重要功能或合并前使用，用于验证工作成果是否符合要求", skillMd: skillMd10, contentHash: contentHash10, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 1625, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 421, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 1771, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 373, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 1112, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 730, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 843, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 652, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "requesting-code-review", status: "success", startTime: 100, duration: 1428, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
  }

  // subagent-driven-development: 3 calls
  {
    const skillMd11 = `---
name: subagent-driven-development
description: 当在当前会话中执行包含独立任务的实现计划时使用
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [agents, development]
---

# 子智能体驱动开发

通过为每个任务分派一个全新的子智能体来执行计划，每个任务完成后进行两阶段审查：先审查规格合规性，再审查代码质量。

**为什么用子智能体：** 你将任务委派给具有隔离上下文的专用智能体。通过精心设计它们的指令和上下文，确保它们专注并成功完成任务。它们不应继承你的会话上下文或历史记录——你要精确构造它们所需的一切。这样也能为你自己保留用于协调工作的上下文。

**核心原则：** 每个任务一个全新子智能体 + 两阶段审查（先规格后质量）= 高质量、快速迭代

## 何时使用

\`\`\`dot
digraph when_to_use {
    "有实现计划?" [shape=diamond];
    "任务基本独立?" [shape=diamond];
    "留在当前会话?" [shape=diamond];
    "subagent-driven-development" [shape=box];
    "executing-plans" [shape=box];
    "手动执行或先头脑风暴" [shape=box];

    "有实现计划?" -> "任务基本独立?" [label="是"];
    "有实现计划?" -> "手动执行或先头脑风暴" [label="否"];
    "任务基本独立?" -> "留在当前会话?" [label="是"];
    "任务基本独立?" -> "手动执行或先头脑风暴" [label="否 - 紧密耦合"];
    "留在当前会话?" -> "subagent-driven-development" [label="是"];
    "留在当前会话?" -> "executing-plans" [label="否 - 并行会话"];
}
\`\`\`

**与 Executing Plans（并行会话）的对比：**
- 同一会话（无上下文切换）
- 每个任务全新子智能体（无上下文污染）
- 每个任务后两阶段审查：先规格合规性，再代码质量
- 更快的迭代（任务间无需人工介入）

## 流程

\`\`\`dot
digraph process {
    rankdir=TB;

    subgraph cluster_per_task {
        label="每个任务";
        "分派实现子智能体 (./implementer-prompt.md)" [shape=box];
        "实现子智能体有疑问?" [shape=diamond];
        "回答问题，提供上下文" [shape=box];
        "实现子智能体实现、测试、提交、自审" [shape=box];
        "分派规格审查子智能体 (./spec-reviewer-prompt.md)" [shape=box];
        "规格审查子智能体确认代码匹配规格?" [shape=diamond];
        "实现子智能体修复规格差距" [shape=box];
        "分派代码质量审查子智能体 (./code-quality-reviewer-prompt.md)" [shape=box];
        "代码质量审查子智能体通过?" [shape=diamond];
        "实现子智能体修复质量问题" [shape=box];
        "在 TodoWrite 中标记任务完成" [shape=box];
    }

    "读取计划，提取所有任务的完整文本，记录上下文，创建 TodoWrite" [shape=box];
    "还有剩余任务?" [shape=diamond];
    "分派最终代码审查子智能体审查整体实现" [shape=box];
    "使用 superpowers:finishing-a-development-branch" [shape=box style=filled fillcolor=lightgreen];

    "读取计划，提取所有任务的完整文本，记录上下文，创建 TodoWrite" -> "分派实现子智能体 (./implementer-prompt.md)";
    "分派实现子智能体 (./implementer-prompt.md)" -> "实现子智能体有疑问?";
    "实现子智能体有疑问?" -> "回答问题，提供上下文" [label="是"];
    "回答问题，提供上下文" -> "分派实现子智能体 (./implementer-prompt.md)";
    "实现子智能体有疑问?" -> "实现子智能体实现、测试、提交、自审" [label="否"];
    "实现子智能体实现、测试、提交、自审" -> "分派规格审查子智能体 (./spec-reviewer-prompt.md)";
    "分派规格审查子智能体 (./spec-reviewer-prompt.md)" -> "规格审查子智能体确认代码匹配规格?";
    "规格审查子智能体确认代码匹配规格?" -> "实现子智能体修复规格差距" [label="否"];
    "实现子智能体修复规格差距" -> "分派规格审查子智能体 (./spec-reviewer-prompt.md)" [label="重新审查"];
    "规格审查子智能体确认代码匹配规格?" -> "分派代码质量审查子智能体 (./code-quality-reviewer-prompt.md)" [label="是"];
    "分派代码质量审查子智能体 (./code-quality-reviewer-prompt.md)" -> "代码质量审查子智能体通过?";
    "代码质量审查子智能体通过?" -> "实现子智能体修复质量问题" [label="否"];
    "实现子智能体修复质量问题" -> "分派代码质量审查子智能体 (./code-quality-reviewer-prompt.md)" [label="重新审查"];
    "代码质量审查子智能体通过?" -> "在 TodoWrite 中标记任务完成" [label="是"];
    "在 TodoWrite 中标记任务完成" -> "还有剩余任务?";
    "还有剩余任务?" -> "分派实现子智能体 (./implementer-prompt.md)" [label="是"];
    "还有剩余任务?" -> "分派最终代码审查子智能体审查整体实现" [label="否"];
    "分派最终代码审查子智能体审查整体实现" -> "使用 superpowers:finishing-a-development-branch";
}
\`\`\`

## 模型选择

使用能胜任每个角色的最低成本模型，以节省开支并提高速度。

**机械性实现任务**（隔离的函数、清晰的规格、1-2 个文件）：使用快速、便宜的模型。当计划编写得足够详细时，大多数实现任务都是机械性的。

**集成和判断类任务**（多文件协调、模式匹配、调试）：使用标准模型。

**架构、设计和审查类任务**：使用最强的可用模型。

**任务复杂度信号：**
- 涉及 1-2 个文件且有完整规格 → 便宜模型
- 涉及多个文件且有集成考虑 → 标准模型
- 需要设计判断或广泛的代码库理解 → 最强模型

## 处理实现者状态

实现子智能体报告四种状态之一。根据每种状态进行相应处理：

**DONE：** 进入规格合规性审查。

**DONE_WITH_CONCERNS：** 实现者完成了工作但标记了疑虑。在继续之前阅读这些疑虑。如果疑虑涉及正确性或范围，在审查前解决。如果只是观察性说明（如"这个文件越来越大了"），记录下来并继续审查。

**NEEDS_CONTEXT：** 实现者需要未提供的信息。提供缺失的上下文并重新分派。

**BLOCKED：** 实现者无法完成任务。评估阻塞原因：
1. 如果是上下文问题，提供更多上下文并用同一模型重新分派
2. 如果任务需要更强的推理能力，用更强的模型重新分派
3. 如果任务太大，拆分为更小的部分
4. 如果计划本身有问题，上报给人类

**绝不** 忽略上报或在不做任何更改的情况下让同一模型重试。如果实现者说卡住了，说明有什么东西需要改变。

## 提示词模板

- \`./implementer-prompt.md\` - 分派实现子智能体
- \`./spec-reviewer-prompt.md\` - 分派规格合规审查子智能体
- \`./code-quality-reviewer-prompt.md\` - 分派代码质量审查子智能体

## 示例工作流

\`\`\`
你：我正在使用子智能体驱动开发来执行这个计划。

[一次性读取计划文件：docs/superpowers/plans/feature-plan.md]
[提取全部 5 个任务的完整文本和上下文]
[用所有任务创建 TodoWrite]

任务 1：Hook 安装脚本

[获取任务 1 的文本和上下文（已提取）]
[分派实现子智能体，附带完整任务文本 + 上下文]

实现者："在我开始之前——hook 应该安装在用户级别还是系统级别？"

你："用户级别（~/.config/superpowers/hooks/）"

实现者："明白了。现在开始实现……"
[稍后] 实现者：
  - 实现了 install-hook 命令
  - 添加了测试，5/5 通过
  - 自审：发现遗漏了 --force 参数，已添加
  - 已提交

[分派规格合规审查]
规格审查者：✅ 符合规格 - 所有需求已满足，无多余内容

[获取 git SHA，分派代码质量审查]
代码审查者：优点：测试覆盖好，代码整洁。问题：无。通过。

[标记任务 1 完成]

任务 2：恢复模式

[获取任务 2 的文本和上下文（已提取）]
[分派实现子智能体，附带完整任务文本 + 上下文]

实现者：[无疑问，直接开始]
实现者：
  - 添加了 verify/repair 模式
  - 8/8 测试通过
  - 自审：一切正常
  - 已提交

[分派规格合规审查]
规格审查者：❌ 问题：
  - 缺失：进度报告（规格要求"每 100 项报告一次"）
  - 多余：添加了 --json 参数（未被要求）

[实现者修复问题]
实现者：移除了 --json 参数，添加了进度报告

[规格审查者再次审查]
规格审查者：✅ 现在符合规格

[分派代码质量审查]
代码审查者：优点：扎实。问题（重要）：魔法数字（100）

[实现者修复]
实现者：提取了 PROGRESS_INTERVAL 常量

[代码审查者再次审查]
代码审查者：✅ 通过

[标记任务 2 完成]

...

[所有任务完成后]
[分派最终代码审查]
最终审查者：所有需求已满足，可以合并

完成！
\`\`\`

## 优势

**与手动执行相比：**
- 子智能体自然遵循 TDD
- 每个任务全新上下文（不会混淆）
- 并行安全（子智能体不会互相干扰）
- 子智能体可以提问（工作前和工作中都可以）

**与 Executing Plans 相比：**
- 同一会话（无交接）
- 持续进展（无需等待）
- 审查检查点自动化

**效率提升：**
- 无文件读取开销（控制者提供完整文本）
- 控制者精确策划所需上下文
- 子智能体预先获得完整信息
- 问题在工作开始前就被提出（而非工作结束后）

**质量关卡：**
- 自审在交接前发现问题
- 两阶段审查：规格合规性，然后代码质量
- 审查循环确保修复确实有效
- 规格合规防止过度/不足构建
- 代码质量确保实现良好

**成本：**
- 更多子智能体调用（每个任务需要实现者 + 2 个审查者）
- 控制者需要更多准备工作（预先提取所有任务）
- 审查循环增加迭代次数
- 但能及早发现问题（比后期调试更省成本）

## 红线

**绝不：**
- 未经用户明确同意就在 main/master 分支上开始实现
- 跳过审查（规格合规性或代码质量）
- 带着未修复的问题继续
- 并行分派多个实现子智能体（会冲突）
- 让子智能体读取计划文件（应提供完整文本）
- 跳过场景铺设上下文（子智能体需要理解任务在哪个环节）
- 忽视子智能体的问题（在让它们继续之前先回答）
- 在规格合规性上接受"差不多就行"（规格审查者发现问题 = 未完成）
- 跳过审查循环（审查者发现问题 = 实现者修复 = 再次审查）
- 让实现者的自审替代正式审查（两者都需要）
- **在规格合规性审查通过之前开始代码质量审查**（顺序错误）
- 在任一审查有未解决问题时就进入下一个任务

**如果子智能体提问：**
- 清晰完整地回答
- 必要时提供额外上下文
- 不要催促它们进入实现阶段

**如果审查者发现问题：**
- 实现者（同一子智能体）修复
- 审查者再次审查
- 重复直到通过
- 不要跳过重新审查

**如果子智能体失败：**
- 分派修复子智能体并提供具体指令
- 不要尝试手动修复（上下文污染）

## 集成

**必需的工作流技能：**
- **superpowers:using-git-worktrees** - 必需：在开始前建立隔离工作区
- **superpowers:writing-plans** - 创建本技能执行的计划
- **superpowers:requesting-code-review** - 审查子智能体的代码审查模板
- **superpowers:finishing-a-development-branch** - 所有任务完成后收尾

**子智能体应使用：**
- **superpowers:test-driven-development** - 子智能体对每个任务遵循 TDD

**替代工作流：**
- **superpowers:executing-plans** - 用于并行会话而非同会话执行
`;
    const contentHash11 = "4cc2fd17286d34a89fb9d5b43797fbe4128c2feb57ae5ead4c21f7e27c004ee4";
    await p.skill.create({ data: { name: "subagent-driven-development", description: "当在当前会话中执行包含独立任务的实现计划时使用", skillMd: skillMd11, contentHash: contentHash11, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "subagent-driven-development", status: "success", startTime: 100, duration: 1019, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "subagent-driven-development", status: "success", startTime: 100, duration: 1386, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "subagent-driven-development", status: "success", startTime: 100, duration: 392, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
  }

  // systematic-debugging: 3 calls
  {
    const skillMd12 = `---
name: systematic-debugging
description: 遇到任何 bug、测试失败或异常行为时使用，在提出修复方案之前执行
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [debugging]
---

# 系统化调试

## 概述

随意修复既浪费时间又会引入新 bug。草率的补丁只会掩盖深层问题。

**核心原则：** 在尝试修复之前，务必先找到根本原因。只修症状就是失败。

**敷衍走流程等于违背调试的精神。**

## 铁律

\`\`\`
不做根因调查，不许提修复方案
\`\`\`

如果你还没完成第一阶段，就不能提出修复方案。

## 何时使用

用于任何技术问题：
- 测试失败
- 生产环境 bug
- 异常行为
- 性能问题
- 构建失败
- 集成问题

**尤其在以下情况必须使用：**
- 时间紧迫（紧急情况最容易让人猜测式修复）
- 觉得"一个小修改"就能搞定
- 已经尝试了多种修复
- 上一次修复没有生效
- 你没有完全理解问题

**以下情况也不要跳过：**
- 问题看起来很简单（简单的 bug 也有根本原因）
- 你很赶时间（越急越容易返工）
- 领导要求立刻修好（系统化调试比反复尝试更快）

## 四个阶段

你必须完成每个阶段后才能进入下一个。

### 第一阶段：根因调查

**在尝试任何修复之前：**

1. **仔细阅读错误信息**
   - 不要跳过错误或警告
   - 它们往往直接包含解决方案
   - 完整阅读堆栈跟踪
   - 记下行号、文件路径、错误码

2. **稳定复现**
   - 你能可靠地触发它吗？
   - 具体的复现步骤是什么？
   - 每次都能复现吗？
   - 如果无法复现 → 收集更多数据，不要猜测

3. **检查近期变更**
   - 什么变更可能导致了这个问题？
   - git diff、最近的提交
   - 新依赖、配置变更
   - 环境差异

4. **在多组件系统中收集证据**

   **当系统有多个组件时（CI → 构建 → 签名，API → 服务 → 数据库）：**

   **在提出修复方案之前，先添加诊断埋点：**
   \`\`\`
   对每个组件边界：
     - 记录进入组件的数据
     - 记录离开组件的数据
     - 验证环境/配置的传递
     - 检查每一层的状态

   执行一次以收集证据，确定断裂点在哪里
   然后分析证据，定位故障组件
   然后针对该组件深入调查
   \`\`\`

   **示例（多层系统）：**
   \`\`\`bash
   # 第 1 层：工作流
   echo "=== Secrets available in workflow: ==="
   echo "IDENTITY: \${IDENTITY:+SET}\${IDENTITY:-UNSET}"

   # 第 2 层：构建脚本
   echo "=== Env vars in build script: ==="
   env | grep IDENTITY || echo "IDENTITY not in environment"

   # 第 3 层：签名脚本
   echo "=== Keychain state: ==="
   security list-keychains
   security find-identity -v

   # 第 4 层：实际签名
   codesign --sign "$IDENTITY" --verbose=4 "$APP"
   \`\`\`

   **由此可以看出：** 哪一层出了问题（secrets → workflow ✓, workflow → build ✗）

5. **跟踪数据流**

   **当错误发生在调用栈深处时：**

   参见本目录下的 \`root-cause-tracing.md\`，了解完整的反向追踪技术。

   **简要版本：**
   - 错误值从哪里产生的？
   - 谁用错误值调用了这里？
   - 持续向上追踪直到找到源头
   - 在源头修复，而不是在症状处修复

### 第二阶段：模式分析

**先找到模式，再修复：**

1. **找到可正常工作的示例**
   - 在同一代码库中找到类似的正常代码
   - 有什么正常的代码与出问题的代码相似？

2. **与参考实现对比**
   - 如果是实现某个模式，完整阅读参考实现
   - 不要略读——逐行阅读
   - 在应用之前彻底理解该模式

3. **识别差异**
   - 正常代码和出问题的代码之间有什么不同？
   - 列出每一个差异，无论多小
   - 不要假设"那不可能有影响"

4. **理解依赖关系**
   - 这个功能需要哪些其他组件？
   - 需要哪些设置、配置、环境？
   - 它有哪些隐含假设？

### 第三阶段：假设与验证

**科学方法：**

1. **提出单一假设**
   - 清晰地陈述："我认为 X 是根本原因，因为 Y"
   - 写下来
   - 要具体，不要含糊

2. **最小化测试**
   - 做出最小的改动来验证假设
   - 每次只改一个变量
   - 不要同时修复多个问题

3. **继续之前先验证**
   - 生效了？是 → 进入第四阶段
   - 没生效？提出新假设
   - 不要在上面叠加更多修复

4. **当你不确定时**
   - 说"我不理解 X"
   - 不要假装自己知道
   - 寻求帮助
   - 做更多调研

### 第四阶段：实施

**修复根本原因，而非症状：**

1. **创建失败的测试用例**
   - 最简化的复现
   - 尽可能用自动化测试
   - 没有测试框架就写一次性测试脚本
   - 修复前必须先有测试
   - 使用 \`superpowers:test-driven-development\` 技能来编写规范的失败测试

2. **实施单一修复**
   - 修复已定位的根本原因
   - 每次只改一处
   - 不做"顺便改改"的优化
   - 不捆绑重构

3. **验证修复**
   - 测试现在通过了吗？
   - 其他测试没有被破坏吧？
   - 问题真的解决了吗？

4. **如果修复不起作用**
   - 停下来
   - 数一数：你已经尝试了几次修复？
   - 少于 3 次：回到第一阶段，用新信息重新分析
   - **3 次或以上：停下来质疑架构（见下方第 5 步）**
   - 没有经过架构讨论，不要尝试第 4 次修复

5. **如果 3 次以上修复都失败了：质疑架构**

   **以下模式表明存在架构问题：**
   - 每次修复都暴露出新的共享状态/耦合/其他位置的问题
   - 修复需要"大规模重构"才能实现
   - 每次修复都在其他地方产生新的症状

   **停下来质疑根本性问题：**
   - 这个模式从根本上合理吗？
   - 我们是不是在"惯性驱动"下坚持了错误方案？
   - 应该重构架构还是继续修补症状？

   **在尝试更多修复之前，和你的搭档讨论**

   这不是假设失败——这是架构有误。

## 红线——停下来，按流程走

如果你发现自己在想：
- "先临时修一下，以后再排查"
- "试着改改 X 看看行不行"
- "一次性改多个地方，跑测试看看"
- "跳过测试，我手动验证"
- "大概是 X 的问题，让我修一下"
- "我不完全理解，但这应该能行"
- "模式说的是 X，但我换个方式用"
- "主要问题有这些：[未经调查就列出修复方案]"
- 没有追踪数据流就提出解决方案
- **"再试一次修复"（已经尝试了 2 次以上）**
- **每次修复都暴露出不同地方的新问题**

**以上这些都意味着：停下来。回到第一阶段。**

**如果 3 次以上修复都失败了：** 质疑架构（见第四阶段第 5 步）

## 搭档发出的信号——说明你的方法不对

**留意这些提醒：**
- "难道不是这样吗？"——你在没有验证的情况下做了假设
- "它能告诉我们……吗？"——你应该先收集证据
- "别猜了"——你在没有理解的情况下提出修复
- "深入想想"——要质疑根本性问题，而不只是症状
- "我们卡住了？"（沮丧的语气）——你的方法没有奏效

**当你看到这些信号时：** 停下来。回到第一阶段。

## 常见借口

| 借口 | 现实 |
|------|------|
| "问题很简单，不需要走流程" | 简单问题也有根本原因。对于简单 bug，流程很快就能走完。 |
| "紧急情况，没时间走流程" | 系统化调试比反复猜测式修复更快。 |
| "先试一下，再排查" | 第一次修复就定下了基调。从一开始就做对。 |
| "确认修复有效后再写测试" | 没有测试的修复留不住。先写测试才能证明修复有效。 |
| "一次修多个问题省时间" | 无法隔离哪个生效了。还会引入新 bug。 |
| "参考实现太长了，我自己改改" | 一知半解必然出 bug。完整阅读。 |
| "我看出问题了，让我修一下" | 看到症状 ≠ 理解根因。 |
| "再试一次"（在 2 次以上失败后） | 3 次以上失败 = 架构问题。质疑模式，不要继续修。 |

## 速查表

| 阶段 | 关键活动 | 通过标准 |
|------|---------|---------|
| **1. 根因** | 阅读错误、复现、检查变更、收集证据 | 理解了什么出了问题以及为什么 |
| **2. 模式** | 找到正常示例、对比 | 识别出差异 |
| **3. 假设** | 提出理论、最小化验证 | 假设被验证或产生新假设 |
| **4. 实施** | 创建测试、修复、验证 | bug 已修复，测试通过 |

## 当流程显示"找不到根因"

如果系统化排查后发现问题确实是环境相关、时序相关或外部因素导致的：

1. 你已经完成了流程
2. 记录你排查了什么
3. 实施适当的处理措施（重试、超时、错误提示）
4. 添加监控/日志以便后续排查

**但是：** 95% 的"找不到根因"其实是排查不充分。

## 辅助技术

以下技术是系统化调试的组成部分，可在本目录中找到：

- **\`root-cause-tracing.md\`** - 沿调用栈反向追踪 bug，找到最初的触发点
- **\`defense-in-depth.md\`** - 找到根因后，在多个层级添加校验
- **\`condition-based-waiting.md\`** - 用条件轮询替代硬编码等待时间

**相关技能：**
- **superpowers:test-driven-development** - 用于创建失败测试用例（第四阶段，第 1 步）
- **superpowers:verification-before-completion** - 在宣称成功之前验证修复确实有效

## 实际效果

调试实践中的数据：
- 系统化方法：15-30 分钟修复
- 随意修复方法：2-3 小时反复折腾
- 一次修复成功率：95% vs 40%
- 引入新 bug：几乎为零 vs 经常发生
`;
    const contentHash12 = "6586b1d2e787c5cf74576ee78a7cbe518013f51fc5254f8cb239748b6e11b5aa";
    await p.skill.create({ data: { name: "systematic-debugging", description: "遇到任何 bug、测试失败或异常行为时使用，在提出修复方案之前执行", skillMd: skillMd12, contentHash: contentHash12, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "systematic-debugging", status: "success", startTime: 100, duration: 1620, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "systematic-debugging", status: "success", startTime: 100, duration: 683, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "systematic-debugging", status: "success", startTime: 100, duration: 1599, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
  }

  // test-driven-development: 8 calls
  {
    const skillMd13 = `---
name: test-driven-development
description: 在实现任何功能或修复 bug 时使用，在编写实现代码之前
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [testing, development]
---

# 测试驱动开发（TDD）

## 概述

先写测试。看它失败。写最少的代码让它通过。

**核心原则：** 如果你没有看到测试失败，你就不知道它是否测试了正确的东西。

**违反规则的字面意思就是违反规则的精神。**

## 何时使用

**始终使用：**
- 新功能
- Bug 修复
- 重构
- 行为变更

**例外（需询问你的人类伙伴）：**
- 一次性原型
- 生成的代码
- 配置文件

想着"就这一次跳过 TDD"？停下来。那是在给自己找借口。

## 铁律

\`\`\`
没有失败的测试，就不写生产代码
\`\`\`

先写了代码再写测试？删掉它。从头来过。

**没有例外：**
- 不要保留作为"参考"
- 不要在写测试时"改编"它
- 不要看它
- 删除就是删除

从测试出发，重新实现。句号。

## 红-绿-重构

\`\`\`dot
digraph tdd_cycle {
    rankdir=LR;
    red [label="红灯\\n编写失败的测试", shape=box, style=filled, fillcolor="#ffcccc"];
    verify_red [label="验证正确失败", shape=diamond];
    green [label="绿灯\\n最少代码", shape=box, style=filled, fillcolor="#ccffcc"];
    verify_green [label="验证通过\\n全部绿灯", shape=diamond];
    refactor [label="重构\\n清理代码", shape=box, style=filled, fillcolor="#ccccff"];
    next [label="下一个", shape=ellipse];

    red -> verify_red;
    verify_red -> green [label="是"];
    verify_red -> red [label="错误的\\n失败"];
    green -> verify_green;
    verify_green -> refactor [label="是"];
    verify_green -> green [label="否"];
    refactor -> verify_green [label="保持\\n绿灯"];
    verify_green -> next;
    next -> red;
}
\`\`\`

### 红灯 - 编写失败的测试

写一个最小的测试来展示期望行为。

<Good>
\`\`\`typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
\`\`\`
名称清晰，测试真实行为，只测一件事
</Good>

<Bad>
\`\`\`typescript
test('retry works', async () => {
  const mock = jest.fn()
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce('success');
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(3);
});
\`\`\`
名称模糊，测试的是 mock 而非代码
</Bad>

**要求：**
- 一个行为
- 清晰的名称
- 使用真实代码（除非不得已才用 mock）

### 验证红灯 - 看它失败

**必须执行。绝不跳过。**

\`\`\`bash
npm test path/to/test.test.ts
\`\`\`

确认：
- 测试失败（不是报错）
- 失败信息符合预期
- 失败原因是功能缺失（不是拼写错误）

**测试通过了？** 你在测试已有的行为。修改测试。

**测试报错了？** 修复错误，重新运行直到它正确地失败。

### 绿灯 - 最少代码

写最简单的代码让测试通过。

<Good>
\`\`\`typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error('unreachable');
}
\`\`\`
刚好够通过测试
</Good>

<Bad>
\`\`\`typescript
async function retryOperation<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    backoff?: 'linear' | 'exponential';
    onRetry?: (attempt: number) => void;
  }
): Promise<T> {
  // YAGNI
}
\`\`\`
过度设计
</Bad>

不要添加功能、重构其他代码或做超出测试要求的"改进"。

### 验证绿灯 - 看它通过

**必须执行。**

\`\`\`bash
npm test path/to/test.test.ts
\`\`\`

确认：
- 测试通过
- 其他测试仍然通过
- 输出干净（没有错误、警告）

**测试失败了？** 修改代码，不是测试。

**其他测试失败了？** 立即修复。

### 重构 - 清理代码

只有在绿灯之后才重构：
- 消除重复
- 改善命名
- 提取辅助函数

保持测试绿灯。不要添加行为。

### 重复

为下一个功能写下一个失败的测试。

## 好的测试

| 特质 | 好的 | 差的 |
|------|------|------|
| **最小化** | 只测一件事。名称中有"和"？拆分它。 | \`test('validates email and domain and whitespace')\` |
| **清晰** | 名称描述行为 | \`test('test1')\` |
| **展示意图** | 展示期望的 API | 掩盖了代码应该做什么 |

## 为什么顺序很重要

**"我先写完再补测试来验证"**

后写的测试立即通过。立即通过什么也证明不了：
- 可能测试了错误的东西
- 可能测试的是实现而非行为
- 可能遗漏了你忘掉的边界情况
- 你从未看到它捕获 bug

先写测试迫使你看到测试失败，证明它确实在测试某些东西。

**"我已经手动测试了所有边界情况"**

手动测试是临时的。你以为你测试了所有情况，但是：
- 没有测试记录
- 代码变更后无法重新运行
- 在压力下容易遗忘
- "我试过了能跑" 不等于 全面测试

自动化测试是系统性的。它们每次以相同方式运行。

**"删除 X 小时的工作太浪费了"**

沉没成本谬误。时间已经花了。你现在的选择：
- 删除并用 TDD 重写（再花 X 小时，高信心）
- 保留并后补测试（30 分钟，低信心，可能有 bug）

"浪费"的是保留你无法信任的代码。没有真正测试的可运行代码就是技术债。

**"TDD 太教条了，务实意味着灵活变通"**

TDD 就是务实的：
- 在 commit 前发现 bug（比事后调试快）
- 防止回归（测试立即发现破坏）
- 记录行为（测试展示如何使用代码）
- 支持重构（放心修改，测试捕获破坏）

"务实的"捷径 = 在生产环境调试 = 更慢。

**"后补测试也能达到相同目的——重要的是精神不是仪式"**

不对。后补测试回答"这段代码做了什么？"先写测试回答"这段代码应该做什么？"

后补测试受你实现的偏见影响。你测试的是你构建的东西，而非需求要求的。你验证的是你记得的边界情况，而非发现的。

先写测试迫使你在实现前发现边界情况。后补测试验证的是你记住了所有情况（你没有）。

30 分钟的后补测试 ≠ TDD。你得到了覆盖率，但失去了测试有效的证明。

## 常见借口

| 借口 | 现实 |
|------|------|
| "太简单了不用测" | 简单的代码也会出 bug。测试只需 30 秒。 |
| "我之后补测试" | 立即通过的测试什么也证明不了。 |
| "后补测试也能达到相同目的" | 后补测试 = "这做了什么？" 先写测试 = "这应该做什么？" |
| "已经手动测试过了" | 临时测试 ≠ 系统测试。无记录，无法重现。 |
| "删除 X 小时的工作太浪费" | 沉没成本谬误。保留未验证的代码就是技术债。 |
| "留作参考，然后先写测试" | 你会去改编它。那就是后补测试。删除就是删除。 |
| "需要先探索一下" | 可以。探索完了扔掉，从 TDD 开始。 |
| "测试难写 = 设计不清楚" | 听测试的。难以测试 = 难以使用。 |
| "TDD 会拖慢我" | TDD 比调试快。务实 = 先写测试。 |
| "手动测试更快" | 手动测试无法证明边界情况。每次修改你都得重新测。 |
| "现有代码没有测试" | 你在改进它。为现有代码补测试。 |

## 危险信号 - 停下来，从头开始

- 先写了代码再写测试
- 实现完了才补测试
- 测试立即通过
- 无法解释测试为什么失败
- "之后再补"测试
- 说服自己"就这一次"
- "我已经手动测试过了"
- "后补测试也能达到相同目的"
- "重要的是精神不是仪式"
- "留作参考"或"改编现有代码"
- "已经花了 X 小时了，删掉太浪费"
- "TDD 太教条了，我是在务实"
- "这次情况不同，因为……"

**以上所有情况都意味着：删除代码。用 TDD 从头开始。**

## 示例：Bug 修复

**Bug：** 空邮箱被接受了

**红灯**
\`\`\`typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
\`\`\`

**验证红灯**
\`\`\`bash
$ npm test
FAIL: expected 'Email required', got undefined
\`\`\`

**绿灯**
\`\`\`typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
  // ...
}
\`\`\`

**验证绿灯**
\`\`\`bash
$ npm test
PASS
\`\`\`

**重构**
如果需要，提取验证逻辑以支持多个字段。

## 验证清单

在标记工作完成之前：

- [ ] 每个新函数/方法都有测试
- [ ] 在实现之前看到每个测试失败
- [ ] 每个测试因预期原因失败（功能缺失，不是拼写错误）
- [ ] 为每个测试编写了最少代码使其通过
- [ ] 所有测试通过
- [ ] 输出干净（没有错误、警告）
- [ ] 测试使用真实代码（只在不可避免时用 mock）
- [ ] 覆盖了边界情况和错误场景

不能全部勾选？你跳过了 TDD。从头开始。

## 遇到困难时

| 问题 | 解决方案 |
|------|----------|
| 不知道怎么测试 | 写出你期望的 API。先写断言。问你的人类伙伴。 |
| 测试太复杂 | 设计太复杂。简化接口。 |
| 必须 mock 所有东西 | 代码耦合太紧。使用依赖注入。 |
| 测试 setup 太庞大 | 提取辅助函数。还是复杂？简化设计。 |

## 调试集成

发现 bug？写一个重现 bug 的失败测试。按 TDD 循环走。测试既证明了修复有效，又防止了回归。

绝不在没有测试的情况下修复 bug。

## 测试反模式

添加 mock 或测试工具时，阅读 @testing-anti-patterns.md 以避免常见陷阱：
- 测试 mock 行为而非真实行为
- 在生产类中添加仅测试用的方法
- 在不理解依赖的情况下使用 mock

## 最终规则

\`\`\`
生产代码 → 测试存在且先失败
否则 → 不是 TDD
\`\`\`

没有你的人类伙伴的许可，没有例外。
`;
    const contentHash13 = "71d6187b60a34336981daba68fa0a8d90bd31fdb71b60ad7cdb9c34b3b74c843";
    await p.skill.create({ data: { name: "test-driven-development", description: "在实现任何功能或修复 bug 时使用，在编写实现代码之前", skillMd: skillMd13, contentHash: contentHash13, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 354, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 527, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 495, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 0 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 580, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 1783, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 424, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 950, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "test-driven-development", status: "success", startTime: 100, duration: 1347, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
  }

  // using-git-worktrees: 4 calls
  {
    const skillMd14 = `---
name: using-git-worktrees
description: 当需要开始与当前工作区隔离的功能开发，或在执行实现计划之前使用——通过原生工具或 git worktree 回退机制确保隔离工作区存在
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [git, workflow]
---

# 使用 Git 工作树

## 概述

确保工作发生在隔离的工作区中。优先使用你的平台的原生 worktree 工具。仅在没有原生工具可用时，再回退到手动 git worktree。

**核心原则：** 先检测现有隔离。然后用原生工具。再回退到 git。绝不与 harness 对抗。

**开始时宣布：** "我正在使用 using-git-worktrees 技能来建立一个隔离的工作区。"

## 步骤 0：检测现有隔离

**创建任何东西之前，先检查你是否已经在一个隔离的工作区里。**

\`\`\`bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
\`\`\`

**Submodule 守卫：** 在 git submodule 内 \`GIT_DIR != GIT_COMMON\` 也为真。在判定"已经在 worktree 内"之前，先确认你不在 submodule 里：

\`\`\`bash
# 如果这条命令返回路径，说明你在 submodule 里，不是 worktree —— 按普通仓库处理
git rev-parse --show-superproject-working-tree 2>/dev/null
\`\`\`

**如果 \`GIT_DIR != GIT_COMMON\`（且不是 submodule）：** 你已经在一个 linked worktree 内。跳到步骤 2（项目设置）。**不要**再创建一个 worktree。

按分支状态报告：

- 在某个分支上："已经在隔离工作区 \`<path>\`，分支 \`<name>\`。"
- 分离 HEAD："已经在隔离工作区 \`<path>\`（分离 HEAD，由外部管理）。完成时需要创建分支。"

**如果 \`GIT_DIR == GIT_COMMON\`（或在 submodule 内）：** 你在一个普通的仓库检出里。

用户是否已经在你的 instructions 里表明过 worktree 偏好？如果没有，创建 worktree 之前先征求同意：

> "你希望我搭一个隔离的 worktree 吗？它能保护你当前分支不被改动。"

如果用户已声明过偏好，直接遵循，不再询问。如果用户拒绝同意，原地工作并跳到步骤 2。

## 步骤 1：创建隔离工作区

**你有两种机制。按这个顺序尝试。**

### 1a. 原生 Worktree 工具（首选）

用户已经请求隔离工作区（步骤 0 已获同意）。你是否已经有创建 worktree 的方法？可能是名为 \`EnterWorktree\`、\`WorktreeCreate\` 的工具、\`/worktree\` 命令，或 \`--worktree\` 标志。如果有，用它，然后跳到步骤 2。

原生工具自动处理目录放置、分支创建和清理。在你已经有原生工具的情况下使用 \`git worktree add\`，会创建你的 harness 看不到也无法管理的"幻影状态"。

只有在没有原生 worktree 工具可用时，才进入步骤 1b。

### 1b. Git Worktree 回退

**只在步骤 1a 不适用时使用** —— 你没有可用的原生 worktree 工具。手动用 git 创建 worktree。

#### 目录选择

按以下优先级。明确的用户偏好始终优先于观察到的文件系统状态。

1. **检查你的 instructions 里是否声明过 worktree 目录偏好。** 如果用户已指定，不再询问直接用。

2. **检查是否存在项目本地的 worktree 目录：**

   \`\`\`bash
   ls -d .worktrees 2>/dev/null     # 首选（隐藏目录）
   ls -d worktrees 2>/dev/null      # 备选
   \`\`\`

   找到就用。如果两者都存在，\`.worktrees\` 优先。

3. **如果没有其他可参考的信息**，默认用项目根目录下的 \`.worktrees/\`。

#### 安全验证（仅项目本地目录）

**创建 worktree 前必须验证目录已被忽略：**

\`\`\`bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
\`\`\`

**如果未被忽略：** 添加到 .gitignore，提交该改动，然后继续。

**为什么关键：** 防止 worktree 内容被意外提交到仓库。

#### 创建工作树

\`\`\`bash
# 根据选定位置确定路径
path="$LOCATION/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
\`\`\`

**沙盒回退：** 如果 \`git worktree add\` 因权限错误（沙盒拒绝）失败，告诉用户沙盒阻止了 worktree 创建，你将在当前目录原地工作。然后原地运行 setup 和基线测试。

## 步骤 2：项目设置

自动检测并运行相应的设置命令：

\`\`\`bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
\`\`\`

## 步骤 3：验证基线干净

运行测试确保工作区初始状态干净：

\`\`\`bash
# 使用项目对应的命令
npm test / cargo test / pytest / go test ./...
\`\`\`

**如果测试失败：** 报告失败，询问是继续还是排查。

**如果测试通过：** 报告就绪。

### 报告

\`\`\`
工作树已就绪：<full-path>
测试通过（<N> 个测试，0 个失败）
准备实现 <feature-name>
\`\`\`

## 快速参考

| 情况 | 操作 |
|------|------|
| 已在 linked worktree 内 | 跳过创建（步骤 0） |
| 在 submodule 内 | 按普通仓库处理（步骤 0 守卫） |
| 有原生 worktree 工具 | 用它（步骤 1a） |
| 没有原生工具 | git worktree 回退（步骤 1b） |
| \`.worktrees/\` 存在 | 用它（验证已忽略） |
| \`worktrees/\` 存在 | 用它（验证已忽略） |
| 两者都存在 | 用 \`.worktrees/\` |
| 都不存在 | 检查 instructions 文件，再默认 \`.worktrees/\` |
| 目录未被忽略 | 添加到 .gitignore + 提交 |
| 创建时权限错误 | 沙盒回退，原地工作 |
| 基线测试失败 | 报告失败 + 询问 |
| 无 package.json/Cargo.toml | 跳过依赖安装 |

## 常见错误

### 与 harness 对抗

- **问题：** 平台已经提供隔离的情况下还在用 \`git worktree add\`
- **修复：** 步骤 0 检测现有隔离。步骤 1a 让位给原生工具。

### 跳过检测

- **问题：** 在已有的 worktree 内嵌套创建另一个 worktree
- **修复：** 创建任何东西之前都先跑步骤 0

### 跳过忽略验证

- **问题：** worktree 内容被跟踪，污染 git status
- **修复：** 创建项目本地 worktree 前始终使用 \`git check-ignore\`

### 假设目录位置

- **问题：** 造成不一致、违反项目约定
- **修复：** 遵循优先级：明确 instructions > 现有项目本地目录 > 默认

### 带着失败的测试继续

- **问题：** 无法区分新 bug 和已有问题
- **修复：** 报告失败，获得明确许可后再继续

## 红线

**绝不：**

- 步骤 0 已检测到现有隔离时还创建 worktree
- 在已有原生 worktree 工具（如 \`EnterWorktree\`）的情况下还用 \`git worktree add\`。这是 #1 错误——有就用。
- 跳过步骤 1a 直接跳到步骤 1b 的 git 命令
- 不验证已忽略就创建项目本地 worktree
- 跳过基线测试验证
- 不询问就带着失败的测试继续

**始终：**

- 先跑步骤 0 检测
- 优先原生工具，其次 git 回退
- 遵循目录优先级：明确 instructions > 现有项目本地目录 > 默认
- 项目本地目录验证已忽略
- 自动检测并运行项目设置
- 验证测试基线干净

## 集成

**被以下技能调用：**

- **brainstorming**（阶段 4）- 设计通过且需要实现时必需
- **subagent-driven-development** - 执行任何任务前必需
- **executing-plans** - 执行任何任务前必需
- 任何需要隔离工作区的技能

**配合使用：**

- **finishing-a-development-branch** - 工作完成后清理时必需
`;
    const contentHash14 = "fc77eef6f481ba411229771e6821dac268652b482d3924f80678c5a84acefe26";
    await p.skill.create({ data: { name: "using-git-worktrees", description: "当需要开始与当前工作区隔离的功能开发，或在执行实现计划之前使用——通过原生工具或 git worktree 回退机制确保隔离工作区存在", skillMd: skillMd14, contentHash: contentHash14, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-git-worktrees", status: "success", startTime: 100, duration: 1780, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-git-worktrees", status: "success", startTime: 100, duration: 527, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-git-worktrees", status: "success", startTime: 100, duration: 579, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-git-worktrees", status: "success", startTime: 100, duration: 479, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
  }

  // using-superpowers: 9 calls
  {
    const skillMd15 = `---
name: using-superpowers
description: 在开始任何对话时使用——确立如何查找和使用技能，要求在任何响应（包括澄清性问题）之前调用 Skill 工具
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [meta, getting-started]
---

<SUBAGENT-STOP>
如果你是作为子智能体被分派来执行特定任务的，忽略此技能。
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
如果你认为哪怕只有 1% 的可能性某个技能适用于你正在做的事情，你绝对必须调用该技能。

如果一个技能适用于你的任务，你没有选择。你必须使用它。

这不可协商。你不能通过合理化来逃避。
</EXTREMELY-IMPORTANT>

## 规则

**在任何响应或操作之前调用相关或被请求的技能**——包括澄清性问题、探索代码库、或查看文件之前。如果调用后发现技能不适合当前情况，你不需要使用它。

**在进入 EnterPlanMode 之前：** 如果你还没有头脑风暴过，先调用头脑风暴技能。

然后宣布"使用 [技能] 来 [目的]"，并严格遵循该技能。如果它有检查清单，为每个条目创建一个待办。

## 技能优先级

当多个技能都适用时，流程技能优先——它们决定处理方式，然后由实现技能（前端设计等）负责执行。头脑风暴和系统化调试是 Superpowers 中最常见的流程技能，但这条规则适用于任何流程技能。

- "让我们构建 X" → 先用 superpowers:brainstorming，再用实现技能。
- "修复这个 bug" → 先用 superpowers:systematic-debugging，再用领域技能。

## 红线

这些想法意味着停下——你在合理化：

| 想法 | 现实 |
|------|------|
| "这只是一个简单的问题" | 问题就是任务。检查技能。 |
| "我需要先了解更多上下文" | 技能检查在澄清性问题之前。 |
| "让我先探索一下代码库" | 技能告诉你如何探索。先检查。 |
| "我可以快速查一下 git/文件" | 文件缺少对话上下文。检查技能。 |
| "让我先收集信息" | 技能告诉你如何收集信息。 |
| "这不需要正式的技能" | 如果技能存在，就使用它。 |
| "我记得这个技能" | 技能会迭代更新。阅读当前版本。 |
| "这不算一个任务" | 行动 = 任务。检查技能。 |
| "技能太小题大做了" | 简单的事会变复杂。使用它。 |
| "让我先做这一件事" | 在做任何事之前先检查。 |
| "这样做感觉很高效" | 无纪律的行动浪费时间。技能防止这一点。 |
| "我知道那是什么意思" | 知道概念 ≠ 使用技能。调用它。 |

## 平台适配

如果你的运行环境在下面列出，请阅读对应的参考文件获取特殊说明：

- Codex：\`references/codex-tools.md\`
- Pi：\`references/pi-tools.md\`
- Copilot CLI：\`references/copilot-tools.md\`
- Hermes Agent：\`references/hermes-tools.md\`
- Qoder：\`references/qoder-tools.md\`

Gemini CLI 用户通过 GEMINI.md 自动获得 \`references/gemini-tools.md\` 的工具映射。

## 中国特色技能路由

当检测到以下场景时，**必须**优先调用对应的中国特色技能：

| 场景 | 调用技能 |
|------|---------|
| 代码审查且团队使用中文沟通 | **superpowers:chinese-code-review** |
| 使用 Gitee/Coding/极狐 GitLab | **superpowers:chinese-git-workflow** |
| 编写中文技术文档或 README | **superpowers:chinese-documentation** |
| 编写 git commit message（中文项目） | **superpowers:chinese-commit-conventions** |
| 构建 MCP 服务器/工具 | **superpowers:mcp-builder** |

**判断依据：**
- 项目中有中文注释、中文 README、或 .gitee 目录 → 启用中文系列技能
- commit 历史中有中文 → 使用中文提交规范
- 用户用中文交流 → 所有输出使用中文，优先考虑中国特色技能

中国特色技能与翻译技能**叠加使用**，不互斥。例如：做代码审查时，同时使用 requesting-code-review（流程）+ chinese-code-review（风格）。

## 用户指令

用户指令（CLAUDE.md、AGENTS.md、GEMINI.md 等、直接请求）优先于技能，技能又优先于默认行为。只有当你的人类伙伴明确告诉你跳过时，才能跳过技能工作流或指令。
`;
    const contentHash15 = "cee73afca03454d2d3012011ee7878b93cfb78badd6c289a4039826f7dc1b173";
    await p.skill.create({ data: { name: "using-superpowers", description: "在开始任何对话时使用——确立如何查找和使用技能，要求在任何响应（包括澄清性问题）之前调用 Skill 工具", skillMd: skillMd15, contentHash: contentHash15, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1278, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 314, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 939, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 812, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1337, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1636, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1746, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1645, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "using-superpowers", status: "success", startTime: 100, duration: 1530, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
  }

  // verification-before-completion: 2 calls
  {
    const skillMd16 = `---
name: verification-before-completion
description: 在宣称工作完成、已修复或测试通过之前使用，在提交或创建 PR 之前——必须运行验证命令并确认输出后才能声称成功；始终用证据支撑断言
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [quality, verification]
---

# 完成前验证

## 概述

在没有验证的情况下宣称工作完成，这不是高效，而是不诚实。

**核心原则：** 始终用证据支撑结论。

**对这条规则敷衍了事，就等于违背了它的精神。**

## 铁律

\`\`\`
没有新鲜的验证证据，不许宣称完成
\`\`\`

如果你在这条消息中没有运行验证命令，就不能声称测试通过。

## 门控函数

\`\`\`
在宣称任何状态或表达满意之前：

1. 确定：什么命令能证明这个结论？
2. 运行：执行完整命令（重新运行，完整执行）
3. 阅读：完整输出，检查退出码，统计失败数
4. 验证：输出是否支持这个结论？
   - 如果否：用证据说明实际状态
   - 如果是：带证据陈述结论
5. 只有这时：才能做出结论

跳过任何一步 = 说谎，不是验证
\`\`\`

## 常见失败模式

| 结论 | 需要 | 不够格 |
|------|------|--------|
| 测试通过 | 测试命令输出：0 failures | 之前的运行结果、"应该会通过" |
| Linter 无报错 | Linter 输出：0 errors | 部分检查、推断 |
| 构建成功 | 构建命令：exit 0 | linter 通过、日志看起来没问题 |
| Bug 已修复 | 测试原始症状：通过 | 代码改了，假设已修复 |
| 回归测试有效 | 红-绿循环已验证 | 测试只通过了一次 |
| 代理已完成 | VCS diff 显示变更 | 代理报告"成功" |
| 需求已满足 | 逐项核对清单 | 测试通过 |

## 红线——停下来

- 使用"应该"、"大概"、"似乎"
- 验证前就表达满意（"太好了！"、"完美！"、"搞定！"等）
- 即将提交/推送/创建 PR 却没有验证
- 信任代理的成功报告
- 依赖部分验证
- 想着"就这一次"
- 累了想赶紧收工
- **任何暗示成功但实际未运行验证的措辞**

## 防止合理化

| 借口 | 现实 |
|------|------|
| "应该能行了" | 运行验证命令 |
| "我有信心" | 信心 ≠ 证据 |
| "就这一次" | 没有例外 |
| "Linter 通过了" | Linter ≠ 编译器 |
| "代理说成功了" | 独立验证 |
| "我累了" | 疲劳 ≠ 借口 |
| "部分检查就够了" | 部分检查什么也证明不了 |
| "换个说法这条规则就不适用了" | 精神大于字面 |

## 关键模式

**测试：**
\`\`\`
✅ [运行测试命令] [看到：34/34 pass] "全部测试通过"
❌ "应该能通过了" / "看起来对了"
\`\`\`

**回归测试（TDD 红-绿）：**
\`\`\`
✅ 编写 → 运行（通过）→ 回退修复 → 运行（必须失败）→ 恢复 → 运行（通过）
❌ "我写了回归测试"（没有经过红-绿验证）
\`\`\`

**构建：**
\`\`\`
✅ [运行构建] [看到：exit 0] "构建通过"
❌ "Linter 通过了"（linter 不检查编译）
\`\`\`

**需求：**
\`\`\`
✅ 重读计划 → 创建核对清单 → 逐项验证 → 报告缺口或完成
❌ "测试通过了，阶段完成"
\`\`\`

**代理委派：**
\`\`\`
✅ 代理报告成功 → 检查 VCS diff → 验证变更 → 报告实际状态
❌ 信任代理报告
\`\`\`

## 为什么这很重要

来自 24 次失败记录：
- 搭档说"我不信你"——信任被破坏
- 未定义的函数被交付——会直接崩溃
- 遗漏需求被交付——功能不完整
- 虚假完成浪费的时间 → 返工 → 重做
- 违反原则："诚实是核心价值。如果你说谎，就会被替换。"

## 何时使用

**以下情况之前必须使用：**
- 任何形式的成功/完成声明
- 任何满意的表达
- 任何关于工作状态的正面陈述
- 提交、创建 PR、标记任务完成
- 进入下一个任务
- 委派给代理

**本规则适用于：**
- 准确措辞
- 同义词和换一种说法
- 暗示成功
- 任何传达完成/正确性的沟通

## 底线

**验证没有捷径。**

运行命令。阅读输出。然后才能宣称结果。

这没有商量余地。
`;
    const contentHash16 = "27ffbe6005fd798859d3d344d0288bcb3efdb89f6c151ea943027711986bff30";
    await p.skill.create({ data: { name: "verification-before-completion", description: "在宣称工作完成、已修复或测试通过之前使用，在提交或创建 PR 之前——必须运行验证命令并确认输出后才能声称成功；始终用证据支撑断言", skillMd: skillMd16, contentHash: contentHash16, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "verification-before-completion", status: "success", startTime: 100, duration: 1678, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 1 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "verification-before-completion", status: "success", startTime: 100, duration: 1402, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
  }

  // workflow-runner: 9 calls
  {
    const skillMd17 = `---
name: workflow-runner
description: "在 Claude Code / OpenClaw / Cursor 中直接运行 agency-orchestrator YAML 工作流——无需 API key，使用当前会话的 LLM 作为执行引擎。当用户提供 .yaml 工作流文件或要求多角色协作完成任务时触发。"
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [execution, workflow]
---

# 工作流执行器：在 AI 工具内运行多角色编排

直接在当前会话中执行 agency-orchestrator 的 YAML 工作流，无需配置 API key。当前 LLM 就是执行引擎——依次扮演每个角色完成任务。

## 适用场景

- 用户提供了一个 \`.yaml\` 工作流文件（如 \`运行 workflows/story-creation.yaml\`）
- 用户要求多个角色协作完成任务（如"用产品经理和架构师一起评审这个 PRD"）
- 用户安装了 \`agency-agents-zh\` 并希望直接在 AI 工具内编排多角色

## 执行流程（5 步）

按以下顺序执行，不要跳步：

### 第 1 步：解析工作流

用 Read 工具读取用户指定的 YAML 文件，提取以下字段：

\`\`\`yaml
name: "工作流名称"
agents_dir: "agency-agents-zh"    # 角色定义目录
inputs:                            # 输入变量
  - name: xxx
    required: true/false
    default: "默认值"
steps:                             # 执行步骤
  - id: step_id
    role: "category/agent-name"    # 角色路径
    task: "任务描述 {{变量}}"       # 支持模板变量
    output: variable_name          # 输出变量名
    depends_on: [other_step_id]    # 依赖关系
\`\`\`

**忽略 \`llm\`、\`concurrency\`、\`timeout\`、\`retry\` 配置**——Skill 模式使用当前会话的 LLM，这些字段仅用于 CLI 模式。

**定位角色目录**：用 Bash \`test -d\` 按以下顺序检查，用第一个存在的：
1. 当前工作目录下的 \`{agents_dir}/\`（如 \`./agency-agents-zh/\`）
2. \`../{agents_dir}/\`（上级目录）
3. 相对于 YAML 文件所在目录的 \`{agents_dir}/\`
4. \`node_modules/agency-agents-zh/\`

如果全部找不到，**停止执行**并提示用户：
\`\`\`
找不到角色目录。请先安装：
  git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git
  或：npm install agency-agents-zh
\`\`\`

### 第 2 步：收集输入

- 对每个 \`required: true\` 的输入，检查用户消息中是否已提供值
- 未提供的必填输入：**立即向用户询问**，不要猜测或用空值
- 有 \`default\` 的可选输入：使用默认值
- 无默认值的可选输入：设为空字符串

### 第 3 步：构建执行顺序

根据 \`depends_on\` 进行拓扑排序，将步骤分成多个层级：

- **无 depends_on 的步骤** → 第 1 层
- **depends_on 全部在第 N 层或之前的步骤** → 第 N+1 层
- **同一层内的步骤**互不依赖，可并行

在回复中展示执行计划：
\`\`\`
执行计划（共 N 步）：
  第 1 层: [step_id] — 角色名
  第 2 层: [step_a, step_b] — 并行
  第 3 层: [step_id] — 角色名
\`\`\`

### 第 4 步：逐层执行

对每一层：

#### 4a. 预读角色文件

用 Read 工具读取该层所有步骤的角色 \`.md\` 文件：\`{角色目录}/{role}.md\`

从文件中提取：
- **角色名**：frontmatter 中的 \`name\` 字段
- **角色 system prompt**：第二个 \`---\` 之后的全部 markdown 内容

#### 4b. 渲染 task 模板

将 task 中的 \`{{变量名}}\` 替换为：
- 来自 inputs 的用户输入值
- 来自前序步骤 output 的结果文本

#### 4c. 执行

**单步骤层**：直接在主会话中扮演该角色执行。格式：

\`\`\`
### Step N/Total: step_id（角色名）

[以该角色身份完成 task，使用角色的专业知识和沟通风格]
\`\`\`

**多步骤层（并行）**：使用 Agent 工具为每个步骤启动子代理。每个子代理的 prompt 必须包含：
- 角色文件的**完整文本内容**（不是路径——子代理可能无法读文件）
- 渲染后的 task 文本
- 指令："以上是你的角色定义，请以该角色身份完成以下任务，直接输出结果"

#### 4d. 保存输出到上下文

如果 step 有 \`output\` 字段，将该步骤的输出文本存入变量上下文，供后续步骤的 \`{{变量}}\` 使用。

### 第 5 步：保存结果并展示

用 Write 工具将结果保存到文件：

\`\`\`
.ao-output/{工作流名称}-{YYYY-MM-DD}/
├── steps/
│   ├── 1-{step_id}.md       # 每步的输出
│   ├── 2-{step_id}.md
│   └── ...
├── summary.md                # 最后一步的完整输出（最终成果）
└── metadata.json             # 基本元数据
\`\`\`

metadata.json 格式：
\`\`\`json
{
  "name": "工作流名称",
  "date": "2026-03-22",
  "success": true,
  "steps": [
    {"id": "step_id", "role": "category/agent", "status": "completed"},
    ...
  ]
}
\`\`\`

执行完毕后，向用户展示：
1. 最终成果（summary.md 的内容）
2. 文件保存位置
3. 执行了几个步骤

## 重要规则

<HARD-GATE>
- 每个步骤都必须真正扮演对应角色，使用该角色的专业知识和沟通风格，不能泛泛回答
- 角色切换必须明确——每步开始时标注角色名
- 不要跳过步骤或合并步骤，严格按 DAG 层级顺序执行
- 如果角色文件找不到，告知用户并建议安装 agency-agents-zh
- 不要在没有读取角色 .md 文件的情况下执行步骤——必须先 Read 再执行
</HARD-GATE>

## 没有 YAML 文件时的快捷模式

如果用户没有指定 YAML 文件，但描述了需要多角色协作的任务：

1. 根据用户描述，**自动生成** YAML 工作流定义
2. 展示给用户确认
3. 确认后按上述流程执行

示例：
- 用户说"帮我用叙事学家和心理学家写个故事" → 生成 story-creation 类似的工作流
- 用户说"让产品经理和架构师评审这个 PRD" → 生成 product-review 类似的工作流

## 故障处理

- **角色文件不存在**：提示用户运行 \`ao init\` 或 \`npm install agency-agents-zh\`
- **模板变量未定义**：检查上下文，如果是必填输入则向用户询问
- **步骤执行失败**：标记该步骤为失败，跳过所有依赖它的下游步骤，继续执行其他独立步骤
`;
    const contentHash17 = "445b25e66a8ab8cd1102e4bebdf8cd616a520b8d78e3684a0ffe6b3a11804e31";
    await p.skill.create({ data: { name: "workflow-runner", description: "在 Claude Code / OpenClaw / Cursor 中直接运行 agency-orchestrator YAML 工作流——无需 API key", skillMd: skillMd17, contentHash: contentHash17, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 535, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 1778, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 377, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 1756, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 607, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 1305, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 1785, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 981, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 3 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "workflow-runner", status: "success", startTime: 100, duration: 1124, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
  }

  // writing-plans: 9 calls
  {
    const skillMd18 = `---
name: writing-plans
description: 当你有规格说明或需求用于多步骤任务时使用，在动手写代码之前
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [planning, documentation]
---

# 编写计划

## 概述

编写全面的实现计划，假设工程师对我们的代码库零上下文，且品味存疑。记录他们需要知道的一切：每个任务要修改哪些文件、代码、测试、可能需要查阅的文档、如何测试。将整个计划拆成小步骤任务。DRY。YAGNI。TDD。频繁 commit。

假设他们是有经验的开发者，但对我们的工具链和问题领域几乎一无所知。假设他们不太擅长测试设计。

**开始时宣布：** "我正在使用 writing-plans 技能创建实现计划。"

**上下文：** 此技能应在专用 worktree 中运行（由 brainstorming 技能创建）。

**计划保存位置：** \`docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md\`
- （用户对计划位置的偏好优先于此默认值）

## 范围检查

如果规格涵盖了多个独立子系统，它应该在头脑风暴阶段就被拆分为子项目规格。如果没有，建议将其拆分为独立的计划——每个子系统一个。每个计划应该能独立产出可工作、可测试的软件。

## 文件结构

在定义任务之前，先列出将要创建或修改的文件以及每个文件的职责。这是锁定分解决策的地方。

- 设计边界清晰、接口定义良好的单元。每个文件应有一个明确的职责。
- 你对能一次放入上下文的代码推理得最好，文件越专注你的编辑越可靠。优先选择小而专注的文件，而非承担过多功能的大文件。
- 一起变更的文件应放在一起。按职责拆分，而非按技术层级拆分。
- 在现有代码库中，遵循已有模式。如果代码库使用大文件，不要单方面重构——但如果你正在修改的文件已经变得难以管理，在计划中包含拆分是合理的。

此结构决定了任务分解。每个任务应产出独立的、有意义的变更。

## 小步骤任务粒度

**每步是一个操作（2-5 分钟）：**
- "编写失败的测试" - 一步
- "运行它确认失败" - 一步
- "实现最少代码让测试通过" - 一步
- "运行测试确认通过" - 一步
- "Commit" - 一步

## 计划文档头部

**每个计划必须以此头部开始：**

\`\`\`markdown
# [功能名称] 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（\`- [ ]\`）语法来跟踪进度。

**目标：** [一句话描述要构建什么]

**架构：** [2-3 句话描述方案]

**技术栈：** [关键技术/库]

---
\`\`\`

## 任务结构

\`\`\`\`markdown
### 任务 N：[组件名称]

**文件：**
- 创建：\`exact/path/to/file.py\`
- 修改：\`exact/path/to/existing.py:123-145\`
- 测试：\`tests/exact/path/to/test.py\`

- [ ] **步骤 1：编写失败的测试**

\`\`\`python
def test_specific_behavior():
    result = function(input)
    assert result == expected
\`\`\`

- [ ] **步骤 2：运行测试验证失败**

运行：\`pytest tests/path/test.py::test_name -v\`
预期：FAIL，报错 "function not defined"

- [ ] **步骤 3：编写最少实现代码**

\`\`\`python
def function(input):
    return expected
\`\`\`

- [ ] **步骤 4：运行测试验证通过**

运行：\`pytest tests/path/test.py::test_name -v\`
预期：PASS

- [ ] **步骤 5：Commit**

\`\`\`bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
\`\`\`
\`\`\`\`

## 禁止占位符

每个步骤都必须包含工程师需要的实际内容。以下是**计划缺陷**——绝不要写出来：
- "待定"、"TODO"、"后续实现"、"补充细节"
- "添加适当的错误处理" / "添加验证" / "处理边界情况"
- "为上述代码编写测试"（没有实际测试代码）
- "类似任务 N"（重复代码——工程师可能不按顺序阅读任务）
- 只描述做什么而不展示怎么做的步骤（代码步骤必须有代码块）
- 引用了未在任何任务中定义的类型、函数或方法

## 注意事项
- 始终使用精确的文件路径
- 每个步骤都包含完整代码——如果步骤涉及代码变更，就展示代码
- 精确的命令和预期输出
- DRY、YAGNI、TDD、频繁 commit

## 自检

编写完整计划后，以全新视角审视规格并对照检查计划。这是你自己执行的检查清单——不是子代理调度。

**1. 规格覆盖度：** 浏览规格中的每个章节/需求。你能指出实现它的任务吗？列出所有遗漏。

**2. 占位符扫描：** 搜索计划中的红旗——上方"禁止占位符"章节中的任何模式。修复它们。

**3. 类型一致性：** 后续任务中使用的类型、方法签名和属性名是否与前面任务中定义的一致？任务 3 中叫 \`clearLayers()\` 但任务 7 中叫 \`clearFullLayers()\` 就是 bug。

如果发现问题，直接内联修复。无需重新审查——修好继续推进。如果发现规格中的需求没有对应任务，就添加任务。

## 执行交接

保存计划后，提供执行选项：

**"计划已完成并保存到 \`docs/superpowers/plans/<filename>.md\`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？"**

**如果选择子代理驱动：**
- **必需子技能：** 使用 superpowers:subagent-driven-development
- 每个任务一个新子代理 + 两阶段审查

**如果选择内联执行：**
- **必需子技能：** 使用 superpowers:executing-plans
- 批量执行并设有检查点供审查
`;
    const contentHash18 = "e61ade619fa847bd755ddbb5d292d6dc7194f3a95e62c7dafbac7873879f8fbe";
    await p.skill.create({ data: { name: "writing-plans", description: "当你有规格说明或需求用于多步骤任务时使用，在动手写代码之前", skillMd: skillMd18, contentHash: contentHash18, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s1.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 876, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 9 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1561, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 5 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1575, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 6 * 3600000) } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1535, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1523, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s5.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1241, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 7 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1648, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 4 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 659, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
    await p.span.create({ data: { sessionId: s2.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-plans", status: "success", startTime: 100, duration: 1123, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // writing-skills: 2 calls
  {
    const skillMd19 = `---
name: writing-skills
description: 当创建新技能、编辑现有技能或在部署前验证技能是否有效时使用
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [skills, documentation]
---

# 编写技能

## 概述

**编写技能就是将测试驱动开发应用于流程文档。**

**个人技能存放在智能体特定的目录中（Claude Code 用 \`~/.claude/skills\`，Codex 用 \`~/.agents/skills/\`）**

你编写测试用例（带子智能体的压力场景），观察它们失败（基线行为），编写技能（文档），观察测试通过（智能体遵守规则），然后重构（堵住漏洞）。

**核心原则：** 如果你没有观察到智能体在没有该技能时失败，你就不知道这个技能是否教了正确的东西。

**必需背景：** 在使用此技能前，你必须理解 superpowers:test-driven-development。该技能定义了基本的红-绿-重构循环。本技能将 TDD 适配到文档编写中。

**官方指南：** Anthropic 官方的技能编写最佳实践请参见 anthropic-best-practices.md。该文档提供了补充本技能 TDD 导向方法的额外模式和指南。

## 什么是技能？

**技能**是经过验证的技术、模式或工具的参考指南。技能帮助未来的 Claude 实例找到并应用有效的方法。

**技能是：** 可复用的技术、模式、工具、参考指南

**技能不是：** 关于你某次如何解决问题的叙事

## TDD 映射到技能

| TDD 概念 | 技能创建 |
|----------|---------|
| **测试用例** | 带子智能体的压力场景 |
| **生产代码** | 技能文档（SKILL.md） |
| **测试失败（红）** | 智能体在没有技能时违反规则（基线） |
| **测试通过（绿）** | 智能体在有技能时遵守规则 |
| **重构** | 在保持合规的同时堵住漏洞 |
| **先写测试** | 在编写技能之前先运行基线场景 |
| **观察失败** | 记录智能体使用的确切合理化借口 |
| **最小代码** | 编写针对那些具体违规行为的技能 |
| **观察通过** | 验证智能体现在遵守规则 |
| **重构循环** | 发现新的合理化借口 → 堵住 → 重新验证 |

整个技能创建过程遵循红-绿-重构。

## 何时创建技能

**创建条件：**
- 技术对你来说不是直觉上显而易见的
- 你会在不同项目中反复引用
- 模式具有广泛适用性（非项目特定）
- 其他人也会受益

**不要创建：**
- 一次性解决方案
- 其他地方有充分文档的标准实践
- 项目特定的约定（放在 CLAUDE.md 中）
- 机械性约束（如果可以用正则/验证强制执行，就自动化——文档留给需要判断的场景）

## 技能类型

### 技术类
有具体步骤的方法（condition-based-waiting、root-cause-tracing）

### 模式类
思考问题的方式（flatten-with-flags、test-invariants）

### 参考类
API 文档、语法指南、工具文档（office docs）

## 目录结构

\`\`\`
skills/
  skill-name/
    SKILL.md              # 主参考文档（必需）
    supporting-file.*     # 仅在需要时
\`\`\`

**扁平命名空间** - 所有技能在一个可搜索的命名空间中

**分离文件的情况：**
1. **大量参考内容**（100+ 行）- API 文档、全面的语法说明
2. **可复用工具** - 脚本、实用程序、模板

**保持内联：**
- 原则和概念
- 代码模式（< 50 行）
- 其他所有内容

## SKILL.md 结构

**Frontmatter（YAML）：**
- 两个必需字段：\`name\` 和 \`description\`（完整支持字段参见 [agentskills.io/specification](https://agentskills.io/specification)）
- 总计最多 1024 字符
- \`name\`：只使用字母、数字和连字符（不要用括号、特殊字符）
- \`description\`：第三人称，仅描述何时使用（不是做什么）
  - 以"Use when..."开头，聚焦于触发条件
  - 包含具体的症状、场景和上下文
  - **绝不总结技能的流程或工作流**（参见 CSO 章节了解原因）
  - 尽量控制在 500 字符以内

\`\`\`markdown
---
name: Skill-Name-With-Hyphens
description: Use when [具体的触发条件和症状]
---

# 技能名称

## 概述
这是什么？用 1-2 句话说明核心原则。

## 何时使用
[如果决策不明显，使用小型内联流程图]

症状和用例的要点列表
不适用的场景

## 核心模式（技术/模式类）
前后代码对比

## 快速参考
用于快速浏览常见操作的表格或要点

## 实现
简单模式内联代码
大量参考或可复用工具链接到文件

## 常见错误
常见问题 + 修复方法

## 实际效果（可选）
具体结果
\`\`\`


## Claude 搜索优化（CSO）

**发现至关重要：** 未来的 Claude 需要找到你的技能

### 1. 丰富的描述字段

**目的：** Claude 读取描述来决定为当前任务加载哪些技能。让它能回答："我现在应该读这个技能吗？"

**格式：** 以"Use when..."开头，聚焦于触发条件

**关键：描述 = 何时使用，不是技能做什么**

描述应该只描述触发条件。不要在描述中总结技能的流程或工作流。

**为什么这很重要：** 测试表明，当描述总结了技能的工作流时，Claude 可能会跟随描述而非阅读完整的技能内容。一个写着"任务间进行代码审查"的描述导致 Claude 只做了一次审查，尽管技能的流程图清楚地展示了两次审查（先规格合规再代码质量）。

当描述改为仅"在当前会话中执行包含独立任务的实现计划时使用"（无工作流摘要）时，Claude 正确地阅读了流程图并遵循了两阶段审查流程。

**陷阱：** 总结工作流的描述创建了 Claude 会走的捷径。技能正文变成了 Claude 跳过的文档。

\`\`\`yaml
# 错误：总结了工作流 - Claude 可能会跟随描述而非阅读技能
description: Use when executing plans - dispatches subagent per task with code review between tasks

# 错误：流程细节太多
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# 正确：只有触发条件，无工作流摘要
description: Use when executing implementation plans with independent tasks in the current session

# 正确：仅触发条件
description: Use when implementing any feature or bugfix, before writing implementation code
\`\`\`

**内容：**
- 使用具体的触发条件、症状和场景来表明此技能适用
- 描述问题（竞态条件、行为不一致）而非语言特定的症状（setTimeout、sleep）
- 保持触发条件技术无关，除非技能本身是技术特定的
- 如果技能是技术特定的，在触发条件中明确说明
- 用第三人称写（注入到系统提示中）
- **绝不总结技能的流程或工作流**

\`\`\`yaml
# 错误：太抽象、模糊，未包含何时使用
description: For async testing

# 错误：第一人称
description: I can help you with async tests when they're flaky

# 错误：提到了技术但技能并非该技术特定的
description: Use when tests use setTimeout/sleep and are flaky

# 正确：以"Use when"开头，描述问题，无工作流
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently

# 正确：技术特定的技能带有明确的触发条件
description: Use when using React Router and handling authentication redirects
\`\`\`

### 2. 关键词覆盖

使用 Claude 会搜索的词语：
- 错误信息："Hook timed out"、"ENOTEMPTY"、"race condition"
- 症状："flaky"、"hanging"、"zombie"、"pollution"
- 同义词："timeout/hang/freeze"、"cleanup/teardown/afterEach"
- 工具：实际命令、库名称、文件类型

### 3. 描述性命名

**使用主动语态，动词优先：**
- ✅ \`creating-skills\` 而非 \`skill-creation\`
- ✅ \`condition-based-waiting\` 而非 \`async-test-helpers\`

### 4. Token 效率（关键）

**问题：** getting-started 和频繁引用的技能会加载到每个对话中。每个 token 都很重要。

**目标字数：**
- getting-started 工作流：每个 <150 词
- 频繁加载的技能：总计 <200 词
- 其他技能：<500 词（仍要简洁）

**技巧：**

**将细节移到工具帮助中：**
\`\`\`bash
# 错误：在 SKILL.md 中列出所有参数
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# 正确：引用 --help
search-conversations 支持多种模式和过滤器。运行 --help 查看详情。
\`\`\`

**使用交叉引用：**
\`\`\`markdown
# 错误：重复工作流细节
搜索时，用模板分派子智能体……
[20 行重复的说明]

# 正确：引用其他技能
始终使用子智能体（节省 50-100 倍上下文）。必需：使用 [other-skill-name] 工作流。
\`\`\`

**压缩示例：**
\`\`\`markdown
# 错误：冗长的示例（42 词）
你的搭档："我们之前是怎么处理 React Router 中的认证错误的？"
你：我来搜索过去对话中的 React Router 认证模式。
[用搜索查询分派子智能体："React Router authentication error handling 401"]

# 正确：精简的示例（20 词）
搭档："我们之前是怎么处理 React Router 中的认证错误的？"
你：正在搜索……
[分派子智能体 → 整合]
\`\`\`

**消除冗余：**
- 不要重复交叉引用的技能中已有的内容
- 不要解释从命令中就能看出的东西
- 不要为同一模式提供多个示例

**验证：**
\`\`\`bash
wc -w skills/path/SKILL.md
# getting-started 工作流：目标 <150 每个
# 其他频繁加载的：目标总计 <200
\`\`\`

**用你做的事或核心洞察来命名：**
- ✅ \`condition-based-waiting\` > \`async-test-helpers\`
- ✅ \`using-skills\` 而非 \`skill-usage\`
- ✅ \`flatten-with-flags\` > \`data-structure-refactoring\`
- ✅ \`root-cause-tracing\` > \`debugging-techniques\`

**动名词（-ing）适合描述流程：**
- \`creating-skills\`、\`testing-skills\`、\`debugging-with-logs\`
- 主动的，描述你正在进行的操作

### 4. 交叉引用其他技能

**编写引用其他技能的文档时：**

仅使用技能名称，带有明确的必需标记：
- ✅ 好的：\`**必需子技能：** 使用 superpowers:test-driven-development\`
- ✅ 好的：\`**必需背景：** 你必须理解 superpowers:systematic-debugging\`
- ❌ 差的：\`参见 skills/testing/test-driven-development\`（不清楚是否必需）
- ❌ 差的：\`@skills/testing/test-driven-development/SKILL.md\`（强制加载，浪费上下文）

**为什么不用 @ 链接：** \`@\` 语法会立即强制加载文件，在你需要之前就消耗 200k+ 的上下文。

## 流程图使用

\`\`\`dot
digraph when_flowchart {
    "需要展示信息?" [shape=diamond];
    "我可能在决策中犯错?" [shape=diamond];
    "使用 markdown" [shape=box];
    "小型内联流程图" [shape=box];

    "需要展示信息?" -> "我可能在决策中犯错?" [label="是"];
    "我可能在决策中犯错?" -> "小型内联流程图" [label="是"];
    "我可能在决策中犯错?" -> "使用 markdown" [label="否"];
}
\`\`\`

**仅在以下情况使用流程图：**
- 非显而易见的决策点
- 你可能过早停止的流程循环
- "何时使用 A vs B"的决策

**绝不使用流程图用于：**
- 参考资料 → 表格、列表
- 代码示例 → Markdown 代码块
- 线性指令 → 编号列表
- 无语义意义的标签（step1、helper2）

参见 @graphviz-conventions.dot 了解 graphviz 样式规则。

**为你的搭档可视化：** 使用此目录中的 \`render-graphs.js\` 将技能的流程图渲染为 SVG：
\`\`\`bash
./render-graphs.js ../some-skill           # 每个图表分别渲染
./render-graphs.js ../some-skill --combine # 所有图表合并为一个 SVG
\`\`\`

## 代码示例

**一个优秀的示例胜过多个平庸的**

选择最相关的语言：
- 测试技术 → TypeScript/JavaScript
- 系统调试 → Shell/Python
- 数据处理 → Python

**好的示例：**
- 完整可运行
- 注释良好，解释为什么
- 来自真实场景
- 清晰展示模式
- 可以直接适配（不是通用模板）

**不要：**
- 用 5 种以上语言实现
- 创建填空模板
- 写人为构造的示例

你擅长语言移植——一个优秀的示例就够了。

## 文件组织

### 自包含技能
\`\`\`
defense-in-depth/
  SKILL.md    # 所有内容内联
\`\`\`
适用场景：所有内容都能放下，无需大量参考

### 带可复用工具的技能
\`\`\`
condition-based-waiting/
  SKILL.md    # 概述 + 模式
  example.ts  # 可适配的工作代码
\`\`\`
适用场景：工具是可复用的代码，不只是叙述

### 带大量参考的技能
\`\`\`
pptx/
  SKILL.md       # 概述 + 工作流
  pptxgenjs.md   # 600 行 API 参考
  ooxml.md       # 500 行 XML 结构
  scripts/       # 可执行工具
\`\`\`
适用场景：参考资料太多无法内联

## 铁律（与 TDD 相同）

\`\`\`
没有失败的测试就不写技能
\`\`\`

这适用于新技能和对现有技能的编辑。

先写技能再测试？删掉它。重新开始。
编辑技能不测试？同样违规。

**无例外：**
- 不适用于"简单的添加"
- 不适用于"只是加一个章节"
- 不适用于"文档更新"
- 不要保留未测试的更改作为"参考"
- 不要在运行测试时"调整"
- 删除就是删除

**必需背景：** superpowers:test-driven-development 技能解释了为什么这很重要。相同的原则适用于文档。

## 测试所有技能类型

不同类型的技能需要不同的测试方法：

### 纪律执行类技能（规则/要求）

**例如：** TDD、完成前验证、编码前设计

**测试方式：**
- 学术性问题：它们理解规则吗？
- 压力场景：它们在压力下遵守吗？
- 多重压力组合：时间 + 沉没成本 + 疲惫
- 识别合理化借口并添加明确的反驳

**成功标准：** 智能体在最大压力下遵循规则

### 技术类技能（操作指南）

**例如：** condition-based-waiting、root-cause-tracing、defensive-programming

**测试方式：**
- 应用场景：它们能正确应用技术吗？
- 变体场景：它们能处理边界情况吗？
- 缺失信息测试：说明是否有遗漏？

**成功标准：** 智能体成功将技术应用于新场景

### 模式类技能（心智模型）

**例如：** reducing-complexity、information-hiding 概念

**测试方式：**
- 识别场景：它们能识别模式何时适用吗？
- 应用场景：它们能使用心智模型吗？
- 反例：它们知道何时不应用吗？

**成功标准：** 智能体正确识别何时/如何应用模式

### 参考类技能（文档/API）

**例如：** API 文档、命令参考、库指南

**测试方式：**
- 检索场景：它们能找到正确的信息吗？
- 应用场景：它们能正确使用找到的内容吗？
- 覆盖测试：常见用例是否都涵盖了？

**成功标准：** 智能体找到并正确应用参考信息

## 跳过测试的常见合理化借口

| 借口 | 现实 |
|------|------|
| "技能显然很清晰" | 对你清晰 ≠ 对其他智能体清晰。测试它。 |
| "这只是参考资料" | 参考资料可能有遗漏、不清楚的地方。测试检索。 |
| "测试太过了" | 未测试的技能总有问题。15 分钟测试省下数小时。 |
| "有问题再测试" | 问题 = 智能体无法使用技能。在部署前测试。 |
| "测试太繁琐" | 测试比在生产中调试坏技能少繁琐得多。 |
| "我有信心它很好" | 过度自信保证出问题。无论如何都要测试。 |
| "学术审查就够了" | 阅读 ≠ 使用。测试应用场景。 |
| "没时间测试" | 部署未测试的技能比后面修复浪费更多时间。 |

**以上所有都意味着：部署前测试。无例外。**

## 让技能经受住合理化的考验

执行纪律的技能（如 TDD）需要抵抗合理化。智能体很聪明，在压力下会找到漏洞。

**心理学说明：** 理解说服技巧为什么有效有助于你系统性地应用它们。参见 persuasion-principles.md 了解研究基础（Cialdini, 2021; Meincke et al., 2025），涵盖权威、承诺、稀缺、社会认同和归属原则。

### 明确堵住每个漏洞

不要只是陈述规则——禁止具体的变通方法：

<Bad>
\`\`\`markdown
先写代码再写测试？删掉它。
\`\`\`
</Bad>

<Good>
\`\`\`markdown
先写代码再写测试？删掉它。重新开始。

**无例外：**
- 不要保留作为"参考"
- 不要在写测试时"调整"它
- 不要看它
- 删除就是删除
\`\`\`
</Good>

### 应对"精神 vs 字面"的辩论

在前面加入基础原则：

\`\`\`markdown
**违反规则的字面意思就是违反规则的精神。**
\`\`\`

这切断了整类"我遵循的是精神"的合理化借口。

### 构建合理化借口表

从基线测试中捕获合理化借口（参见下方测试章节）。智能体使用的每个借口都进入表中：

\`\`\`markdown
| 借口 | 现实 |
|------|------|
| "太简单不值得测试" | 简单的代码也会出错。测试只需 30 秒。 |
| "我后面再测试" | 测试立即通过什么也证明不了。 |
| "后写测试效果一样" | 后写测试 = "这做了什么？" 先写测试 = "这应该做什么？" |
\`\`\`

### 创建红线列表

让智能体容易自查是否在合理化：

\`\`\`markdown
## 红线 - 停下来重新开始

- 先写代码再写测试
- "我已经手动测试过了"
- "后写测试效果一样"
- "重要的是精神不是仪式"
- "这个情况不同，因为……"

**以上所有都意味着：删除代码。用 TDD 重新开始。**
\`\`\`

### 更新 CSO 以包含违规症状

在描述中添加：你即将违反规则时的症状：

\`\`\`yaml
description: use when implementing any feature or bugfix, before writing implementation code
\`\`\`

## 技能的红-绿-重构

遵循 TDD 循环：

### 红：编写失败的测试（基线）

在没有技能的情况下运行压力场景。逐字记录行为：
- 它们做了什么选择？
- 它们使用了什么合理化借口（原文）？
- 哪些压力触发了违规？

这就是"观察测试失败"——在编写技能之前你必须看到智能体自然会怎么做。

### 绿：编写最小技能

编写针对那些具体合理化借口的技能。不要为假设情况添加额外内容。

用技能运行相同的场景。智能体应该现在遵守。

### 重构：堵住漏洞

智能体找到了新的合理化借口？添加明确的反驳。重新测试直到无懈可击。

**测试方法论：** 参见 @testing-skills-with-subagents.md 了解完整的测试方法：
- 如何编写压力场景
- 压力类型（时间、沉没成本、权威、疲惫）
- 系统地堵住漏洞
- 元测试技巧

## 反模式

### 叙事式示例
"在 2025-10-03 的会话中，我们发现空的 projectDir 导致了……"
**为什么不好：** 太具体，不可复用

### 多语言稀释
example-js.js、example-py.py、example-go.go
**为什么不好：** 质量平庸，维护负担重

### 流程图中的代码
\`\`\`dot
step1 [label="import fs"];
step2 [label="read file"];
\`\`\`
**为什么不好：** 无法复制粘贴，难以阅读

### 通用标签
helper1、helper2、step3、pattern4
**为什么不好：** 标签应有语义意义

## 停下：进入下一个技能之前

**编写任何技能后，你必须停下来完成部署流程。**

**不要：**
- 批量创建多个技能而不逐个测试
- 在当前技能验证前就进入下一个
- 因为"批量处理更高效"就跳过测试

**下面的部署清单对每个技能都是强制性的。**

部署未测试的技能 = 部署未测试的代码。这是对质量标准的违反。

## 技能创建清单（TDD 适配版）

**重要：使用 TodoWrite 为下面的每个清单项创建待办。**

**红色阶段 - 编写失败的测试：**
- [ ] 创建压力场景（纪律类技能需 3 个以上组合压力）
- [ ] 在没有技能的情况下运行场景 - 逐字记录基线行为
- [ ] 识别合理化借口中的模式

**绿色阶段 - 编写最小技能：**
- [ ] 名称只使用字母、数字、连字符（无括号/特殊字符）
- [ ] YAML frontmatter 包含必需的 \`name\` 和 \`description\` 字段（最多 1024 字符；参见 [spec](https://agentskills.io/specification)）
- [ ] 描述以"Use when..."开头并包含具体的触发条件/症状
- [ ] 描述用第三人称
- [ ] 全文包含搜索关键词（错误、症状、工具）
- [ ] 带有核心原则的清晰概述
- [ ] 解决红色阶段识别出的具体基线失败
- [ ] 代码内联或链接到独立文件
- [ ] 一个优秀的示例（非多语言）
- [ ] 用技能运行场景 - 验证智能体现在遵守

**重构阶段 - 堵住漏洞：**
- [ ] 从测试中识别新的合理化借口
- [ ] 添加明确的反驳（纪律类技能）
- [ ] 从所有测试迭代中构建合理化借口表
- [ ] 创建红线列表
- [ ] 重新测试直到无懈可击

**质量检查：**
- [ ] 仅在决策不明显时使用小流程图
- [ ] 快速参考表
- [ ] 常见错误章节
- [ ] 无叙事性故事
- [ ] 支持文件仅用于工具或大量参考

**部署：**
- [ ] 将技能提交到 git 并推送到你的 fork（如果已配置）
- [ ] 考虑通过 PR 贡献回去（如果具有广泛用途）

## 发现工作流

未来的 Claude 如何找到你的技能：

1. **遇到问题**（"测试不稳定"）
3. **找到技能**（描述匹配）
4. **浏览概述**（这相关吗？）
5. **阅读模式**（快速参考表）
6. **加载示例**（仅在实现时）

**为此流程优化** - 把可搜索的术语放在前面和各处。

## 总结

**创建技能就是流程文档的 TDD。**

同样的铁律：没有失败的测试就不写技能。
同样的循环：红（基线）→ 绿（写技能）→ 重构（堵漏洞）。
同样的好处：更高的质量、更少的意外、无懈可击的结果。

如果你对代码遵循 TDD，对技能也应如此。这是同样的纪律应用于文档。
`;
    const contentHash19 = "0ad129b5d468f450398122ee4828738667f4d601c9d4a2259c6e82feb5a5c2d8";
    await p.skill.create({ data: { name: "writing-skills", description: "当创建新技能、编辑现有技能或在部署前验证技能是否有效时使用", skillMd: skillMd19, contentHash: contentHash19, version: 1, lastSyncedAt: new Date() } });
    await p.span.create({ data: { sessionId: s4.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-skills", status: "success", startTime: 100, duration: 1050, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 2 * 3600000) } });
    await p.span.create({ data: { sessionId: s3.id, roundIndex: 1, turnId: 0, kind: "tool_call", name: "writing-skills", status: "success", startTime: 100, duration: 1444, input: '{ "query": "test" }', output: '{ "result": "ok" }', createdAt: new Date(now - 8 * 3600000) } });
  }

  // Bulk demo sessions: 30-day span, multi-user x multi-agent x multi-model
  await seedBulkSessions({
    users: [user1, user2, user3, user4, user5],
    agents: [agent1, agent2, agent3, agent4, agent5, agent6, agent7],
    projects: [proj1, proj2, proj3, proj4, proj5],
  });

  console.log("Seed created!");
}

async function seedSession(sessionId, rounds, ctx = {}) {
  let totalSpans = 0, errorCount = 0, totalInput = 0, totalOutput = 0, totalDuration = 0, totalCacheRead = 0, totalCacheWrite = 0;
  let cursor = 0;
  const systemPrompt = `You are an expert coding agent. Available tools: read, bash, edit, write. Be concise.`;

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    for (let t = 0; t < round.turns.length; t++) {
      const turn = round.turns[t];
      for (const spanType of turn.spans) {
        const span = makeSpan(sessionId, r, t, spanType, cursor, systemPrompt, ctx);
        await p.span.create({ data: span.data });
        if (span.error) errorCount++;
        totalInput += span.input || 0;
        totalOutput += span.output || 0;
        totalCacheRead += span.cacheRead || 0;
        totalCacheWrite += span.cacheWrite || 0;
        totalSpans++;
        cursor += span.dur;
        totalDuration = Math.max(totalDuration, cursor);
      }
    }
    cursor += 100;
  }

  await p.session.update({
    where: { id: sessionId },
    data: {
      totalRounds: rounds.length,
      totalSpans,
      errorCount,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      totalDuration,
      endTime: ctx.endTime || new Date(),
    },
  });
}

function makeSpan(sessionId, roundIndex, turnId, type, cursor, systemPrompt, ctx = {}) {
  const base = { sessionId, roundIndex, turnId };
  const rand = ctx.rand || Math.random;
  const ri = (min, max) => Math.floor(min + rand() * (max - min));
  switch (type) {
    case "system_prompt":
      return { data: { ...base, kind: "system_prompt", name: "系统提示词", status: "success", startTime: cursor, duration: 10, input: systemPrompt }, dur: 10, input: 0, output: 0 };
    case "user":
      return { data: { ...base, kind: "user", name: "用户提问", status: "success", startTime: cursor, duration: 50, input: ctx.userInput || "帮我写一个接口" }, dur: 50, input: 0, output: 0 };
    case "llm_thinking": {
      const inputTokens = ri(800, 4000);
      const outputTokens = ri(300, 2000);
      const cacheRead = Math.floor(inputTokens * (0.4 + rand() * 0.4));
      const cacheWrite = Math.floor(inputTokens * (0.05 + rand() * 0.15));
      return { data: { ...base, kind: "llm_thinking", name: "LLM 思考", status: "success", startTime: cursor, duration: 1500, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, model: ctx.model || "claude-sonnet-4.5", output: "让我分析一下需求..." }, dur: 1500, input: inputTokens, output: outputTokens, cacheRead, cacheWrite };
    }
    case "tool_call": {
      const name = ctx.toolNames ? ctx.toolNames[Math.floor(rand() * ctx.toolNames.length)] : "edit_file";
      const inputTokens = ri(200, 1500);
      const outputTokens = ri(50, 500);
      return { data: { ...base, kind: "tool_call", name, status: "success", startTime: cursor, duration: 800, input: '{ "path": "src/api.ts" }', output: '{ "status": "ok" }', inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, dur: 800, input: inputTokens, output: outputTokens };
    }
    case "skill_call": {
      const skillName = ctx.skillNames[Math.floor(rand() * ctx.skillNames.length)];
      const inputTokens = ri(1000, 6000);
      const outputTokens = ri(200, 1200);
      return { data: { ...base, kind: "tool_call", name: "skill", status: "success", startTime: cursor, duration: ri(300, 2500), input: JSON.stringify({ path: `/home/user/.pi/agent/skills/${skillName}/SKILL.md` }), output: `{ "skill": "${skillName}", "loaded": true }`, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, dur: 1200, input: inputTokens, output: outputTokens };
    }
    case "tool_result":
      return { data: { ...base, kind: "tool_call", name: "edit_file", status: "success", startTime: cursor, duration: 100, output: "File written successfully", inputTokens: 0, outputTokens: 50, totalTokens: 50 }, dur: 100, input: 0, output: 50 };
    case "tool_result_failed":
      return { data: { ...base, kind: "tool_call", name: "edit_file", status: "failed", startTime: cursor, duration: 800, error: "Permission denied", output: "Error: permission denied", inputTokens: 500, outputTokens: 50, totalTokens: 550 }, dur: 800, input: 500, output: 50, error: true };
    case "answer": {
      const outputTokens = ri(500, 2500);
      return { data: { ...base, kind: "answer", name: "最终回答", status: "success", startTime: cursor, duration: 300, inputTokens: 50, outputTokens, totalTokens: 50 + outputTokens, output: "已完成！文件已创建。" }, dur: 300, input: 50, output: outputTokens };
    }
    default:
      return { data: { ...base, kind: "user", name: "unknown", status: "success", startTime: cursor, duration: 10 }, dur: 10, input: 0, output: 0 };
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await p.$disconnect(); });

// ---------- Bulk demo data generator (deterministic via seeded PRNG) ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BULK_SKILL_NAMES = [
  "brainstorming", "chinese-code-review", "chinese-commit-conventions", "chinese-documentation",
  "chinese-git-workflow", "dispatching-parallel-agents", "executing-plans", "writing-skills",
  "test-driven-development", "systematic-debugging", "requesting-code-review", "receiving-code-review",
  "using-git-worktrees", "finishing-a-development-branch", "subagent-driven-development",
  "remembering-with-memory", "configuring-pre-commit-hooks", "session-summaries", "troubleshooting-skills",
];

const BULK_MODELS = ["claude-sonnet-4.5", "gpt-4o", "deepseek-v3", "qwen-max", "LongCat-2.0", "glm-4.6"];
const BULK_TOOL_NAMES = ["read_file", "edit_file", "bash", "grep_search", "write_file", "glob_files"];

const BULK_USER_INPUTS = [
  "帮我写一个用户登录接口",
  "这个报错是什么意思？TypeError: Cannot read properties of undefined (reading 'map')，出现在列表渲染页面，帮我排查一下原因并给出修复方案。",
  "我把需求文档贴在下面，请根据文档内容生成一份竞品分析报告的初稿，重点分析目标用户、核心功能差异、定价策略和市场份额四个维度。文档如下：\n\n一、项目背景\n随着公司产品线扩展，我们需要对市场上主要的三家竞品进行系统性梳理……\n二、调研范围\n本次调研覆盖 A、B、C 三款产品的 Web 端与移动端……\n三、评估维度\n功能完整度、性能表现、用户体验、生态集成……\n四、交付要求\n报告需要包含对比矩阵、雷达图和结论建议，篇幅控制在 15 页以内。",
  "把下面这段会议记录整理成待办事项清单，按优先级排序，标明负责人和截止时间：\n\n本周例会纪要（摘录）\n1. 支付网关超时问题仍然存在，运维组本周内给出监控告警方案。\n2. 客服系统 V2 的回归测试已完成 80%，剩余用例预计下周三前跑完。\n3. 数据看板的缓存策略需要评审，相关同学下周一碰一次。\n4. 竞品分析报告初稿已同步，请大家周三前反馈意见。\n5. 下季度 OKR 草案由各组长周五前提交。",
  "帮我优化这段 SQL，现在执行要 8 秒，目标 1 秒以内：SELECT * FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.created_at > '2026-01-01' AND o.status IN (1,2,3) ORDER BY o.created_at DESC LIMIT 100;",
  "给这个模块补一下单元测试，覆盖率目标 80% 以上。",
  "解释一下这段代码的执行流程，以及为什么在并发场景下会出现死锁。",
  "帮我写一篇产品发布会的开场演讲稿，时长 5 分钟左右，风格要克制、专业，不要太多形容词。",
  "这个 PR 麻烦 review 一下，重点看异常处理和边界条件。",
  "根据附件里的 API 规范文档，检查我们的接口实现是否符合规范，逐条列出不符合项。",
];

async function seedBulkSessions({ users, agents, projects }) {
  const rand = mulberry32(20261013);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pickWeighted = (arr, weights) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = rand() * total;
    for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const now = Date.now();

  // user weights: Lenovo heaviest; agent weights: audit agent heaviest
  const userW = [3, 2, 2, 1.5, 1.5];
  const agentW = [3, 2, 2.5, 1.5, 1.5, 1, 1];
  const userByAgent = {}; // to compute per-user agent variety

  let created = 0;
  for (let d = 0; d < 30; d++) {
    const sessionsToday = 2 + Math.floor(rand() * 5); // 2-6 per day
    for (let i = 0; i < sessionsToday; i++) {
      const user = pickWeighted(users, userW);
      const agent = pickWeighted(agents, agentW);
      const model = pick(BULK_MODELS);
      const isErr = rand() < 0.08;
      const startAt = new Date(now - d * 86400000 - Math.floor(rand() * 10) * 3600000 - Math.floor(rand() * 60) * 60000);

      const userProjects = projects.filter((pr) => pr.userId === user.id);
      const project = userProjects.length > 0 ? pick(userProjects) : pick(projects);

      const s = await p.session.create({
        data: {
          projectId: project.id,
          userId: user.id,
          agentId: agent.id,
          status: isErr ? "error" : "completed",
          model,
          startTime: startAt,
        },
      });

      // rounds: 1-6, each round = user input + llm thinking + tools + answer
      const roundCount = 1 + Math.floor(rand() * 6);
      const rounds = [];
      let skillBudget = rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0;
      for (let r = 0; r < roundCount; r++) {
        const firstTurn = ["system_prompt", "user"];
        const toolPairs = Math.floor(rand() * 4); // 0-3 tool pairs
        for (let tp = 0; tp < toolPairs; tp++) {
          if (skillBudget > 0 && rand() < 0.4) { firstTurn.push("skill_call"); skillBudget--; }
          else firstTurn.push("tool_call");
          firstTurn.push("tool_result");
        }
        if (isErr && r === roundCount - 1) {
          firstTurn.push("tool_call", "tool_result_failed");
        }
        firstTurn.push("llm_thinking", "answer");
        rounds.push({ turns: [{ spans: firstTurn }] });
      }

      const ctx = {
        model,
        rand,
        skillNames: BULK_SKILL_NAMES,
        toolNames: BULK_TOOL_NAMES,
        userInput: pick(BULK_USER_INPUTS),
        endTime: new Date(startAt.getTime() + Math.floor(rand() * 40 + 3) * 60000),
      };
      await seedSession(s.id, rounds, ctx);
      created++;
    }
  }
  console.log(`Bulk sessions created: ${created}`);
}
