// Model adapter for Mastra steps. Reuses the existing DeepSeek / OpenRouter
// callers + fault-tolerant parser so orchestration inherits the SAME provider
// routing, error contract, and quota-neutral failure behavior as /api/rewrite.
import { callDeepSeek } from '../deepseek.js';
import { callOpenRouter, resolveModel } from '../openrouter.js';
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
export async function callSegments({ prompt, system, model, apiKey }) {
  const raw = await callRaw({ prompt, system, model, apiKey });
  const extract = makeJsonExtractor();
  let summary = '';
  const segments = [];
  for (const obj of extract(raw)) {
    if (obj?.t === 'meta') {
      summary = typeof obj.summary === 'string' ? obj.summary : summary;
    } else if (obj?.t === 'seg') {
      segments.push({
        kind: obj.kind ?? 'experience',
        title: obj.title ?? '',
        original: obj.original ?? '',
        rewritten: obj.rewritten ?? '',
        note: obj.note ?? '',
      });
    }
  }
  return { summary, segments };
}
