import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import type { ApiError } from "@/lib/types";

interface ErrorPanelProps {
  error: ApiError;
  onRetry: () => void;
  onBack: () => void;
}

export function ErrorPanel({ error, onRetry, onBack }: ErrorPanelProps) {
  return (
    <div className="mx-auto max-w-[720px] px-8 py-20">
      <div className="border border-border bg-panel">
        <div className="flex items-center gap-2.5 border-b border-border px-6 py-3">
          <Dot color="red" size={8} />
          <span className="font-mono text-[11px] uppercase tracking-[2px] text-red">
            错误 {error.status > 0 ? `· ${error.status}` : ""}
          </span>
        </div>
        <div className="p-7">
          <p className="font-sans text-[16px] leading-relaxed text-text">
            {error.message}
          </p>

          {error.raw && (
            <details className="mt-5">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[1.5px] text-text-dim hover:text-text">
                查看 AI 原始返回
              </summary>
              <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-words border border-border bg-bg p-4 font-mono text-[12px] leading-relaxed text-text-dim">
                {error.raw}
              </pre>
            </details>
          )}

          <div className="mt-7 flex gap-3">
            <Button size="sm" onClick={onRetry}>
              重试 →
            </Button>
            <Button variant="outline" size="sm" onClick={onBack}>
              ← 返回修改
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
