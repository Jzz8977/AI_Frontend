// DeepSeek direct client (official api.deepseek.com, OpenAI-compatible SDK).
// Used for the `deepseek` model id; other ids still go through OpenRouter.
// Mirrors callOpenRouter's contract: returns the raw assistant string, and
// throws Errors carrying { code, status?, raw? } so rewrite.js handles both
// providers uniformly.
import OpenAI from 'openai';

const BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
// Keep in sync with openrouter.js — low values truncate the JSON output.
const MAX_TOKENS = Number.parseInt(process.env.MAX_TOKENS ?? '', 10) || 8000;
const TIMEOUT_MS = 90_000;

/**
 * Call DeepSeek with a single user prompt.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - own key; falls back to DEEPSEEK_API_KEY
 * @param {string} [opts.model]  - model id; falls back to env/default
 * @param {string} [opts.system] - optional system message prepended to messages
 * @returns {Promise<string>} the raw assistant message content
 * @throws {Error} with .code (NO_KEY | UPSTREAM | NETWORK | EMPTY)
 */
export async function callDeepSeek(
  prompt,
  { apiKey, model: modelOverride, system } = {}
) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error(
      'No DeepSeek API key available. Set DEEPSEEK_API_KEY.'
    );
    err.code = 'NO_KEY';
    throw err;
  }

  const model = modelOverride || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  const client = new OpenAI({
    baseURL: BASE_URL,
    apiKey: key,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      messages: system
        ? [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ]
        : [{ role: 'user', content: prompt }],
      // NOTE: no response_format:json_object here — the deepseek-v4 reasoning
      // models reject it when thinking is enabled. The prompt asks for JSON and
      // parseAIResponse() is fault-tolerant (fences + outer-brace slice).
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      stream: false,
    });
  } catch (e) {
    if (e?.status) {
      const err = new Error(`DeepSeek returned ${e.status}`);
      err.code = 'UPSTREAM';
      err.status = e.status;
      err.raw = e?.error?.message || e?.message || undefined;
      throw err;
    }
    const err = new Error(
      e?.name === 'APIConnectionTimeoutError'
        ? 'DeepSeek request timed out'
        : `Network error contacting DeepSeek: ${e?.message ?? 'unknown'}`
    );
    err.code = 'NETWORK';
    throw err;
  }

  const choice = completion?.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason;

  console.log(
    `[deepseek] model=${model} finish_reason=${finishReason} ` +
      `content_len=${typeof content === 'string' ? content.length : 'n/a'} ` +
      `usage=${JSON.stringify(completion?.usage ?? {})}`
  );
  if (finishReason === 'length') {
    console.warn(
      `[deepseek] ⚠ response TRUNCATED by max_tokens (${MAX_TOKENS}). ` +
        `Raise MAX_TOKENS or shorten the input.`
    );
  }

  if (typeof content !== 'string' || content.trim() === '') {
    const err = new Error('DeepSeek response contained no message content');
    err.code = 'EMPTY';
    err.raw = JSON.stringify(completion);
    throw err;
  }

  return content;
}

/**
 * Stream a DeepSeek completion. Async generator yielding text deltas.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {string} [opts.system]
 * @param {AbortSignal} [opts.signal]
 * @yields {string}
 * @throws {Error} with .code (NO_KEY | UPSTREAM | NETWORK)
 */
export async function* streamDeepSeek(
  prompt,
  { apiKey, model: modelOverride, system, signal } = {}
) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error('No DeepSeek API key available. Set DEEPSEEK_API_KEY.');
    err.code = 'NO_KEY';
    throw err;
  }
  const model = modelOverride || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const client = new OpenAI({
    baseURL: BASE_URL,
    apiKey: key,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model,
        messages: system
          ? [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ]
          : [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        stream: true,
      },
      { signal }
    );
  } catch (e) {
    if (e?.status) {
      const err = new Error(`DeepSeek returned ${e.status}`);
      err.code = 'UPSTREAM';
      err.status = e.status;
      err.raw = e?.error?.message || e?.message || undefined;
      throw err;
    }
    const err = new Error(
      `Network error contacting DeepSeek: ${e?.message ?? 'unknown'}`
    );
    err.code = 'NETWORK';
    throw err;
  }

  try {
    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  } catch (e) {
    const err = new Error(`DeepSeek stream error: ${e?.message ?? 'unknown'}`);
    err.code = 'NETWORK';
    throw err;
  }
}

export default callDeepSeek;
