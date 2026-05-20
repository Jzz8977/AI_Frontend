# 简历改写门户（Resume Rewriter Portal）

面向求职者的 AI 简历改写与备战平台。输入原始简历，按目标岗位一键产出「改写前 / 改写后」对比稿，并可继续做深度精修、提炼知识点、生成学习路线思维导图、在线编辑排版导出 PDF，以及题库 AI 模拟面试。

> 单一事实来源是 `CONTRACT.md`（前后端共享 API 契约）；交互/视觉规范见 `r1.md`（注意 r1.md 描述的是 Next.js+Anthropic，**实际技术栈以 CONTRACT.md 为准**）。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + Vite 6 + TypeScript + Tailwind + shadcn 风格组件 + react-router 7 |
| 后端 | Node ≥22 + Express 4 + better-sqlite3（SQLite）+ JWT 鉴权 |
| 编排 | Mastra workflow（`@mastra/core`）+ zod |
| 模型 | DeepSeek 官方直连；其余模型走 OpenRouter（默认 `anthropic/claude-sonnet-4.5`）|

数据库为单文件 SQLite（`server/data.db`，可经 `DB_PATH` 覆盖），表 `users / usage / projects / runs` 自动建。一个 *project* = 一个投递方向，一次成功改写 = 该项目下的一个 *run*（版本号项目内从 1 递增）。

---

## 核心功能

- **快速改写**：选模式（快速重写 / 精修诊断）→ 选岗位（前端 / 全栈 / AI）→ 粘贴简历 → 流式逐段产出左右对比卡（约 15s 出首段）。
- **深度编排（Mastra 工作流）**：`init → dountil(改写 → 评估) → finalize`，未达目标分自动重试（上限 4 轮，把上轮评审意见喂回修订）。首遍即时流式，后台继续精修后整体替换为改进版。
- **AI 提炼知识点**：从最终稿提炼 6~10 个主题，按「核心 / 进阶 / 加分」分级，可一键复制 Markdown 清单。
- **学习路线思维导图**：基于知识点产出 3~5 阶段递进路线，Excalidraw 风格横向渲染（此特性始终强制走 DeepSeek）。
- **在线简历编辑器**（`/editor`）：纯前端结构化编辑器，3 套模板 + 强调色，支持增删/重排区块、JSON 导入导出、复制 Markdown、打印导出 PDF；可从改写结果一键带入。
- **题库 AI 面试助手**：毛玻璃悬浮弹层，选分类逐题作答 → 流式 Markdown 点评 → 错题本。主后端作为受信代理转发内网题库服务（前端绝不直连）。
- **项目历史与公开展示墙**：每次改写存为版本可复用；作者可主动 opt-in 把某版本设为公开，免登录展示墙只展示改写结果（绝不含原文与身份）。

---

## 鉴权与用量

- JWT（Bearer），密码 `bcrypt` 哈希。
- 每账号每自然日免费 `DAILY_FREE_LIMIT=5` 次成功改写；仅 AI 调用**成功**才计数。
- 用户可保存自己的 OpenRouter key（`hasOwnKey=true` → 无限量，且用自己的 key；key 永不回传响应）。

---

## 本地开发

```bash
npm run install:all          # 安装根 / server / client 依赖

# 配置 server/.env（参考 server/.env.example）
#   OPENROUTER_API_KEY, JWT_SECRET, PORT=3001
#   OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
#   DEEPSEEK_API_KEY, DEEPSEEK_MODEL=deepseek-v4-flash
#   DAILY_FREE_LIMIT=5, QBANK_URL=http://127.0.0.1:3002

npm run dev                  # 同时起 server(:3001) + client(:5173)
```

Vite 把 `/api` 代理到 `http://localhost:3001`。

---

## 部署（Docker）

```bash
docker compose up -d --build
```

- client：nginx，宿主映射 `8080:80`，SPA + `/api/` 反代 `server:3001`（对 SSE/长耗时编排关 buffering，`proxy_read_timeout 600s`）。
- server：仅 `expose 3001`，经 nginx 反代；SQLite 落命名卷 `rr-data`（`DB_PATH=/data/data.db`），重启不丢数据。
- `server/.env` 经 compose `env_file` 注入，不入镜像。

详见 `DEPLOY.md`，宝塔面板部署见 `docker-compose.baota.yml`。

---

## 前端路由

`/`（Landing，免登录）·`/showcase/:id`（公开只读）·`/auth` — 无应用外壳。
`/mode` `/role` 游客可探索；登录墙在 `/input`，未登录访问 `/input /result /history /editor` 跳 `/auth` 并在登录后回原目标。

`auth → mode → role → input → result`，外加 `/history`（项目/版本）与 `/editor`（在线编辑器）。

---

## 隐私

简历内容仅用于生成、不对外共享、不训练；生成版本入账户历史可一键删除；展示墙只展示作者主动公开的改写结果、可随时取消、不含原文与身份；简历模板补充字段与在线编辑器整份简历仅存浏览器 `localStorage`，清浏览器数据即丢失。

---

## 目录结构

```
client/   React + Vite 前端（stages 各步骤组件、lib 类型与序列化、api.ts）
server/   Express 后端（src/index.js 入口、src/mastra 编排、src/qbank.js 题库代理、db.js）
CONTRACT.md   前后端 API 契约（单一事实来源）
API.md        外部题库 AI 服务接口说明
DEPLOY.md     Docker 部署指南
r1.md         交互/视觉设计规范（技术栈以 CONTRACT.md 为准）
```
