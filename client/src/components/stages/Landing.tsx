import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Tag } from "@/components/ui/tag";
import { publicShowcase } from "@/lib/api";
import type { ShowcaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LandingProps {
  authed: boolean;
}

const ROLE_WORDS = ["前端工程师", "全栈工程师", "AI 应用工程师"];
const FLOAT_TOKENS = [
  "const role = 'frontend'",
  "STAR ▸ 量化",
  "RAG / Agent",
  "React 19",
  "<résumé/>",
  "score ≥ 85",
  "// 没达目标不结束",
  "DeepSeek",
];

/** 一个轮播打字效果(逐字打出 → 停顿 → 逐字删除 → 下一个)。 */
function useTypewriter(words: string[]) {
  const [text, setText] = useState("");
  const i = useRef(0);
  const del = useRef(false);

  useEffect(() => {
    let timer: number;
    const tick = () => {
      const full = words[i.current % words.length];
      const next = del.current
        ? full.slice(0, text.length - 1)
        : full.slice(0, text.length + 1);
      setText(next);
      let delay = del.current ? 55 : 110;
      if (!del.current && next === full) {
        del.current = true;
        delay = 1300;
      } else if (del.current && next === "") {
        del.current = false;
        i.current += 1;
        delay = 320;
      }
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 140);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return text;
}

function ShowcaseCard({
  item,
  onOpen,
}: {
  item: ShowcaseItem;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group flex flex-col items-start gap-3 border border-border bg-panel p-6 text-left transition-all",
        "hover:-translate-y-1 hover:border-green/50 hover:bg-panel-2"
      )}
    >
      <div className="flex w-full items-center gap-2">
        <Tag color="green">{item.roleLabel}</Tag>
        <Tag color="blue">{item.modeLabel}</Tag>
        <span className="ml-auto font-mono text-[10px] text-text-muted">
          {item.createdAt.slice(0, 10)}
        </span>
      </div>
      <h3 className="font-sans text-[17px] leading-snug text-text">
        {item.title}
      </h3>
      <p className="line-clamp-3 font-mono text-[12px] leading-[1.7] text-text-dim">
        {item.teaser || "// 一份公开分享的改写版本"}
      </p>
      <div className="mt-auto flex items-center gap-3 pt-2 font-mono text-[10px] uppercase tracking-[1.5px] text-text-muted">
        {item.segCount > 0 && <span>{item.segCount} 段经验</span>}
        {item.hasKnowledge && <span className="text-green">知识点</span>}
        {item.hasMindmap && <span className="text-amber">学习路线</span>}
        <span className="ml-auto text-text-dim group-hover:text-green">
          查看 →
        </span>
      </div>
    </button>
  );
}

export function Landing({ authed }: LandingProps) {
  const navigate = useNavigate();
  const typed = useTypewriter(ROLE_WORDS);
  const [items, setItems] = useState<ShowcaseItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    publicShowcase()
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true));
  }, []);

  // Flow is browsable without login up through 选岗位; the wall is at /input.
  const enterFlow = () => navigate("/mode");
  const login = () => navigate(authed ? "/mode" : "/auth");

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* ---- minimal public top bar ---- */}
      <header className="relative z-20 mx-auto flex max-w-[1280px] items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <Dot color="green" pulse size={9} />
          <span className="font-mono text-sm tracking-tight">
            前端<span className="text-green">方向部</span>
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={login}>
          {authed ? "进入工作台 →" : "登录 / 注册"}
        </Button>
      </header>

      {/* ---- hero ---- */}
      <section className="relative overflow-hidden border-b border-border">
        {/* animated backdrop */}
        <div className="pointer-events-none absolute inset-0 select-none">
          <div className="anim-grid absolute inset-0 opacity-[0.28]" />
          <div
            className="anim-aurora absolute -left-40 top-[-30%] h-[520px] w-[520px] rounded-full blur-[120px]"
            style={{ background: "rgba(63,185,80,0.20)" }}
          />
          <div
            className="anim-aurora absolute right-[-10%] top-[10%] h-[460px] w-[460px] rounded-full blur-[120px]"
            style={{
              background: "rgba(125,211,252,0.16)",
              animationDelay: "-7s",
            }}
          />
          <div className="anim-scanline absolute inset-x-0 top-0 h-px bg-green/30" />
          {FLOAT_TOKENS.map((tk, n) => (
            <span
              key={tk}
              className="anim-floaty absolute font-mono text-[11px] text-text-muted"
              style={{
                left: `${8 + ((n * 12.5) % 86)}%`,
                top: `${18 + ((n * 9) % 64)}%`,
                animationDelay: `${(n % 5) * -1.3}s`,
                animationDuration: `${5.5 + (n % 4)}s`,
              }}
            >
              {tk}
            </span>
          ))}
        </div>

        <div className="relative z-10 mx-auto max-w-[1280px] px-8 py-28 md:py-36">
          <p className="anim-riseIn mb-6 inline-flex items-center gap-2 border border-border bg-panel/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[2px] text-green backdrop-blur">
            <Dot color="green" pulse size={7} /> 2026 简历改写门户
          </p>
          <h1
            className="anim-riseIn max-w-[16ch] font-sans text-[48px] font-light leading-[1.08] tracking-[-1.5px] md:text-[76px]"
            style={{ animationDelay: "0.08s" }}
          >
            把你的经历,
            <br />
            重写成{" "}
            <span className="text-green">
              {typed}
              <span className="anim-blink">_</span>
            </span>
            <br />
            想要的样子。
          </h1>
          <p
            className="anim-riseIn mt-7 max-w-[52ch] font-sans text-[17px] font-light leading-relaxed text-text-dim"
            style={{ animationDelay: "0.16s" }}
          >
            AI 按 2026 岗位标准重写简历、逐条诊断、深度编排到达标为止,
            还能提炼知识点与学习路线。下面是其他人主动分享的版本 ——
            无需登录即可参考借鉴。
          </p>
          <div
            className="anim-riseIn mt-10 flex flex-wrap items-center gap-4"
            style={{ animationDelay: "0.24s" }}
          >
            <Button size="lg" onClick={enterFlow}>
              立即改写简历 →
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() =>
                document
                  .getElementById("showcase")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              浏览展示墙 ↓
            </Button>
          </div>
          <p
            className="anim-riseIn mt-6 font-mono text-[11px] text-text-muted"
            style={{ animationDelay: "0.3s" }}
          >
            // 首屏与展示墙免登录;开始改写时再登录注册
          </p>
        </div>
      </section>

      {/* ---- showcase ---- */}
      <section
        id="showcase"
        className="mx-auto max-w-[1280px] scroll-mt-6 px-8 py-20"
      >
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-sans text-[32px] font-light tracking-[-1px]">
              分享展示墙<span className="text-green">.</span>
            </h2>
            <p className="mt-2 font-mono text-[12px] text-text-dim">
              // 作者主动公开的改写版本,仅含改写结果,不含原始简历与作者身份
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={enterFlow}>
            {authed ? "去改我的简历 →" : "我也要改写 →"}
          </Button>
        </div>

        {items === null && !failed && (
          <div className="border border-border bg-panel p-10 text-center font-mono text-[12px] text-text-muted">
            正在加载展示墙…
          </div>
        )}
        {failed && (
          <div className="border border-border bg-panel p-10 text-center font-mono text-[12px] text-text-muted">
            // 展示墙暂不可用,请稍后重试。
          </div>
        )}
        {items !== null && items.length === 0 && (
          <div className="border border-border bg-panel p-10 text-center font-mono text-[12px] text-text-muted">
            // 还没有人分享。成为第一个 —— 改写后在「历史」里把某个版本设为公开。
          </div>
        )}
        {items !== null && items.length > 0 && (
          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => (
              <ShowcaseCard
                key={it.id}
                item={it}
                onOpen={() => navigate(`/showcase/${it.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border px-8 py-6">
        <p className="mx-auto max-w-[1280px] font-mono text-[11px] leading-relaxed text-text-muted">
          隐私说明:简历内容仅用于本工具生成改写结果,不对外共享、不用于训练。
          「展示墙」只展示作者**主动选择公开**的改写结果(可随时在「历史」中取消分享),
          绝不包含原始简历、联系方式或作者身份。
        </p>
      </footer>
    </div>
  );
}
