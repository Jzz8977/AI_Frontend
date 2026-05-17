// DeepSeek direct client (official api.deepseek.com, OpenAI-compatible SDK).
// Used for the `deepseek` model id; other ids still go through OpenRouter.
// Mirrors callOpenRouter's contract: returns the raw assistant string, and
// throws Errors carrying { code, status?, raw? } so rewrite.js handles both
// providers uniformly.
import OpenAI from 'openai';

const BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 90_000;

/**
 * Call DeepSeek with a single user prompt.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - own key; falls back to DEEPSEEK_API_KEY
 * @param {string} [opts.model]  - model id; falls back to env/default
 * @returns {Promise<string>} the raw assistant message content
 * @throws {Error} with .code (NO_KEY | UPSTREAM | NETWORK | EMPTY)
 */
export async function callDeepSeek(prompt, { apiKey, model: modelOverride } = {}) {
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
      messages: [{ role: 'user', content: prompt }],
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

  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    const err = new Error('DeepSeek response contained no message content');
    err.code = 'EMPTY';
    err.raw = JSON.stringify(completion);
    throw err;
  }

  return content;
}

export default callDeepSeek;
