// POST /api/rewrite — Bearer-protected. Quota enforced BEFORE the AI call.
// Usage is counted ONLY on a successful, parseable rewrite.
import express from 'express';
import { requireAuth } from './auth.js';
import { buildRewritePrompt, buildReviewPrompt } from './prompts.js';
import { parseAIResponse } from './parser.js';
import { callOpenRouter, resolveModel, MODEL_MAP } from './openrouter.js';
import { callDeepSeek } from './deepseek.js';
import { canConsume, consume, getUsage } from './usage.js';
import { createProject, getOwnedProject, addRun } from './db.js';

const router = express.Router();

const MODES = new Set(['auto', 'review']);
const ROLES = new Set(['frontend', 'fullstack', 'ai']);
const ROLE_LABEL = { frontend: '前端', fullstack: '全栈', ai: 'AI' };
const MODEL_IDS = Object.keys(MODEL_MAP);
const MIN_LEN = 50;
const MAX_LEN = 8000;
const MAX_TITLE = 80;

/** Default project title when the user doesn't name it. */
function autoTitle(role) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${ROLE_LABEL[role] ?? role} · ${ts}`;
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { mode, role, original, model, projectId, projectTitle } =
      req.body ?? {};

    // ---- Defensive input validation (400) ----
    if (!MODES.has(mode)) {
      return res.status(400).json({ error: 'mode must be "auto" or "review"' });
    }
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
    // Optional model selection. Omitted -> server default. Unknown -> 400.
    if (model != null && !MODEL_IDS.includes(model)) {
      return res.status(400).json({
        error: `model must be one of: ${MODEL_IDS.join(', ')}`,
      });
    }
    const resolvedModel = resolveModel(model) ?? undefined;

    // Optional project targeting. projectId -> append to that owned project;
    // omitted -> create a new project (named projectTitle or auto).
    if (projectId != null && !Number.isInteger(projectId)) {
      return res.status(400).json({ error: 'projectId must be an integer' });
    }
    if (
      projectTitle != null &&
      (typeof projectTitle !== 'string' || projectTitle.length > MAX_TITLE)
    ) {
      return res.status(400).json({
        error: `projectTitle must be a string ≤ ${MAX_TITLE} chars`,
      });
    }

    const userId = req.user.id;
    const hasOwnKey = Boolean(req.user.openrouter_key);

    // Resolve target project early so a bad projectId fails before we spend
    // an AI call / quota slot. null -> create a fresh project on success.
    let targetProject = null;
    if (projectId != null) {
      targetProject = getOwnedProject(userId, projectId);
      if (!targetProject) {
        return res.status(404).json({ error: 'Project not found' });
      }
    }

    // ---- Enforce quota BEFORE calling the AI (429) ----
    if (!canConsume(userId, hasOwnKey)) {
      return res.status(429).json({
        error: 'Daily free limit reached. Add your own OpenRouter key for unlimited use.',
        usage: getUsage(userId, hasOwnKey),
      });
    }

    // ---- Build prompt + call OpenRouter ----
    const prompt =
      mode === 'auto'
        ? buildRewritePrompt(role, trimmed)
        : buildReviewPrompt(role, trimmed);

    let raw;
    try {
      // `deepseek` goes direct to api.deepseek.com; everything else via OpenRouter.
      raw =
        model === 'deepseek'
          ? await callDeepSeek(prompt)
          : await callOpenRouter(prompt, {
              apiKey: hasOwnKey ? req.user.openrouter_key : undefined,
              model: resolvedModel,
            });
    } catch (err) {
      // AI call failed — DO NOT count.
      return res.status(502).json({
        error: `AI request failed: ${err.message}`,
        raw: err.raw,
      });
    }

    // ---- Fault-tolerant parse ----
    let result;
    try {
      result = parseAIResponse(raw);
    } catch (err) {
      // Parse failed — DO NOT count. Return raw for the client to inspect.
      return res.status(502).json({
        error: `Failed to parse AI response: ${err.message}`,
        raw,
      });
    }

    // ---- Success: atomically consume a slot, then return ----
    // The pre-check above is a cheap fast-path; this conditional write is the
    // authoritative, race-free gate. If a concurrent request took the last
    // slot during our AI round-trip, reject with 429 (we don't count).
    const { ok, usage } = consume(userId, hasOwnKey);
    if (!ok) {
      return res.status(429).json({
        error: 'Daily free limit reached. Add your own OpenRouter key for unlimited use.',
        usage,
      });
    }
    // ---- Persist the run (history). Best-effort: a storage hiccup must not
    // lose the user's already-paid-for rewrite, so we still return on error. ----
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
        mode,
        role,
        model: model ?? null,
        original: trimmed,
        resultJson: JSON.stringify(result),
      });
      runInfo = { runId: run.id, version };
    } catch (e) {
      console.error('[rewrite] failed to persist run:', e);
    }

    return res.json({
      result,
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
