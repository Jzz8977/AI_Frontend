// POST /api/orchestrate — #1 工作流编排,**phased SSE**.
// Mastra [改写 → 评估 → 没达目标不结束] 循环跑完即刻 flush 分段(分段对比/
// 整理成稿/简历模板 立刻可用),随后 #2 知识点、#3 学习路线 各自单独跑完再 flush
// 一帧 —— 用户不必等整条流水线。配额/落库规则与 /api/rewrite 完全一致:
// 配额预检 + 仅干净收尾才扣 + run 尽力落库(mode=auto)。客户端中途断开不扣不落。
import express from 'express';
import { requireAuth } from './auth.js';
import { MODEL_MAP } from './openrouter.js';
import { canConsume, consume, getUsage } from './usage.js';
import { createProject, getOwnedProject, addRun } from './db.js';
import {
  runRefine,
  extractKnowledge,
  buildMindmap,
} from './mastra/pipeline.js';

const router = express.Router();

const ROLES = new Set(['frontend', 'fullstack', 'ai']);
const ROLE_LABEL = { frontend: '前端', fullstack: '全栈', ai: 'AI' };
const MODEL_IDS = Object.keys(MODEL_MAP);
const MIN_LEN = 50;
const MAX_LEN = 8000;
const MAX_TITLE = 80;
// Hard ceiling on refine iterations regardless of client input — bounds
// worst-case model spend per request ("没达目标不结束" but not "永不结束").
const ITER_CEILING = 4;

function autoTitle(role) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${ROLE_LABEL[role] ?? role} · ${ts}`;
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

router.post('/', requireAuth, async (req, res) => {
  const { role, original, model, projectId, projectTitle, targetScore } =
    req.body ?? {};

  // ---- Validation (plain JSON 4xx, before we switch to SSE) ----
  if (!ROLES.has(role)) {
    return res
      .status(400)
      .json({ error: 'role must be "frontend", "fullstack", or "ai"' });
  }
  if (typeof original !== 'string') {
    return res.status(400).json({ error: 'original must be a string' });
  }
  const trimmed = original.trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) {
    return res.status(400).json({
      error: `original length must be between ${MIN_LEN} and ${MAX_LEN} characters (got ${trimmed.length})`,
    });
  }
  if (model != null && !MODEL_IDS.includes(model)) {
    return res
      .status(400)
      .json({ error: `model must be one of: ${MODEL_IDS.join(', ')}` });
  }
  if (projectId != null && !Number.isInteger(projectId)) {
    return res.status(400).json({ error: 'projectId must be an integer' });
  }
  if (
    projectTitle != null &&
    (typeof projectTitle !== 'string' || projectTitle.length > MAX_TITLE)
  ) {
    return res
      .status(400)
      .json({ error: `projectTitle must be a string ≤ ${MAX_TITLE} chars` });
  }
  let target = 85;
  if (targetScore != null) {
    if (!Number.isFinite(targetScore) || targetScore < 1 || targetScore > 100) {
      return res
        .status(400)
        .json({ error: 'targetScore must be a number in [1, 100]' });
    }
    target = Math.round(targetScore);
  }

  const userId = req.user.id;
  const hasOwnKey = Boolean(req.user.openrouter_key);

  let targetProject = null;
  if (projectId != null) {
    targetProject = getOwnedProject(userId, projectId);
    if (!targetProject) {
      return res.status(404).json({ error: 'Project not found' });
    }
  }

  if (!canConsume(userId, hasOwnKey)) {
    return res.status(429).json({
      error:
        'Daily free limit reached. Add your own OpenRouter key for unlimited use.',
      usage: getUsage(userId, hasOwnKey),
    });
  }

  // ---- Switch to SSE ----
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) clientGone = true;
  });

  // ---- Phase 1: Mastra refine loop (改写→评估→没达目标不结束) ----
  let refined;
  try {
    refined = await runRefine(
      {
        original: trimmed,
        role,
        model: model ?? null,
        apiKey: hasOwnKey ? req.user.openrouter_key : undefined,
        targetScore: target,
        maxIters: ITER_CEILING,
      },
      ({ attempt, score }) => {
        if (clientGone) return;
        sse(res, {
          t: 'iter',
          attempt,
          score,
          targetScore: target,
          ceiling: ITER_CEILING,
        });
      },
      {
        // The FIRST refine pass streams live (meta/seg frames), so the
        // compare cards show as fast as a normal quick rewrite. Later
        // refine passes are flushed as one `revise` frame below.
        sink: (frame) => {
          if (!clientGone && !res.writableEnded) sse(res, frame);
        },
      }
    );
  } catch (err) {
    if (!clientGone) {
      console.error(
        `[orchestrate] user=${userId} model=${model ?? 'default'} ` +
          `code=${err.code ?? ''} ${err.message}`
      );
      sse(res, { t: 'error', error: `Orchestration failed: ${err.message}` });
    }
    return res.end();
  }

  if (clientGone) return; // disconnected mid-pipeline — no count/persist

  if (!refined?.segments?.length) {
    sse(res, { t: 'error', error: 'Pipeline produced no usable segments' });
    return res.end();
  }

  const { summary, segments, score, iterations } = refined;

  // The first pass was already streamed live (meta/seg) via the sink. If the
  // loop refined further (>1 evaluation = at least one extra rewrite), flush
  // the improved final version as one `revise` frame so the client swaps the
  // displayed draft for the polished one. If it passed on the first try the
  // streamed draft already IS final — no revise needed.
  if (iterations.length > 1) {
    sse(res, {
      t: 'revise',
      summary,
      segments,
      score,
      attempt: iterations.length,
    });
  }
  // Segments settled here; 知识点/学习路线 still pending below.
  sse(res, { t: 'segdone' });

  // ---- Phase 2: #2 知识点(uses the user's chosen model, same as before) ----
  const knowledge = await extractKnowledge({
    role,
    model: refined.model,
    apiKey: refined.apiKey,
    summary,
    segments,
  });
  if (clientGone) return;
  sse(res, { t: 'knowledge', knowledge });

  // ---- Phase 3: #3 学习路线(always DeepSeek, inside buildMindmap) ----
  const mindmap = await buildMindmap({ role, summary, segments, knowledge });
  if (clientGone) return;
  sse(res, { t: 'mindmap', mindmap });

  // ---- Success: consume quota + persist (mirrors /api/rewrite) ----
  const { ok, usage } = consume(userId, hasOwnKey);
  if (!ok) {
    sse(res, {
      t: 'error',
      error: 'Daily free limit reached.',
      usage,
    });
    return res.end();
  }

  const result = { summary, segments, knowledge, mindmap };
  let project = null;
  let runInfo = null;
  try {
    project =
      targetProject ??
      createProject(
        userId,
        (typeof projectTitle === 'string' && projectTitle.trim()) ||
          autoTitle(role)
      );
    const { run, version } = addRun(userId, project.id, {
      mode: 'auto',
      role,
      model: model ?? null,
      original: trimmed,
      resultJson: JSON.stringify(result),
    });
    runInfo = { runId: run.id, version };
  } catch (e) {
    console.error('[orchestrate] failed to persist run:', e);
  }

  sse(res, {
    t: 'end',
    score,
    iterations,
    usage,
    projectId: project?.id ?? null,
    projectTitle: project?.title ?? null,
    ...(runInfo ?? {}),
  });
  res.end();
});

export default router;
