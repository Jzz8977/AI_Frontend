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
import { ResumeEditor } from "@/components/stages/ResumeEditor";
import { ErrorPanel } from "@/components/stages/ErrorPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { RESUME_SEED_KEY, docFromAutoResult } from "@/lib/resume-doc";

import {
  clearToken,
  getToken,
  me,
  rewrite,
  streamOrchestrate,
  streamRewrite,
  setUnauthorizedHandler,
} from "@/lib/api";
import type {
  ApiError,
  AutoResult as AutoResultData,
  AutoSegment,
  KnowledgeTopic,
  Mindmap,
  Mode,
  OrchestrationIteration,
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
  // #1 深度编排:auto 模式下开启 → 走 /api/orchestrate(改写→评估→没达目标不结束)。
  const [deep, setDeep] = useState(false);
  const [orch, setOrch] = useState<{
    score: number;
    iterations: OrchestrationIteration[];
  } | null>(null);
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
  // #1 深度编排 phased SSE: 精修循环跑完先出分段,知识点/学习路线随后各自下发。
  const [orchStreaming, setOrchStreaming] = useState(false);
  const [streamKnowledge, setStreamKnowledge] = useState<KnowledgeTopic[]>([]);
  const [streamMindmap, setStreamMindmap] = useState<Mindmap | null>(null);
  const [orchProgress, setOrchProgress] = useState<{
    attempt?: number;
    score?: number;
    targetScore?: number;
    ceiling?: number;
  } | null>(null);

  const lastSubmit = useRef(0);
  const abortStream = useRef<(() => void) | null>(null);

  const stopStream = useCallback(() => {
    abortStream.current?.();
    abortStream.current = null;
    setStreaming(false);
    setOrchStreaming(false);
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
    setStreamKnowledge([]);
    setStreamMindmap(null);
    setOrchProgress(null);
  }, []);

  const logout = useCallback(() => {
    stopStream();
    clearToken();
    setAuthed(false);
    setUser(null);
    setUsage(null);
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
      setOriginal(""); // 提交成功即清空输入,避免原文残留(失败时保留以便重试)
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
    setOrch(null);
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
          setOriginal(""); // 流式成功收尾即清空输入(失败/中断不清,便于重试)
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

  // #1 深度编排:phased SSE。精修循环(Mastra 改写→评估,没达目标不结束)
  // 跑完先 flush 分段(分段对比/整理成稿/简历模板 立即可用),知识点、
  // 学习路线 随后各自跑完再各下发一帧 —— 不必等整条流水线。
  const runOrchestrate = useCallback(() => {
    const now = Date.now();
    if (now - lastSubmit.current < 1200) return;
    lastSubmit.current = now;

    stopStream();
    setError(null);
    setResult(null);
    setOrch(null);
    setViewingRun(null);
    setStreamSummary("");
    setStreamSegments([]);
    setStreamKnowledge([]);
    setStreamMindmap(null);
    setOrchProgress(null);
    setOrchStreaming(true);
    setStreaming(true);
    setInFlight(true);
    navigate("/result");

    abortStream.current = streamOrchestrate(
      {
        role,
        original,
        model,
        projectId,
        projectTitle: projectId == null ? projectName : null,
      },
      {
        onIter: (info) => setOrchProgress(info),
        onMeta: (summary) => setStreamSummary(summary),
        onSegment: (seg) => setStreamSegments((p) => [...p, seg]),
        // 分段全部到位:结束「流式」态(分段对比/整理成稿/简历模板 完成、
        // 动作按钮可用),仅保留 orchStreaming → 知识点/学习路线 tab 显示生成中。
        onSegDone: () => setStreaming(false),
        onKnowledge: (k) => setStreamKnowledge(k),
        onMindmap: (m) => setStreamMindmap(m),
        onEnd: (info) => {
          if (info.usage) setUsage(info.usage);
          setProjectId(info.projectId);
          setProjectTitle(info.projectTitle);
          if (info.score != null)
            setOrch({
              score: info.score,
              iterations: info.iterations ?? [],
            });
          setStreaming(false);
          setOrchStreaming(false);
          setInFlight(false);
          abortStream.current = null;
          setOriginal(""); // 编排成功收尾即清空输入(失败/中断不清,便于重试)
          toast.success(
            `编排完成 · 评分 ${info.score ?? "-"} · ${
              info.iterations?.length ?? 0
            } 轮`
          );
        },
        onError: (err) => {
          setStreaming(false);
          setOrchStreaming(false);
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
    if (mode === "auto") (deep ? runOrchestrate : runStream)();
    else runRewrite();
  }, [mode, deep, runOrchestrate, runStream, runRewrite]);

  // "改写新简历(新建项目)" — drop project context, back to start.
  const newProject = useCallback(() => {
    stopStream();
    clearStream();
    setResult(null);
    setOrch(null);
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

  // #6 把当前 auto 改写结果作为种子带入在线简历编辑器(纯本地,不上传)。
  const openInEditor = useCallback(() => {
    const data: AutoResultData =
      viewingRun || (result && !streaming)
        ? (result as AutoResultData)
        : { summary: streamSummary, segments: streamSegments };
    try {
      localStorage.setItem(
        RESUME_SEED_KEY,
        JSON.stringify(docFromAutoResult(data))
      );
    } catch {
      /* storage disabled — 编辑器仍会打开,只是没有预填 */
    }
    navigate("/editor");
  }, [viewingRun, result, streaming, streamSummary, streamSegments, navigate]);

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
  const editorAction = mode === "auto" && (
    <Button variant="outline" size="sm" onClick={openInEditor}>
      在编辑器中编辑
    </Button>
  );

  const resultActions = viewingRun ? (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/history")}
      >
        ← 返回历史
      </Button>
      {editorAction}
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
      {editorAction}
      <Button size="sm" onClick={() => iterateProject()}>
        再改一版 →
      </Button>
    </>
  );

  const resultTitle = viewingRun
    ? `${projectTitle ?? "项目"} · v${viewingRun.version}`
    : mode === "auto"
      ? orch
        ? `改写完成 · 评分 ${orch.score}(${orch.iterations.length} 轮编排)`
        : "改写完成"
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
      deep={deep}
      onDeepChange={setDeep}
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
  } else if (
    orchStreaming &&
    streamSegments.length === 0 &&
    streamSummary === ""
  ) {
    // 深度编排:精修循环还没产出第一段 — loading terminal + 轮次进度心跳。
    const p = orchProgress;
    const note = p
      ? `精修中 · 第 ${p.attempt ?? "?"} 轮 · 评分 ${p.score ?? "-"}/${
          p.targetScore ?? 85
        }(没达目标继续,上限 ${p.ceiling ?? 4} 轮)`
      : "正在启动深度编排…";
    resultStep = (
      <div className="flex min-h-[70vh] items-center justify-center px-8">
        <LoadingTerminal mode="auto" note={note} />
      </div>
    );
  } else if (mode === "auto" && inFlight && !result && !streaming && !orchStreaming) {
    // (safety) non-streamed auto in flight — show the loading terminal.
    resultStep = (
      <div className="flex min-h-[70vh] items-center justify-center px-8">
        <LoadingTerminal mode="auto" />
      </div>
    );
  } else if (mode === "auto") {
    resultStep = (
      <AutoResult
        data={
          viewingRun || (result && !streaming && !orchStreaming)
            ? (result as AutoResultData)
            : {
                summary: streamSummary,
                segments: streamSegments,
                knowledge: streamKnowledge,
                mindmap: streamMindmap,
              }
        }
        streaming={streaming}
        orchestrating={orchStreaming}
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
  const pathStage: Stage = location.pathname.startsWith("/editor")
    ? "editor"
    : location.pathname.startsWith("/role")
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
        editorActive={location.pathname.startsWith("/editor")}
        onHome={goHome}
        onHistory={() => navigate("/history")}
        onEditor={() => navigate("/editor")}
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
          <Route
            path="/editor"
            element={<ResumeEditor onBack={() => navigate(-1)} />}
          />
          <Route path="*" element={<Navigate to="/mode" replace />} />
        </Routes>
      </main>

      <footer className="no-print border-t border-border px-8 py-4">
        <p className="mx-auto max-w-[1280px] font-mono text-[11px] leading-relaxed text-text-muted">
          隐私说明：你的简历内容仅用于本工具生成改写结果,不对外共享、不用于训练;
          生成的版本会存入你的账户历史以便复用,可在「历史」中一键删除。
          在「简历模板」补充的姓名 / 联系方式,以及「在线简历编辑器」中编辑的整份简历,
          仅保存在本地浏览器,不会上传服务器,清除浏览器数据即丢失。
        </p>
      </footer>

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
