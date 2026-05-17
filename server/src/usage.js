// Daily quota logic. Natural day key (server-local). Users with their own
// OpenRouter key are unlimited and never counted.
import { getUsageCount, tryIncrementUsage } from './db.js';

const DAILY_FREE_LIMIT = Number.parseInt(process.env.DAILY_FREE_LIMIT ?? '5', 10) || 5;

/** Server-local natural day key, e.g. "2026-05-17". */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO timestamp of the next server-local midnight (quota reset point). */
export function nextMidnightISO(date = new Date()) {
  const next = new Date(date);
  next.setHours(24, 0, 0, 0); // rolls into the next day at 00:00 local
  return next.toISOString();
}

/**
 * Build the usage object exactly per CONTRACT:
 * { used, limit, remaining, unlimited, resetAt }
 *
 * @param {number} userId
 * @param {boolean} hasOwnKey - true => unlimited, not counted
 */
export function getUsage(userId, hasOwnKey) {
  const now = new Date();
  const resetAt = nextMidnightISO(now);

  if (hasOwnKey) {
    return {
      used: 0,
      limit: DAILY_FREE_LIMIT,
      remaining: DAILY_FREE_LIMIT,
      unlimited: true,
      resetAt,
    };
  }

  const used = getUsageCount(userId, dayKey(now));
  const remaining = Math.max(0, DAILY_FREE_LIMIT - used);
  return {
    used,
    limit: DAILY_FREE_LIMIT,
    remaining,
    unlimited: false,
    resetAt,
  };
}

/**
 * Whether the user may make another rewrite right now.
 * Unlimited users always pass.
 */
export function canConsume(userId, hasOwnKey) {
  if (hasOwnKey) return true;
  return getUsageCount(userId, dayKey()) < DAILY_FREE_LIMIT;
}

/**
 * Atomically consume one slot for a SUCCESSFUL rewrite.
 * Unlimited (own-key) users always succeed and are never counted.
 * Returns { ok, usage }: ok=false means a concurrent request took the last
 * slot between the pre-check and here (race-safe enforcement).
 */
export function consume(userId, hasOwnKey) {
  if (hasOwnKey) {
    return { ok: true, usage: getUsage(userId, hasOwnKey) };
  }
  const ok = tryIncrementUsage(userId, dayKey(), DAILY_FREE_LIMIT);
  return { ok, usage: getUsage(userId, false) };
}

export { DAILY_FREE_LIMIT };
