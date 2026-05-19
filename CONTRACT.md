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
| POST | `/api/orchestrate` | `{role, original, model?, projectId?, projectTitle?, targetScore?}` | **phased SSE 流**(校验/限流失败仍以普通 JSON 400/401/404/429 返回) |

- **phased SSE(分阶段流式)**,解决"等整条流水线太慢":**第一遍改写直接流式逐段下发(和普通快速重写一样快,~15s 出对比卡)**,后续精修在后台继续,改进版整体替换,知识点/学习路线再各自下发一帧。事件类型 `t`:
  - `{"t":"meta","summary"}` + 多个 `{"t":"seg",...}` — **首遍改写实时流式**(Mastra `rewriteStep` 在 `attempt===0` 且有 SSE sink 时走 `runner.callSegmentsStream`,经 `requestContext` Map 注入 sink;NDJSON 帧逐个吐,wire 形状与 `/api/rewrite/stream` 完全一致)。
  - `{"t":"iter","attempt","score","targetScore","ceiling"}` — 每轮 评估 完成的进度心跳(经 Mastra `run.watch` best-effort,缺失不影响结果)。
  - `{"t":"revise","summary","segments","score","attempt"}` — 精修循环跑了不止一轮(`iterations.length>1`)时,把打磨后的**改进版整体下发**,前端整体替换显示(首遍若一次过评估则不发 revise)。后续精修非流式收集。
  - `{"t":"segdone"}` — 分段(含可能的 revise)已定稿(前端据此结束「流式」态、亮出动作按钮)。
  - `{"t":"knowledge","knowledge":[...]}` — #2 知识点跑完(可能空数组)。
  - `{"t":"mindmap","mindmap":{...}|null}` — #3 学习路线跑完(可能 null)。
  - `{"t":"end","score","iterations","usage","projectId","projectTitle","runId","version"}` — 干净收尾,**此时才计数+落库**。
  - `{"t":"error","error",...}` — 失败收尾,不计数/不落库。客户端断开则不计数/不落库。
- 后端用 **Mastra workflow**(`server/src/mastra/`):`refinePipeline = init → dountil(改写 → 评估) → refine-finalize`。"没达目标不结束" = `dountil` 重复 [改写→评估] **直到** 评分 ≥ `targetScore` **或** 达到迭代上限 `ITER_CEILING=4`(硬上限)。重试时把上一轮评审意见 + 上一版草稿喂回改写 prompt(修订而非重写)。知识点 / 学习路线 复用同一套核心逻辑(`extractKnowledge` / `buildMindmap`,Mastra step 与本路由共用),在精修循环之外按阶段调用以便逐帧 flush。
- 改写步骤复用**流式 NDJSON 协议**(`STREAM_*` prompt):首遍真流式(`callSegmentsStream`,边吐边 flush),后续精修非流式收集(`callSegments`),都经 `makeJsonExtractor` 拼成与流式端点**完全一致**的 `{summary, segments}`,故结果可直接喂 AutoResult / 整理成稿 / 简历模板。
- 模型路由、错误契约、限流、落库规则与 `/api/rewrite` **完全一致**:配额预检 + 仅干净收尾才扣 + run 尽力落库(mode=`auto`,`result = {summary, segments, knowledge, mindmap}`)。精修循环失败(模型/解析)→ `{"t":"error"}`,**不计数**;知识点/学习路线失败仅置空/`null`,不影响已出的改写。
- `targetScore`(可选,`[1,100]`,默认 85);`role`/`original`/`model`/`projectId`/`projectTitle` 校验同 `/api/rewrite`。
- `score`=最终评分(`end` 帧);`iterations`=`[{attempt,score,feedback}]` 迭代轨迹(`end` 帧)。
- **#2 知识点**:精修循环后跑 `extractKnowledge`,从最终改写稿提炼 `knowledge:[{topic, level:"核心"|"进阶"|"加分", points:string[]}]`(6~10 主题)。失败仅置空数组,不影响改写结果。`knowledge` **写入 run 的 `result_json`**(`result = {summary, segments, knowledge}`),故历史复用也带知识点。
- 前端:AutoResult 第 4 个 tab「知识点」按 level 着色(核心绿/进阶蓝/加分琥珀),「复制清单」导出 Markdown;非深度编排结果该 tab 显示提示文案。
- **#3 学习路线思维导图**:knowledge 后跑 `buildMindmap`,**始终强制走 DeepSeek**(忽略用户选的改写模型与自带 key,用服务端 `DEEPSEEK_API_KEY`)。基于 knowledge(空则回退 summary+segments)产出 `mindmap:{goal, phases:[{name, duration, topics:[{title, points:string[]}]}]}`(3~5 阶段递进)。失败置 `null`,不影响其余结果。`mindmap` 一并写入 `result_json`(`result = {summary, segments, knowledge, mindmap}`)。
- 前端:AutoResult 第 5 个 tab「学习路线」以 Excalidraw 风格(粗描边+错位投影+轻微旋转)横向渲染 中心目标→阶段链→主题/要点,「复制路线」导出 Markdown;非深度编排结果显示提示文案。完整 Excalidraw 原生编辑/导出留作后续增强。
- 前端:input 页 **auto 模式**有「深度编排」开关(`deep`),开启则 `onExecute` 走 `streamOrchestrate()`(含 `onRevise`)而非 `streamRewrite()`。`/result`:**首遍改写实时流式逐段渲染(与普通快速重写同速)**;首段到达前短暂显示 `LoadingTerminal`(`note` 带轮次心跳「精修中 · 第 N 轮 · 评分 M/目标」)。`onRevise` → 整体替换 `streamSummary/streamSegments` 为改进版(用户先看首版,后台精修完成无缝换更优)。`onSegDone` → `streaming` 转 false、动作按钮亮出,**可读/复制分段对比 / 整理成稿 / 简历模板**;此间 `orchStreaming` 仍真,「知识点」「学习路线」tab 显示"生成中"占位,各自帧到后填充;`end` 落 `orch` 评分,标题附「评分 N(M 轮编排)」。review 不显示该开关。

## 项目历史 (JWT, Bearer)

| 方法 | 路径 | Body | 返回 |
|---|---|---|---|
| GET | `/api/projects` | — | `{ projects:[{id,title,runCount,lastRole,lastMode,createdAt,updatedAt}] }` |
| GET | `/api/projects/:id` | — | `{ project:{id,title,createdAt,updatedAt}, runs:[{id,version,mode,role,model,original,result,createdAt}] }` |
| PATCH | `/api/projects/:id` | `{title}` (非空 ≤80) | `{ ok:true }` |
| PATCH | `/api/projects/:id/runs/:runId/share` | `{shared:boolean}` | `{ ok:true, shared }` |
| DELETE | `/api/projects/:id` | — | `{ ok:true }`(级联删 runs) |

- 全部按 `user_id` 归属校验:非本人项目一律 `404`。`runs` 按时间升序,`version` 为项目内 1 起序号。`run` 含 `shared:boolean`。
- 分享接口:`shared` 必须布尔;项目须属调用者(否则 404),run 也须属调用者(`setRunShared` user-scoped,否则 404)。**opt-in**,可随时来回切。

## 公开展示墙 / 分享 (免登录, 无 Bearer)

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/public/showcase` | `{ items:[{id,title,role,roleLabel,mode,modeLabel,teaser,segCount,hasKnowledge,hasMindmap,createdAt}] }` |
| GET | `/api/public/showcase/:id` | `{ item:{id,title,role,roleLabel,mode,modeLabel,createdAt,result} }` |

- 数据源 = 作者**主动 `shared=1`** 的 run(`runs.shared`,迁移用幂等 `ALTER TABLE`)。列表按 `r.id DESC`,上限 60。
- **隐私铁律**:公开端点只回**改写结果**(`result`=summary/segments/knowledge/mindmap 或 review 结构),**绝不**含 `original` 原始简历、作者邮箱/`user_id`。`teaser` 取 `summary`(无则 `verdict`)前 160 字。
- 取消分享后 `/showcase/:id` 立即 404(与"不存在"同义,不泄漏曾分享过)。

## 题库 AI 面试助手 (JWT, Bearer — 主后端代理内网题库服务)

外部「题库 AI 服务」(见 `API.md`)是**内网 server→server** 服务、自身不鉴权。主后端 `server/src/qbank.js`(挂 `/api/qbank`,全 `requireAuth`)做受信代理:**前端绝不直连**,`userId` 由后端按已验证登录态注入 `u_<user.id>`(忽略前端传入的任何 userId);上游地址 `QBANK_URL`(env,默认 `http://127.0.0.1:3002`)。

| 方法 | 路径 | 代理到 | 说明 |
|---|---|---|---|
| GET | `/api/qbank/categories` | `GET /api/categories` | 分类(按 direction 分组) |
| POST | `/api/qbank/interview/start` | `POST /api/interview/start` | body `{category,count?}`;注入 `userId` |
| POST | `/api/qbank/interview/answer/stream` | `POST /api/interview/answer/stream` | **SSE 命名事件**(`meta`/`chunk`/`done`/`error`)**边读边写透传**,客户端断开 `AbortController` 掐上游;流前校验错误以普通 JSON 透传 |
| GET | `/api/qbank/mistakes` | `GET /api/mistakes` | query `{category?,limit?,offset?}`;注入 `userId` |

- 上游不可达 → `502 {error:"qbank_unreachable", message}`(不泄漏内网细节);上游错误体按原 status 透传。
- 前端:`InterviewChat`(`components/InterviewChat.tsx`)= **毛玻璃悬浮弹层**(右下角圆形 launcher → `fixed z-[60]` 背板模糊 + `backdrop-blur-2xl` 半透明面板),登录后任意应用页可用(`showAppChrome` 时挂载,Landing/Showcase/Auth 不挂)。流程:选分类(+题量 5/10/15/20)→ 逐题 chat 作答 → SSE 流式 Markdown 点评(内置极简 md 渲染:标题/粗体/代码/列表)→ 下一题 → 完成;另有「错题本」视图。`api.ts`:`qbankCategories/qbankStart/qbankMistakes/qbankAnswerStream`(命名事件 SSE 解析)。

## 前端路由 + 阶段机

react-router。**免登录可浏览**:`/`(Landing)、`/showcase/:id`、`/auth`,**外加 `/mode` `/role`**(选模式/选岗位允许游客探索)。**登录墙在 `/input`**:`/input /result /history /editor` 未登录经 `guard()` 重定向 `/auth` 并带 `state.from=当前路径`;登录成功 `onAuthed` 读 `location.state.from` 回到原目标(无则 `/mode`);`/auth` 已登录则重定向 `/mode`。**Bare 页(`/ /showcase /auth`)无应用外壳**;`/mode /role` 登录后仍有外壳(`showAppChrome = authed && !isBareRoute`)。catch-all → 已登录 `/mode`、未登录 `/`。Landing「立即改写」/「我也要改写」→ `/mode`(进流程,墙在 input);右上「登录/注册」→ `/auth`。
- **首屏 `/` Landing(免登录)**:炫酷动画(动网格 `anim-grid` + 极光 `anim-aurora` + 浮动 token `anim-floaty` + 扫描线 `anim-scanline` + 入场 `anim-riseIn`,均 `prefers-reduced-motion` 关闭;岗位词打字轮播)+ 「分享展示墙」网格(`publicShowcase()`);`enterFlow()`→`/mode`(立即改写/我也要改写),`login()`→`/auth`(右上登录注册)。`/showcase/:id` 用 AutoResult/ReviewResult **只读**渲染(无 actions),其「我也要改写」→ `/mode`。TopBar 加「展示墙」入口 → `/`。
- `/mode` `/role` `/input` `/result` 各为一步;返回按钮也走路由(`navigate("/mode|/role")`)。
- `/result` 守卫:无流式/结果/历史上下文(如刷新冷启)时重定向 `/input`。review 等待响应时该路由内显示 loading 动画。
- `/history` — 项目列表。`/history/:projectId` — 该项目版本列表(点版本 → 设状态并 `navigate("/result")` 只读复用)。
- `/editor` — #6 在线简历编辑器(独立路由,登录后可经 TopBar「编辑器」或结果页「在编辑器中编辑」进入;`onBack` 走 `navigate(-1)`)。
- 其它路径重定向 `/mode`。TopBar 左上角 `前端方向部` 点击回 `/mode`;「历史」→ `/history`,据 `location` 高亮;步骤指示由 `location.pathname` 推导。
- `auto` 结果页有「分段对比 / 整理成稿 / 简历模板」三切换:
  - **整理成稿**把 summary + 各段 `rewritten` 拼成一篇分组(技能/工作经历/项目)Markdown,带「复制全文」按钮(`navigator.clipboard`),流式期间同步增量。
  - **简历模板**:左侧用户补充姓名/意向岗位/电话/邮箱/城市/教育经历,右侧实时拼成可直接投递的完整简历 Markdown,「复制简历全文」「清空补充」。补充字段**仅存浏览器 `localStorage`(键 `resume_tpl_profile`),不上传服务器**;`logout` 不清它(属用户本地数据)。
  - auto 结果页动作区另有「在编辑器中编辑」:把当前 `{summary, segments}` 经 `docFromAutoResult` 映射为结构化简历种子(写 `localStorage` 键 `resume_editor_seed`),`navigate("/editor")` 打开 #6 编辑器并一次性消费该种子(消费后立即删除)。
- 全局 footer 隐私说明(措辞须与实现一致,**不得**写"从不存储"):简历内容仅用于生成、不对外共享/不训练;生成版本入账户历史、可在「历史」一键删除;**「展示墙」只展示作者主动设为公开的改写结果、可随时取消、不含原文与身份**;简历模板补充字段与在线编辑器整份简历仅存本地浏览器、清浏览器数据即丢失。Landing/Showcase 公开页另有面向访客的同义隐私说明。

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

## 在线简历编辑器 (#6, 继承 magic-resume 思路, 纯前端)

- 路由 `/editor`,组件 `client/src/components/stages/ResumeEditor.tsx`,模型与序列化在 `client/src/lib/resume-doc.ts`,类型 `ResumeDoc` 等在 `lib/types.ts`。
- **结构化文档**:`basics(name/title/phone/email/city/website)` + `summary` + `skills` + `experience[]` + `projects[]` + `education[]` + `custom[]` + `template` + `accent`(hex 强调色)。`experience/projects` 每项含 `bullets:string[]`(每行一条)。
- **持久化**:整份文档仅写浏览器 `localStorage` 键 `resume_editor_doc`(每次编辑即存),**绝不上传服务器**;`normalizeDoc` 容错收敛任意 JSON(`template` 缺省回退 `compact`,`accent` 非 `#RRGGBB` 回退 `DEFAULT_ACCENT`);`logout` 不清(属用户本地数据)。
- **实时预览**:右栏白纸 A4 风格(固定浅色,不随暗色应用主题变),三套模板 `classic|compact|timeline`(纯 CSS 变体),**默认 `compact`(紧凑型)**。强调色面板(`ACCENT_PRESETS` 8 色 + 原生取色器):**`timeline` 模板的标题左描边/文字色 + 页头下边框用 `accent` 着色(变色功能)**;其它模板视觉不受 accent 影响。
- **列表项**:工作/项目/教育/自定义模块均可「+ 添加」、上移 ↑ / 下移 ↓ 重排(无第三方 DnD 依赖)、删除。
- **导入/导出**:`导出 JSON`(下载结构化文档,可再导入续编)、`导入 JSON`(经 `normalizeDoc`)、`复制 Markdown`(`docToMarkdown` 拼整篇)、`导出 PDF / 打印`(`window.print()` + `@media print`:`.no-print` 隐藏应用外壳,`.resume-paper` 去阴影铺满)。
- **从改写结果带入**:auto 结果页「在编辑器中编辑」→ `docFromAutoResult(summary,segments)` 映射为种子写 `resume_editor_seed`,编辑器挂载时一次性消费(`segments` 按 kind 落到 skills/experience/projects,标题尽力拆 公司·岗位·时间,rewritten 按行拆 bullets)。
- TopBar 增「编辑器」入口(`/editor` 高亮);该路由不属创建流程步骤,不参与顶部 step 进度高亮。

## 文案 (#5 全中文)

- 前端所有用户可见英文已转中文:步骤指示(模式/岗位/输入/生成/结果)、各步骤 `// 步骤 0X` 头、`执行中…/开始执行`、`改写前/改写后`、`AI 总评`、`生成中…`、loading 终端行、`错误`、review 的 `采纳/已采纳`、严重度(严重/中等/轻微)、历史里 mode/role 数据值(快速重写/精修诊断、前端/全栈/AI 应用)等。
- 刻意保留:技术/品牌专有名词(React 19、Next.js、TS、MCP、RAG、Excalidraw、DeepSeek)、纯样式化代码标签(MODE_01 / FE / AI / r.code)、示例邮箱占位符。
