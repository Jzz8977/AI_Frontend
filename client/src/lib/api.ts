import type {
  ApiError,
  AuthResponse,
  AutoSegment,
  KnowledgeTopic,
  MeResponse,
  Mindmap,
  Mode,
  ModelId,
  OrchestrationIteration,
  ProjectDetail,
  ProjectSummary,
  QbankCategoryGroup,
  QbankMistakesResponse,
  QbankStartResponse,
  RewriteResponse,
  RoleId,
  ShowcaseDetail,
  ShowcaseItem,
  Usage,
} from "./types";

const TOKEN_KEY = "rr_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Called by api() on any 401 — wired up by App on mount.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function api<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err: ApiError = {
      status: 0,
      message: "网络错误,无法连接到服务器。请确认后端已启动 (localhost:3001)。",
    };
    throw err;
  }

  let data: unknown = null;
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => "");
    data = text ? { error: text } : null;
  }

  if (res.ok) return data as T;

  const d = (data ?? {}) as Record<string, unknown>;

  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    const err: ApiError = {
      status: 401,
      message: (d.error as string) || "登录已过期,请重新登录。",
    };
    throw err;
  }

  if (res.status === 429) {
    const err: ApiError = {
      status: 429,
      message:
        (d.error as string) ||
        "今日免费额度已用完。可在设置里配置你自己的 OpenRouter Key 解锁无限改写。",
      usage: d.usage as ApiError["usage"],
    };
    throw err;
  }

  if (res.status === 502) {
    const err: ApiError = {
      status: 502,
      message:
        (d.error as string) || "AI 返回解析失败,请重试。可展开查看原始返回。",
      raw: d.raw as string | undefined,
    };
    throw err;
  }

  const err: ApiError = {
    status: res.status,
    message: (d.error as string) || `请求失败 (${res.status})`,
  };
  throw err;
}

// ---- Auth ----
export function register(email: string, password: string) {
  return api<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}
export function login(email: string, password: string) {
  return api<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}
export function me() {
  return api<MeResponse>("/api/auth/me");
}
export function setOpenrouterKey(openrouterKey: string | null) {
  return api<{ ok: true; hasOwnKey: boolean }>("/api/auth/openrouter-key", {
    method: "PUT",
    body: { openrouterKey },
  });
}

// ---- Rewrite ----
export function rewrite(
  mode: Mode,
  role: RoleId,
  original: string,
  model: ModelId,
  project?: { projectId?: number | null; projectTitle?: string | null }
) {
  return api<RewriteResponse>("/api/rewrite", {
    method: "POST",
    body: {
      mode,
      role,
      original,
      model,
      // Omit nulls so the server treats "no project" as "create new".
      ...(project?.projectId != null ? { projectId: project.projectId } : {}),
      ...(project?.projectTitle ? { projectTitle: project.projectTitle } : {}),
    },
  });
}

// ---- #1 深度编排 (phased SSE;改写→评估→没达目标不结束 循环) ----
export interface OrchestrateStreamHandlers {
  /** 每轮 评估 完成后的进度心跳(精修中,尚无结果)。 */
  onIter: (info: {
    attempt?: number;
    score?: number;
    targetScore?: number;
    ceiling?: number;
  }) => void;
  onMeta: (summary: string) => void;
  onSegment: (seg: AutoSegment) => void;
  /** 精修循环把首版改写打磨得更好后,一次性下发改进版(整体替换)。 */
  onRevise: (info: {
    summary: string;
    segments: AutoSegment[];
    score?: number;
    attempt?: number;
  }) => void;
  /** 所有分段已下发完毕(知识点/学习路线 仍在后台跑)。 */
  onSegDone: () => void;
  /** #2 知识点跑完一次性下发(可能为空数组)。 */
  onKnowledge: (knowledge: KnowledgeTopic[]) => void;
  /** #3 学习路线跑完一次性下发(可能为 null)。 */
  onMindmap: (mindmap: Mindmap | null) => void;
  onEnd: (info: {
    score?: number;
    iterations?: OrchestrationIteration[];
    usage?: Usage;
    projectId: number | null;
    projectTitle: string | null;
    runId?: number;
    version?: number;
  }) => void;
  onError: (err: ApiError) => void;
}

/**
 * POST /api/orchestrate (phased SSE) — 精修循环跑完先 flush 分段,知识点 /
 * 学习路线各自跑完再各 flush 一帧。返回 abort fn。校验/鉴权失败仍以普通
 * JSON 返回(与 streamRewrite 同形)。
 */
export function streamOrchestrate(
  params: {
    role: RoleId;
    original: string;
    model: ModelId;
    projectId?: number | null;
    projectTitle?: string | null;
    targetScore?: number;
  },
  h: OrchestrateStreamHandlers
): () => void {
  const ctrl = new AbortController();
  const token = getToken();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/api/orchestrate", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          role: params.role,
          original: params.original,
          model: params.model,
          ...(params.projectId != null
            ? { projectId: params.projectId }
            : {}),
          ...(params.projectTitle ? { projectTitle: params.projectTitle } : {}),
          ...(params.targetScore != null
            ? { targetScore: params.targetScore }
            : {}),
        }),
      });
    } catch {
      h.onError({ status: 0, message: "网络错误,无法连接到服务器。" });
      return;
    }

    if (!res.ok || !res.body) {
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401) {
        clearToken();
        onUnauthorized?.();
      }
      h.onError({
        status: res.status,
        message: (d.error as string) || `请求失败 (${res.status})`,
        usage: d.usage as ApiError["usage"],
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.t === "iter")
            h.onIter({
              attempt: evt.attempt as number | undefined,
              score: evt.score as number | undefined,
              targetScore: evt.targetScore as number | undefined,
              ceiling: evt.ceiling as number | undefined,
            });
          else if (evt.t === "meta") h.onMeta((evt.summary as string) ?? "");
          else if (evt.t === "seg")
            h.onSegment({
              kind: (evt.kind as AutoSegment["kind"]) ?? "experience",
              title: (evt.title as string) ?? "",
              original: (evt.original as string) ?? "",
              rewritten: (evt.rewritten as string) ?? "",
              note: (evt.note as string) ?? "",
            });
          else if (evt.t === "revise")
            h.onRevise({
              summary: (evt.summary as string) ?? "",
              segments: ((evt.segments as AutoSegment[]) ?? []).map((sg) => ({
                kind: sg.kind ?? "experience",
                title: sg.title ?? "",
                original: sg.original ?? "",
                rewritten: sg.rewritten ?? "",
                note: sg.note ?? "",
              })),
              score: evt.score as number | undefined,
              attempt: evt.attempt as number | undefined,
            });
          else if (evt.t === "segdone") h.onSegDone();
          else if (evt.t === "knowledge")
            h.onKnowledge((evt.knowledge as KnowledgeTopic[]) ?? []);
          else if (evt.t === "mindmap")
            h.onMindmap((evt.mindmap as Mindmap | null) ?? null);
          else if (evt.t === "end")
            h.onEnd({
              score: evt.score as number | undefined,
              iterations: evt.iterations as
                | OrchestrationIteration[]
                | undefined,
              usage: evt.usage as Usage | undefined,
              projectId: (evt.projectId as number | null) ?? null,
              projectTitle: (evt.projectTitle as string | null) ?? null,
              runId: evt.runId as number | undefined,
              version: evt.version as number | undefined,
            });
          else if (evt.t === "error")
            h.onError({
              status: 502,
              message: (evt.error as string) || "深度编排失败",
              usage: evt.usage as ApiError["usage"],
            });
        }
      }
    } catch {
      if (!ctrl.signal.aborted)
        h.onError({ status: 0, message: "流式连接中断,请重试。" });
    }
  })();

  return () => ctrl.abort();
}

// ---- Streaming rewrite (auto only, NDJSON over SSE) ----
export interface StreamHandlers {
  onMeta: (summary: string) => void;
  onSegment: (seg: import("./types").AutoSegment) => void;
  onEnd: (info: {
    usage?: import("./types").Usage;
    projectId: number | null;
    projectTitle: string | null;
    runId?: number;
    version?: number;
  }) => void;
  onError: (err: ApiError) => void;
}

/**
 * POST /api/rewrite/stream and dispatch SSE events. Returns an abort fn.
 * 4xx (non-SSE) is surfaced via onError, same shape as api().
 */
export function streamRewrite(
  params: {
    role: RoleId;
    original: string;
    model: ModelId;
    projectId?: number | null;
    projectTitle?: string | null;
  },
  h: StreamHandlers
): () => void {
  const ctrl = new AbortController();
  const token = getToken();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/api/rewrite/stream", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          role: params.role,
          original: params.original,
          model: params.model,
          ...(params.projectId != null
            ? { projectId: params.projectId }
            : {}),
          ...(params.projectTitle ? { projectTitle: params.projectTitle } : {}),
        }),
      });
    } catch {
      h.onError({ status: 0, message: "网络错误,无法连接到服务器。" });
      return;
    }

    // Validation / auth failures come back as plain JSON, not SSE.
    if (!res.ok || !res.body) {
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401) {
        clearToken();
        onUnauthorized?.();
      }
      h.onError({
        status: res.status,
        message: (d.error as string) || `请求失败 (${res.status})`,
        usage: d.usage as ApiError["usage"],
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        // SSE frames are separated by a blank line.
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.t === "meta") h.onMeta((evt.summary as string) ?? "");
          else if (evt.t === "seg")
            h.onSegment({
              kind: (evt.kind as import("./types").SegmentKind) ?? "experience",
              title: (evt.title as string) ?? "",
              original: (evt.original as string) ?? "",
              rewritten: (evt.rewritten as string) ?? "",
              note: (evt.note as string) ?? "",
            });
          else if (evt.t === "end")
            h.onEnd({
              usage: evt.usage as import("./types").Usage | undefined,
              projectId: (evt.projectId as number | null) ?? null,
              projectTitle: (evt.projectTitle as string | null) ?? null,
              runId: evt.runId as number | undefined,
              version: evt.version as number | undefined,
            });
          else if (evt.t === "error")
            h.onError({
              status: 502,
              message: (evt.error as string) || "AI 流式请求失败",
              raw: evt.raw as string | undefined,
              usage: evt.usage as ApiError["usage"],
            });
        }
      }
    } catch {
      if (!ctrl.signal.aborted)
        h.onError({ status: 0, message: "流式连接中断,请重试。" });
    }
  })();

  return () => ctrl.abort();
}

// ---- Projects / history ----
export function listProjects() {
  return api<{ projects: ProjectSummary[] }>("/api/projects");
}
export function getProject(id: number) {
  return api<ProjectDetail>(`/api/projects/${id}`);
}
export function renameProject(id: number, title: string) {
  return api<{ ok: true }>(`/api/projects/${id}`, {
    method: "PATCH",
    body: { title },
  });
}
export function deleteProject(id: number) {
  return api<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" });
}

// ---- 分享 / 公开展示墙 ----
export function setRunShared(
  projectId: number,
  runId: number,
  shared: boolean
) {
  return api<{ ok: true; shared: boolean }>(
    `/api/projects/${projectId}/runs/${runId}/share`,
    { method: "PATCH", body: { shared } }
  );
}

/** 公开展示墙列表 — 免登录。 */
export function publicShowcase() {
  return api<{ items: ShowcaseItem[] }>("/api/public/showcase", {
    auth: false,
  });
}

/** 公开展示墙某条详情(仅改写结果,无原文/作者身份)— 免登录。 */
export function publicShowcaseItem(id: number) {
  return api<{ item: ShowcaseDetail }>(`/api/public/showcase/${id}`, {
    auth: false,
  });
}

// ---- 题库 AI(面试练习,经主后端代理;userId 由后端按登录态注入)----

export function qbankCategories() {
  return api<{ categories: QbankCategoryGroup[] }>("/api/qbank/categories");
}

export function qbankStart(category: string, count?: number) {
  return api<QbankStartResponse>("/api/qbank/interview/start", {
    method: "POST",
    body: { category, ...(count != null ? { count } : {}) },
  });
}

export function qbankMistakes(
  category?: string,
  limit?: number,
  offset?: number
) {
  const q = new URLSearchParams();
  if (category) q.set("category", category);
  if (limit != null) q.set("limit", String(limit));
  if (offset != null) q.set("offset", String(offset));
  const qs = q.toString();
  return api<QbankMistakesResponse>(
    `/api/qbank/mistakes${qs ? `?${qs}` : ""}`
  );
}

export interface QbankAnswerHandlers {
  /** 评判开始,告知检索到 N 条相关知识。 */
  onMeta?: (info: { questionId: string; retrievedCount: number }) => void;
  /** 流式反馈文本片段(按序拼接为 Markdown)。 */
  onChunk: (text: string) => void;
  /** 评判结束:是否答错 + 相关题 id。 */
  onDone: (info: {
    isWrong: boolean;
    relatedQuestionIds: string[];
  }) => void;
  onError: (err: ApiError) => void;
}

/**
 * POST /api/qbank/interview/answer/stream — 命名事件 SSE
 * (event: meta|chunk|done|error)。返回 abort fn。流前的校验错误以普通
 * JSON(400/404/502)经 onError 返回。
 */
export function qbankAnswerStream(
  params: { sessionId: string; questionId: string; userAnswer: string },
  h: QbankAnswerHandlers
): () => void {
  const ctrl = new AbortController();
  const token = getToken();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/api/qbank/interview/answer/stream", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
      });
    } catch {
      h.onError({ status: 0, message: "网络错误,无法连接到服务器。" });
      return;
    }

    const ctype = res.headers.get("content-type") || "";
    if (!res.ok || !res.body || !ctype.includes("text/event-stream")) {
      const d = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.status === 401) {
        clearToken();
        onUnauthorized?.();
      }
      h.onError({
        status: res.status || 502,
        message:
          (d.message as string) ||
          (d.error as string) ||
          "题库服务请求失败",
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let evt = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) evt = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5));
          }
          if (!dataLines.length) continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataLines.join("\n").trim());
          } catch {
            continue;
          }
          if (evt === "meta")
            h.onMeta?.({
              questionId: (payload.questionId as string) ?? "",
              retrievedCount: (payload.retrievedCount as number) ?? 0,
            });
          else if (evt === "chunk")
            h.onChunk((payload.text as string) ?? "");
          else if (evt === "done")
            h.onDone({
              isWrong: Boolean(payload.isWrong),
              relatedQuestionIds:
                (payload.relatedQuestionIds as string[]) ?? [],
            });
          else if (evt === "error")
            h.onError({
              status: 502,
              message: (payload.message as string) || "评判失败",
            });
        }
      }
    } catch {
      if (!ctrl.signal.aborted)
        h.onError({ status: 0, message: "评判连接中断,请重试。" });
    }
  })();

  return () => ctrl.abort();
}
