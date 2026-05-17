import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { setOpenrouterKey } from "@/lib/api";
import type { ApiError } from "@/lib/types";

interface SettingsDialogProps {
  open: boolean;
  hasOwnKey: boolean;
  onClose: () => void;
  onChanged: (hasOwnKey: boolean) => void;
}

export function SettingsDialog({
  open,
  hasOwnKey,
  onClose,
  onChanged,
}: SettingsDialogProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const save = async () => {
    if (!key.trim()) {
      toast.error("请输入 OpenRouter Key");
      return;
    }
    setBusy(true);
    try {
      const r = await setOpenrouterKey(key.trim());
      onChanged(r.hasOwnKey);
      setKey("");
      toast.success("已保存,改写将使用你自己的 Key(无限次)");
      onClose();
    } catch (e) {
      toast.error((e as ApiError).message || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const r = await setOpenrouterKey(null);
      onChanged(r.hasOwnKey);
      toast.success("已清除,恢复每日免费额度");
      onClose();
    } catch (e) {
      toast.error((e as ApiError).message || "清除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] border border-border bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[2px] text-green">
            SETTINGS · openrouter key
          </span>
          <button
            onClick={onClose}
            className="font-mono text-[11px] text-text-dim hover:text-text"
          >
            [ ✕ ]
          </button>
        </div>
        <div className="space-y-4 p-7">
          <p className="font-sans text-[14px] leading-relaxed text-text-dim">
            配置你自己的 OpenRouter Key 后,改写将使用你的 Key 且
            <span className="text-green"> 不限次数</span>。Key
            仅保存在服务端,绝不回传。
          </p>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
                当前状态
              </span>
              {hasOwnKey ? (
                <Tag color="green">已配置 · 无限</Tag>
              ) : (
                <Tag color="dim">未配置 · 每日免费额度</Tag>
              )}
            </div>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-or-v1-..."
              disabled={busy}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button size="sm" onClick={save} disabled={busy}>
              保存 Key
            </Button>
            {hasOwnKey && (
              <Button
                variant="danger"
                size="sm"
                onClick={clear}
                disabled={busy}
              >
                清除 Key
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
