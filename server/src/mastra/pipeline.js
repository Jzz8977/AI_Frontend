// #1 工作流编排 — Mastra workflow: 改写 → 质量评估 → (没达目标不结束) 循环重写。
//
// "没达目标不结束" is implemented with Mastra's `.dountil(loop, cond)`: the
// [rewrite → evaluate] body repeats until the evaluator's score clears the
// target OR we hit maxIters (a hard ceiling so we never loop forever / burn
// unbounded model calls). Each retry feeds the evaluator's feedback back into
// the rewrite prompt so the draft actually improves.
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  STREAM_SYSTEM_PROMPT,
  STREAM_USER_PROMPT,
  ROLE_LABEL,
} from '../prompts.js';
import { callJson, callSegments } from './runner.js';

const segmentSchema = z.object({
  kind: z.enum(['skills', 'experience', 'project']),
  title: z.string(),
  original: z.string(),
  rewritten: z.string(),
  note: z.string(),
});

// #2 知识点:从最终改写稿提炼出候选人需掌握的结构化知识点。
const knowledgeSchema = z.object({
  topic: z.string(),
  level: z.enum(['核心', '进阶', '加分']),
  points: z.array(z.string()),
});

// #3 学习路线思维导图(Excalidraw 风格):中心目标 → 分阶段 → 主题节点。
const mindmapSchema = z.object({
  goal: z.string(),
  phases: z.array(
    z.object({
      name: z.string(),
      duration: z.string(),
      topics: z.array(
        z.object({ title: z.string(), points: z.array(z.string()) })
      ),
    })
  ),
});

// One state object flows through every step and around the loop unchanged in
// shape, so `.dountil` can feed an iteration's output back as the next input.
const stateSchema = z.object({
  original: z.string(),
  role: z.enum(['frontend', 'fullstack', 'ai']),
  model: z.string().nullable(),
  apiKey: z.string().optional(),
  targetScore: z.number(),
  maxIters: z.number(),
  attempt: z.number(),
  summary: z.string(),
  segments: z.array(segmentSchema),
  score: z.number(),
  feedback: z.string(),
  trace: z.array(
    z.object({ attempt: z.number(), score: z.number(), feedback: z.string() })
  ),
  knowledge: z.array(knowledgeSchema),
  mindmap: mindmapSchema.nullable(),
});

const inputSchema = z.object({
  original: z.string(),
  role: z.enum(['frontend', 'fullstack', 'ai']),
  model: z.string().nullable(),
  apiKey: z.string().optional(),
  targetScore: z.number().default(85),
  maxIters: z.number().default(3),
});

const outputSchema = z.object({
  summary: z.string(),
  segments: z.array(segmentSchema),
  score: z.number(),
  iterations: z.array(
    z.object({ attempt: z.number(), score: z.number(), feedback: z.string() })
  ),
  knowledge: z.array(knowledgeSchema),
  mindmap: mindmapSchema.nullable(),
});

const initStep = createStep({
  id: 'init',
  inputSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    attempt: 0,
    summary: '',
    segments: [],
    score: 0,
    feedback: '',
    trace: [],
    knowledge: [],
    mindmap: null,
  }),
});

const rewriteStep = createStep({
  id: 'rewrite',
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData: s }) => {
    let prompt = STREAM_USER_PROMPT(s.original, s.role);
    // On a retry, hand the evaluator's critique + the prior draft back to the
    // model so it revises instead of regenerating blindly.
    if (s.attempt > 0 && s.feedback) {
      prompt +=
        `\n\n## 上一版评审意见(必须逐条改进,目标分 ${s.targetScore})\n${s.feedback}` +
        `\n\n## 上一版草稿(在此基础上修订,不要推倒重写)\n` +
        JSON.stringify({ summary: s.summary, segments: s.segments });
    }
    const r = await callSegments({
      prompt,
      system: STREAM_SYSTEM_PROMPT,
      model: s.model,
      apiKey: s.apiKey,
    });
    return {
      ...s,
      attempt: s.attempt + 1,
      summary: r.summary,
      segments: r.segments,
    };
  },
});

const EVAL_SYSTEM =
  '你是极其严格的资深技术招聘官。只评估,不改写。严格按 JSON 输出,不要任何前后缀或代码块。';

const evaluateStep = createStep({
  id: 'evaluate',
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData: s }) => {
    const label = ROLE_LABEL[s.role] ?? s.role;
    const prompt = [
      `针对「${label}」岗位的 2026 招聘标准,评估下面这份改写后的简历。`,
      '打分维度:量化程度、技术栈现代化、AI 浓度、动词强度、STAR 结构、真实可信。',
      `目标分 ${s.targetScore}(满分 100)。低于目标分必须给出**具体、可执行**的逐条修改建议。`,
      '只输出 JSON:{"score": <0-100 整数>, "pass": <boolean>, "feedback": "<不达标时写明每条要改什么;达标写\\"达标\\">"}',
      `## 待评估简历\n${JSON.stringify({ summary: s.summary, segments: s.segments })}`,
    ].join('\n\n');
    let score = 0;
    let feedback = '';
    try {
      const r = await callJson({
        prompt,
        system: EVAL_SYSTEM,
        model: s.model,
        apiKey: s.apiKey,
      });
      score = Number.isFinite(r?.score) ? Math.round(r.score) : 0;
      feedback = typeof r?.feedback === 'string' ? r.feedback : '';
    } catch {
      // Evaluator hiccup must not kill an otherwise-good rewrite: treat as a
      // pass-through (score 0 keeps looping until maxIters, then we ship it).
      feedback = '(评审调用失败,跳过本轮评分)';
    }
    return {
      ...s,
      score,
      feedback,
      trace: [...s.trace, { attempt: s.attempt, score, feedback }],
    };
  },
});

// #2 知识点提炼:基于最终改写稿,提炼候选人为撑起这份简历应掌握的知识体系。
const KNOWLEDGE_SYSTEM =
  '你是技术面试官 + 学习规划师。只输出 JSON,不要任何前后缀或代码块。';

const knowledgeStep = createStep({
  id: 'knowledge',
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData: s }) => {
    const label = ROLE_LABEL[s.role] ?? s.role;
    const prompt = [
      `下面是一份面向「${label}」岗位的改写后简历。提炼出:要在面试中撑起这份简历、候选人必须掌握的结构化知识点。`,
      '按主题归类,每个主题给 level(核心/进阶/加分)和 3~6 条具体知识点(可考的点 / 易被追问的点)。覆盖简历里出现的技术与项目,聚焦 2026 岗位标准,不泛泛而谈。',
      '只输出 JSON:{"knowledge":[{"topic":"主题名","level":"核心|进阶|加分","points":["知识点1","知识点2"]}]} ,6~10 个主题。',
      `## 简历\n${JSON.stringify({ summary: s.summary, segments: s.segments })}`,
    ].join('\n\n');
    let knowledge = [];
    try {
      const r = await callJson({
        prompt,
        system: KNOWLEDGE_SYSTEM,
        model: s.model,
        apiKey: s.apiKey,
      });
      if (Array.isArray(r?.knowledge)) {
        knowledge = r.knowledge
          .filter((k) => k && typeof k.topic === 'string')
          .map((k) => ({
            topic: String(k.topic),
            level: ['核心', '进阶', '加分'].includes(k.level)
              ? k.level
              : '核心',
            points: Array.isArray(k.points)
              ? k.points.map(String).filter(Boolean)
              : [],
          }));
      }
    } catch {
      // Knowledge is additive — a failure here must not sink the rewrite.
      knowledge = [];
    }
    return { ...s, knowledge };
  },
});

// #3 学习路线思维导图 — 始终走 DeepSeek(需求明确:该步骤只有 DeepSeek),
// 与用户选的改写模型无关;DeepSeek 直连用服务端 key,无需 apiKey。
const MINDMAP_SYSTEM =
  '你是资深技术学习规划师。把知识点组织成一条可执行的进阶学习路线。只输出 JSON,不要任何前后缀或代码块。';

const mindmapStep = createStep({
  id: 'mindmap',
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData: s }) => {
    const label = ROLE_LABEL[s.role] ?? s.role;
    const basis = s.knowledge.length
      ? JSON.stringify(s.knowledge)
      : JSON.stringify({ summary: s.summary, segments: s.segments });
    const prompt = [
      `面向「${label}」岗位,把下列知识点编排成一张「学习路线思维导图」:中心是终极目标,向外按学习先后分 3~5 个阶段(由易到难、有依赖关系),每阶段挂 2~4 个主题节点,每节点 2~4 条要点。`,
      '阶段要体现递进(基础→进阶→工程化→面试冲刺之类),duration 给周数区间。',
      '只输出 JSON:{"goal":"中心目标(一句话)","phases":[{"name":"阶段名","duration":"如 2~3 周","topics":[{"title":"主题","points":["要点1","要点2"]}]}]}',
      `## 知识点 / 简历依据\n${basis}`,
    ].join('\n\n');
    let mindmap = null;
    try {
      // 强制 DeepSeek:忽略 s.model / s.apiKey。
      const r = await callJson({
        prompt,
        system: MINDMAP_SYSTEM,
        model: 'deepseek',
      });
      if (r && typeof r.goal === 'string' && Array.isArray(r.phases)) {
        mindmap = {
          goal: String(r.goal),
          phases: r.phases
            .filter((p) => p && typeof p.name === 'string')
            .map((p) => ({
              name: String(p.name),
              duration: typeof p.duration === 'string' ? p.duration : '',
              topics: Array.isArray(p.topics)
                ? p.topics
                    .filter((t) => t && typeof t.title === 'string')
                    .map((t) => ({
                      title: String(t.title),
                      points: Array.isArray(t.points)
                        ? t.points.map(String).filter(Boolean)
                        : [],
                    }))
                : [],
            })),
        };
      }
    } catch {
      // Mindmap is additive — failure must not sink the rewrite/knowledge.
      mindmap = null;
    }
    return { ...s, mindmap };
  },
});

const finalizeStep = createStep({
  id: 'finalize',
  inputSchema: stateSchema,
  outputSchema,
  execute: async ({ inputData: s }) => ({
    summary: s.summary,
    segments: s.segments,
    score: s.score,
    iterations: s.trace,
    knowledge: s.knowledge,
    mindmap: s.mindmap,
  }),
});

// Loop body: one rewrite + one evaluation.
const refineLoop = createWorkflow({
  id: 'refine-loop',
  inputSchema: stateSchema,
  outputSchema: stateSchema,
})
  .then(rewriteStep)
  .then(evaluateStep)
  .commit();

// 没达目标不结束:repeat the loop UNTIL score clears target OR we hit the
// hard iteration ceiling. `dountil` stops when the predicate returns true.
export const resumePipeline = createWorkflow({
  id: 'resume-pipeline',
  inputSchema,
  outputSchema,
})
  .then(initStep)
  .dountil(
    refineLoop,
    async ({ inputData: s }) =>
      s.score >= s.targetScore || s.attempt >= s.maxIters
  )
  .then(knowledgeStep)
  .then(mindmapStep)
  .then(finalizeStep)
  .commit();

/**
 * Run the orchestrated pipeline to completion.
 * @returns {Promise<{summary,segments,score,iterations}>}
 */
export async function runResumePipeline(input) {
  const run = await resumePipeline.createRun();
  const res = await run.start({ inputData: input });
  if (res.status !== 'success') {
    const msg =
      res.error?.message ||
      (typeof res.error === 'string' ? res.error : 'pipeline failed');
    const err = new Error(msg);
    err.code = 'PIPELINE';
    throw err;
  }
  return res.result;
}
