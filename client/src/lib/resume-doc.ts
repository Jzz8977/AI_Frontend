// #6 在线简历编辑器 — 结构化简历文档模型。
// 全部数据仅保存在浏览器 localStorage,绝不上传服务器(与隐私说明一致)。

import type {
  AutoResult,
  AutoSegment,
  ResumeDoc,
  ResumeExperience,
  ResumeProject,
} from "./types";

export const RESUME_DOC_KEY = "resume_editor_doc";
// AutoResult → 编辑器 的一次性导入桥(由结果页写入,编辑器消费后清除)。
export const RESUME_SEED_KEY = "resume_editor_seed";

/** 短随机 id,用于列表项 key / reorder。 */
export function rid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function emptyExperience(): ResumeExperience {
  return { id: rid(), company: "", role: "", period: "", bullets: [""] };
}

export function emptyProject(): ResumeProject {
  return { id: rid(), name: "", stack: "", period: "", bullets: [""] };
}

export function defaultDoc(): ResumeDoc {
  return {
    basics: { name: "", title: "", phone: "", email: "", city: "", website: "" },
    summary: "",
    skills: "",
    experience: [emptyExperience()],
    projects: [emptyProject()],
    education: [{ id: rid(), school: "", major: "", degree: "", period: "" }],
    custom: [],
    template: "compact", // 默认紧凑型
    accent: DEFAULT_ACCENT,
  };
}

/** 默认强调色 + 时间线可选配色板。 */
export const DEFAULT_ACCENT = "#2563eb";
export const ACCENT_PRESETS = [
  "#2563eb", // 蓝
  "#0f766e", // 青绿
  "#7c3aed", // 紫
  "#db2777", // 玫红
  "#ea580c", // 橙
  "#16a34a", // 绿
  "#475569", // 石墨
  "#dc2626", // 红
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function normAccent(v: unknown): string {
  return typeof v === "string" && HEX_RE.test(v) ? v : DEFAULT_ACCENT;
}

const TEMPLATES: ResumeDoc["template"][] = ["classic", "compact", "timeline"];

/** 容错地把任意 JSON 收敛成合法 ResumeDoc(缺字段补默认,多余字段丢弃)。 */
export function normalizeDoc(input: unknown): ResumeDoc {
  const base = defaultDoc();
  if (!input || typeof input !== "object") return base;
  const o = input as Record<string, unknown>;
  const b = (o.basics ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const bulletList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => str(x));
    return [""];
  };
  return {
    basics: {
      name: str(b.name),
      title: str(b.title),
      phone: str(b.phone),
      email: str(b.email),
      city: str(b.city),
      website: str(b.website),
    },
    summary: str(o.summary),
    skills: str(o.skills),
    experience: Array.isArray(o.experience)
      ? (o.experience as Record<string, unknown>[]).map((e) => ({
          id: str(e.id) || rid(),
          company: str(e.company),
          role: str(e.role),
          period: str(e.period),
          bullets: bulletList(e.bullets),
        }))
      : base.experience,
    projects: Array.isArray(o.projects)
      ? (o.projects as Record<string, unknown>[]).map((p) => ({
          id: str(p.id) || rid(),
          name: str(p.name),
          stack: str(p.stack),
          period: str(p.period),
          bullets: bulletList(p.bullets),
        }))
      : base.projects,
    education: Array.isArray(o.education)
      ? (o.education as Record<string, unknown>[]).map((e) => ({
          id: str(e.id) || rid(),
          school: str(e.school),
          major: str(e.major),
          degree: str(e.degree),
          period: str(e.period),
        }))
      : base.education,
    custom: Array.isArray(o.custom)
      ? (o.custom as Record<string, unknown>[]).map((c) => ({
          id: str(c.id) || rid(),
          heading: str(c.heading),
          body: str(c.body),
        }))
      : [],
    template: TEMPLATES.includes(o.template as ResumeDoc["template"])
      ? (o.template as ResumeDoc["template"])
      : "compact",
    accent: normAccent(o.accent),
  };
}

export function loadDoc(): ResumeDoc {
  try {
    const raw = localStorage.getItem(RESUME_DOC_KEY);
    if (!raw) return defaultDoc();
    return normalizeDoc(JSON.parse(raw));
  } catch {
    return defaultDoc();
  }
}

export function saveDoc(doc: ResumeDoc): void {
  try {
    localStorage.setItem(RESUME_DOC_KEY, JSON.stringify(doc));
  } catch {
    /* storage full / disabled — non-fatal, just no local persistence */
  }
}

/** 把一行行文本拆成 bullet 数组(去空行)。 */
function splitBullets(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•▹·\s]+/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : [""];
}

/** experience 段标题大多是「公司 · 岗位 · 时间」一类,尽力拆开。 */
function parseExpTitle(title: string): {
  company: string;
  role: string;
  period: string;
} {
  const parts = title
    .split(/[·｜|\-—]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    company: parts[0] ?? title.trim(),
    role: parts[1] ?? "",
    period: parts[2] ?? "",
  };
}

/**
 * 用最近一次 AI 改写结果(summary + segments)预填一份结构化简历,
 * 与现有「简历模板」tab 的数据来源一致,但落到可逐字段编辑的文档。
 */
export function docFromAutoResult(data: AutoResult): ResumeDoc {
  const doc = defaultDoc();
  doc.summary = (data.summary ?? "").trim();

  const segs: AutoSegment[] = data.segments ?? [];
  const skillSegs = segs.filter((s) => s.kind === "skills" && s.rewritten.trim());
  if (skillSegs.length) {
    doc.skills = skillSegs.map((s) => s.rewritten.trim()).join("\n");
  }

  const expSegs = segs.filter(
    (s) => s.kind === "experience" && s.rewritten.trim()
  );
  if (expSegs.length) {
    doc.experience = expSegs.map((s) => {
      const t = parseExpTitle(s.title || "");
      return {
        id: rid(),
        company: t.company,
        role: t.role,
        period: t.period,
        bullets: splitBullets(s.rewritten),
      };
    });
  }

  const projSegs = segs.filter(
    (s) => s.kind === "project" && s.rewritten.trim()
  );
  if (projSegs.length) {
    doc.projects = projSegs.map((s) => ({
      id: rid(),
      name: (s.title || "").trim(),
      stack: "",
      period: "",
      bullets: splitBullets(s.rewritten),
    }));
  }

  return doc;
}

/** 序列化为可直接复制 / 投递的 Markdown 全文。 */
export function docToMarkdown(doc: ResumeDoc): string {
  const L: string[] = [];
  const b = doc.basics;
  if (b.name.trim()) L.push(`# ${b.name.trim()}`, "");
  const contact = [
    b.title.trim() && `求职意向：${b.title.trim()}`,
    b.phone.trim() && `电话：${b.phone.trim()}`,
    b.email.trim() && `邮箱：${b.email.trim()}`,
    b.city.trim() && `城市：${b.city.trim()}`,
    b.website.trim() && `主页：${b.website.trim()}`,
  ].filter(Boolean);
  if (contact.length) L.push(contact.join(" · "), "");

  if (doc.summary.trim()) L.push("## 个人简介", "", doc.summary.trim(), "");

  if (doc.skills.trim()) L.push("## 技能", "", doc.skills.trim(), "");

  const exps = doc.experience.filter(
    (e) => e.company.trim() || e.bullets.some((x) => x.trim())
  );
  if (exps.length) {
    L.push("## 工作经历", "");
    for (const e of exps) {
      const head = [e.company.trim(), e.role.trim(), e.period.trim()]
        .filter(Boolean)
        .join(" · ");
      if (head) L.push(`### ${head}`);
      for (const x of e.bullets.filter((v) => v.trim()))
        L.push(`- ${x.trim()}`);
      L.push("");
    }
  }

  const projs = doc.projects.filter(
    (p) => p.name.trim() || p.bullets.some((x) => x.trim())
  );
  if (projs.length) {
    L.push("## 项目经历", "");
    for (const p of projs) {
      const head = [p.name.trim(), p.stack.trim(), p.period.trim()]
        .filter(Boolean)
        .join(" · ");
      if (head) L.push(`### ${head}`);
      for (const x of p.bullets.filter((v) => v.trim()))
        L.push(`- ${x.trim()}`);
      L.push("");
    }
  }

  const edus = doc.education.filter((e) => e.school.trim() || e.major.trim());
  if (edus.length) {
    L.push("## 教育经历", "");
    for (const e of edus) {
      L.push(
        `- ${[e.period.trim(), e.school.trim(), e.major.trim(), e.degree.trim()]
          .filter(Boolean)
          .join(" ｜ ")}`
      );
    }
    L.push("");
  }

  for (const c of doc.custom) {
    if (!c.heading.trim() && !c.body.trim()) continue;
    L.push(`## ${c.heading.trim() || "其他"}`, "", c.body.trim(), "");
  }

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
