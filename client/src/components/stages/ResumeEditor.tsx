import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  ResumeDoc,
  ResumeCustomSection,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeTemplateId,
} from "@/lib/types";
import {
  ACCENT_PRESETS,
  RESUME_SEED_KEY,
  defaultDoc,
  docToMarkdown,
  emptyExperience,
  emptyProject,
  loadDoc,
  normalizeDoc,
  rid,
  saveDoc,
} from "@/lib/resume-doc";

const TEMPLATES: { id: ResumeTemplateId; label: string }[] = [
  { id: "classic", label: "经典" },
  { id: "compact", label: "紧凑" },
  { id: "timeline", label: "时间线" },
];

/** 把 [...] 里的项上移/下移一格,返回新数组(越界则原样返回)。 */
function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---- small editor primitives (dark app theme) ----

function Field({
  label,
  value,
  onChange,
  ph,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ph?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-text-dim">
        {label}
      </span>
      <Input
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  ph,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ph?: string;
  rows?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-text-dim">
        {label}
      </span>
      <textarea
        value={value}
        placeholder={ph}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full border border-border bg-bg px-3 py-2 font-mono text-[13px] leading-[1.7] text-text",
          "placeholder:text-text-muted focus-visible:border-green focus-visible:outline-none"
        )}
      />
    </label>
  );
}

function SectionShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          {title}
        </span>
        {hint && (
          <span className="font-mono text-[10px] text-text-muted">{hint}</span>
        )}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function ItemBar({
  label,
  i,
  count,
  onUp,
  onDown,
  onRemove,
}: {
  label: string;
  i: number;
  count: number;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px] text-text-dim">
        {label} #{String(i + 1).padStart(2, "0")}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={i === 0}
          onClick={onUp}
          title="上移"
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={i === count - 1}
          onClick={onDown}
          title="下移"
        >
          ↓
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={onRemove}
          title="删除该项"
        >
          删除
        </Button>
      </div>
    </div>
  );
}

// ---- live preview (always light "paper", independent of dark app theme) ----

function PreviewContact({ doc }: { doc: ResumeDoc }) {
  const b = doc.basics;
  const items = [
    b.title && `求职意向：${b.title}`,
    b.phone,
    b.email,
    b.city,
    b.website,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <p className="mt-1 text-[12px] text-[#444]">{items.join("  ·  ")}</p>
  );
}

function PreviewHeading({
  children,
  template,
  accent,
}: {
  children: React.ReactNode;
  template: ResumeTemplateId;
  accent: string;
}) {
  const timeline = template === "timeline";
  return (
    <h2
      className={cn(
        "mt-5 mb-2 text-[14px] font-semibold tracking-wide",
        timeline ? "border-l-4 pl-2" : "border-b border-[#d4d4d4] pb-1"
      )}
      style={
        timeline
          ? { borderColor: accent, color: accent }
          : { color: "#1a1a1a" }
      }
    >
      {children}
    </h2>
  );
}

function Bullets({ items }: { items: string[] }) {
  const v = items.filter((x) => x.trim());
  if (!v.length) return null;
  return (
    <ul className="ml-4 list-disc space-y-0.5 text-[12px] leading-[1.65] text-[#333]">
      {v.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function ResumePreview({ doc }: { doc: ResumeDoc }) {
  const t = doc.template;
  const compact = t === "compact";
  const accent = doc.accent;
  const b = doc.basics;
  const exps = doc.experience.filter(
    (e) => e.company.trim() || e.bullets.some((x) => x.trim())
  );
  const projs = doc.projects.filter(
    (p) => p.name.trim() || p.bullets.some((x) => x.trim())
  );
  const edus = doc.education.filter((e) => e.school.trim() || e.major.trim());
  const empty =
    !b.name.trim() &&
    !doc.summary.trim() &&
    !doc.skills.trim() &&
    !exps.length &&
    !projs.length &&
    !edus.length;

  const itemHead = (parts: string[]) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-medium text-[#1a1a1a]">
        {parts.filter(Boolean).slice(0, 2).join(" · ")}
      </span>
      {parts[2] && (
        <span className="shrink-0 text-[11px] text-[#777]">{parts[2]}</span>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "resume-paper mx-auto w-full max-w-[820px] bg-white text-[#222] shadow-[0_2px_24px_rgba(0,0,0,0.5)]",
        compact ? "px-10 py-9" : "px-12 py-12"
      )}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {empty ? (
        <p className="py-24 text-center text-[13px] text-[#999]">
          在左侧填写信息,这里会实时生成简历预览。
        </p>
      ) : (
        <>
          <header
            className={cn(t === "timeline" && "border-b-2 pb-3")}
            style={
              t === "timeline" ? { borderColor: accent } : undefined
            }
          >
            <h1 className="text-[26px] font-bold leading-tight text-[#111]">
              {b.name || "你的姓名"}
            </h1>
            <PreviewContact doc={doc} />
          </header>

          {doc.summary.trim() && (
            <>
              <PreviewHeading template={t} accent={accent}>个人简介</PreviewHeading>
              <p className="whitespace-pre-line text-[12.5px] leading-[1.7] text-[#333]">
                {doc.summary.trim()}
              </p>
            </>
          )}

          {doc.skills.trim() && (
            <>
              <PreviewHeading template={t} accent={accent}>技能</PreviewHeading>
              <p className="whitespace-pre-line text-[12.5px] leading-[1.7] text-[#333]">
                {doc.skills.trim()}
              </p>
            </>
          )}

          {exps.length > 0 && (
            <>
              <PreviewHeading template={t} accent={accent}>工作经历</PreviewHeading>
              <div className={compact ? "space-y-2" : "space-y-3.5"}>
                {exps.map((e) => (
                  <div key={e.id}>
                    {itemHead([e.company, e.role, e.period])}
                    <Bullets items={e.bullets} />
                  </div>
                ))}
              </div>
            </>
          )}

          {projs.length > 0 && (
            <>
              <PreviewHeading template={t} accent={accent}>项目经历</PreviewHeading>
              <div className={compact ? "space-y-2" : "space-y-3.5"}>
                {projs.map((p) => (
                  <div key={p.id}>
                    {itemHead([p.name, p.stack, p.period])}
                    <Bullets items={p.bullets} />
                  </div>
                ))}
              </div>
            </>
          )}

          {edus.length > 0 && (
            <>
              <PreviewHeading template={t} accent={accent}>教育经历</PreviewHeading>
              <ul className="space-y-1 text-[12.5px] leading-[1.6] text-[#333]">
                {edus.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>
                      {[e.school, e.major, e.degree]
                        .filter(Boolean)
                        .join(" ｜ ")}
                    </span>
                    {e.period && (
                      <span className="shrink-0 text-[#777]">{e.period}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {doc.custom.map(
            (c) =>
              (c.heading.trim() || c.body.trim()) && (
                <div key={c.id}>
                  <PreviewHeading template={t} accent={accent}>
                    {c.heading.trim() || "其他"}
                  </PreviewHeading>
                  <p className="whitespace-pre-line text-[12.5px] leading-[1.7] text-[#333]">
                    {c.body.trim()}
                  </p>
                </div>
              )
          )}
        </>
      )}
    </div>
  );
}

// ---- main editor ----

export function ResumeEditor({ onBack }: { onBack: () => void }) {
  const [doc, setDoc] = useState<ResumeDoc>(loadDoc);
  const fileRef = useRef<HTMLInputElement>(null);

  // One-time seed handoff from the rewrite result page.
  useEffect(() => {
    try {
      const seed = localStorage.getItem(RESUME_SEED_KEY);
      if (seed) {
        localStorage.removeItem(RESUME_SEED_KEY);
        setDoc(normalizeDoc(JSON.parse(seed)));
        toast.success("已从最近改写结果导入,可继续编辑");
      }
    } catch {
      /* ignore malformed seed */
    }
  }, []);

  useEffect(() => {
    saveDoc(doc);
  }, [doc]);

  const patch = (p: Partial<ResumeDoc>) => setDoc((d) => ({ ...d, ...p }));
  const setBasic = (k: keyof ResumeDoc["basics"], v: string) =>
    setDoc((d) => ({ ...d, basics: { ...d.basics, [k]: v } }));

  const setExp = (i: number, p: Partial<ResumeExperience>) =>
    setDoc((d) => ({
      ...d,
      experience: d.experience.map((e, n) => (n === i ? { ...e, ...p } : e)),
    }));
  const setProj = (i: number, p: Partial<ResumeProject>) =>
    setDoc((d) => ({
      ...d,
      projects: d.projects.map((e, n) => (n === i ? { ...e, ...p } : e)),
    }));
  const setEdu = (i: number, p: Partial<ResumeEducation>) =>
    setDoc((d) => ({
      ...d,
      education: d.education.map((e, n) => (n === i ? { ...e, ...p } : e)),
    }));
  const setCustom = (i: number, p: Partial<ResumeCustomSection>) =>
    setDoc((d) => ({
      ...d,
      custom: d.custom.map((e, n) => (n === i ? { ...e, ...p } : e)),
    }));

  const md = useMemo(() => docToMarkdown(doc), [doc]);

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(md);
      toast.success("已复制简历 Markdown 全文");
    } catch {
      toast.error("复制失败,请手动选择文本复制");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume-${doc.basics.name.trim() || "draft"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出简历 JSON(可再次导入继续编辑)");
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setDoc(normalizeDoc(JSON.parse(String(reader.result))));
        toast.success("已导入简历 JSON");
      } catch {
        toast.error("文件格式不对,需为本编辑器导出的 JSON");
      }
    };
    reader.readAsText(file);
  };

  const clearAll = () => {
    if (!confirm("确定清空当前简历?该操作不可撤销(仅清除本地草稿)。"))
      return;
    setDoc(defaultDoc());
    toast.success("已清空本地简历草稿");
  };

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-12">
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-sans text-[34px] font-light tracking-[-1px] text-text">
            在线简历编辑器<span className="text-green">.</span>
          </h1>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            // 结构化编辑 + 实时预览 + 导出 PDF。全部内容仅存本地浏览器,不上传服务器。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            ← 返回
          </Button>
          <Button variant="outline" size="sm" onClick={exportJson}>
            导出 JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            导入 JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
          <Button variant="danger" size="sm" onClick={clearAll}>
            清空
          </Button>
          <Button variant="outline" size="sm" onClick={copyMd}>
            复制 Markdown
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            导出 PDF / 打印
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,460px)_1fr]">
        {/* ---- left: structured form ---- */}
        <div className="no-print space-y-5">
          {/* template switch */}
          <div className="flex border border-border bg-panel">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => patch({ template: tpl.id })}
                className={cn(
                  "flex-1 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[1.5px] transition-colors",
                  doc.template === tpl.id
                    ? "bg-bg text-green"
                    : "text-text-dim hover:text-text"
                )}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          {/* 强调色 — 时间线模板的描边/标题配色(变色功能) */}
          <div className="flex flex-wrap items-center gap-3 border border-border bg-panel px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-text-dim">
              强调色
              {doc.template !== "timeline" && (
                <span className="ml-1 normal-case text-text-muted">
                  (时间线模板生效)
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => patch({ accent: c })}
                  title={c}
                  aria-label={`选择 ${c}`}
                  className={cn(
                    "h-6 w-6 border transition-transform hover:scale-110",
                    doc.accent === c
                      ? "border-text ring-1 ring-green"
                      : "border-border"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                className="ml-1 flex h-6 cursor-pointer items-center gap-1 border border-border px-2 font-mono text-[10px] text-text-dim hover:text-text"
                title="自定义颜色"
              >
                自定义
                <input
                  type="color"
                  value={doc.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>
          </div>

          <SectionShell title="基本信息">
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="姓名"
                value={doc.basics.name}
                onChange={(v) => setBasic("name", v)}
                ph="张三"
              />
              <Field
                label="意向岗位"
                value={doc.basics.title}
                onChange={(v) => setBasic("title", v)}
                ph="前端工程师"
              />
              <Field
                label="电话"
                value={doc.basics.phone}
                onChange={(v) => setBasic("phone", v)}
                ph="138-0000-0000"
              />
              <Field
                label="邮箱"
                value={doc.basics.email}
                onChange={(v) => setBasic("email", v)}
                ph="you@example.com"
              />
              <Field
                label="城市"
                value={doc.basics.city}
                onChange={(v) => setBasic("city", v)}
                ph="上海"
              />
              <Field
                label="主页 / GitHub"
                value={doc.basics.website}
                onChange={(v) => setBasic("website", v)}
                ph="github.com/you"
              />
            </div>
          </SectionShell>

          <SectionShell title="个人简介">
            <Area
              label="一段话概述"
              value={doc.summary}
              onChange={(v) => patch({ summary: v })}
              ph="5 年前端,主导过…"
              rows={4}
            />
          </SectionShell>

          <SectionShell title="技能" hint="每行一类,或逗号分隔">
            <Area
              label="技能清单"
              value={doc.skills}
              onChange={(v) => patch({ skills: v })}
              ph={"语言：TypeScript / JavaScript\n框架:React 19 / Next.js 15"}
              rows={4}
            />
          </SectionShell>

          <SectionShell title="工作经历">
            {doc.experience.map((e, i) => (
              <div key={e.id} className="space-y-3 border border-border p-4">
                <ItemBar
                  label="经历"
                  i={i}
                  count={doc.experience.length}
                  onUp={() =>
                    patch({ experience: move(doc.experience, i, -1) })
                  }
                  onDown={() =>
                    patch({ experience: move(doc.experience, i, 1) })
                  }
                  onRemove={() =>
                    patch({
                      experience: doc.experience.filter((_, n) => n !== i),
                    })
                  }
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="公司"
                    value={e.company}
                    onChange={(v) => setExp(i, { company: v })}
                  />
                  <Field
                    label="岗位"
                    value={e.role}
                    onChange={(v) => setExp(i, { role: v })}
                  />
                </div>
                <Field
                  label="时间"
                  value={e.period}
                  onChange={(v) => setExp(i, { period: v })}
                  ph="2021.06 - 至今"
                />
                <Area
                  label="工作内容(每行一条)"
                  value={e.bullets.join("\n")}
                  onChange={(v) => setExp(i, { bullets: v.split("\n") })}
                  rows={4}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({ experience: [...doc.experience, emptyExperience()] })
              }
            >
              + 添加工作经历
            </Button>
          </SectionShell>

          <SectionShell title="项目经历">
            {doc.projects.map((p, i) => (
              <div key={p.id} className="space-y-3 border border-border p-4">
                <ItemBar
                  label="项目"
                  i={i}
                  count={doc.projects.length}
                  onUp={() => patch({ projects: move(doc.projects, i, -1) })}
                  onDown={() => patch({ projects: move(doc.projects, i, 1) })}
                  onRemove={() =>
                    patch({
                      projects: doc.projects.filter((_, n) => n !== i),
                    })
                  }
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="项目名"
                    value={p.name}
                    onChange={(v) => setProj(i, { name: v })}
                  />
                  <Field
                    label="技术栈"
                    value={p.stack}
                    onChange={(v) => setProj(i, { stack: v })}
                  />
                </div>
                <Field
                  label="时间"
                  value={p.period}
                  onChange={(v) => setProj(i, { period: v })}
                />
                <Area
                  label="项目描述(每行一条)"
                  value={p.bullets.join("\n")}
                  onChange={(v) => setProj(i, { bullets: v.split("\n") })}
                  rows={4}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({ projects: [...doc.projects, emptyProject()] })
              }
            >
              + 添加项目
            </Button>
          </SectionShell>

          <SectionShell title="教育经历">
            {doc.education.map((e, i) => (
              <div key={e.id} className="space-y-3 border border-border p-4">
                <ItemBar
                  label="教育"
                  i={i}
                  count={doc.education.length}
                  onUp={() => patch({ education: move(doc.education, i, -1) })}
                  onDown={() => patch({ education: move(doc.education, i, 1) })}
                  onRemove={() =>
                    patch({
                      education: doc.education.filter((_, n) => n !== i),
                    })
                  }
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="学校"
                    value={e.school}
                    onChange={(v) => setEdu(i, { school: v })}
                  />
                  <Field
                    label="专业"
                    value={e.major}
                    onChange={(v) => setEdu(i, { major: v })}
                  />
                  <Field
                    label="学历"
                    value={e.degree}
                    onChange={(v) => setEdu(i, { degree: v })}
                    ph="本科"
                  />
                  <Field
                    label="时间"
                    value={e.period}
                    onChange={(v) => setEdu(i, { period: v })}
                    ph="2018 - 2022"
                  />
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  education: [
                    ...doc.education,
                    { id: rid(), school: "", major: "", degree: "", period: "" },
                  ],
                })
              }
            >
              + 添加教育经历
            </Button>
          </SectionShell>

          <SectionShell title="自定义模块" hint="如:获奖 / 开源 / 自我评价">
            {doc.custom.map((c, i) => (
              <div key={c.id} className="space-y-3 border border-border p-4">
                <ItemBar
                  label="模块"
                  i={i}
                  count={doc.custom.length}
                  onUp={() => patch({ custom: move(doc.custom, i, -1) })}
                  onDown={() => patch({ custom: move(doc.custom, i, 1) })}
                  onRemove={() =>
                    patch({ custom: doc.custom.filter((_, n) => n !== i) })
                  }
                />
                <Field
                  label="标题"
                  value={c.heading}
                  onChange={(v) => setCustom(i, { heading: v })}
                  ph="获奖经历"
                />
                <Area
                  label="内容"
                  value={c.body}
                  onChange={(v) => setCustom(i, { body: v })}
                  rows={3}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  custom: [
                    ...doc.custom,
                    { id: rid(), heading: "", body: "" },
                  ],
                })
              }
            >
              + 添加自定义模块
            </Button>
          </SectionShell>
        </div>

        {/* ---- right: live preview ---- */}
        <div className="print-flush lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:self-start lg:overflow-auto">
          <ResumePreview doc={doc} />
        </div>
      </div>
    </div>
  );
}
