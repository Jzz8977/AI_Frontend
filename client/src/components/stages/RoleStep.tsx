import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { ROLES } from "@/lib/constants";
import type { Mode, RoleId } from "@/lib/types";

interface RoleStepProps {
  mode: Mode;
  onSelect: (role: RoleId) => void;
  onBack: () => void;
}

/** r1.md §3.2 — 选岗位 */
export function RoleStep({ mode, onSelect, onBack }: RoleStepProps) {
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-14">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
            // step 02 — select target role
          </p>
          <h1 className="mt-3 font-sans text-[40px] font-light tracking-[-1px] text-text">
            选择目标岗位
            <span className="text-green">.</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Tag color="green">
            {mode === "auto" ? "MODE_01 快速重写" : "MODE_02 精修诊断"}
          </Tag>
          <Button variant="outline" size="sm" onClick={onBack}>
            ← 返回
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-3">
        {ROLES.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className="group flex min-h-[360px] flex-col bg-panel p-9 text-left transition-transform duration-150 hover:-translate-y-0.5 hover:bg-panel-2 focus-visible:bg-panel-2"
          >
            <span className="font-mono text-[56px] font-bold leading-none tracking-[-2px] text-green">
              {r.code}
            </span>
            <h2 className="mt-7 font-sans text-[22px] font-normal text-text">
              {r.name}
            </h2>
            <p className="mt-1 font-mono text-xs tracking-wide text-text-muted">
              {r.en}
            </p>
            <p className="mt-5 font-sans text-[15px] leading-relaxed text-text-dim">
              {r.desc}
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-9">
              {r.tags.map((t) => (
                <Tag key={t} color="dim">
                  {t}
                </Tag>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
