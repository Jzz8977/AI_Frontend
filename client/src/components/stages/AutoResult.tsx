import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dot } from "@/components/ui/dot";
import { Tag } from "@/components/ui/tag";
import type { AutoResult as AutoResultData, DiffNote } from "@/lib/types";

interface AutoResultProps {
  data: AutoResultData;
  original: string;
  title?: string;
  actions?: ReactNode;
}

function SummaryCard({ summary }: { summary: string }) {
  return (
    <div className="border border-border bg-panel p-7">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[2px] text-green">
        AI SUMMARY
      </p>
      <p className="whitespace-pre-line font-sans text-[17px] font-light leading-relaxed text-text">
        {summary}
      </p>
    </div>
  );
}

function DiffBlock({ note }: { note: DiffNote }) {
  return (
    <div className="border border-border bg-panel p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="font-mono text-xs text-text-dim">
          #{note.type}
        </span>
        <Tag color="amber">{note.type}</Tag>
      </div>
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words border p-4 font-mono text-[12.5px] leading-relaxed"
          style={{
            background: "rgba(248,113,113,0.06)",
            borderColor: "rgba(248,113,113,0.2)",
            color: "#FCA5A5",
          }}
        >
          − {note.from}
        </pre>
        <span className="hidden text-center font-mono text-text-muted md:block">
          →
        </span>
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words border p-4 font-mono text-[12.5px] leading-relaxed"
          style={{
            background: "rgba(63,185,80,0.06)",
            borderColor: "#1F4D26",
            color: "#86EFAC",
          }}
        >
          + {note.to}
        </pre>
      </div>
      <p className="mt-4 font-mono text-[12.5px] leading-relaxed text-amber">
        // {note.why}
      </p>
    </div>
  );
}

export function AutoResult({
  data,
  original,
  title = "改写完成",
  actions,
}: AutoResultProps) {
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-14">
      <div className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-sans text-[40px] font-light tracking-[-1px] text-text">
          {title}<span className="text-green">.</span>
        </h1>
        <div className="flex items-center gap-2">{actions}</div>
      </div>

      <Tabs defaultValue="compare" className="space-y-px">
        <div className="space-y-px">
          <SummaryCard summary={data.summary} />
          <TabsList className="bg-panel">
            <TabsTrigger value="compare">双栏对比</TabsTrigger>
            <TabsTrigger value="full">改写全文</TabsTrigger>
            <TabsTrigger value="diff">改动详情</TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: 双栏对比 */}
        <TabsContent value="compare">
          <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
            <div className="bg-panel p-7">
              <div className="mb-4 flex items-center gap-2">
                <Dot color="dim" size={7} />
                <span className="font-mono text-[11px] uppercase tracking-[2px] text-text-dim">
                  BEFORE / original
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.7] text-text-dim">
                {original}
              </pre>
            </div>
            <div className="bg-panel p-7">
              <div className="mb-4 flex items-center gap-2">
                <Dot color="green" size={7} />
                <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
                  AFTER / rewritten
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.7] text-text">
                {data.rewritten_experience}
              </pre>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: 改写全文 */}
        <TabsContent value="full">
          <div className="space-y-px">
            <div className="border border-border bg-panel p-7">
              <p className="mb-5 font-mono text-[11px] uppercase tracking-[2px] text-green">
                KEY_HIGHLIGHTS
              </p>
              <ul className="space-y-3">
                {data.highlights.map((h, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="font-mono text-xs text-text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-sans text-[15px] leading-relaxed text-text">
                      {h}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-3">
              <SkillCol
                title="CORE_SKILLS"
                color="green"
                items={data.skills.core}
              />
              <SkillCol
                title="AI ENGINEERING"
                color="amber"
                items={data.skills.ai}
              />
              <SkillCol
                title="EXTRA"
                color="blue"
                items={data.skills.extra}
              />
            </div>

            <div className="border border-border bg-panel p-7">
              <p className="mb-5 font-mono text-[11px] uppercase tracking-[2px] text-green">
                REWRITTEN_EXPERIENCE
              </p>
              <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.7] text-text">
                {data.rewritten_experience}
              </pre>
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: 改动详情 */}
        <TabsContent value="diff">
          <div className="space-y-px">
            {data.diff_notes.map((n, i) => (
              <DiffBlock key={i} note={n} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkillCol({
  title,
  color,
  items,
}: {
  title: string;
  color: "green" | "amber" | "blue";
  items: string[];
}) {
  const cls =
    color === "green"
      ? "text-green"
      : color === "amber"
        ? "text-amber"
        : "text-blue";
  return (
    <div className="bg-panel p-7">
      <p className={`mb-5 font-mono text-[11px] uppercase tracking-[2px] ${cls}`}>
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <Tag key={s} color={color}>
            {s}
          </Tag>
        ))}
      </div>
    </div>
  );
}
