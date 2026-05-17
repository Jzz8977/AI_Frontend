import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { TopBar } from "@/components/ui/top-bar";
import { Button } from "@/components/ui/button";
import { AuthStep } from "@/components/stages/AuthStep";
import { ModeStep } from "@/components/stages/ModeStep";
import { RoleStep } from "@/components/stages/RoleStep";
import { InputStep } from "@/components/stages/InputStep";
import { LoadingTerminal } from "@/components/stages/LoadingTerminal";
import { AutoResult } from "@/components/stages/AutoResult";
import { ReviewResult } from "@/components/stages/ReviewResult";
import { ProjectsView } from "@/components/stages/ProjectsView";
import { ErrorPanel } from "@/components/stages/ErrorPanel";
import { SettingsDialog } from "@/components/SettingsDialog";

import {
  clearToken,
  getToken,
  me,
  rewrite,
  streamRewrite,
  setUnauthorizedHandler,
} from "@/lib/api";
import type {
  ApiError,
  AutoResult as AutoResultData,
  AutoSegment,
  Mode,
  ModelId,
  ProjectDetail,
  ReviewResult as ReviewData,
  RewriteResult,
  RoleId,
  Run,
  Stage,
  Usage,
  User,
} from "@/lib/types";
import { DEFAULT_MODEL } from "@/lib/constants";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [mode, setMode] = useState<Mode>("auto");
  const [role, setRole] = useState<RoleId>("frontend");
  const [model] = useState<ModelId>(DEFAULT_MODEL);
  const [original, setOriginal] = useState("");
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Project context: which project the next/current rewrite belongs to.
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const [projectName, setProjectName] = useState(""); // draft name for a NEW project
  // When set, the result screen is showing a past run (read-only history view).
  const [viewingRun, setViewingRun] = useState<Run | null>(null);

  // auto-mode streaming state (NDJSON segments arriving live).
  const [streaming, setStreaming] = useState(false);
  const [streamSummary, setStreamSummary] = useState("");
  const [streamSegments, setStreamSegments] = useState<AutoSegment[]>([]);

  const lastSubmit = useRef(0);
  const abortStream = useRef<(() => void) | null>(null);

  const stopStream = useCallback(() => {
    abortStream.current?.();
    abortStream.current = null;
    setStreaming(false);
  }, []);

  const resetProject = useCallback(() => {
    setProjectId(null);
    setProjectTitle(null);
    setProjectName("");
    setViewingRun(null);
  }, []);

  const clearStream = useCallback(() => {
    setStreamSummary("");
    setStreamSegments([]);
  }, []);

  const logout = useCallback(() => {
    stopStream();
    clearToken();
    setAuthed(false);
    setUser(null);
    setUsage(null);
    setStage("mode");
    setResult(null);
    setError(null);
    setOriginal("");
    clearStream();
    resetProject();
  }, [resetProject, stopStream, clearStream]);

  // Any 401 anywhere → clear token, return to auth.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      setUser(null);
      setUsage(null);
    });
  }, []);

  const loadMe = useCallback(async () => {
    const res = await me();
    setUser(res.user);
    setUsage(res.usage);
    setAuthed(true);
  }, []);

  // Boot: if token exists, validate via /api/auth/me.
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          await loadMe();
        } catch {
          clearToken();
        }
      }
      setBooting(false);
    })();
  }, [loadMe]);

  const onAuthed = useCallback(async () => {
    try {
      await loadMe();
      navigate("/mode");
    } catch (e) {
      toast.error((e as ApiError).message || "加载用户信息失败");
    }
  }, [loadMe, navigate]);

  // logo「前端方向部」→ 回到创建流程第一步
  const goHome = useCallback(() => {
    setError(null);
    navigate("/mode");
  }, [navigate]);

  const runRewrite = useCallback(async () => {
    const now = Date.now();
    if (now - lastSubmit.current < 1200) return; // throttle guard
    lastSubmit.current = now;

    setInFlight(true);
    setError(null);
    navigate("/result");
    const startedAt = Date.now();
    try {
      const res = await rewrite(mode, role, original, model, {
        projectId,
        // Only relevant when creating a new project (no projectId).
        projectTitle: projectId == null ? projectName : null,
      });
      // Keep the terminal animation on screen briefly for polish.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 1600) {
        await new Promise((r) => setTimeout(r, 1600 - elapsed));
      }
      setResult(res.result);
      setUsage(res.usage);
      setProjectId(res.projectId);
      setProjectTitle(res.projectTitle);
      setViewingRun(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        // api() already cleared auth; AuthStep gate will take over.
        navigate("/input");
        return;
      }
      if (err.status === 429 && err.usage) setUsage(err.usage);
      setError(err);
      navigate("/input");
      toast.error(err.message);
    } finally {
      setInFlight(false);
    }
  }, [mode, role, original, model, projectId, projectName, navigate]);

  // auto mode → streaming NDJSON. Render the result page immediately and
  // append segment cards as they arrive.
  const runStream = useCallback(() => {
    const now = Date.now();
    if (now - lastSubmit.current < 1200) return;
    lastSubmit.current = now;

    stopStream();
    setError(null);
    setResult(null);
    setViewingRun(null);
    setStreamSummary("");
    setStreamSegments([]);
    setStreaming(true);
    setInFlight(true);
    navigate("/result");

    abortStream.current = streamRewrite(
      {
        role,
        original,
        model,
        projectId,
        projectTitle: projectId == null ? projectName : null,
      },
      {
        onMeta: (summary) => setStreamSummary(summary),
        onSegment: (seg) => setStreamSegments((p) => [...p, seg]),
        onEnd: (info) => {
          if (info.usage) setUsage(info.usage);
          setProjectId(info.projectId);
          setProjectTitle(info.projectTitle);
          setStreaming(false);
          setInFlight(false);
          abortStream.current = null;
        },
        onError: (err) => {
          setStreaming(false);
          setInFlight(false);
          abortStream.current = null;
          if (err.status === 401) {
            navigate("/input");
            return;
          }
          if (err.status === 429 && err.usage) setUsage(err.usage);
          setError(err);
          navigate("/input");
          toast.error(err.message);
        },
      }
    );
  }, [role, original, model, projectId, projectName, stopStream, navigate]);

  // Single entry point used by InputStep / retry.
  const onExecute = useCallback(() => {
    if (mode === "auto") runStream();
    else runRewrite();
  }, [mode, runStream, runRewrite]);

  // "改写新简历(新建项目)" — drop project context, back to start.
  const newProject = useCallback(() => {
    stopStream();
    clearStream();
    setResult(null);
    setError(null);
    setOriginal("");
    resetProject();
    navigate("/mode");
  }, [resetProject, stopStream, clearStream, navigate]);

  // "再改一版(留在本项目)" — keep project, return to input to tweak & resubmit.
  const iterateProject = useCallback(
    (seedOriginal?: string) => {
      stopStream();
      clearStream();
      setResult(null);
      setError(null);
      setViewingRun(null);
      if (seedOriginal != null) setOriginal(seedOriginal);
      navigate("/input");
    },
    [stopStream, clearStream, navigate]
  );

  // Open a past run from history (read-only on the result screen).
  const openRun = useCallback(
    (run: Run, project: ProjectDetail["project"]) => {
      if (!run.result) {
        toast.error("该版本没有可展示的结果");
        return;
      }
      stopStream();
      clearStream();
      setResult(run.result);
      setMode(run.mode);
      setRole(run.role);
      setOriginal(run.original);
      setProjectId(project.id);
      setProjectTitle(project.title);
      setViewingRun(run);
      navigate("/result");
    },
    [stopStream, clearStream, navigate]
  );

  // ProjectsView「再改一版」— set project context then go to input under "/".
  const continueProject = useCallback(
    (pid: number, title: string, seed: string) => {
      setProjectId(pid);
      setProjectTitle(title);
      setViewingRun(null);
      stopStream();
      clearStream();
      setResult(null);
      setError(null);
      setOriginal(seed);
      navigate("/input");
    },
    [stopStream, clearStream, navigate]
  );

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <span className="font-mono text-xs uppercase tracking-[2px] text-text-muted">
          loading…
        </span>
      </div>
    );
  }

  if (!authed) {
    return <AuthStep onAuthed={onAuthed} />;
  }

  // Result-screen action buttons differ for a fresh rewrite vs. history view.
  const resultActions = viewingRun ? (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/history")}
      >
        ← 返回历史
      </Button>
      {projectId != null && projectTitle != null && (
        <Button
          size="sm"
          onClick={() => iterateProject(viewingRun.original)}
        >
          基于此再改一版 →
        </Button>
      )}
    </>
  ) : (
    <>
      <Button variant="outline" size="sm" onClick={newProject}>
        改写新简历
      </Button>
      <Button size="sm" onClick={() => iterateProject()}>
        再改一版 →
      </Button>
    </>
  );

  const resultTitle = viewingRun
    ? `${projectTitle ?? "项目"} · v${viewingRun.version}`
    : mode === "auto"
      ? "改写完成"
      : "诊断完成";

  // Each flow step is its own route; back buttons navigate routes too.
  const modeStep = (
    <ModeStep
      onSelect={(m) => {
        setMode(m);
        navigate("/role");
      }}
    />
  );

  const roleStep = (
    <RoleStep
      mode={mode}
      onSelect={(r) => {
        setRole(r);
        navigate("/input");
      }}
      onBack={() => navigate("/mode")}
    />
  );

  const inputStep = error ? (
    <ErrorPanel
      error={error}
      onRetry={onExecute}
      onBack={() => setError(null)}
    />
  ) : (
    <InputStep
      mode={mode}
      role={role}
      value={original}
      onChange={setOriginal}
      currentProjectTitle={projectId != null ? projectTitle : null}
      projectName={projectName}
      onProjectNameChange={setProjectName}
      onExecute={onExecute}
      onBack={() => navigate("/role")}
      inFlight={inFlight}
    />
  );

  // /result is only valid mid/after a rewrite (or when viewing history);
  // a cold hit (e.g. refresh) bounces back to /input.
  const hasResultContext =
    streaming ||
    inFlight ||
    !!result ||
    !!viewingRun ||
    streamSegments.length > 0 ||
    streamSummary !== "";

  let resultStep: ReactNode;
  if (!hasResultContext) {
    resultStep = <Navigate to="/input" replace />;
  } else if (mode === "auto") {
    resultStep = (
      <AutoResult
        data={
          viewingRun
            ? (result as AutoResultData)
            : { summary: streamSummary, segments: streamSegments }
        }
        streaming={streaming}
        title={resultTitle}
        actions={streaming ? null : resultActions}
      />
    );
  } else if (result) {
    resultStep = (
      <ReviewResult
        data={result as ReviewData}
        title={resultTitle}
        actions={resultActions}
      />
    );
  } else {
    // review in flight, awaiting the (non-streamed) response
    resultStep = (
      <div className="flex min-h-[70vh] items-center justify-center px-8">
        <LoadingTerminal mode={mode} />
      </div>
    );
  }

  // TopBar step indicator derived from the URL.
  const pathStage: Stage = location.pathname.startsWith("/role")
    ? "role"
    : location.pathname.startsWith("/input")
      ? "input"
      : location.pathname.startsWith("/result")
        ? mode === "review" && inFlight && !result
          ? "loading"
          : "result"
        : "mode";

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        stage={pathStage}
        usage={usage}
        email={user?.email}
        historyActive={location.pathname.startsWith("/history")}
        onHome={goHome}
        onHistory={() => navigate("/history")}
        onSettings={() => setSettingsOpen(true)}
        onLogout={logout}
      />

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/mode" replace />} />
          <Route path="/mode" element={modeStep} />
          <Route path="/role" element={roleStep} />
          <Route path="/input" element={inputStep} />
          <Route path="/result" element={resultStep} />
          <Route
            path="/history"
            element={
              <ProjectsView onOpenRun={openRun} onContinue={continueProject} />
            }
          />
          <Route
            path="/history/:projectId"
            element={
              <ProjectsView onOpenRun={openRun} onContinue={continueProject} />
            }
          />
          <Route path="*" element={<Navigate to="/mode" replace />} />
        </Routes>
      </main>

      <SettingsDialog
        open={settingsOpen}
        hasOwnKey={!!user?.hasOwnKey}
        onClose={() => setSettingsOpen(false)}
        onChanged={(hasOwnKey) => {
          setUser((u) => (u ? { ...u, hasOwnKey } : u));
          loadMe().catch(() => {});
        }}
      />
    </div>
  );
}
