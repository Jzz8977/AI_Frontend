// Types mirroring CONTRACT.md + r1.md §5.4 result schemas.

export type Mode = "auto" | "review";
export type RoleId = "frontend" | "fullstack" | "ai";
export type ModelId = "claude" | "chatgpt" | "qwen" | "deepseek";

export type Stage =
  | "auth"
  | "mode"
  | "role"
  | "input"
  | "loading"
  | "result"
  | "history"
  | "project"
  | "editor";

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  resetAt: string;
}

export interface User {
  id: number | string;
  email: string;
  hasOwnKey?: boolean;
}

export interface AuthResponse {
  token: string;
  user: { id: number | string; email: string };
}

export interface MeResponse {
  user: User;
  usage: Usage;
}

// ---- Rewrite results ----

// auto = streamed NDJSON: a summary + per-segment before/after compare.
export type SegmentKind = "skills" | "experience" | "project";

export interface AutoSegment {
  kind: SegmentKind;
  title: string;
  original: string;
  rewritten: string;
  note: string;
}

// #2 知识点 — 仅深度编排结果包含;普通改写无此字段。
export type KnowledgeLevel = "核心" | "进阶" | "加分";

export interface KnowledgeTopic {
  topic: string;
  level: KnowledgeLevel;
  points: string[];
}

// #3 学习路线思维导图(Excalidraw 风格)。
export interface MindmapTopic {
  title: string;
  points: string[];
}
export interface MindmapPhase {
  name: string;
  duration: string;
  topics: MindmapTopic[];
}
export interface Mindmap {
  goal: string;
  phases: MindmapPhase[];
}

export interface AutoResult {
  summary: string;
  segments: AutoSegment[];
  knowledge?: KnowledgeTopic[];
  mindmap?: Mindmap | null;
}

export type IssueSeverity = "high" | "medium" | "low";
export type IssueCategory =
  | "缺数据"
  | "技术陈旧"
  | "岗位不匹配"
  | "表达冗余"
  | "缺AI浓度"
  | "结构问题"
  | string;

export interface ReviewIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  original: string;
  problem: string;
  suggestion: string;
  rewritten: string;
}

export interface ReviewResult {
  score: number;
  verdict: string;
  issues: ReviewIssue[];
}

export type RewriteResult = AutoResult | ReviewResult;

export interface RewriteResponse {
  result: RewriteResult;
  usage: Usage;
  projectId: number | null;
  projectTitle: string | null;
  runId?: number;
  version?: number;
}

// #1 工作流编排 — 改写→评估→没达目标不结束 的最终产物 + 迭代轨迹。
export interface OrchestrationIteration {
  attempt: number;
  score: number;
  feedback: string;
}

export interface OrchestrateResponse {
  result: AutoResult;
  score: number;
  iterations: OrchestrationIteration[];
  knowledge: KnowledgeTopic[];
  mindmap: Mindmap | null;
  usage: Usage;
  projectId: number | null;
  projectTitle: string | null;
  runId?: number;
  version?: number;
}

// ---- Projects / history ----

export interface ProjectSummary {
  id: number;
  title: string;
  runCount: number;
  lastRole: RoleId | null;
  lastMode: Mode | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: number;
  version: number;
  mode: Mode;
  role: RoleId;
  model: ModelId | null;
  original: string;
  result: RewriteResult | null;
  createdAt: string;
}

export interface ProjectDetail {
  project: {
    id: number;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  runs: Run[];
}

// ---- #6 在线简历编辑器(magic-resume 风格,纯本地)----
// 结构化简历文档:仅存浏览器 localStorage,绝不上传服务器。

export type ResumeTemplateId = "classic" | "compact" | "timeline";

export interface ResumeBasics {
  name: string;
  title: string; // 意向岗位
  phone: string;
  email: string;
  city: string;
  website: string;
}

export interface ResumeExperience {
  id: string;
  company: string;
  role: string;
  period: string;
  bullets: string[];
}

export interface ResumeProject {
  id: string;
  name: string;
  stack: string;
  period: string;
  bullets: string[];
}

export interface ResumeEducation {
  id: string;
  school: string;
  major: string;
  degree: string;
  period: string;
}

export interface ResumeCustomSection {
  id: string;
  heading: string;
  body: string;
}

export interface ResumeDoc {
  basics: ResumeBasics;
  summary: string;
  skills: string;
  experience: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  custom: ResumeCustomSection[];
  template: ResumeTemplateId;
}

// API error shape
export interface ApiError {
  status: number;
  message: string;
  raw?: string;
  usage?: Usage;
}
