import { Tag } from "@/components/ui/tag";
import { MODES } from "@/lib/constants";
import type { Mode } from "@/lib/types";

interface ModeStepProps {
  onSelect: (mode: Mode) => void;
}

/** r1.md §3.1 — 选模式 */
export function ModeStep({ onSelect }: ModeStepProps) {
  return (
    <div className="mx-auto max-w-[1100px] px-8 py-16">
      <h1 className="mb-16 font-sans text-[clamp(40px,7vw,72px)] font-extralight leading-[1.05] tracking-[-2px] text-text">
        把简历写成
        <br />
        <span className="font-bold italic">
          2026 年招聘官想看的样子
          <span className="text-green">.</span>
        </span>
      </h1>

      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className="group flex min-h-[260px] flex-col bg-panel p-9 text-left transition-colors hover:bg-panel-2 focus-visible:bg-panel-2"
          >
            <div className="mb-10 flex items-start justify-between">
              <span className="font-mono text-xs uppercase tracking-[2px] text-green">
                {m.code}
              </span>
              <Tag color="amber">{m.eta}</Tag>
            </div>
            <h2 className="font-sans text-[32px] font-light leading-tight tracking-[-0.5px] text-text">
              {m.title}
            </h2>
            <p className="mt-1 font-mono text-xs tracking-wide text-text-muted">
              {m.subtitle}
            </p>
            <p className="mt-5 max-w-[320px] font-sans text-[15px] leading-relaxed text-text-dim">
              {m.desc}
            </p>
            <span className="mt-auto pt-10 font-mono text-xs uppercase tracking-[2px] text-green opacity-70 transition-opacity group-hover:opacity-100">
              启动 →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
