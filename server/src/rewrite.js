// POST /api/rewrite — Bearer-protected. Quota enforced BEFORE the AI call.
// Usage is counted ONLY on a successful, parseable rewrite.
import express from 'express';
import { requireAuth } from './auth.js';
import {
  SYSTEM_PROMPT,
  USER_PROMPT_TEMPLATE,
  STREAM_SYSTEM_PROMPT,
  STREAM_USER_PROMPT,
} from './prompts.js';
import { parseAIResponse } from './parser.js';
import {
  callOpenRouter,
  streamOpenRouter,
  resolveModel,
  MODEL_MAP,
} from './openrouter.js';
import { callDeepSeek, streamDeepSeek } from './deepseek.js';
import { makeJsonExtractor } from './ndjson.js';
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

    // ---- Build prompt + call the model ----
    // SYSTEM_PROMPT (persona/rules/examples) goes as the system message;
    // the per-request user message carries roleSpec + mode schema + 原文.
    const prompt = USER_PROMPT_TEMPLATE(trimmed, role, mode);

    let raw;
    try {
      // `deepseek` goes direct to api.deepseek.com; everything else via OpenRouter.
      raw =
        model === 'deepseek'
          ? await callDeepSeek(prompt, { system: SYSTEM_PROMPT })
          : await callOpenRouter(prompt, {
              apiKey: hasOwnKey ? req.user.openrouter_key : undefined,
              model: resolvedModel,
              system: SYSTEM_PROMPT,
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
      // Parse failed — DO NOT count. Log enough to diagnose (almost always
      // truncation: see the [openrouter]/[deepseek] finish_reason line above).
      console.error(
        `[rewrite] PARSE FAIL user=${userId} model=${model ?? 'default'} ` +
          `mode=${mode} role=${role} raw_len=${raw.length} ` +
          `err=${err.message}\n--- raw tail (last 400) ---\n${raw.slice(-400)}\n--- end ---`
      );
      // Return raw for the client to inspect (collapsible panel).
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

// ---------------------------------------------------------------------------
// POST /api/rewrite/stream — auto-only, NDJSON-over-SSE.
// Emits: data: {"t":"meta",...} / {"t":"seg",...} / {"t":"end",...} /
//        {"t":"error",...}. Quota+persist happen only on a clean finish.
// ---------------------------------------------------------------------------

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

router.post('/stream', requireAuth, async (req, res) => {
  const { role, original, model, projectId, projectTitle } = req.body ?? {};

  // ---- Validation (plain JSON 4xx, before we switch to SSE) ----
  if (!ROLES.has(role)) {
    return res.status(400).json({ error: 'role invalid' });
  }
  if (typeof original !== 'string') {
    return res.status(400).json({ error: 'original must be a string' });
  }
  const trimmed = original.trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) {
    return res
      .status(400)
      .json({ error: `original length must be in [${MIN_LEN}, ${MAX_LEN}]` });
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
    return res.status(400).json({ error: 'projectTitle invalid' });
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
      error: 'Daily free limit reached.',
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

  // Detect a real client disconnect via the RESPONSE (not req: with
  // express.json the request body is already consumed, so req 'close'
  // fires immediately and would abort us before the model call starts).
  const ac = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      ac.abort();
    }
  });

  const prompt = STREAM_USER_PROMPT(trimmed, role);
  const opts = { system: STREAM_SYSTEM_PROMPT, signal: ac.signal };
  const gen =
    model === 'deepseek'
      ? streamDeepSeek(prompt, opts)
      : streamOpenRouter(prompt, {
          ...opts,
          apiKey: hasOwnKey ? req.user.openrouter_key : undefined,
          model: resolveModel(model) ?? undefined,
        });

  const extract = makeJsonExtractor();
  let summary = '';
  const segments = [];
  let gotAny = false;

  try {
    for await (const delta of gen) {
      for (const obj of extract(delta)) {
        if (obj.t === 'meta') {
          gotAny = true;
          summary = typeof obj.summary === 'string' ? obj.summary : '';
          sse(res, { t: 'meta', summary });
        } else if (obj.t === 'seg') {
          gotAny = true;
          const seg = {
            kind: obj.kind ?? 'experience',
            title: obj.title ?? '',
            original: obj.original ?? '',
            rewritten: obj.rewritten ?? '',
            note: obj.note ?? '',
          };
          segments.push(seg);
          sse(res, { t: 'seg', ...seg });
        } else if (obj.t === 'done') {
          break;
        }
      }
    }
  } catch (err) {
    if (!clientGone) {
      console.error(
        `[rewrite/stream] user=${userId} model=${model ?? 'default'} ` +
          `code=${err.code} status=${err.status ?? ''} ${err.message}`
      );
      sse(res, {
        t: 'error',
        error: `AI 流式请求失败: ${err.message}`,
        raw: err.raw,
      });
    }
    return res.end();
  }

  if (clientGone) return; // client disconnected mid-stream — no count/persist

  if (!gotAny || segments.length === 0) {
    sse(res, { t: 'error', error: '模型没有产出有效分段', raw: undefined });
    return res.end();
  }

  // ---- Success: consume quota + persist (mirrors POST /) ----
  const { ok, usage } = consume(userId, hasOwnKey);
  if (!ok) {
    sse(res, { t: 'error', error: 'Daily free limit reached.', usage });
    return res.end();
  }

  const result = { summary, segments };
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
    console.error('[rewrite/stream] failed to persist run:', e);
  }

  sse(res, {
    t: 'end',
    usage,
    projectId: project?.id ?? null,
    projectTitle: project?.title ?? null,
    ...(runInfo ?? {}),
  });
  res.end();
});

export default router;
