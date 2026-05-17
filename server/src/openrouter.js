// OpenRouter client (OpenAI-compatible chat/completions).
// Uses the platform key by default, or the caller-supplied key (own-key users).

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 90_000;

// Friendly id (sent by the client) -> OpenRouter model slug.
// Tune slugs as OpenRouter's catalog evolves; keys are the public contract.
export const MODEL_MAP = {
  claude: 'anthropic/claude-sonnet-4.5',
  chatgpt: 'openai/gpt-4o',
  qwen: 'qwen/qwen-2.5-72b-instruct',
  deepseek: 'deepseek/deepseek-chat-v3.1:free',
};

/**
 * Resolve a client-supplied model id to an OpenRouter slug.
 * Unknown/empty -> null (caller decides: 400 or fall back to default).
 */
export function resolveModel(id) {
  if (id == null) return null;
  return MODEL_MAP[id] ?? null;
}

/**
 * Call OpenRouter with a single user prompt.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - the user's own key; falls back to platform key
 * @param {string} [opts.model] - resolved OpenRouter slug; falls back to env/default
 * @returns {Promise<string>} the raw assistant message content
 * @throws {Error} on missing key, non-2xx response, or network/timeout error
 */
export async function callOpenRouter(prompt, { apiKey, model: modelOverride } = {}) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    const err = new Error(
      'No OpenRouter API key available. Set OPENROUTER_API_KEY or save your own key.'
    );
    err.code = 'NO_KEY';
    throw err;
  }

  const model = modelOverride || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        // OpenRouter attribution headers.
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'Resume Rewriter Portal',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(
      e.name === 'AbortError'
        ? 'OpenRouter request timed out'
        : `Network error contacting OpenRouter: ${e.message}`
    );
    err.code = 'NETWORK';
    throw err;
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = '';
      }
    }
    const err = new Error(`OpenRouter returned ${response.status}`);
    err.code = 'UPSTREAM';
    err.status = response.status;
    // Detail goes to `raw` (collapsible panel per r1.md §5.6), not the
    // user-facing `error` string — avoids leaking backend internals.
    err.raw = detail || undefined;
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    const err = new Error(`Failed to parse OpenRouter response body: ${e.message}`);
    err.code = 'BAD_BODY';
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    const err = new Error('OpenRouter response contained no message content');
    err.code = 'EMPTY';
    err.raw = JSON.stringify(data);
    throw err;
  }

  return content;
}

export default callOpenRouter;
