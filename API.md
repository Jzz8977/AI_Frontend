# 题库 AI 服务 — API 说明文档

> 版本 0.1.0 ｜ 供主后端集成参考。
> 本服务为**内网独立服务**，仅供主后端服务器到服务器调用，不直接面向前端。
> **已移除 JWT 验签**：鉴权由主后端负责；`userId` 由主后端在请求中显式传入
> （POST 走 body，GET `/mistakes` 走 query）。本服务以 `userId` 做数据隔离。

## 通用约定

- Base URL：`http://<内网IP>:<PORT>`（PORT 由 `.env` 配置，默认 3001，当前部署 3002）
- 请求体（POST）：`Content-Type: application/json`
- 响应：JSON，UTF-8；SSE 接口为 `text/event-stream`
- 错误响应统一格式：

```json
{ "error": "bad_request", "message": "具体原因" }
```

| HTTP | error | 触发场景 |
|---|---|---|
| 400 | `bad_request` | 参数缺失/非法（zod 校验失败）、session 不属于该用户、题不在会话内 |
| 404 | `not_found` | 分类无题、session 不存在、题目不存在 |
| 500 | `internal_error` | 内部异常 |

> 注：移除鉴权后不再有 401。主后端须自行保证只有合法登录用户的请求才会带正确 `userId` 转发过来。

---

## 1. GET /health

健康检查。无需任何参数。

**响应 200**
```json
{ "status": "ok", "version": "0.1.0" }
```

---

## 2. GET /api/categories

返回所有可选分类（供前端"专项练习"选择界面用），按 direction 分组，附中文名与题数。

**请求参数**：无

**响应 200**
```json
{
  "categories": [
    {
      "direction": "backend",
      "items": [
        { "key": "database-basics", "name": "数据库基础", "count": 214 },
        { "key": "jvm", "name": "JVM", "count": 2 }
      ]
    },
    {
      "direction": "frontend",
      "items": [
        { "key": "ECMAScript", "name": "ECMAScript", "count": 20 },
        { "key": "js", "name": "JavaScript", "count": 627 }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `direction` | `"backend"｜"frontend"` | 方向 |
| `items[].key` | string | 分类 key（用于 `/interview/start` 的 `category`） |
| `items[].name` | string | 中文显示名（写死映射，未命中回退 key） |
| `items[].count` | number | 该分类题数 |

---

## 3. POST /api/interview/start

开始一次面试，在指定分类下随机抽题并创建会话。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` | string | 是 | 主后端传入的用户标识，数据隔离依据 |
| `category` | string | 是 | 分类 key（来自 `/api/categories`） |
| `count` | number | 否 | 抽题数，默认 10，范围 1~20 |

```json
{ "userId": "u_123", "category": "database-basics", "count": 10 }
```

**响应 200**
```json
{
  "sessionId": "uuid-xxxx",
  "questions": [
    {
      "id": "jg-database-basics-mongodb-是什么-431",
      "title": "MongoDB 是什么？",
      "questionType": "concept",
      "questionText": "## 题目正文..."
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | string(uuid) | 后续答题接口需带上 |
| `questions[].id` | string | 题目 id |
| `questions[].title` | string | 题目标题 |
| `questions[].questionType` | `"concept"｜"sql"` | 题型 |
| `questions[].questionText` | string | 题目正文 |

**要点**
- 响应**绝不含参考答案**（`referenceAnswer`），防泄题。
- `count` 超出范围或缺 `userId`/`category` → 400；分类无题 → 404。
- 实际返回数量 ≤ `count`（分类题不足时返回该分类全部，如 jvm 仅 2 题）。

---

## 4. POST /api/interview/answer/stream

提交单题答案，**SSE 流式返回评判**（像 ChatGPT 逐字蹦出）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` | string | 是 | 须与创建该 session 时的 userId 一致 |
| `sessionId` | string | 是 | 来自 `/interview/start` |
| `questionId` | string | 是 | 必须属于该 session |
| `userAnswer` | string | 是 | 用户作答内容（SQL 题填 SQL 语句） |

```json
{
  "userId": "u_123",
  "sessionId": "uuid-xxxx",
  "questionId": "jg-database-basics-mongodb-是什么-431",
  "userAnswer": "MongoDB 是一个 NoSQL 数据库..."
}
```

**响应**：`Content-Type: text/event-stream`

事件序列（SSE）：

```
event: meta
data: {"questionId":"jg-...-431","retrievedCount":5}

event: chunk
data: {"text":"## 你答得怎么样\n\n"}

event: chunk
data: {"text":"你的回答抓住了核心概念..."}

... （多个 chunk 事件，按顺序拼接即完整 Markdown 反馈）

event: done
data: {"isWrong":true,"relatedQuestionIds":["jg-...-433","jg-...-434"]}
```

| 事件 | data 字段 | 说明 |
|---|---|---|
| `meta` | `questionId`, `retrievedCount` | 评判开始前发一次，告知检索到 N 条相关知识 |
| `chunk` | `text` | DeepSeek 流式文本片段，前端按顺序拼接 |
| `done` | `isWrong`(bool), `relatedQuestionIds`(string[]) | 评判结束；不含分数 |
| `error` | `message` | 出错时发送后关闭连接（前端不空等） |

**评判内容结构**（chunk 拼出的 Markdown）：`## 你答得怎么样` / `## 答对的地方` / `## 需要改进的地方` / `## 知识点讲解`。**不含任何分数字眼**。

**落库**：`done` 前会写入 `answers` 表（`is_wrong`、完整 `feedback`、`related_question_ids`），供错题接口查询。

**校验错误**：缺字段 → 400；session 不存在 → 404；`userId` 与 session 不符 → 400；题不在会话内 → 400；题目不存在 → 404。这些在流开始前以普通 JSON 错误返回（非 SSE）。

**主后端代理注意**：必须**边读边写**透传字节流给前端，不要缓冲完整响应，否则失去流式效果。

---

## 5. GET /api/mistakes

查询某用户的错题列表（`answers.is_wrong=1`，join 题目取标题/分类）。

**Query 参数**

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `userId` | string | 是 | — | 用户标识 |
| `category` | string | 否 | — | 按分类筛选 |
| `limit` | number | 否 | 50 | 1~200 |
| `offset` | number | 否 | 0 | 分页偏移 |

示例：`GET /api/mistakes?userId=u_123&category=redis&limit=20&offset=0`

**响应 200**
```json
{
  "total": 23,
  "items": [
    {
      "questionId": "jg-database-basics-mongodb-是什么-431",
      "title": "MongoDB 是什么？",
      "category": "database-basics",
      "userAnswer": "用户当时的回答",
      "feedback": "LLM 评判全文（Markdown）",
      "answeredAt": 1716100000
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `total` | number | 符合条件的错题总数（不受 limit 影响） |
| `items[].answeredAt` | number | Unix 秒级时间戳，按其倒序 |

缺 `userId` 或参数非法 → 400。

---

## 主后端集成示例（Node）

```js
const QBANK = 'http://127.0.0.1:3002';

// 抽题
async function start(userId, category) {
  const r = await fetch(`${QBANK}/api/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, category, count: 10 }),
  });
  if (!r.ok) throw new Error((await r.json()).message);
  return r.json();
}

// SSE 评判：透传给前端（关键：边读边写，不缓冲）
async function gradeProxy(userId, body, clientRes) {
  const up = await fetch(`${QBANK}/api/interview/answer/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...body }),
  });
  if (!up.ok) { // 流前的校验错误是普通 JSON
    clientRes.status(up.status).json(await up.json());
    return;
  }
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  const reader = up.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    clientRes.write(value);
  }
  clientRes.end();
}

// 错题
async function mistakes(userId, category) {
  const u = new URL(`${QBANK}/api/mistakes`);
  u.searchParams.set('userId', userId);
  if (category) u.searchParams.set('category', category);
  return (await fetch(u)).json();
}
```

**安全提醒**：本服务不再自行鉴权，`userId` 完全信任请求方。**务必保证本服务只在内网、仅由主后端访问**，且 `userId` 由主后端依据已验证的登录态填充，不可由前端直接传穿。
