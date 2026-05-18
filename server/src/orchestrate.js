// POST /api/orchestrate — #1 工作流编排.
// Runs the Mastra [改写 → 评估 → 没达目标不结束] pipeline, then (later steps)
// will chain 知识点(#2)/思维导图(#3). Quota + persistence rules are IDENTICAL
// to /api/rewrite: quota pre-checked, consumed ONLY on success, run persisted
// best-effort. The final refined draft is stored as an `auto` run.
import express from 'express';
import { requireAuth } from './auth.js';
import { MODEL_MAP } from './openrouter.js';
import { canConsume, consume, getUsage } from './usage.js';
import { createProject, getOwnedProject, addRun } from './db.js';
import { runResumePipeline } from './mastra/pipeline.js';

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

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { role, original, model, projectId, projectTitle, targetScore } =
      req.body ?? {};

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

    let out;
    try {
      out = await runResumePipeline({
        original: trimmed,
        role,
        model: model ?? null,
        apiKey: hasOwnKey ? req.user.openrouter_key : undefined,
        targetScore: target,
        maxIters: ITER_CEILING,
      });
    } catch (err) {
      // Pipeline failed (model/parse error inside a step) — DO NOT count.
      return res
        .status(502)
        .json({ error: `Orchestration failed: ${err.message}` });
    }

    if (!out?.segments?.length) {
      return res
        .status(502)
        .json({ error: 'Pipeline produced no usable segments' });
    }

    // Authoritative, race-free quota gate (mirrors rewrite.js).
    const { ok, usage } = consume(userId, hasOwnKey);
    if (!ok) {
      return res.status(429).json({
        error:
          'Daily free limit reached. Add your own OpenRouter key for unlimited use.',
        usage,
      });
    }

    const result = {
      summary: out.summary,
      segments: out.segments,
      knowledge: out.knowledge ?? [],
      mindmap: out.mindmap ?? null,
    };
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

    return res.json({
      result,
      score: out.score,
      iterations: out.iterations,
      knowledge: result.knowledge,
      mindmap: result.mindmap,
      usage,
      projectId: project?.id ?? null,
      projectTitle: project?.title ?? null,
      ...(runInfo ?? {}),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
