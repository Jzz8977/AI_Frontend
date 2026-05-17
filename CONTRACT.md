# API 契约 (前后端共享)

简历改写门户。前端 React+Vite+shadcn (`client/`),后端 Node+Express+SQLite (`server/`)。
设计/交互规范见 `r1.md`(注意:r1.md 写的是 Next.js+Anthropic,**实际栈以本文件为准**:React SPA + Express + OpenRouter)。

## 环境

- 后端端口 `3001`,前端 Vite 端口 `5173`,Vite 代理 `/api` → `http://localhost:3001`。
- 后端 `.env`:`OPENROUTER_API_KEY`(平台默认 key)、`JWT_SECRET`、`PORT=3001`、`OPENROUTER_MODEL=anthropic/claude-sonnet-4.5`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-v4-flash`、`DAILY_FREE_LIMIT=5`。
- 数据库:SQLite 文件 `server/data.db`,`better-sqlite3`。表自动建:`users`、`usage`、`projects`、`runs`。
  - `projects(id, user_id, title, created_at, updated_at)` — 一个简历目标/投递方向。
  - `runs(id, project_id, user_id, mode, role, model, original, result_json, created_at)` — 一次成功改写=该项目下的一个版本。删除 project 级联删除其 runs。
- `deepseek` 模型走 DeepSeek 官方直连(`api.deepseek.com`,OpenAI SDK),其余模型仍走 OpenRouter。

## 认证 (JWT, Bearer header)

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password}` | `{token, user:{id,email}}` |
| POST | `/api/auth/login` | `{email, password}` | `{token, user:{id,email}}` |
| GET | `/api/auth/me` | — (Bearer) | `{user:{id,email,hasOwnKey:boolean}, usage}` |
| PUT | `/api/auth/openrouter-key` | `{openrouterKey:string\|null}` (Bearer) | `{ok:true, hasOwnKey}` |

- 密码 `bcrypt` 哈希。email 唯一,冲突返回 409。校验失败 400,凭证错误 401。
- `openrouterKey` 存 user 表,**永不在任何响应里回传**,只回传 `hasOwnKey` 布尔。

## 用量 / 限流

`usage` 对象结构:`{ used:number, limit:number, remaining:number, unlimited:boolean, resetAt:ISOString }`

- 每账号每**自然日**(服务器本地 0 点重置)免费 `DAILY_FREE_LIMIT=5` 次 `/api/rewrite` 成功调用。
- 若用户已保存自己的 OpenRouter key(`hasOwnKey=true`):`unlimited=true`,不计数,且改写用用户自己的 key。
- 仅 AI 调用**成功**才计数;失败不扣。
- 超额返回 `429 { error, usage }`。

## 改写

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| POST | `/api/rewrite` | `{mode, role, original, model?, projectId?, projectTitle?}` (Bearer) | `{ result, usage, projectId, projectTitle, runId?, version? }` |

- `mode`: `"auto"`(快速重写) \| `"review"`(精修诊断)。
- `role`: `"frontend"` \| `"fullstack"` \| `"ai"`。
- `original`: string,服务端校验 `trim().length` 在 `[50, 8000]`,否则 400。
- `model`(可选): `"claude"` \| `"chatgpt"` \| `"qwen"` \| `"deepseek"`。省略则用服务端默认
  (`OPENROUTER_MODEL` / claude)。未知值返回 400。后端 `MODEL_MAP` 把它映射为 OpenRouter slug。
- 服务端按 `mode`/`role` 构造 prompt(逻辑见 r1.md 第 5 节),调 OpenRouter
  `POST https://openrouter.ai/api/v1/chat/completions`,model 取 env(用户自带 key 时仍用同 model),
  `response_format` 尽量要求 JSON,响应走容错解析(剥离 ```json 包裹、截取首尾大括号)。
- `result` 的 JSON schema 严格按 r1.md 5.4 节:
  - `auto`: `{summary, highlights[], skills:{core[],ai[],extra[]}, rewritten_experience, diff_notes:[{type,from,to,why}]}`
  - `review`: `{score, verdict, issues:[{id,severity,category,original,problem,suggestion,rewritten}]}`
- AI/解析失败:返回 `502 { error, raw? }`(raw 为模型原始输出,供前端折叠展示),**不计数**。
- `projectId`(可选,整数):传入则把本次改写作为**新版本**追加到该项目(必须属于当前用户,否则 404,
  且在调用 AI 前校验);省略则**新建项目**。`projectTitle`(可选,≤80 字符,仅新建项目时生效)
  留空则自动按 `岗位 · 时间` 生成。仅**成功改写**才落库(与计数一致);落库失败不影响返回结果。
- 返回额外带 `projectId`/`projectTitle`(命中或新建的项目)、`runId`/`version`(版本号,项目内 1 起递增)。

## 项目历史 (JWT, Bearer)

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| GET | `/api/projects` | — | `{ projects:[{id,title,runCount,lastRole,lastMode,createdAt,updatedAt}] }` |
| GET | `/api/projects/:id` | — | `{ project:{id,title,createdAt,updatedAt}, runs:[{id,version,mode,role,model,original,result,createdAt}] }` |
| PATCH | `/api/projects/:id` | `{title}` (非空 ≤80) | `{ ok:true }` |
| DELETE | `/api/projects/:id` | — | `{ ok:true }`(级联删 runs) |

- 全部按 `user_id` 归属校验:非本人项目一律 `404`。`runs` 按时间升序,`version` 为项目内 1 起序号。

## 前端阶段机

`auth(登录/注册) → mode → role → input → loading → result(auto: 3 Tab / review: issue 列表)`
另有 `history` 视图(TopBar「历史」进入):项目列表 → 某项目的版本列表 → 点版本只读复用 result 页。

- 未登录只能见 auth 页;登录后进入主流程,顶部 TopBar 显示当前 step + 剩余次数 + 退出。
- EXECUTE 按钮防抖:请求中禁用 + 客户端 1.2s 节流,防重复点击。
- token 存 `localStorage`,过期/401 自动登出回 auth 页。
- 输入区可"加载示例数据"(用 r1.md 3.3 的示例文本)。
- 模型选择器在前端隐藏,统一用 `DEFAULT_MODEL`(`constants.ts`)随请求发送。
- 项目上下文:input 页无当前项目时可填项目名(可留空);有当前项目时显示「继续优化 · 项目名」,
  本次存为新版本。result 页两个动作:`再改一版`(留在本项目→回 input)/ `改写新简历`(清空→新建项目)。
- 错误兜底:展示友好错误 + `<details>` 原始返回 + 重试。

## 联调

根 `package.json` 提供 `npm run dev`(concurrently 同时起 server+client)、`npm run install:all`。
