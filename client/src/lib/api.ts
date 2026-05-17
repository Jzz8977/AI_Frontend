import type {
  ApiError,
  AuthResponse,
  MeResponse,
  Mode,
  ModelId,
  ProjectDetail,
  ProjectSummary,
  RewriteResponse,
  RoleId,
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
