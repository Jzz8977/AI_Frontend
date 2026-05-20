import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot } from "@/components/ui/dot";
import { login, register, setToken } from "@/lib/api";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AuthStepProps {
  onAuthed: () => void;
}

export function AuthStep({ onAuthed }: AuthStepProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      toast.error("请填写邮箱和密码");
      return;
    }
    setBusy(true);
    try {
      const res =
        tab === "login"
          ? await login(email.trim(), password)
          : await register(email.trim(), password);
      setToken(res.token);
      toast.success(tab === "login" ? "登录成功" : "注册成功");
      onAuthed();
    } catch (err) {
      const e = err as ApiError;
      toast.error(e.message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-2.5">
          <Dot color="green" pulse size={9} />
          <span className="font-mono text-sm tracking-tight text-text">
            resume<span className="text-text-muted">.</span>
            <span className="text-green">rewrite</span>
            <span className="text-text-muted">()</span>
          </span>
        </div>

        <h1 className="mb-2 font-sans text-[34px] font-extralight leading-[1.15] tracking-[-1px] text-text">
          程序员把简历写成
          <br />
          <span className="font-medium italic">
            招聘官想看的样子
            <span className="text-green">.</span>
          </span>
        </h1>
        <p className="mb-9 font-mono text-[11px] uppercase tracking-[1.5px] text-text-muted">
          // 登录后开始使用
        </p>

        <div className="mb-px flex border border-border">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-3 font-mono text-[11px] uppercase tracking-[2px] transition-colors",
                tab === t
                  ? "bg-panel-2 text-green"
                  : "bg-panel text-text-dim hover:text-text"
              )}
            >
              {t === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form
          onSubmit={submit}
          className="space-y-px border border-t-0 border-border bg-panel p-7"
        >
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
            email
          </label>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
          <div className="h-4" />
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[2px] text-text-muted">
            password
          </label>
          <Input
            type="password"
            autoComplete={
              tab === "login" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
          <div className="h-7" />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "处理中…"
              : tab === "login"
                ? "登录 →"
                : "创建账号 →"}
          </Button>
        </form>
      </div>
    </div>
  );
}
