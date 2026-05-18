import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import {
  MAX_INPUT,
  MIN_INPUT,
  MODES,
  ROLES,
  SAMPLE_RESUME,
} from "@/lib/constants";
import type { Mode, RoleId } from "@/lib/types";
import { cn } from "@/lib/utils";

interface InputStepProps {
  mode: Mode;
  role: RoleId;
  value: string;
  onChange: (v: string) => void;
  /** Title of the project being iterated, or null when starting a new one. */
  currentProjectTitle?: string | null;
  /** Optional name for the NEW project (only used when no current project). */
  projectName: string;
  onProjectNameChange: (v: string) => void;
  /** #1 深度编排开关(仅 auto 模式生效)。 */
  deep: boolean;
  onDeepChange: (v: boolean) => void;
  onExecute: () => void;
  onBack: () => void;
  inFlight: boolean;
}

/** r1.md §3.3 — 粘贴原文 (仿编辑器 textarea) */
export function InputStep({
  mode,
  role,
  value,
  onChange,
  currentProjectTitle,
  projectName,
  onProjectNameChange,
  deep,
  onDeepChange,
  onExecute,
  onBack,
  inFlight,
}: InputStepProps) {
  const [throttled, setThrottled] = useState(false);
  const len = value.length;
  const trimmed = value.trim().length;
  const tooShort = trimmed < MIN_INPUT;
  const tooLong = trimmed > MAX_INPUT; // match server (validates trimmed length)
  const disabled = tooShort || tooLong || inFlight || throttled;

  const modeDef = MODES.find((m) => m.id === mode)!;
  const roleDef = ROLES.find((r) => r.id === role)!;

  const handleExecute = () => {
    if (disabled) return;
    // 客户端 1.2s 节流,防重复点击
    setThrottled(true);
    setTimeout(() => setThrottled(false), 1200);
    onExecute();
  };

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-14">
      <div className="mb-7 flex items-start justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
            // 步骤 03 — 粘贴简历原文
          </p>
          <h1 className="mt-3 font-sans text-[40px] font-light tracking-[-1px] text-text">
            粘贴简历原文
            <span className="text-green">.</span>
          </h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <Tag color="green">{modeDef.code} {modeDef.title}</Tag>
            <Tag color="blue">
              {roleDef.code} · {roleDef.name}
            </Tag>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          ← 返回
        </Button>
      </div>

      {currentProjectTitle ? (
        <div className="mb-4 flex items-center gap-3 border border-border bg-panel px-4 py-3 font-mono text-[12px]">
          <span className="uppercase tracking-[2px] text-green">
            // 继续优化
          </span>
          <span className="truncate text-text" title={currentProjectTitle}>
            {currentProjectTitle}
          </span>
          <span className="text-text-muted">→ 本次将作为新版本存入该项目</span>
        </div>
      ) : (
        <div className="mb-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
            // 项目名 (可留空,自动按岗位+时间生成)
          </label>
          <input
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            disabled={inFlight}
            maxLength={80}
            placeholder="例如:阿里前端 P6 投递"
            className={cn(
              "h-11 w-full max-w-[420px] rounded-none border border-border bg-panel px-3 font-mono text-[13px] text-text",
              "placeholder:text-text-muted hover:border-border-hi focus:border-green focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
        </div>
      )}

      <div className="border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-xs">
          <span className="text-text-dim">简历原文.txt</span>
          <span
            className={cn(
              "tracking-wide",
              tooLong ? "text-red" : "text-text-muted"
            )}
          >
            {len} 字
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={"// 在此粘贴简历原文…\n// 至少 50 字"}
          className="block min-h-[380px] w-full resize-y bg-panel px-5 py-4 font-mono text-[13px] leading-[1.7] text-text placeholder:text-text-muted focus:outline-none"
        />
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(SAMPLE_RESUME)}
          >
            加载示例数据
          </Button>
          {tooShort && trimmed > 0 && (
            <span className="font-mono text-[11px] text-text-muted">
              还需 {MIN_INPUT - trimmed} 字
            </span>
          )}
          {tooLong && (
            <span className="font-mono text-[11px] text-red">
              超出上限 {len - MAX_INPUT} 字
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* model picker hidden — model fixed to DEFAULT_MODEL upstream */}
          {mode === "auto" && (
            <button
              type="button"
              onClick={() => onDeepChange(!deep)}
              disabled={inFlight}
              title="开启后由 AI 反复改写+自评,没达目标分不结束(约 1~3 轮,较慢)"
              className={cn(
                "flex items-center gap-2 border px-3 py-2 font-mono text-[11px] uppercase tracking-[1.5px] transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                deep
                  ? "border-green/50 bg-green/10 text-green"
                  : "border-border bg-transparent text-text-dim hover:border-border-hi hover:text-text"
              )}
            >
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  deep ? "bg-green" : "bg-text-muted"
                )}
              />
              深度编排
            </button>
          )}
          <Button onClick={handleExecute} disabled={disabled} size="lg">
            {inFlight ? "执行中…" : "开始执行 →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
