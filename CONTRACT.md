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
| POST | `/api/rewrite/stream` | `{role, original, model?, projectId?, projectTitle?}` (Bearer) | **SSE 流**(见下「流式」) |

- **`auto` 模式走流式 `/api/rewrite/stream`;`review` 模式走非流式 `/api/rewrite`。** 两者校验/限流/落库规则一致。
- `mode`: `"auto"`(快速重写,流式) \| `"review"`(精修诊断,非流式)。
- `role`: `"frontend"` \| `"fullstack"` \| `"ai"`。
- `original`: string,服务端校验 `trim().length` 在 `[50, 8000]`,否则 400。
- `model`(可选): `"claude"` \| `"chatgpt"` \| `"qwen"` \| `"deepseek"`。省略则用服务端默认
  (`OPENROUTER_MODEL` / claude)。未知值返回 400。后端 `MODEL_MAP` 把它映射为 OpenRouter slug。
- 服务端按 `mode`/`role` 构造 prompt(逻辑见 r1.md 第 5 节),调 OpenRouter
  `POST https://openrouter.ai/api/v1/chat/completions`,model 取 env(用户自带 key 时仍用同 model),
  `response_format` 尽量要求 JSON,响应走容错解析(剥离 ```json 包裹、截取首尾大括号)。
- `result` 的 JSON schema:
  - `auto`(流式落库后形态): `{ summary:string, segments:[{kind:"skills"|"experience"|"project", title, original, rewritten, note}] }`
  - `review`: `{score, verdict, issues:[{id,severity,category,original,problem,suggestion,rewritten}]}`
- AI/解析失败:`review` 返回 `502 { error, raw? }`;`auto` 通过 SSE `error` 事件返回。**均不计数**。

### 流式 (`POST /api/rewrite/stream`,SSE,auto 专用)

- 校验/鉴权失败仍以**普通 JSON** 返回(400/401/404/429),不进入 SSE;成功后切换
  `Content-Type: text/event-stream`,逐帧 `data: <json>\n\n`,事件类型 `t`:
  - `{"t":"meta","summary":string}` — 首帧,自我评价。
  - `{"t":"seg","kind":"skills"|"experience"|"project","title","original","rewritten","note"}` —
    每段一帧:技能 1 帧、每家公司 1 帧、**每个项目各 1 帧**。前端收一帧渲一张左右对比卡。
  - `{"t":"end","usage",...,"projectId","projectTitle","runId","version"}` — 成功收尾,**此时才计数+落库**。
  - `{"t":"error","error",...}` — 失败收尾,不计数/不落库。
- 模型按上述 NDJSON 协议逐行输出(prompt 强约束);后端用 brace 感知的提取器容错切分
  (容忍跨 chunk、pretty-print)。客户端断开会 abort 上游,不计数。
- 模型走向:`deepseek`→DeepSeek 直连流;其余→OpenRouter 流。流式路径**不发** `response_format`。
- `projectId`(可选,整数):传入则把本次改写作为**新版本**追加到该项目(必须属于当前用户,否则 404,
  且在调用 AI 前校验);省略则**新建项目**。`projectTitle`(可选,≤80 字符,仅新建项目时生效)
  留空则自动按 `岗位 · 时间` 生成。仅**成功改写**才落库(与计数一致);落库失败不影响返回结果。
- 返回额外带 `projectId`/`projectTitle`(命中或新建的项目)、`runId`/`version`(版本号,项目内 1 起递增)。

## 深度编排 (#1 工作流编排, JWT, Bearer)

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| POST | `/api/orchestrate` | `{role, original, model?, projectId?, projectTitle?, targetScore?}` | `{ result, score, iterations, knowledge, mindmap, usage, projectId, projectTitle, runId?, version? }` |

- **非流式**。后端用 **Mastra workflow**(`server/src/mastra/`)编排:`init → dountil(改写 → 评估) → finalize`。"没达目标不结束" = `dountil` 重复 [改写→评估] **直到** 评分 ≥ `targetScore` **或** 达到迭代上限 `ITER_CEILING=4`(硬上限,防止无限循环/无限烧 token)。重试时把上一轮评审意见 + 上一版草稿喂回改写 prompt(修订而非重写)。
- 改写步骤复用**流式 NDJSON 协议**(`STREAM_*` prompt)但非流式收集,经 `makeJsonExtractor` 拼成与流式端点**完全一致**的 `{summary, segments}`,故结果可直接喂 AutoResult / 整理成稿 / 简历模板。
- 模型路由、错误契约、限流、落库规则与 `/api/rewrite` **完全一致**:配额预检 + 仅成功才扣 + run 尽力落库(mode=`auto`)。pipeline 内任一步失败(模型/解析)→ `502 { error }`,**不计数**。
- `targetScore`(可选,`[1,100]`,默认 85);`role`/`original`/`model`/`projectId`/`projectTitle` 校验同 `/api/rewrite`。
- `score`=最终评分;`iterations`=`[{attempt,score,feedback}]` 迭代轨迹。
- **#2 知识点**:精修循环后追加 `knowledge` 步骤,从最终改写稿提炼 `knowledge:[{topic, level:"核心"|"进阶"|"加分", points:string[]}]`(6~10 主题)。该步骤失败仅置空数组,不影响改写结果。`knowledge` **同时写入 run 的 `result_json`**(`result = {summary, segments, knowledge}`),故历史复用也带知识点。响应里 `knowledge` 与 `result.knowledge` 同值。
- 前端:AutoResult 第 4 个 tab「知识点」按 level 着色(核心绿/进阶蓝/加分琥珀),「复制清单」导出 Markdown;非深度编排结果该 tab 显示提示文案。
- **#3 学习路线思维导图**:knowledge 步骤后追加 `mindmap` 步骤,**始终强制走 DeepSeek**(忽略用户选的改写模型与自带 key,用服务端 `DEEPSEEK_API_KEY`)。基于 knowledge(空则回退 summary+segments)产出 `mindmap:{goal, phases:[{name, duration, topics:[{title, points:string[]}]}]}`(3~5 阶段递进)。失败置 `null`,不影响其余结果。`mindmap` 一并写入 `result_json`(`result = {summary, segments, knowledge, mindmap}`)。响应 `mindmap` 与 `result.mindmap` 同值。
- 前端:AutoResult 第 5 个 tab「学习路线」以 Excalidraw 风格(粗描边+错位投影+轻微旋转)横向渲染 中心目标→阶段链→主题/要点,「复制路线」导出 Markdown;非深度编排结果显示提示文案。完整 Excalidraw 原生编辑/导出留作后续增强。
- 前端:input 页 **auto 模式**有「深度编排」开关(`deep`),开启则 `onExecute` 走 `orchestrate()` 而非 `streamRewrite()`;`/result` 在编排进行中(`inFlight && !result && !streaming`)显示 LoadingTerminal,完成后复用 AutoResult,标题附「评分 N(M 轮编排)」。review 模式不显示该开关。

## 项目历史 (JWT, Bearer)

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| GET | `/api/projects` | — | `{ projects:[{id,title,runCount,lastRole,lastMode,createdAt,updatedAt}] }` |
| GET | `/api/projects/:id` | — | `{ project:{id,title,createdAt,updatedAt}, runs:[{id,version,mode,role,model,original,result,createdAt}] }` |
| PATCH | `/api/projects/:id` | `{title}` (非空 ≤80) | `{ ok:true }` |
| DELETE | `/api/projects/:id` | — | `{ ok:true }`(级联删 runs) |

- 全部按 `user_id` 归属校验:非本人项目一律 `404`。`runs` 按时间升序,`version` 为项目内 1 起序号。

## 前端路由 + 阶段机

react-router,**每一步独立路由**(未登录任意路径显示 auth):
- `/` → 重定向 `/mode`。`/mode` `/role` `/input` `/result` 各为一步;返回按钮也走路由(`navigate("/mode|/role")`)。
- `/result` 守卫:无流式/结果/历史上下文(如刷新冷启)时重定向 `/input`。review 等待响应时该路由内显示 loading 动画。
- `/history` — 项目列表。`/history/:projectId` — 该项目版本列表(点版本 → 设状态并 `navigate("/result")` 只读复用)。
- 其它路径重定向 `/mode`。TopBar 左上角 `前端方向部` 点击回 `/mode`;「历史」→ `/history`,据 `location` 高亮;步骤指示由 `location.pathname` 推导。
- `auto` 结果页有「分段对比 / 整理成稿 / 简历模板」三切换:
  - **整理成稿**把 summary + 各段 `rewritten` 拼成一篇分组(技能/工作经历/项目)Markdown,带「复制全文」按钮(`navigator.clipboard`),流式期间同步增量。
  - **简历模板**:左侧用户补充姓名/意向岗位/电话/邮箱/城市/教育经历,右侧实时拼成可直接投递的完整简历 Markdown,「复制简历全文」「清空补充」。补充字段**仅存浏览器 `localStorage`(键 `resume_tpl_profile`),不上传服务器**;`logout` 不清它(属用户本地数据)。完整在线简历编辑器(参考 magic-resume)为待办 #6,后续单独交付。
- 全局 footer 隐私说明(措辞须与实现一致,**不得**写"从不存储"):简历内容仅用于生成、不对外共享/不训练;生成版本入账户历史、可在「历史」一键删除;简历模板补充字段仅存本地浏览器。

`auth(登录/注册) → mode → role → input → result`
- `auto`:点 EXECUTE 直接进 `result`,流式逐段渲染**左右对比卡**(summary + 技能/每家公司/每个项目各一张),
  顶部 `streaming…` 指示;流结束后才出现「再改一版/改写新简历」动作按钮。
- `review`:走 `loading` 动画 → `result` 的 issue 列表(非流式,沿用原 ReviewResult)。
- 另有 `history` 视图(TopBar「历史」进入):项目列表 → 某项目的版本列表 → 点版本只读复用 result 页。

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

## 部署 (#4 Docker)

- `docker compose up -d --build` → client(nginx,宿主 `8080:80`)+ server(仅 `expose 3001`,经 nginx 反代)。详见 `DEPLOY.md`。
- `server/Dockerfile`:`node:22-bookworm-slim`,**不装系统编译链**(better-sqlite3 用 linux-x64/node22 预编译二进制)。`db.js` 的 `DB_PATH` 可经 env 覆盖(默认 `server/data.db` 不变);compose 设 `DB_PATH=/data/data.db` 挂命名卷 `rr-data`,重启不丢数据(已验证)。
- `client/Dockerfile` 多阶段(Vite build → nginx);`client/nginx.conf`:SPA `try_files /index.html`,`/api/` 反代 `server:3001` 且对 SSE/长耗时 orchestrate 关 buffering、`proxy_read_timeout 600s`。
- `server/.env` 经 compose `env_file` 注入,不入镜像(`.dockerignore`)。

## 文案 (#5 全中文)

- 前端所有用户可见英文已转中文:步骤指示(模式/岗位/输入/生成/结果)、各步骤 `// 步骤 0X` 头、`执行中…/开始执行`、`改写前/改写后`、`AI 总评`、`生成中…`、loading 终端行、`错误`、review 的 `采纳/已采纳`、严重度(严重/中等/轻微)、历史里 mode/role 数据值(快速重写/精修诊断、前端/全栈/AI 应用)等。
- 刻意保留:技术/品牌专有名词(React 19、Next.js、TS、MCP、RAG、Excalidraw、DeepSeek)、纯样式化代码标签(MODE_01 / FE / AI / r.code)、示例邮箱占位符。
