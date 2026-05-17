import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type {
  AutoResult as AutoResultData,
  AutoSegment,
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

function SummaryCard({ summary }: { summary: string }) {
  return (
    <div className="border border-border bg-panel p-7">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[2px] text-green">
        AI SUMMARY
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
              BEFORE
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
              AFTER
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
  const [view, setView] = useState<"compare" | "doc">("compare");
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
              streaming…
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">{actions}</div>
      </div>

      {/* view switch: 分段对比 / 整理成稿 */}
      <div className="mb-px flex border border-border bg-panel">
        {(
          [
            ["compare", "分段对比"],
            ["doc", "整理成稿"],
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
