// Prompt engineering — faithful implementation of r1.md section 5.
// Two builders: buildRewritePrompt (auto) and buildReviewPrompt (review).
// Each injects a role-specific 2026 tech dictionary (roleSpec).

// §5.2 角色规格 (roleSpec)
const ROLE_SPEC = {
  frontend: {
    label: '前端工程师 (Frontend Engineer)',
    spec: `- 强化:React 19 / Next.js 15 (App Router/RSC/Server Actions) / TypeScript 严格模式
- 强化:性能 (Core Web Vitals/INP) / 工程化 (Turborepo/Vite 6) / Edge Runtime
- 强化:AI 增强体验 (Vercel AI SDK / 流式 UI / Generative UI)
- 弱化:jQuery / Vue 2 / Webpack 配置细节 / 旧脚手架
- 弱化:CSS 兼容性细节 (除非是大厂方向)`,
  },
  fullstack: {
    label: '全栈工程师 (Full-Stack Engineer)',
    spec: `- 强化:端到端拥有感 (前端 + API + DB + 部署)
- 强化:Next.js 15 / tRPC / Drizzle ORM / Postgres / Redis
- 强化:Edge/Serverless 部署 / 可观测性 / CI/CD
- 强化:把纯前端项目往全栈靠 — 突出 API 设计、数据建模、性能优化
- 弱化:框架配置细节 / 单点技术深度`,
  },
  ai: {
    label: 'AI 应用工程师 (AI Application Engineer)',
    spec: `- 强化:LLM 集成 (OpenAI/Anthropic/开源模型) / 流式响应 / 函数调用
- 强化:Agent 工作流 (LangGraph/CrewAI) / Tools / MCP (Model Context Protocol)
- 强化:RAG (向量库/混合检索/重排) / Embedding / 知识库工程
- 强化:Vercel AI SDK / Generative UI / 流式渲染 / Stream Composition
- 强化:Evals / Prompt 工程 / 成本与延迟优化
- 把任何 AI 相关经历(哪怕只是用过 Cursor/Claude)都包装成工程化经验`,
  },
};

// §5.3 改写硬性要求
const HARD_RULES = `## 改写硬性要求(必须全部遵守)
1. 量化一切:每条经验必须有数字(用户数/性能提升 %/成本下降/耗时减少)。原文没有数字就根据项目体量合理推测,但不要夸张。
2. STAR 结构:每条要点遵循 Situation→Task→Action→Result,但写得自然不模板化。
3. 技术栈现代化:用 2026 主流技术名词替换陈旧表述。例如 "jQuery 实现交互" → 升级为对应现代方案。
4. AI 浓度:如果原文有任何 AI/LLM/Copilot/Cursor/Claude 相关经历,放大;如果完全没有,在"技能"或"项目"中加入合理可信的 AI 工程经验(基于原项目能力延伸)。
5. 去除信息:删掉过时技术(jQuery/Vue 2 配置细节/Webpack 1-3)或弱化为"另熟悉"。
6. 动词强度:用"主导/设计/重构/落地"取代"负责/参与/协助"。
7. 保留真实性:不能编造完全不存在的公司/学历/年限。技能可以基于真实经验合理延伸。`;

// §5.4 输出格式 — auto
const AUTO_SCHEMA = `## 输出格式(严格 JSON,字段与类型必须完全一致)
{
  "summary": string,              // 3 行精炼自我评价
  "highlights": string[],         // 3-5 条高光要点,每条带具体数字
  "skills": {
    "core": string[],             // 核心技能 6-8 项
    "ai": string[],               // AI 相关 4-6 项
    "extra": string[]             // 加分项 4-6 项
  },
  "rewritten_experience": string, // 改写后的完整工作经历(markdown,## 分块)
  "diff_notes": [                 // 5-8 条关键改动
    {
      "type": "upgrade" | "add" | "remove" | "rephrase",
      "from": string,             // 原表述
      "to": string,               // 改写后
      "why": string               // 为什么这样改
    }
  ]
}`;

// §5.4 输出格式 — review
const REVIEW_SCHEMA = `## 输出格式(严格 JSON,字段与类型必须完全一致)
{
  "score": number,                // 整体评分 0-100
  "verdict": string,              // 一句话总评
  "issues": [                     // 6-10 条
    {
      "id": string,               // i1, i2, ...
      "severity": "high" | "medium" | "low",
      "category": "缺数据" | "技术陈旧" | "岗位不匹配" | "表达冗余" | "缺AI浓度" | "结构问题",
      "original": string,         // 原文片段(不超过 50 字)
      "problem": string,          // 问题是什么
      "suggestion": string,       // 建议怎么改
      "rewritten": string         // 直接给出改写后的版本
    }
  ]
}`;

// §5.5 Prompt 模板末尾
function tail(original) {
  return `直接返回 JSON,不要任何前后缀文字,不要 markdown 代码块包裹。只输出一个 JSON 对象。

## 原简历
${original}`;
}

function roleBlock(role) {
  const r = ROLE_SPEC[role] ?? ROLE_SPEC.frontend;
  return `## 目标岗位:${r.label}\n## 2026 技术词典(roleSpec)\n${r.spec}`;
}

/**
 * 快速重写模式 prompt (auto).
 * @param {"frontend"|"fullstack"|"ai"} role
 * @param {string} original
 */
export function buildRewritePrompt(role, original) {
  return `你是一位资深技术招聘官 + 简历改写专家,专注 2026 年中国技术招聘市场。
你的任务:把下面这份简历**重塑**成目标岗位 2026 年标准想看的样子 —— 不是润色,而是按最新技术叙事重写,强化 AI 浓度、量化产出、现代化技术栈。

${roleBlock(role)}

${HARD_RULES}

${AUTO_SCHEMA}

${tail(original)}`;
}

/**
 * 精修诊断模式 prompt (review).
 * @param {"frontend"|"fullstack"|"ai"} role
 * @param {string} original
 */
export function buildReviewPrompt(role, original) {
  return `你是一位资深技术招聘官 + 简历诊断专家,专注 2026 年中国技术招聘市场。
你的任务:对下面这份简历做**逐条诊断**,按目标岗位 2026 标准找出问题,并对每个问题直接给出可用的改写版本。诊断要犀利、具体、可执行。

${roleBlock(role)}

${HARD_RULES}

诊断时重点检查:缺量化数据、技术陈旧、与岗位不匹配、表达冗余、AI 浓度不足、结构问题。

${REVIEW_SCHEMA}

${tail(original)}`;
}

export { ROLE_SPEC };
