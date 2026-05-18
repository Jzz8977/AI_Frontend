import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import type { ReviewIssue, ReviewResult as ReviewData } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ReviewResultProps {
  data: ReviewData;
  title?: string;
  actions?: ReactNode;
}

const SEV_COLOR: Record<string, "red" | "amber" | "blue"> = {
  high: "red",
  medium: "amber",
  low: "blue",
};

const SEV_LABEL: Record<string, string> = {
  high: "严重",
  medium: "中等",
  low: "轻微",
};

function scoreColor(score: number) {
  if (score >= 70) return "var(--green)";
  if (score >= 50) return "var(--amber)";
  return "var(--red)";
}

export function ReviewResult({
  data,
  title = "诊断完成",
  actions,
}: ReviewResultProps) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const acceptedCount = useMemo(
    () => Object.values(accepted).filter(Boolean).length,
    [accepted]
  );

  const toggle = (id: string) =>
    setAccepted((p) => ({ ...p, [id]: !p[id] }));

  const acceptAll = () => {
    const all: Record<string, boolean> = {};
    data.issues.forEach((i) => (all[i.id] = true));
    setAccepted(all);
  };

  const exportAccepted = () => {
    const picked = data.issues.filter((i) => accepted[i.id]);
    if (picked.length === 0) {
      toast.error("还没有接受任何改动");
      return;
    }
    const md = picked
      .map(
        (i, idx) =>
          `## ${String(idx + 1).padStart(2, "0")} [${SEV_LABEL[i.severity] ?? i.severity}] ${i.category}\n\n原文:\n> ${i.original}\n\n问题:${i.problem}\n\n建议改写为:\n${i.rewritten}\n`
      )
      .join("\n---\n\n");
    const blob = new Blob(
      [`# 已接受的改动 (${picked.length})\n\n${md}`],
      { type: "text/markdown" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "已采纳改动.md";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${picked.length} 条改动`);
  };

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-14">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-sans text-[40px] font-light tracking-[-1px] text-text">
          {title}<span className="text-green">.</span>
        </h1>
        <div className="flex items-center gap-2">{actions}</div>
      </div>

      {/* 评分卡 */}
      <div className="flex flex-col border border-border bg-panel md:flex-row">
        <div className="flex w-full flex-col items-start justify-center border-b border-border p-7 md:w-[180px] md:border-b-0 md:border-r">
          <span
            className="font-mono text-[56px] font-bold leading-none"
            style={{ color: scoreColor(data.score) }}
          >
            {data.score}
          </span>
          <span className="mt-2 font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
            SCORE <span className="text-text-muted">/ 100</span>
          </span>
        </div>
        <div className="flex-1 p-7">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[2px] text-green">
            AI VERDICT
          </p>
          <p className="font-sans text-[17px] font-light leading-relaxed text-text">
            {data.verdict}
          </p>
        </div>
      </div>

      {/* 统计行 */}
      <div className="mt-px flex items-center justify-between border border-t-0 border-border bg-panel px-7 py-3 font-mono text-[11px] uppercase tracking-[1.5px] text-text-dim">
        <span>发现 {data.issues.length} 处问题</span>
        <span>
          已采纳 <span className="text-green">{acceptedCount}</span> /{" "}
          {data.issues.length}
        </span>
      </div>

      {/* 问题卡片列表 */}
      <div className="mt-px space-y-px">
        {data.issues.map((issue, idx) => (
          <IssueCard
            key={issue.id}
            n={idx + 1}
            issue={issue}
            accepted={!!accepted[issue.id]}
            onToggle={() => toggle(issue.id)}
          />
        ))}
      </div>

      {/* 批量操作 */}
      <div className="mt-7 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={acceptAll}>
          全部接受
        </Button>
        <Button variant="accept" size="sm" onClick={exportAccepted}>
          导出已接受的改动
        </Button>
      </div>
    </div>
  );
}

function IssueCard({
  n,
  issue,
  accepted,
  onToggle,
}: {
  n: number;
  issue: ReviewIssue;
  accepted: boolean;
  onToggle: () => void;
}) {
  const sev = SEV_COLOR[issue.severity] ?? "blue";
  return (
    <div
      className={cn(
        "border border-border bg-panel p-7 transition-opacity",
        accepted && "opacity-60"
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-text-dim">
            #{String(n).padStart(2, "0")}
          </span>
          <Tag color={sev}>{SEV_LABEL[issue.severity] ?? issue.severity}</Tag>
          <Tag color="dim">{issue.category}</Tag>
        </div>
        <Button
          variant={accepted ? "default" : "accept"}
          size="sm"
          onClick={onToggle}
        >
          {accepted ? "✓ 已采纳" : "采纳"}
        </Button>
      </div>

      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
        原文片段
      </p>
      <pre className="mb-5 whitespace-pre-wrap break-words border border-border bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text-dim">
        {issue.original}
      </pre>

      <div className="mb-5 space-y-2 font-sans text-[15px] leading-relaxed">
        <p className="text-text">
          <span className="mr-3 font-mono text-[11px] uppercase tracking-[1.5px] text-red">
            问题
          </span>
          {issue.problem}
        </p>
        <p className="text-text">
          <span className="mr-3 font-mono text-[11px] uppercase tracking-[1.5px] text-amber">
            建议
          </span>
          {issue.suggestion}
        </p>
      </div>

      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[2px] text-green">
        建议改写为 ↓
      </p>
      <pre
        className="whitespace-pre-wrap break-words border p-4 font-mono text-[12.5px] leading-relaxed"
        style={{
          background: "rgba(63,185,80,0.06)",
          borderColor: "#1F4D26",
          color: "#86EFAC",
        }}
      >
        + {issue.rewritten}
      </pre>
    </div>
  );
}
