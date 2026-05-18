import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import {
  deleteProject,
  getProject,
  listProjects,
  renameProject,
} from "@/lib/api";
import type { ProjectDetail, ProjectSummary, Run } from "@/lib/types";

// 历史里展示的英文数据值 → 中文。
const MODE_CN: Record<string, string> = { auto: "快速重写", review: "精修诊断" };
const ROLE_CN: Record<string, string> = {
  frontend: "前端",
  fullstack: "全栈",
  ai: "AI 应用",
};
const cn2 = (m: Record<string, string>, v?: string | null) =>
  v ? m[v] ?? v : "";

interface ProjectsViewProps {
  /** Open a past run on the result screen (App navigates to "/"). */
  onOpenRun: (run: Run, project: ProjectDetail["project"]) => void;
  /** Iterate: new version in this project (seed = latest original). */
  onContinue: (
    projectId: number,
    title: string,
    seedOriginal: string
  ) => void;
}

const fmt = (s: string) => s.replace("T", " ").slice(0, 16);

export function ProjectsView({ onOpenRun, onContinue }: ProjectsViewProps) {
  const navigate = useNavigate();
  const { projectId: pidParam } = useParams();
  const openId = pidParam ? Number.parseInt(pidParam, 10) : null;

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { projects } = await listProjects();
      setProjects(projects);
    } catch {
      toast.error("加载项目列表失败");
      setProjects([]);
    }
  }, []);

  // List view: load the list. Detail view: load that project.
  useEffect(() => {
    if (openId == null) {
      setDetail(null);
      refresh();
      return;
    }
    let alive = true;
    setLoading(true);
    getProject(openId)
      .then((d) => alive && setDetail(d))
      .catch(() => {
        toast.error("加载项目详情失败");
        navigate("/history", { replace: true });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [openId, refresh, navigate]);

  const onRename = useCallback(
    async (id: number, current: string) => {
      const next = window.prompt("重命名项目", current)?.trim();
      if (!next || next === current) return;
      try {
        await renameProject(id, next);
        toast.success("已重命名");
        if (openId === id) setDetail(await getProject(id));
        else await refresh();
      } catch {
        toast.error("重命名失败");
      }
    },
    [refresh, openId]
  );

  const onDelete = useCallback(
    async (id: number, title: string) => {
      if (!window.confirm(`删除项目「${title}」及其所有版本?此操作不可撤销。`))
        return;
      try {
        await deleteProject(id);
        toast.success("已删除");
        if (openId === id) navigate("/history", { replace: true });
        else await refresh();
      } catch {
        toast.error("删除失败");
      }
    },
    [refresh, openId, navigate]
  );

  // ---- Detail (versions of one project) ----
  if (openId != null) {
    if (loading || !detail) {
      return (
        <div className="mx-auto max-w-[1100px] px-8 py-14 font-mono text-xs text-text-muted">
          loading…
        </div>
      );
    }
    const { project, runs } = detail;
    const latest = runs[runs.length - 1];
    return (
      <div className="mx-auto max-w-[1100px] px-8 py-14">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
              // project · {runs.length} 个版本
            </p>
            <h1 className="mt-3 font-sans text-[36px] font-light tracking-[-1px] text-text">
              {project.title}
              <span className="text-green">.</span>
            </h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/history")}
            >
              ← 项目列表
            </Button>
            {latest && (
              <Button
                size="sm"
                onClick={() =>
                  onContinue(project.id, project.title, latest.original)
                }
              >
                再改一版 →
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-px">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpenRun(r, project)}
              className="flex w-full items-center justify-between gap-4 border border-border bg-panel px-6 py-5 text-left transition-colors hover:border-border-hi"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-[13px] text-green">
                  v{r.version}
                </span>
                <Tag color={r.mode === "auto" ? "green" : "amber"}>
                  {cn2(MODE_CN, r.mode)}
                </Tag>
                <Tag color="blue">{cn2(ROLE_CN, r.role)}</Tag>
                {r.model && <Tag color="dim">{r.model}</Tag>}
              </div>
              <span className="font-mono text-[11px] text-text-muted">
                {fmt(r.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- List ----
  return (
    <div className="mx-auto max-w-[1100px] px-8 py-14">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
          // history
        </p>
        <h1 className="mt-3 font-sans text-[36px] font-light tracking-[-1px] text-text">
          我的项目<span className="text-green">.</span>
        </h1>
      </div>

      {projects == null ? (
        <p className="font-mono text-xs text-text-muted">loading…</p>
      ) : projects.length === 0 ? (
        <div className="border border-border bg-panel px-6 py-12 text-center font-mono text-[13px] text-text-muted">
          还没有任何项目。完成一次改写后会自动归档到这里。
        </div>
      ) : (
        <div className="space-y-px">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-4 border border-border bg-panel px-6 py-5"
            >
              <button
                onClick={() => navigate(`/history/${p.id}`)}
                className="flex-1 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="font-sans text-[16px] text-text">
                    {p.title}
                  </span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {p.runCount} 版
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-text-muted">
                  更新于 {fmt(p.updatedAt)}
                  {p.lastMode ? ` · ${cn2(MODE_CN, p.lastMode)}` : ""}
                  {p.lastRole ? ` · ${cn2(ROLE_CN, p.lastRole)}` : ""}
                </div>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRename(p.id, p.title)}
                >
                  重命名
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(p.id, p.title)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
