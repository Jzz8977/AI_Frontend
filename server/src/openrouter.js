// OpenRouter client (OpenAI-compatible chat/completions).
// Uses the platform key by default, or the caller-supplied key (own-key users).

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
// auto-mode results (full rewritten_experience) routinely exceed 4k tokens;
// too low here truncates the JSON and parsing fails downstream.
const MAX_TOKENS = Number.parseInt(process.env.MAX_TOKENS ?? '', 10) || 8000;
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
 * @param {string} [opts.system] - optional system message prepended to messages
 * @returns {Promise<string>} the raw assistant message content
 * @throws {Error} on missing key, non-2xx response, or network/timeout error
 */
export async function callOpenRouter(
  prompt,
  { apiKey, model: modelOverride, system } = {}
) {
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
        messages: system
          ? [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ]
          : [{ role: 'user', content: prompt }],
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

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason;

  // Diagnostic: finish_reason === 'length' means the model was cut off by
  // max_tokens — the JSON will be truncated and parse will fail downstream.
  console.log(
    `[openrouter] model=${model} finish_reason=${finishReason} ` +
      `content_len=${typeof content === 'string' ? content.length : 'n/a'} ` +
      `usage=${JSON.stringify(data?.usage ?? {})}`
  );
  if (finishReason === 'length') {
    console.warn(
      `[openrouter] ⚠ response TRUNCATED by max_tokens (${MAX_TOKENS}). ` +
        `Raise MAX_TOKENS or shorten the input.`
    );
  }

  if (typeof content !== 'string' || content.trim() === '') {
    const err = new Error('OpenRouter response contained no message content');
    err.code = 'EMPTY';
    err.raw = JSON.stringify(data);
    throw err;
  }

  return content;
}

/**
 * Stream an OpenRouter completion. Async generator yielding text deltas.
 * No response_format (NDJSON protocol is enforced via the prompt).
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {string} [opts.system]
 * @param {AbortSignal} [opts.signal] - aborts the upstream fetch
 * @yields {string} incremental assistant text
 * @throws {Error} with .code (NO_KEY | UPSTREAM | NETWORK)
 */
export async function* streamOpenRouter(
  prompt,
  { apiKey, model: modelOverride, system, signal } = {}
) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    const err = new Error('No OpenRouter API key available.');
    err.code = 'NO_KEY';
    throw err;
  }
  const model = modelOverride || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'Resume Rewriter Portal',
      },
      body: JSON.stringify({
        model,
        messages: system
          ? [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ]
          : [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        stream: true,
      }),
    });
  } catch (e) {
    const err = new Error(
      e.name === 'AbortError'
        ? 'OpenRouter stream aborted'
        : `Network error contacting OpenRouter: ${e.message}`
    );
    err.code = 'NETWORK';
    throw err;
  }

  if (!response.ok || !response.body) {
    let detail = '';
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      detail = await response.text().catch(() => '');
    }
    const err = new Error(`OpenRouter returned ${response.status}`);
    err.code = 'UPSTREAM';
    err.status = response.status;
    err.raw = detail || undefined;
    throw err;
  }

  // Parse the OpenAI-style SSE: lines "data: {json}" / "data: [DONE]".
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of response.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive / non-JSON lines
      }
    }
  }
}

export default callOpenRouter;
