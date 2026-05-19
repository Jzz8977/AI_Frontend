// 题库 AI 服务代理 — 所有路由 Bearer 保护。前端**不直连** qbank(内网服务,
// 不自鉴权);本路由按已验证的登录态注入 userId,做 server→server 转发。
// userId 取 `u_<主后端用户id>`,与该用户的题库数据隔离一一对应。
import express from 'express';
import { requireAuth } from './auth.js';

const router = express.Router();

const QBANK = (process.env.QBANK_URL || 'http://127.0.0.1:3002').replace(
  /\/+$/,
  ''
);

// Node's global fetch (undici) does NOT do happy-eyeballs: `localhost` may
// resolve to ::1 while the qbank only binds IPv4 (or vice-versa), surfacing
// as an opaque "fetch failed". So we try the configured base first, then a
// swapped-host fallback (127.0.0.1 <-> localhost) on connection failure.
function bases() {
  const list = [QBANK];
  try {
    const h = new URL(QBANK).hostname;
    if (h === '127.0.0.1')
      list.push(QBANK.replace('127.0.0.1', 'localhost'));
    else if (h === 'localhost')
      list.push(QBANK.replace('localhost', '127.0.0.1'));
  } catch {
    /* malformed QBANK_URL — single candidate */
  }
  return [...new Set(list)];
}

/** 脱敏请求头(隐藏 Authorization / Cookie 的具体值,只留存在性)。 */
function redactHeaders(h) {
  const o = {};
  const src =
    typeof h?.forEach === 'function'
      ? (() => {
          const m = {};
          h.forEach((v, k) => (m[k] = v));
          return m;
        })()
      : h || {};
  for (const [k, v] of Object.entries(src)) {
    const lk = k.toLowerCase();
    o[k] =
      lk === 'authorization' || lk === 'cookie'
        ? `<${String(v).slice(0, 8)}…redacted>`
        : v;
  }
  return o;
}

/**
 * fetch the upstream, trying each base in turn. `make(base)` returns the
 * full target URL. Only CONNECTION failures (fetch throws) fall through to
 * the next base; once the server responds (any status) we return it.
 * Logs每次出站请求的地址 / 方法 / 请求头 / 结果,便于排查连通性。
 */
async function qfetch(make, init = {}) {
  const method = init.method || 'GET';
  let lastErr;
  for (const base of bases()) {
    const url = make(base);
    console.log(
      `[qbank→] ${method} ${url} headers=` +
        JSON.stringify(redactHeaders(init.headers))
    );
    try {
      const r = await fetch(url, init);
      console.log(`[qbank←] ${method} ${url} -> ${r.status}`);
      return r;
    } catch (e) {
      console.error(
        `[qbank✗] ${method} ${url} failed: ${e?.message || e}` +
          (e?.cause
            ? ` cause=${e.cause.code || e.cause.message || e.cause}`
            : '')
      );
      lastErr = e;
    }
  }
  throw lastErr;
}

const uid = (req) => `u_${req.user.id}`;

/** qbank 不可达 / 异常时的统一友好错误(并打印可诊断的根因)。 */
function unreachable(res, err) {
  const cause = err?.cause;
  console.error(
    `[qbank] upstream unreachable bases=${bases().join(',')} ` +
      `err=${err?.message || err}` +
      (cause ? ` cause=${cause.code || cause.message || cause}` : '')
  );
  return res.status(502).json({
    error: 'qbank_unreachable',
    message: '题库服务暂时不可用,请稍后再试。',
  });
}

/** 透传一个普通 JSON 上游响应(含其错误码与体)。 */
async function passJson(upstream, res) {
  const ct = upstream.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await upstream.json().catch(() => null);
    return res.status(upstream.status).json(data ?? {});
  }
  const text = await upstream.text().catch(() => '');
  return res
    .status(upstream.status)
    .json({ error: 'bad_gateway', message: text.slice(0, 300) });
}

// 入站请求日志:打印请求地址 + (脱敏)请求头,便于排查代理/鉴权问题。
router.use((req, _res, next) => {
  console.log(
    `[qbank IN] ${req.method} ${req.baseUrl}${req.path} ` +
      `query=${JSON.stringify(req.query)} ` +
      `headers=${JSON.stringify(redactHeaders(req.headers))}`
  );
  next();
});

// ---- GET /api/qbank/categories ----
router.get('/categories', requireAuth, async (_req, res) => {
  try {
    const up = await qfetch((b) => `${b}/api/categories`);
    return passJson(up, res);
  } catch (e) {
    return unreachable(res, e);
  }
});

// ---- POST /api/qbank/interview/start ----
router.post('/interview/start', requireAuth, async (req, res) => {
  const { category, count } = req.body ?? {};
  if (typeof category !== 'string' || !category.trim()) {
    return res
      .status(400)
      .json({ error: 'bad_request', message: 'category 必填' });
  }
  try {
    const up = await qfetch((b) => `${b}/api/interview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid(req),
        category: category.trim(),
        ...(Number.isFinite(count) ? { count } : {}),
      }),
    });
    return passJson(up, res);
  } catch (e) {
    return unreachable(res, e);
  }
});

// ---- POST /api/qbank/interview/answer/stream — SSE 透传 ----
router.post('/interview/answer/stream', requireAuth, async (req, res) => {
  const { sessionId, questionId, userAnswer } = req.body ?? {};
  if (
    typeof sessionId !== 'string' ||
    typeof questionId !== 'string' ||
    typeof userAnswer !== 'string'
  ) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'sessionId / questionId / userAnswer 必填',
    });
  }

  // Abort the upstream if the client hangs up so we don't keep the model busy.
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  let up;
  try {
    up = await qfetch((b) => `${b}/api/interview/answer/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid(req),
        sessionId,
        questionId,
        userAnswer,
      }),
      signal: ac.signal,
    });
  } catch (e) {
    return unreachable(res, e);
  }

  // Pre-stream validation errors come back as plain JSON (non-SSE).
  if (!up.ok || !up.body) {
    return passJson(up, res);
  }

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Stream pass-through: read upstream bytes and write immediately (no
  // buffering, or the流式 effect is lost — per API.md 主后端代理注意).
  const reader = up.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded) break;
      res.write(value);
    }
  } catch {
    /* upstream aborted / client gone — just close */
  }
  res.end();
});

// ---- GET /api/qbank/mistakes ----
router.get('/mistakes', requireAuth, async (req, res) => {
  const { category, limit, offset } = req.query;
  const qs = new URLSearchParams({ userId: uid(req) });
  if (typeof category === 'string' && category.trim()) {
    qs.set('category', category.trim());
  }
  if (limit != null) qs.set('limit', String(limit));
  if (offset != null) qs.set('offset', String(offset));
  try {
    const up = await qfetch((b) => `${b}/api/mistakes?${qs.toString()}`);
    return passJson(up, res);
  } catch (e) {
    return unreachable(res, e);
  }
});

export default router;
