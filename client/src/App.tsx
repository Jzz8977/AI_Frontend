import { useCallback, useEffect, useRef, useState } from "react";
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
  setUnauthorizedHandler,
} from "@/lib/api";
import type {
  ApiError,
  AutoResult as AutoResultData,
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
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [stage, setStage] = useState<Stage>("mode");
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

  const lastSubmit = useRef(0);

  const resetProject = useCallback(() => {
    setProjectId(null);
    setProjectTitle(null);
    setProjectName("");
    setViewingRun(null);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAuthed(false);
    setUser(null);
    setUsage(null);
    setStage("mode");
    setResult(null);
    setError(null);
    setOriginal("");
    resetProject();
  }, [resetProject]);

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
      setStage("mode");
    } catch (e) {
      toast.error((e as ApiError).message || "加载用户信息失败");
    }
  }, [loadMe]);

  const runRewrite = useCallback(async () => {
    const now = Date.now();
    if (now - lastSubmit.current < 1200) return; // throttle guard
    lastSubmit.current = now;

    setInFlight(true);
    setError(null);
    setStage("loading");
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
      setStage("result");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        // api() already cleared auth; reset the stage so we don't leave a
        // stale "loading" screen behind the AuthStep gate.
        setStage("input");
        return;
      }
      if (err.status === 429 && err.usage) setUsage(err.usage);
      setError(err);
      setStage("input");
      toast.error(err.message);
    } finally {
      setInFlight(false);
    }
  }, [mode, role, original, model, projectId, projectName]);

  // "改写新简历(新建项目)" — drop project context, back to start.
  const newProject = useCallback(() => {
    setResult(null);
    setError(null);
    setOriginal("");
    resetProject();
    setStage("mode");
  }, [resetProject]);

  // "再改一版(留在本项目)" — keep project, return to input to tweak & resubmit.
  const iterateProject = useCallback(
    (seedOriginal?: string) => {
      setResult(null);
      setError(null);
      setViewingRun(null);
      if (seedOriginal != null) setOriginal(seedOriginal);
      setStage("input");
    },
    []
  );

  // Open a past run from history (read-only on the result screen).
  const openRun = useCallback(
    (run: Run, project: ProjectDetail["project"]) => {
      if (!run.result) {
        toast.error("该版本没有可展示的结果");
        return;
      }
      setResult(run.result);
      setMode(run.mode);
      setRole(run.role);
      setOriginal(run.original);
      setProjectId(project.id);
      setProjectTitle(project.title);
      setViewingRun(run);
      setStage("result");
    },
    []
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
      <Button variant="outline" size="sm" onClick={() => setStage("history")}>
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

  return (
    <div className="min-h-screen bg-bg">
      <TopBar
        stage={stage}
        usage={usage}
        email={user?.email}
        onHistory={() => setStage("history")}
        onSettings={() => setSettingsOpen(true)}
        onLogout={logout}
      />

      <main>
        {stage === "mode" && (
          <ModeStep
            onSelect={(m) => {
              setMode(m);
              setStage("role");
            }}
          />
        )}

        {stage === "role" && (
          <RoleStep
            mode={mode}
            onSelect={(r) => {
              setRole(r);
              setStage("input");
            }}
            onBack={() => setStage("mode")}
          />
        )}

        {stage === "input" && (
          <>
            {error && (
              <ErrorPanel
                error={error}
                onRetry={runRewrite}
                onBack={() => setError(null)}
              />
            )}
            {!error && (
              <InputStep
                mode={mode}
                role={role}
                value={original}
                onChange={setOriginal}
                currentProjectTitle={projectId != null ? projectTitle : null}
                projectName={projectName}
                onProjectNameChange={setProjectName}
                onExecute={runRewrite}
                onBack={() => setStage("role")}
                inFlight={inFlight}
              />
            )}
          </>
        )}

        {stage === "loading" && (
          <div className="flex min-h-[70vh] items-center justify-center px-8">
            <LoadingTerminal mode={mode} />
          </div>
        )}

        {stage === "result" && result && mode === "auto" && (
          <AutoResult
            data={result as AutoResultData}
            original={original}
            title={resultTitle}
            actions={resultActions}
          />
        )}

        {stage === "result" && result && mode === "review" && (
          <ReviewResult
            data={result as ReviewData}
            title={resultTitle}
            actions={resultActions}
          />
        )}

        {(stage === "history" || stage === "project") && (
          <ProjectsView onOpenRun={openRun} onContinue={
            (pid, title, seed) => {
              setProjectId(pid);
              setProjectTitle(title);
              setViewingRun(null);
              iterateProject(seed);
            }
          } />
        )}
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
