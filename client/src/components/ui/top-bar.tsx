import { Dot } from "./dot";
import { cn } from "@/lib/utils";
import type { Stage, Usage } from "@/lib/types";

const STEPS: { key: Stage; label: string }[] = [
  { key: "mode", label: "MODE" },
  { key: "role", label: "ROLE" },
  { key: "input", label: "INPUT" },
  { key: "loading", label: "RUN" },
  { key: "result", label: "RESULT" },
];

interface TopBarProps {
  stage: Stage;
  usage: Usage | null;
  email?: string;
  /** True when the history routes are active (drives the [ 历史 ] highlight). */
  historyActive?: boolean;
  onHome: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onLogout: () => void;
}

/** r1.md §4.4 — 顶部导航,显示当前 step + 剩余次数 + 退出 */
export function TopBar({
  stage,
  usage,
  email,
  historyActive = false,
  onHome,
  onHistory,
  onSettings,
  onLogout,
}: TopBarProps) {
  const activeIndex = STEPS.findIndex((s) => s.key === stage);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-8 py-[14px]">
        {/* logo — 点击回首页 */}
        <button
          onClick={onHome}
          aria-label="回到首页"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <Dot color="green" pulse size={9} />
          <span className="font-mono text-sm tracking-tight text-text">
            前端<span className="text-green">方向部</span>
          </span>
        </button>

        {/* steps */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="进度">
          {STEPS.map((s, i) => {
            const active = s.key === stage;
            const done = activeIndex > i;
            return (
              <div key={s.key} className="flex items-center">
                <span
                  className={cn(
                    "px-2.5 py-1 font-mono text-[10px] uppercase tracking-[2px] transition-colors",
                    active && "text-green",
                    done && "text-text-dim",
                    !active && !done && "text-text-muted"
                  )}
                >
                  {String(i + 1).padStart(2, "0")} {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="text-text-muted">·</span>
                )}
              </div>
            );
          })}
        </nav>

        {/* quota + actions */}
        <div className="flex items-center gap-4">
          <span className="font-mono text-[11px] tracking-wide text-text-dim">
            {usage?.unlimited ? (
              <span className="text-green">∞ 自带KEY</span>
            ) : usage ? (
              <>
                <span className="text-text-muted">quota </span>
                <span
                  className={cn(
                    usage.remaining <= 0 ? "text-red" : "text-text"
                  )}
                >
                  {usage.used}/{usage.limit}
                </span>
              </>
            ) : (
              <span className="text-text-muted">--/--</span>
            )}
          </span>
          {email && (
            <span
              className="hidden max-w-[160px] truncate font-mono text-[11px] text-text-muted lg:inline"
              title={email}
            >
              {email}
            </span>
          )}
          <button
            onClick={onHistory}
            className={cn(
              "font-mono text-[11px] uppercase tracking-[1.5px] transition-colors hover:text-text",
              historyActive ? "text-green" : "text-text-dim"
            )}
          >
            [ 历史 ]
          </button>
          <button
            onClick={onSettings}
            className="font-mono text-[11px] uppercase tracking-[1.5px] text-text-dim transition-colors hover:text-text"
          >
            [ 设置 ]
          </button>
          <button
            onClick={onLogout}
            className="font-mono text-[11px] uppercase tracking-[1.5px] text-text-dim transition-colors hover:text-red"
          >
            [ 退出 ]
          </button>
        </div>
      </div>
    </header>
  );
}
