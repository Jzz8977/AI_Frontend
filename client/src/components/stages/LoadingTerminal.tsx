import { useEffect, useState } from "react";
import { Dot } from "@/components/ui/dot";
import { cn } from "@/lib/utils";
import { LOADING_LINES_AUTO, LOADING_LINES_REVIEW } from "@/lib/constants";
import type { Mode } from "@/lib/types";

interface LoadingTerminalProps {
  mode: Mode;
  /** Extra live status line (e.g. 深度编排 iteration progress). */
  note?: string;
}

/** r1.md §3.4 — 终端 loading 动画。每行 800ms 出现,完成行灰+绿✓,
 *  全部出现后追加橙色 waiting 行 + 闪烁光标。 */
export function LoadingTerminal({ mode, note }: LoadingTerminalProps) {
  const lines = mode === "auto" ? LOADING_LINES_AUTO : LOADING_LINES_REVIEW;
  const [visible, setVisible] = useState(1);

  useEffect(() => {
    setVisible(1);
    if (lines.length <= 1) return;
    const t = setInterval(() => {
      setVisible((v) => {
        if (v >= lines.length) {
          clearInterval(t);
          return v;
        }
        return v + 1;
      });
    }, 800);
    return () => clearInterval(t);
  }, [lines.length]);

  const allShown = visible >= lines.length;

  return (
    <div className="mx-auto w-full max-w-[720px] border border-border bg-panel">
      <div className="flex items-center gap-2.5 border-b border-border px-6 py-3">
        <Dot color="green" pulse size={8} />
        <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
          PROCESSING
        </span>
      </div>

      <div className="space-y-2 p-7 font-mono text-[13px] leading-[1.7]">
        {lines.slice(0, visible).map((line, i) => {
          const isLast = i === visible - 1 && !allShown;
          const completed = i < visible - 1 || allShown;
          return (
            <div
              key={line}
              className={cn(
                "anim-fadeIn flex items-center gap-2",
                completed ? "text-text-dim" : "text-text"
              )}
            >
              <span className="text-text-muted">$</span>
              <span>{line}</span>
              {completed && <span className="text-green">✓</span>}
              {isLast && (
                <span className="anim-blink text-text">_</span>
              )}
            </div>
          );
        })}

        {allShown && (
          <div className="anim-fadeIn flex items-center gap-2 text-amber">
            <span className="text-text-muted">$</span>
            <span>{note || "正在等待 AI 响应"}</span>
            <span className="anim-blink">_</span>
          </div>
        )}
      </div>
    </div>
  );
}
