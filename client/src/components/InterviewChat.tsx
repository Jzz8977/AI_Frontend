import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, X, RotateCcw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  qbankAnswerStream,
  qbankCategories,
  qbankMistakes,
  qbankStart,
} from "@/lib/api";
import type {
  ApiError,
  QbankCategoryGroup,
  QbankMistake,
  QbankQuestion,
} from "@/lib/types";

// ---- tiny, safe-ish markdown renderer (headings / bold / code / lists) ----

function mdInline(s: string, keyBase: string) {
  // split on `code` and **bold**
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p))
      return (
        <code
          key={`${keyBase}-${i}`}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-green"
        >
          {p.slice(1, -1)}
        </code>
      );
    if (/^\*\*[^*]+\*\*$/.test(p))
      return (
        <strong key={`${keyBase}-${i}`} className="font-semibold text-text">
          {p.slice(2, -2)}
        </strong>
      );
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let li: string[] = [];
  const flushList = () => {
    if (!li.length) return;
    out.push(
      <ul
        key={`ul-${out.length}`}
        className="my-1.5 ml-4 list-disc space-y-1 text-[13px] leading-relaxed text-text-dim"
      >
        {li.map((t, k) => (
          <li key={k}>{mdInline(t, `li-${out.length}-${k}`)}</li>
        ))}
      </ul>
    );
    li = [];
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith("```")) {
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        <pre
          key={`pre-${out.length}`}
          className="my-2 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-text"
        >
          {code.join("\n")}
        </pre>
      );
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      out.push(
        <p
          key={`h-${out.length}`}
          className="mt-3 mb-1 font-mono text-[11px] uppercase tracking-[1.5px] text-green"
        >
          {h[2]}
        </p>
      );
      i++;
      continue;
    }
    const item = ln.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      li.push(item[1]);
      i++;
      continue;
    }
    if (!ln.trim()) {
      flushList();
      i++;
      continue;
    }
    flushList();
    out.push(
      <p
        key={`p-${out.length}`}
        className="my-1.5 text-[13px] leading-relaxed text-text-dim"
      >
        {mdInline(ln, `p-${out.length}`)}
      </p>
    );
    i++;
  }
  flushList();
  return <div>{out}</div>;
}

// ---- chat message model ----

type Msg =
  | { role: "bot"; kind: "question"; q: QbankQuestion; idx: number; total: number }
  | { role: "user"; text: string }
  | { role: "bot"; kind: "feedback"; text: string; streaming: boolean; meta?: string };

type Phase = "pick" | "loading" | "chat" | "mistakes";

const DIR_LABEL: Record<string, string> = {
  frontend: "前端方向",
  backend: "后端方向",
};
const COUNTS = [5, 10, 15, 20];

export function InterviewChat({ authed }: { authed: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");

  const [cats, setCats] = useState<QbankCategoryGroup[] | null>(null);
  const [count, setCount] = useState(10);

  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<QbankQuestion[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [answeredCur, setAnsweredCur] = useState(false);

  const [mistakes, setMistakes] = useState<QbankMistake[] | null>(null);
  const [openMistake, setOpenMistake] = useState<string | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs, phase]);

  // Load categories the first time the panel opens (only when logged in).
  useEffect(() => {
    if (!open || !authed || cats !== null) return;
    qbankCategories()
      .then((r) => setCats(r.categories))
      .catch((e) => {
        setCats([]);
        toast.error((e as ApiError).message || "题库分类加载失败");
      });
  }, [open, authed, cats]);

  const resetSession = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setSessionId("");
    setQuestions([]);
    setQIdx(0);
    setMsgs([]);
    setAnswer("");
    setGrading(false);
    setAnsweredCur(false);
  }, []);

  const pushQuestion = useCallback(
    (qs: QbankQuestion[], idx: number) => {
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          kind: "question",
          q: qs[idx],
          idx,
          total: qs.length,
        },
      ]);
      setAnsweredCur(false);
      setAnswer("");
    },
    []
  );

  const startInterview = useCallback(
    async (categoryKey: string, categoryName: string) => {
      setPhase("loading");
      try {
        const r = await qbankStart(categoryKey, count);
        if (!r.questions?.length) {
          toast.error("该分类暂无题目");
          setPhase("pick");
          return;
        }
        setSessionId(r.sessionId);
        setQuestions(r.questions);
        setQIdx(0);
        setMsgs([
          {
            role: "bot",
            kind: "feedback",
            text: `开始「${categoryName}」面试,共 ${r.questions.length} 题。逐题作答,我会即时点评。加油 👊`,
            streaming: false,
          },
        ]);
        pushQuestion(r.questions, 0);
        setPhase("chat");
      } catch (e) {
        toast.error((e as ApiError).message || "开始面试失败");
        setPhase("pick");
      }
    },
    [count, pushQuestion]
  );

  const submitAnswer = useCallback(() => {
    const text = answer.trim();
    if (!text || grading || answeredCur) return;
    const q = questions[qIdx];
    if (!q) return;
    setMsgs((m) => [
      ...m,
      { role: "user", text },
      { role: "bot", kind: "feedback", text: "", streaming: true },
    ]);
    setAnswer("");
    setGrading(true);
    setAnsweredCur(true);

    abortRef.current = qbankAnswerStream(
      { sessionId, questionId: q.id, userAnswer: text },
      {
        // 纯函数式更新(绝不原地改 last):React StrictMode 会双调用
        // setState updater,原地 += 会导致每个 chunk 重复两次。
        onMeta: (info) =>
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "bot" || last.kind !== "feedback")
              return m;
            return [
              ...m.slice(0, -1),
              {
                ...last,
                meta: `检索到 ${info.retrievedCount} 条相关知识 · 评判中…`,
              },
            ];
          }),
        onChunk: (t) =>
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "bot" || last.kind !== "feedback")
              return m;
            return [
              ...m.slice(0, -1),
              { ...last, text: last.text + t },
            ];
          }),
        onDone: (info) => {
          setGrading(false);
          abortRef.current = null;
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "bot" || last.kind !== "feedback")
              return m;
            return [
              ...m.slice(0, -1),
              {
                ...last,
                streaming: false,
                meta: info.isWrong
                  ? "✗ 已记入错题本,可在「错题本」复盘"
                  : "✓ 回答到位",
              },
            ];
          });
        },
        onError: (err) => {
          setGrading(false);
          abortRef.current = null;
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== "bot" || last.kind !== "feedback")
              return m;
            return [
              ...m.slice(0, -1),
              {
                ...last,
                streaming: false,
                text: last.text || `评判失败:${err.message}`,
              },
            ];
          });
          toast.error(err.message);
        },
      }
    );
  }, [answer, grading, answeredCur, questions, qIdx, sessionId]);

  const nextQuestion = useCallback(() => {
    const ni = qIdx + 1;
    if (ni >= questions.length) {
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          kind: "feedback",
          text: "🎉 本组面试完成!可「再来一组」换分类,或去「错题本」复盘。",
          streaming: false,
        },
      ]);
      return;
    }
    setQIdx(ni);
    pushQuestion(questions, ni);
  }, [qIdx, questions, pushQuestion]);

  const openMistakes = useCallback(() => {
    setPhase("mistakes");
    setMistakes(null);
    qbankMistakes(undefined, 100, 0)
      .then((r) => setMistakes(r.items))
      .catch((e) => {
        setMistakes([]);
        toast.error((e as ApiError).message || "错题本加载失败");
      });
  }, []);

  const finished =
    phase === "chat" && answeredCur && qIdx === questions.length - 1;
  const lastIsSummary =
    msgs[msgs.length - 1]?.role === "bot" &&
    (msgs[msgs.length - 1] as { text?: string }).text?.startsWith("🎉");

  return (
    <>
      {/* floating launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="面试题库助手"
        className={cn(
          "fixed bottom-6 right-6 z-[55] flex h-14 w-14 items-center justify-center rounded-full",
          "border border-white/20 bg-white/10 text-green shadow-[0_8px_30px_rgba(0,0,0,0.5)]",
          "backdrop-blur-xl transition-transform hover:scale-105 active:scale-95"
        )}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-[60] flex items-end justify-end p-0 sm:p-6">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* frosted glass panel */}
          <div
            className={cn(
              "relative flex h-full w-full flex-col overflow-hidden sm:h-[82vh] sm:max-h-[760px] sm:w-[460px]",
              "border border-white/15 bg-white/[0.07] shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
              "backdrop-blur-2xl sm:rounded-2xl",
              "anim-riseIn"
            )}
            style={{
              backgroundImage:
                "linear-gradient(160deg,rgba(63,185,80,0.10),rgba(255,255,255,0.02) 40%)",
            }}
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green/20 text-green">
                  <MessageCircle size={15} />
                </span>
                <div>
                  <p className="font-sans text-[14px] text-text">面试题库助手</p>
                  <p className="font-mono text-[10px] text-text-muted">
                    AI 模拟面试 · 即时点评 · 错题复盘
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {phase === "chat" && (
                  <button
                    onClick={openMistakes}
                    className="font-mono text-[10px] uppercase tracking-[1px] text-text-dim transition-colors hover:text-green"
                  >
                    错题本
                  </button>
                )}
                {(phase === "chat" || phase === "mistakes") && (
                  <button
                    onClick={() => {
                      resetSession();
                      setPhase("pick");
                    }}
                    title="再来一组"
                    className="ml-2 text-text-dim transition-colors hover:text-green"
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="ml-2 text-text-dim transition-colors hover:text-text"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* body */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4"
            >
              {!authed && (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green/15 text-green">
                    <MessageCircle size={22} />
                  </span>
                  <p className="font-sans text-[15px] text-text">
                    登录后即可用 AI 模拟面试
                  </p>
                  <p className="max-w-[280px] font-mono text-[12px] leading-relaxed text-text-muted">
                    // 选分类逐题作答、即时点评、错题复盘 —— 登录后开启
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      navigate("/auth");
                    }}
                  >
                    去登录 / 注册 →
                  </Button>
                </div>
              )}

              {authed && phase === "pick" && (
                <div className="space-y-5">
                  <p className="font-mono text-[12px] leading-relaxed text-text-dim">
                    // 选一个分类开始模拟面试。我会逐题提问、即时点评,答错的题自动进错题本。
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-text-muted">
                      题量
                    </span>
                    {COUNTS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setCount(c)}
                        className={cn(
                          "h-7 w-9 rounded-md border font-mono text-[11px] transition-colors",
                          count === c
                            ? "border-green/50 bg-green/15 text-green"
                            : "border-white/15 text-text-dim hover:text-text"
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {cats === null && (
                    <p className="font-mono text-[12px] text-text-muted">
                      加载分类中…
                    </p>
                  )}
                  {cats?.length === 0 && (
                    <p className="font-mono text-[12px] text-text-muted">
                      // 题库分类不可用,请稍后再试。
                    </p>
                  )}
                  {cats?.map((g) => (
                    <div key={g.direction}>
                      <p className="mb-2 font-mono text-[11px] uppercase tracking-[1.5px] text-green">
                        {DIR_LABEL[g.direction] ?? g.direction}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {g.items.map((it) => (
                          <button
                            key={it.key}
                            onClick={() => startInterview(it.key, it.name)}
                            className={cn(
                              "rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5",
                              "font-sans text-[13px] text-text-dim transition-all",
                              "hover:-translate-y-0.5 hover:border-green/40 hover:text-text"
                            )}
                          >
                            {it.name}
                            <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                              {it.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {phase === "loading" && (
                <p className="mt-10 text-center font-mono text-[12px] text-text-muted">
                  正在抽题…
                </p>
              )}

              {phase === "mistakes" && (
                <div className="space-y-2.5">
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-[1.5px] text-green">
                    错题本
                  </p>
                  {mistakes === null && (
                    <p className="font-mono text-[12px] text-text-muted">
                      加载中…
                    </p>
                  )}
                  {mistakes?.length === 0 && (
                    <p className="font-mono text-[12px] text-text-muted">
                      // 还没有错题。继续加油~
                    </p>
                  )}
                  {mistakes?.map((m) => (
                    <div
                      key={m.questionId + m.answeredAt}
                      className="rounded-lg border border-white/12 bg-white/[0.04]"
                    >
                      <button
                        onClick={() =>
                          setOpenMistake((k) =>
                            k === m.questionId ? null : m.questionId
                          )
                        }
                        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
                      >
                        <span className="font-sans text-[13px] text-text">
                          {m.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-text-muted">
                          {m.category}
                        </span>
                      </button>
                      {openMistake === m.questionId && (
                        <div className="border-t border-white/10 px-3.5 py-3">
                          <p className="mb-1 font-mono text-[10px] uppercase tracking-[1px] text-text-muted">
                            你的回答
                          </p>
                          <p className="mb-3 whitespace-pre-wrap font-mono text-[12px] text-text-dim">
                            {m.userAnswer}
                          </p>
                          <Markdown text={m.feedback} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(phase === "chat" ||
                (phase === "mistakes" && false)) && (
                <div className="space-y-3">
                  {msgs.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-green/30 bg-green/15 px-3.5 py-2 text-[13px] leading-relaxed text-text">
                          {m.text}
                        </div>
                      </div>
                    ) : m.kind === "question" ? (
                      <div key={i} className="space-y-1.5">
                        <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-green">
                          第 {m.idx + 1}/{m.total} 题 · {m.q.questionType}
                        </p>
                        <div className="rounded-2xl rounded-bl-sm border border-white/12 bg-white/[0.05] px-4 py-3">
                          <p className="mb-1.5 font-sans text-[15px] text-text">
                            {m.q.title}
                          </p>
                          <Markdown text={m.q.questionText} />
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="space-y-1">
                        <div className="rounded-2xl rounded-bl-sm border border-white/12 bg-white/[0.05] px-4 py-3">
                          {m.text ? (
                            <Markdown text={m.text} />
                          ) : (
                            <p className="font-mono text-[12px] text-text-muted">
                              {m.meta || "评判中…"}
                              <span className="anim-blink">_</span>
                            </p>
                          )}
                          {m.text && m.streaming && (
                            <span className="anim-blink font-mono text-green">
                              _
                            </span>
                          )}
                        </div>
                        {m.meta && m.text && (
                          <p className="px-1 font-mono text-[10px] text-text-muted">
                            {m.meta}
                          </p>
                        )}
                      </div>
                    )
                  )}

                  {answeredCur && !grading && !lastIsSummary && (
                    <div className="flex justify-center pt-1">
                      <Button size="sm" onClick={nextQuestion}>
                        {finished ? "完成本组" : "下一题"}
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  )}
                  {lastIsSummary && (
                    <div className="flex justify-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={openMistakes}
                      >
                        错题本
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          resetSession();
                          setPhase("pick");
                        }}
                      >
                        再来一组 →
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* composer (only mid-interview, before answering current Q) */}
            {phase === "chat" && !answeredCur && !lastIsSummary && (
              <div className="border-t border-white/10 p-3">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.metaKey || e.ctrlKey) &&
                      e.key === "Enter"
                    )
                      submitAnswer();
                  }}
                  rows={3}
                  placeholder="作答…(⌘/Ctrl+Enter 提交)"
                  className={cn(
                    "w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2",
                    "font-mono text-[13px] leading-relaxed text-text placeholder:text-text-muted",
                    "focus-visible:border-green/60 focus-visible:outline-none"
                  )}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={submitAnswer}
                    disabled={!answer.trim() || grading}
                  >
                    提交作答
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
