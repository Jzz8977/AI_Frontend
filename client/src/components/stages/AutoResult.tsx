import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot } from "@/components/ui/dot";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type {
  AutoResult as AutoResultData,
  AutoSegment,
  KnowledgeTopic,
  Mindmap,
  SegmentKind,
} from "@/lib/types";

interface AutoResultProps {
  data: AutoResultData;
  /** True while segments are still streaming in. */
  streaming?: boolean;
  title?: string;
  actions?: ReactNode;
}

const KIND_META: Record<
  SegmentKind,
  { label: string; color: "green" | "amber" | "blue" }
> = {
  skills: { label: "技能", color: "amber" },
  experience: { label: "工作经历", color: "blue" },
  project: { label: "项目", color: "green" },
};

const KIND_HEADING: Record<SegmentKind, string> = {
  skills: "技能",
  experience: "工作经历",
  project: "项目",
};

/** Stitch summary + every rewritten segment into one clean, copyable doc. */
function buildDoc(summary: string, segments: AutoSegment[]): string {
  const lines: string[] = [];
  if (summary.trim()) {
    lines.push("# 个人简介", "", summary.trim(), "");
  }
  for (const kind of ["skills", "experience", "project"] as SegmentKind[]) {
    const segs = segments.filter((s) => s.kind === kind && s.rewritten.trim());
    if (segs.length === 0) continue;
    lines.push(`# ${KIND_HEADING[kind]}`, "");
    for (const s of segs) {
      if (s.title.trim()) lines.push(`## ${s.title.trim()}`, "");
      lines.push(s.rewritten.trim(), "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function DocView({ doc }: { doc: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc);
      toast.success("已复制整理稿到剪贴板");
    } catch {
      toast.error("复制失败,请手动选择文本复制");
    }
  };
  return (
    <div className="border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          整理成稿 · 可直接复制
        </span>
        <Button size="sm" onClick={copy} disabled={!doc.trim()}>
          复制全文
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words px-6 py-5 font-mono text-[13px] leading-[1.8] text-text">
        {doc.trim() ? doc : "// 生成中…"}
      </pre>
    </div>
  );
}

// ---- 简历模板 (client-only; personal fields never leave the browser) ----

interface Profile {
  name: string;
  target: string;
  phone: string;
  email: string;
  city: string;
  education: string;
}

const EMPTY_PROFILE: Profile = {
  name: "",
  target: "",
  phone: "",
  email: "",
  city: "",
  education: "",
};

const PROFILE_KEY = "resume_tpl_profile";

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return EMPTY_PROFILE;
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

const PROFILE_FIELDS: { key: keyof Profile; label: string; ph: string }[] = [
  { key: "name", label: "姓名", ph: "张三" },
  { key: "target", label: "意向岗位", ph: "前端工程师" },
  { key: "phone", label: "电话", ph: "138-0000-0000" },
  { key: "email", label: "邮箱", ph: "you@example.com" },
  { key: "city", label: "城市", ph: "上海" },
];

/** Stitch the user's local profile + AI doc into one ready-to-send résumé. */
function buildResume(
  p: Profile,
  summary: string,
  segments: AutoSegment[]
): string {
  const lines: string[] = [];
  if (p.name.trim()) lines.push(`# ${p.name.trim()}`, "");
  const contact = [
    p.target.trim() && `求职意向：${p.target.trim()}`,
    p.phone.trim() && `电话：${p.phone.trim()}`,
    p.email.trim() && `邮箱：${p.email.trim()}`,
    p.city.trim() && `城市：${p.city.trim()}`,
  ].filter(Boolean);
  if (contact.length) lines.push(contact.join(" · "), "");
  const body = buildDoc(summary, segments);
  if (body) lines.push(body, "");
  if (p.education.trim()) {
    lines.push("# 教育经历", "", p.education.trim(), "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function TemplateView({
  summary,
  segments,
}: {
  summary: string;
  segments: AutoSegment[];
}) {
  const [profile, setProfile] = useState<Profile>(loadProfile);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* storage full / disabled — non-fatal, just no local persistence */
    }
  }, [profile]);

  const set = (k: keyof Profile, v: string) =>
    setProfile((prev) => ({ ...prev, [k]: v }));

  const resume = useMemo(
    () => buildResume(profile, summary, segments),
    [profile, summary, segments]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resume);
      toast.success("已复制完整简历到剪贴板");
    } catch {
      toast.error("复制失败,请手动选择文本复制");
    }
  };

  const clearProfile = () => {
    setProfile(EMPTY_PROFILE);
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
    toast.success("已清空本地补充信息");
  };

  return (
    <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
      {/* left: fields the user fills in (local-only) */}
      <div className="space-y-5 bg-panel p-7">
        <p className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          补充信息 · 仅存本地浏览器
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => (
            <label key={f.key} className="block space-y-2">
              <span className="font-mono text-[11px] tracking-[1px] text-text-dim">
                {f.label}
              </span>
              <Input
                value={profile[f.key]}
                placeholder={f.ph}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="block space-y-2">
          <span className="font-mono text-[11px] tracking-[1px] text-text-dim">
            教育经历
          </span>
          <textarea
            value={profile.education}
            placeholder={"2018-2022 ｜ XX 大学 ｜ 计算机科学与技术 ｜ 本科"}
            onChange={(e) => set("education", e.target.value)}
            rows={4}
            className={cn(
              "w-full border border-border bg-bg px-3 py-2 font-mono text-sm leading-[1.7] text-text",
              "placeholder:text-text-muted focus-visible:border-green focus-visible:outline-none"
            )}
          />
        </label>
        <p className="font-mono text-[11px] leading-relaxed text-text-muted">
          // 此处补充的姓名 / 联系方式 / 教育经历仅保存在你当前浏览器本地,
          不会上传服务器,清除浏览器数据即丢失。简历改写内容用于生成结果、
          不对外共享,可在「历史」中一键删除。
        </p>
      </div>

      {/* right: assembled, ready-to-send résumé */}
      <div className="bg-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
            完整简历 · 可直接投递
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={clearProfile}
              title="清空本地补充信息"
            >
              清空补充
            </Button>
            <Button size="sm" onClick={copy} disabled={!resume.trim()}>
              复制简历全文
            </Button>
          </div>
        </div>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words px-6 py-5 font-mono text-[13px] leading-[1.8] text-text">
          {resume.trim() ? resume : "// 填写左侧信息后,完整简历会在这里生成…"}
        </pre>
      </div>
    </div>
  );
}

// ---- #2 知识点 ----

const LEVEL_COLOR: Record<
  KnowledgeTopic["level"],
  "green" | "blue" | "amber"
> = { 核心: "green", 进阶: "blue", 加分: "amber" };

function KnowledgeView({ knowledge }: { knowledge: KnowledgeTopic[] }) {
  if (!knowledge.length) {
    return (
      <div className="border border-border bg-panel p-6 font-mono text-[12px] text-text-muted">
        // 知识点仅「深度编排」结果包含。在输入页开启「深度编排」后重新生成即可。
      </div>
    );
  }
  const copy = async () => {
    const md = knowledge
      .map(
        (k) =>
          `## ${k.topic}(${k.level})\n` +
          k.points.map((p) => `- ${p}`).join("\n")
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success("已复制知识点清单");
    } catch {
      toast.error("复制失败,请手动选择文本复制");
    }
  };
  return (
    <div className="border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          知识点 · 撑起这份简历需掌握的体系
        </span>
        <Button size="sm" onClick={copy}>
          复制清单
        </Button>
      </div>
      <div className="space-y-px">
        {knowledge.map((k, i) => (
          <div key={i} className="bg-panel p-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-mono text-xs text-text-dim">
                #{String(i + 1).padStart(2, "0")}
              </span>
              <Tag color={LEVEL_COLOR[k.level] ?? "blue"}>{k.level}</Tag>
              <span className="font-sans text-[16px] text-text">
                {k.topic}
              </span>
            </div>
            <ul className="space-y-1.5 pl-1">
              {k.points.map((p, j) => (
                <li
                  key={j}
                  className="flex gap-2 font-mono text-[12.5px] leading-[1.7] text-text-dim"
                >
                  <span className="text-green">▹</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- #3 学习路线思维导图(Excalidraw 风格:手绘感、错位描边)----

// 手绘感:粗描边 + 错位投影 + 轻微旋转,贴合 Excalidraw 草图观感。
const SKETCH =
  "border-2 border-text shadow-[4px_4px_0_0_rgba(0,0,0,0.45)]";

function MindmapView({ mindmap }: { mindmap: Mindmap | null }) {
  if (!mindmap || !mindmap.phases.length) {
    return (
      <div className="border border-border bg-panel p-6 font-mono text-[12px] text-text-muted">
        // 学习路线仅「深度编排」结果包含(该步骤始终由 DeepSeek 生成)。开启「深度编排」后重新生成即可。
      </div>
    );
  }
  const copy = async () => {
    const md =
      `# 学习路线 · ${mindmap.goal}\n\n` +
      mindmap.phases
        .map(
          (p, i) =>
            `## 阶段 ${i + 1} · ${p.name}${p.duration ? `(${p.duration})` : ""}\n` +
            p.topics
              .map(
                (t) =>
                  `### ${t.title}\n` +
                  t.points.map((x) => `- ${x}`).join("\n")
              )
              .join("\n")
        )
        .join("\n\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success("已复制学习路线");
    } catch {
      toast.error("复制失败,请手动选择文本复制");
    }
  };
  return (
    <div className="border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          学习路线 · Excalidraw 风格(DeepSeek 生成)
        </span>
        <Button size="sm" onClick={copy}>
          复制路线
        </Button>
      </div>
      <div className="overflow-x-auto px-6 py-8">
        <div className="flex min-w-max items-stretch gap-0">
          {/* 中心目标节点 */}
          <div className="flex items-center">
            <div
              className={cn(
                "max-w-[220px] -rotate-1 bg-green/10 px-5 py-4",
                SKETCH
              )}
            >
              <p className="font-mono text-[10px] uppercase tracking-[2px] text-green">
                目标
              </p>
              <p className="mt-1 font-sans text-[15px] leading-snug text-text">
                {mindmap.goal}
              </p>
            </div>
            <div className="h-[2px] w-10 bg-text" />
          </div>

          {/* 阶段链 */}
          {mindmap.phases.map((p, i) => (
            <div key={i} className="flex items-center">
              <div
                className={cn(
                  "w-[260px] bg-panel-2 px-4 py-4",
                  i % 2 ? "rotate-1" : "-rotate-1",
                  SKETCH
                )}
              >
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <span className="font-sans text-[14px] font-medium text-text">
                    {i + 1}. {p.name}
                  </span>
                  {p.duration && (
                    <span className="shrink-0 font-mono text-[10px] text-amber">
                      {p.duration}
                    </span>
                  )}
                </div>
                <div className="space-y-2.5">
                  {p.topics.map((t, j) => (
                    <div
                      key={j}
                      className="border-l-2 border-green/60 pl-2.5"
                    >
                      <p className="font-mono text-[12px] text-text">
                        {t.title}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {t.points.map((x, k) => (
                          <li
                            key={k}
                            className="font-mono text-[11px] leading-[1.6] text-text-dim"
                          >
                            ▹ {x}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              {i < mindmap.phases.length - 1 && (
                <div className="flex items-center">
                  <div className="h-[2px] w-8 bg-text" />
                  <span className="-ml-1 text-text">▶</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ summary }: { summary: string }) {
  return (
    <div className="border border-border bg-panel p-7">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[2px] text-green">
        AI 总评
      </p>
      {summary ? (
        <p className="whitespace-pre-line font-sans text-[17px] font-light leading-relaxed text-text">
          {summary}
        </p>
      ) : (
        <p className="font-mono text-[13px] text-text-muted">// 生成中…</p>
      )}
    </div>
  );
}

function SegmentCard({ seg, n }: { seg: AutoSegment; n: number }) {
  const km = KIND_META[seg.kind] ?? KIND_META.experience;
  return (
    <div className="border border-border bg-panel p-7">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-text-dim">
          #{String(n).padStart(2, "0")}
        </span>
        <Tag color={km.color}>{km.label}</Tag>
        {seg.title && (
          <span className="font-sans text-[15px] text-text">{seg.title}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
        <div className="bg-panel pr-0 md:pr-5">
          <div className="mb-3 flex items-center gap-2">
            <Dot color="dim" size={7} />
            <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-dim">
              改写前
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-text-dim">
            {seg.original?.trim() ? seg.original : "（原文无对应内容 / 新增）"}
          </pre>
        </div>
        <div className="bg-panel pl-0 md:pl-5">
          <div className="mb-3 flex items-center gap-2">
            <Dot color="green" size={7} />
            <span className="font-mono text-[10px] uppercase tracking-[2px] text-green">
              改写后
            </span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-text">
            {seg.rewritten}
          </pre>
        </div>
      </div>

      {seg.note?.trim() && (
        <p className="mt-4 font-mono text-[12.5px] leading-relaxed text-amber">
          // {seg.note}
        </p>
      )}
    </div>
  );
}

export function AutoResult({
  data,
  streaming = false,
  title = "改写完成",
  actions,
}: AutoResultProps) {
  const summary = data?.summary ?? "";
  const segments = data?.segments ?? [];
  const knowledge = data?.knowledge ?? [];
  const mindmap = data?.mindmap ?? null;
  const [view, setView] = useState<
    "compare" | "doc" | "tpl" | "kn" | "mm"
  >("compare");
  const doc = useMemo(
    () => buildDoc(summary, segments),
    [summary, segments]
  );

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-14">
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 font-sans text-[40px] font-light tracking-[-1px] text-text">
          {title}
          <span className="text-green">.</span>
          {streaming && (
            <span className="flex items-center gap-2 font-mono text-[12px] text-text-muted">
              <Dot color="green" pulse size={8} />
              生成中…
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">{actions}</div>
      </div>

      {/* view switch: 分段对比 / 整理成稿 / 简历模板 */}
      <div className="mb-px flex border border-border bg-panel">
        {(
          [
            ["compare", "分段对比"],
            ["doc", "整理成稿"],
            ["tpl", "简历模板"],
            ["kn", "知识点"],
            ["mm", "学习路线"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={cn(
              "px-5 py-2.5 font-mono text-[12px] uppercase tracking-[1.5px] transition-colors",
              view === k
                ? "bg-bg text-green"
                : "text-text-dim hover:text-text"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "doc" ? (
        <DocView doc={doc} />
      ) : view === "tpl" ? (
        <TemplateView summary={summary} segments={segments} />
      ) : view === "kn" ? (
        <KnowledgeView knowledge={knowledge} />
      ) : view === "mm" ? (
        <MindmapView mindmap={mindmap} />
      ) : (
        <div className="space-y-px">
          <SummaryCard summary={summary} />
          {segments.map((seg, i) => (
            <SegmentCard key={i} seg={seg} n={i + 1} />
          ))}
          {streaming && (
            <div className="border border-border bg-panel p-6 font-mono text-[12px] text-text-muted">
              <Dot color="green" pulse size={7} />{" "}
              正在生成下一段对比…（已 {segments.length} 段）
            </div>
          )}
          {!streaming && segments.length === 0 && (
            <div className="border border-border bg-panel p-6 font-mono text-[12px] text-text-muted">
              没有产出分段内容。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
