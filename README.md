# LinkAI Insight

Agent 运维观测平台，用于监控和分析 AI Agent 的运行状态、Token 消耗、Skill/Tool 调用链路与评测实验。

## 技术栈

- **框架**: Next.js 16 + React 19
- **语言**: TypeScript
- **样式**: Tailwind CSS 4 + shadcn/ui
- **数据库**: SQLite + Prisma ORM
- **图表**: Recharts
- **主题**: next-themes（支持深色模式）

## 功能模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 概览仪表盘 | `/` | 核心指标趋势、实时异常哨兵 |
| 用户看板 | `/user-stats` | 用户维度活跃与下钻 |
| Agent 看板 | `/agent-board` | Agent 性能、健康度与对比 |
| Session 看板 | `/trace` | Session 成本/耗时、链路详情 |
| LLM 看板 | `/llm` | 模型 Token、成本与缓存 |
| Tool & Skill 看板 | `/skills` | 工具/Skill 调用与失败聚类 |
| 评测中心 | `/experiments` | 实验管理与评估结果 |
| 告警中心 | `/alerts` | 实时异常列表（与概览同源） |
| 设置 | `/settings` | 评测用 LLM 等配置 |

**兼容旧书签**（自动跳转，可保留）：`/agent-stats` → `/agent-board`，`/skill-stats` → `/skills`。

## 快速开始

### 环境要求

- Node.js >= 18
- npm / pnpm / yarn

### 安装依赖

```bash
npm install
```

### 配置数据库

1. 创建 `.env` 文件：

```env
DATABASE_URL="file:./dev.db"
```

2. 初始化数据库：

```bash
npx prisma migrate dev
```

3. （可选）导入种子数据：

```bash
npm run seed
```

本地 SQLite 文件 `prisma/dev.db` 为运行数据，不应提交到 Git。

### 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3002](http://localhost:3002)

### 构建生产版本

```bash
npm run build
npm start
```

## 项目结构

```
├── prisma/                  # Prisma 配置与数据模型
│   ├── schema.prisma
│   └── seed.js
├── public/                  # 静态资源（如 logo.jpg）
├── scripts/                 # 一次性运维脚本（非日常启动）
│   ├── backfill-sessions.cjs
│   └── backfill-session-counters.cjs
└── src/
    ├── app/
    │   ├── (main)/          # 主应用页面（看板、告警、设置、评测）
    │   └── api/             # REST API（上传、统计、实验等）
    ├── components/          # UI 与看板组件
    └── lib/engine/          # 统计聚合、入库、实验引擎
```

## 数据模型

| 模型 | 说明 |
|------|------|
| `User` | 用户 |
| `Agent` | AI Agent 配置 |
| `Project` | 项目（关联 User 与 Agent） |
| `Session` | 会话记录（Token、终态等） |
| `Span` | 调用链路节点 |
| `Skill` | Skill 注册表与元数据 |
| `BusinessMetric` | 业务指标（预留；上报 API 仍保留） |
| `Experiment` / `ExperimentCase` / `ExperimentEvalResult` | 评测实验 |
| `UserSettings` | 用户设置 |

## 主要 API 路由

| 路由 | 说明 |
|------|------|
| `POST /api/sessions/upload` | Session/Span 数据上报（采集入口） |
| `GET /api/stats` | 概览实时/周期统计与异常哨兵 |
| `GET /api/dashboard/overview` | 首页趋势序列 |
| `GET /api/dashboard/users/*` | 用户看板 |
| `GET /api/dashboard/agents/*` | Agent 看板 |
| `GET /api/sessions/*` | Session 列表、看板、链路树 |
| `GET /api/skills/board` | Tool & Skill 看板聚合 |
| `POST /api/skills/sync` | 同步 Skill 注册表 |
| `GET /api/llm/board` | LLM 看板 |
| `GET /api/experiments/*` | 实验 CRUD 与运行 |
| `GET/POST /api/settings` | 设置 |
| `POST /api/biz-metrics/upload` | 业务指标上报（无前端页面，供外部脚本） |

部分早期路由（如 `GET /api/sessions/top`、`GET /api/skills/stats`）仍保留，新功能请优先使用上表中的看板 API。

## 脚本说明

| 脚本 | 说明 |
|------|------|
| `scripts/backfill-sessions.cjs` | 按当前 derive 规则回填历史 Session 的 Agent/标题/终态 |
| `scripts/backfill-session-counters.cjs` | 校验并回填 Session 计数器字段 |

用法见各文件头部注释；默认 dry-run，写库需加 `--apply`。

## License

Private
