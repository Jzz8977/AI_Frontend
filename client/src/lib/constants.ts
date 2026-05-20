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
    subtitle: "// 快速重写一版",
    desc: "选岗位 / 粘原文 / AI 一键改写 / 双栏对比",
    eta: "~30s",
  },
  {
    id: "review",
    code: "MODE_02",
    title: "精修诊断",
    subtitle: "// 逐条诊断精修",
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
    en: "前端 · React / Vue 双框架 + 3D + AI 补短板",
    desc: "HTML5/CSS3 · React/Vue 任选 · 3D 可视化 · 借 AI 打通端到端",
    tags: ["HTML5 / CSS3", "React 19", "Vue 3 / Nuxt", "TS / Tailwind", "Three.js / WebGL", "AI 助手补 BFF"],
  },
  {
    id: "fullstack",
    code: "FS",
    name: "全栈工程师",
    en: "全栈 · TS / Java 双路径 · 端到端拥有感",
    desc: "Node.js + Vue/React 或 Spring Boot · 微服务 / DB / 中间件 / K8s",
    tags: ["Node.js / Next.js / NestJS", "Vue 3 / React 19", "Spring Boot 3", "MySQL / Postgres", "Redis / MQ", "K8s / 微服务"],
  },
  {
    id: "ai",
    code: "AI",
    name: "AI 应用工程师",
    en: "AI 应用 · LLM 产品 ⇄ 编码提效 双轨",
    desc: "轨 A: LLM/Agent/RAG · 轨 B: AI 工作流/CI/Guardrails",
    tags: ["Vercel AI SDK", "LangGraph / Mastra", "MCP", "Skills","Cursor Rules", "CI/PR 自动化", "度量闭环"],
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
  "正在分析简历结构…",
  "正在识别 2026 技术栈机会…",
  "正在注入 AI 相关信号…",
  "正在用量化指标重写…",
  "正在生成对比报告…",
];

export const LOADING_LINES_REVIEW = [
  "正在扫描简历问题…",
  "正在对照 2026 岗位标准…",
  "正在定位可升级点…",
  "正在为各部分打分…",
  "正在编译诊断报告…",
];

export const MAX_INPUT = 8000;
export const MIN_INPUT = 50;
