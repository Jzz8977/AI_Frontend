import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { AutoResult } from "@/components/stages/AutoResult";
import { ReviewResult } from "@/components/stages/ReviewResult";
import { publicShowcaseItem } from "@/lib/api";
import type {
  AutoResult as AutoResultData,
  ReviewResult as ReviewData,
  ShowcaseDetail,
} from "@/lib/types";

interface ShowcaseProps {
  authed: boolean;
}

/** Public, read-only view of one shared version. No actions, no original. */
export function Showcase({ authed }: ShowcaseProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<ShowcaseDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const n = Number.parseInt(id ?? "", 10);
    if (!Number.isInteger(n)) {
      setErr("无效的分享链接");
      return;
    }
    publicShowcaseItem(n)
      .then((r) => setItem(r.item))
      .catch((e) => setErr(e?.message || "该分享不存在或已被取消"));
  }, [id]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-8 py-[14px]">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <Dot color="green" pulse size={9} />
            <span className="font-mono text-sm tracking-tight">
              前端<span className="text-green">方向部</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              ← 返回展示墙
            </Button>
            <Button
              size="sm"
              onClick={() => navigate("/mode")}
            >
              {authed ? "改我的简历 →" : "我也要改写 →"}
            </Button>
          </div>
        </div>
      </header>

      {err && (
        <div className="mx-auto max-w-[680px] px-8 py-28 text-center">
          <p className="font-mono text-[13px] text-text-dim">// {err}</p>
          <Button
            className="mt-6"
            variant="outline"
            size="sm"
            onClick={() => navigate("/")}
          >
            ← 回到展示墙
          </Button>
        </div>
      )}

      {!err && !item && (
        <div className="px-8 py-28 text-center font-mono text-[12px] text-text-muted">
          正在加载分享内容…
        </div>
      )}

      {!err && item && (
        <>
          <div className="mx-auto max-w-[1280px] px-8 pt-10">
            <p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
              公开分享 · {item.roleLabel} · {item.modeLabel} ·{" "}
              {item.createdAt.slice(0, 10)}
            </p>
            <p className="mt-3 border border-border bg-panel px-4 py-3 font-mono text-[11px] leading-relaxed text-text-muted">
              // 此页为作者主动公开的改写结果,仅供学习借鉴;不含原始简历、
              联系方式与作者身份。
            </p>
          </div>
          {item.mode === "review" ? (
            <ReviewResult
              data={item.result as ReviewData}
              title={item.title}
            />
          ) : (
            <AutoResult
              data={item.result as AutoResultData}
              title={item.title}
            />
          )}
        </>
      )}
    </div>
  );
}
