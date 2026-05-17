import type { Mode, ModelId, RoleId } from "./types";

export interface ModelDef {
  id: ModelId;
  label: string;
}

// 主流模型 — 经 OpenRouter 调用。值需与后端 MODEL_MAP 的 key 一致。
export const MODELS: ModelDef[] = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "qwen", label: "Qwen" },
  { id: "deepseek", label: "DeepSeek" },
];

export const DEFAULT_MODEL: ModelId = "deepseek";

export interface ModeDef {
  id: Mode;
  code: string;
  title: string;
  subtitle: string;
  desc: string;
  eta: string;
}

export const MODES: ModeDef[] = [
  {
    id: "auto",
    code: "MODE_01",
    title: "快速重写",
    subtitle: "// auto-rewrite",
    desc: "选岗位 / 粘原文 / AI 一键改写 / 双栏对比",
    eta: "~30s",
  },
  {
    id: "review",
    code: "MODE_02",
    title: "精修诊断",
    subtitle: "// diagnose & refine",
    desc: "AI 逐条分析问题 / 你决定接受或修改每条建议",
    eta: "~90s",
  },
];

export interface RoleDef {
  id: RoleId;
  code: string;
  name: string;
  en: string;
  desc: string;
  tags: string[];
}

export const ROLES: RoleDef[] = [
  {
    id: "frontend",
    code: "FE",
    name: "前端工程师",
    en: "Frontend Engineer",
    desc: "深度交互 / 性能 / 工程化",
    tags: ["React 19", "Next.js 15", "TS", "Tailwind", "Motion", "WebGPU"],
  },
  {
    id: "fullstack",
    code: "FS",
    name: "全栈工程师",
    en: "Full-Stack Engineer",
    desc: "端到端拥有感 / API / 数据库 / 部署",
    tags: ["Next.js RSC", "tRPC", "Postgres", "Drizzle", "Edge", "Vercel"],
  },
  {
    id: "ai",
    code: "AI",
    name: "AI 应用工程师",
    en: "AI Application Engineer",
    desc: "LLM 集成 / Agent / RAG / 流式 UI",
    tags: ["Vercel AI SDK", "LangGraph", "MCP", "RAG", "Tools", "Streaming"],
  },
];

// r1.md §3.3 示例数据
export const SAMPLE_RESUME = `张三 / 5 年前端
工作经历:
- 2021-至今 XX 科技 高级前端
  负责公司主站重构,使用 Vue + Webpack,优化首屏加载
  参与活动页开发,完成营销活动 20+
  协助后端联调接口,处理 jQuery 老代码

- 2019-2021 YY 公司 前端开发
  使用 React 开发管理后台,实现表单/列表/图表
  负责移动端 H5 开发

技能:HTML/CSS/JS/Vue/React/Node.js`;

// r1.md §3.4 loading terminal lines
export const LOADING_LINES_AUTO = [
  "analyzing resume structure...",
  "detecting 2026 stack opportunities...",
  "injecting AI-related signals...",
  "rewriting with quantified metrics...",
  "generating diff report...",
];

export const LOADING_LINES_REVIEW = [
  "scanning resume for issues...",
  "matching against 2026 role spec...",
  "identifying upgrade opportunities...",
  "scoring each section...",
  "compiling diagnostic report...",
];

export const MAX_INPUT = 8000;
export const MIN_INPUT = 50;
