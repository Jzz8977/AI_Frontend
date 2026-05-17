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
  | "project";

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

// ---- Rewrite results (r1.md §5.4) ----

export type DiffType = "upgrade" | "add" | "remove" | "rephrase";

export interface DiffNote {
  type: DiffType;
  from: string;
  to: string;
  why: string;
}

export interface AutoResult {
  summary: string;
  highlights: string[];
  skills: {
    core: string[];
    ai: string[];
    extra: string[];
  };
  rewritten_experience: string;
  diff_notes: DiffNote[];
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

// API error shape
export interface ApiError {
  status: number;
  message: string;
  raw?: string;
  usage?: Usage;
}
