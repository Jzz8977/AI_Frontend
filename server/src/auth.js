// Auth routes + Bearer middleware. JWT 7d expiry, bcrypt password hashing.
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
  createUser,
  getUserByEmail,
  getUserById,
  setOpenRouterKey,
} from './db.js';
import { getUsage } from './usage.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail fast: a default/known secret would allow trivial token forgery.
  throw new Error(
    'JWT_SECRET is not set. Define it in server/.env before starting the server.'
  );
}
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 10;

// Basic RFC-lite email shape check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

/** Express middleware: requires a valid `Authorization: Bearer <jwt>`. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  let payload;
  try {
    payload = jwt.verify(match[1], JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: 'User no longer exists' });
  }
  req.user = user;
  next();
}

// ---- POST /api/auth/register ------------------------------------------------
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (getUserByEmail(normalizedEmail)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = createUser(normalizedEmail, passwordHash);
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    // Unique-constraint race fallback.
    if (
      err &&
      (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(err.message)))
    ) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  }
});

// ---- POST /api/auth/login ---------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = getUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ---- GET /api/auth/me -------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const hasOwnKey = Boolean(req.user.openrouter_key);
  return res.json({
    user: { id: req.user.id, email: req.user.email, hasOwnKey },
    usage: getUsage(req.user.id, hasOwnKey),
  });
});

// ---- PUT /api/auth/openrouter-key ------------------------------------------
router.put('/openrouter-key', requireAuth, (req, res) => {
  const body = req.body ?? {};
  if (!('openrouterKey' in body)) {
    return res.status(400).json({ error: 'openrouterKey is required (string or null)' });
  }
  const { openrouterKey } = body;

  if (openrouterKey === null || openrouterKey === '') {
    setOpenRouterKey(req.user.id, null);
    return res.json({ ok: true, hasOwnKey: false });
  }
  if (typeof openrouterKey !== 'string') {
    return res.status(400).json({ error: 'openrouterKey must be a string or null' });
  }
  const trimmed = openrouterKey.trim();
  if (trimmed.length < 8) {
    return res.status(400).json({ error: 'openrouterKey looks invalid' });
  }
  setOpenRouterKey(req.user.id, trimmed);
  // NEVER return the key itself.
  return res.json({ ok: true, hasOwnKey: true });
});

export default router;
