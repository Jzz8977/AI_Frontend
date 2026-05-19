// Model adapter for Mastra steps. Reuses the existing DeepSeek / OpenRouter
// callers + fault-tolerant parser so orchestration inherits the SAME provider
// routing, error contract, and quota-neutral failure behavior as /api/rewrite.
import { callDeepSeek, streamDeepSeek } from '../deepseek.js';
import { callOpenRouter, streamOpenRouter, resolveModel } from '../openrouter.js';
import { parseAIResponse } from '../parser.js';
import { makeJsonExtractor } from '../ndjson.js';

/**
 * Call the model once and return its raw assistant string.
 * `deepseek` -> direct; everything else -> OpenRouter (same rule as rewrite.js).
 *
 * @param {object} a
 * @param {string} a.prompt
 * @param {string} a.system
 * @param {string} [a.model]   - model id ("deepseek" | "claude" | ...)
 * @param {string} [a.apiKey]  - user's own OpenRouter key when hasOwnKey
 * @returns {Promise<string>}
 */
export function callRaw({ prompt, system, model, apiKey }) {
  if (model === 'deepseek') {
    return callDeepSeek(prompt, { system });
  }
  return callOpenRouter(prompt, {
    apiKey,
    model: resolveModel(model) ?? undefined,
    system,
  });
}

/** callRaw + fault-tolerant JSON parse. Throws the provider/parse error as-is. */
export async function callJson({ prompt, system, model, apiKey }) {
  const raw = await callRaw({ prompt, system, model, apiKey });
  return parseAIResponse(raw);
}

/**
 * Call the model (non-streamed) with the NDJSON streaming protocol and
 * assemble the result into the SAME {summary, segments} shape the streaming
 * endpoint produces — so orchestrated output stays contract-compatible with
 * AutoResult / 整理成稿 / 简历模板. Uses the brace-aware extractor, so it
 * tolerates the model emitting NDJSON, pretty JSON, or a fenced array.
 *
 * @returns {Promise<{summary:string, segments:Array}>}
 */
const SEG_KINDS = new Set(['skills', 'experience', 'project']);

/**
 * Coerce a parsed `seg` frame into a contract-valid segment, or return null
 * to DROP it. Models sometimes emit a terminator/noise frame shaped like a
 * segment (e.g. `{"t":"seg","kind":"done"}`); letting that through crashes
 * Mastra's strict zod enum on the next step. Missing kind → 'experience'.
 */
function toSegment(obj) {
  const kind =
    obj.kind == null ? 'experience' : String(obj.kind).trim().toLowerCase();
  if (!SEG_KINDS.has(kind)) return null;
  return {
    kind,
    title: obj.title ?? '',
    original: obj.original ?? '',
    rewritten: obj.rewritten ?? '',
    note: obj.note ?? '',
  };
}

export async function callSegments({ prompt, system, model, apiKey }) {
  const raw = await callRaw({ prompt, system, model, apiKey });
  const extract = makeJsonExtractor();
  let summary = '';
  const segments = [];
  for (const obj of extract(raw)) {
    if (obj?.t === 'meta') {
      summary = typeof obj.summary === 'string' ? obj.summary : summary;
    } else if (obj?.t === 'seg') {
      const seg = toSegment(obj);
      if (seg) segments.push(seg);
    }
  }
  return { summary, segments };
}

/**
 * Like callSegments, but **streams** the model (DeepSeek direct / OpenRouter)
 * and invokes `onFrame({t:'meta'|'seg',...})` as each NDJSON frame lands —
 * identical wire shape to POST /api/rewrite/stream. Still returns the fully
 * assembled {summary, segments} for the orchestration loop. Used for the
 * FIRST refine pass so deep 编排 shows the compare cards as fast as a normal
 * quick rewrite.
 *
 * @returns {Promise<{summary:string, segments:Array}>}
 */
export async function callSegmentsStream(
  { prompt, system, model, apiKey, signal },
  onFrame
) {
  const opts = { system, signal };
  const gen =
    model === 'deepseek'
      ? streamDeepSeek(prompt, opts)
      : streamOpenRouter(prompt, {
          ...opts,
          apiKey,
          model: resolveModel(model) ?? undefined,
        });
  const extract = makeJsonExtractor();
  let summary = '';
  const segments = [];
  for await (const delta of gen) {
    for (const obj of extract(delta)) {
      if (obj?.t === 'meta') {
        summary = typeof obj.summary === 'string' ? obj.summary : summary;
        onFrame?.({ t: 'meta', summary });
      } else if (obj?.t === 'seg') {
        const seg = toSegment(obj);
        if (seg) {
          segments.push(seg);
          onFrame?.({ t: 'seg', ...seg });
        }
      } else if (obj?.t === 'done') {
        break;
      }
    }
  }
  return { summary, segments };
}
