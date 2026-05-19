// SQLite persistence layer. Tables auto-create on first import.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// data.db lives at server/data.db (one level up from src/). In containers,
// set DB_PATH to a volume-backed location (e.g. /data/data.db) so the
// database + its WAL/SHM siblings survive restarts.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    openrouter_key TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, day)
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage(user_id, day);

  -- A "project" = one resume-targeting context the user iterates on.
  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A "run" = one successful /api/rewrite call (a version inside a project).
  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL,
    role        TEXT NOT NULL,
    model       TEXT,
    original    TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, id);
`);

// ---- Idempotent migrations (older DBs created before a column existed) ------
// 分享:runs.shared (0/1) — 用户显式把某个版本发布到公开「展示墙」。
const runCols = db.prepare(`PRAGMA table_info(runs)`).all();
if (!runCols.some((c) => c.name === 'shared')) {
  db.exec(`ALTER TABLE runs ADD COLUMN shared INTEGER NOT NULL DEFAULT 0`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_shared ON runs(shared, id)`);

// ---- Prepared statements ----------------------------------------------------

const stmts = {
  insertUser: db.prepare(
    `INSERT INTO users (email, password_hash) VALUES (?, ?)`
  ),
  userByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  setKey: db.prepare(`UPDATE users SET openrouter_key = ? WHERE id = ?`),
  getUsage: db.prepare(
    `SELECT count FROM usage WHERE user_id = ? AND day = ?`
  ),
  // Atomic, limit-aware increment. The INSERT branch (first call of the day)
  // always succeeds with count=1. The conflict branch only increments while
  // strictly under the limit. RETURNING yields the new count, or nothing when
  // the limit was already reached — making the gate race-free.
  tryIncrement: db.prepare(`
    INSERT INTO usage (user_id, day, count) VALUES (@userId, @day, 1)
    ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1
      WHERE count < @limit
    RETURNING count
  `),

  // ---- Projects / runs ----
  insertProject: db.prepare(
    `INSERT INTO projects (user_id, title) VALUES (?, ?) RETURNING *`
  ),
  projectOwned: db.prepare(
    `SELECT * FROM projects WHERE id = ? AND user_id = ?`
  ),
  // List with derived run count + last activity for the sidebar.
  listProjects: db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id)        AS run_count,
           (SELECT r.role FROM runs r WHERE r.project_id = p.id
              ORDER BY r.id DESC LIMIT 1)                                  AS last_role,
           (SELECT r.mode FROM runs r WHERE r.project_id = p.id
              ORDER BY r.id DESC LIMIT 1)                                  AS last_mode
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC, p.id DESC
  `),
  renameProject: db.prepare(
    `UPDATE projects SET title = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
  ),
  deleteProject: db.prepare(
    `DELETE FROM projects WHERE id = ? AND user_id = ?`
  ),
  touchProject: db.prepare(
    `UPDATE projects SET updated_at = datetime('now') WHERE id = ?`
  ),
  insertRun: db.prepare(`
    INSERT INTO runs (project_id, user_id, mode, role, model, original, result_json)
    VALUES (@projectId, @userId, @mode, @role, @model, @original, @resultJson)
    RETURNING *
  `),
  countRuns: db.prepare(
    `SELECT COUNT(*) AS n FROM runs WHERE project_id = ?`
  ),
  runsByProject: db.prepare(
    `SELECT * FROM runs WHERE project_id = ? ORDER BY id ASC`
  ),

  // ---- Sharing / public showcase ----
  setRunShared: db.prepare(
    `UPDATE runs SET shared = ? WHERE id = ? AND user_id = ?`
  ),
  sharedList: db.prepare(`
    SELECT r.id, r.role, r.mode, r.created_at, r.result_json, p.title
    FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.shared = 1
    ORDER BY r.id DESC
    LIMIT 60
  `),
  sharedOne: db.prepare(`
    SELECT r.id, r.role, r.mode, r.created_at, r.result_json, p.title
    FROM runs r JOIN projects p ON p.id = r.project_id
    WHERE r.id = ? AND r.shared = 1
  `),
};

// ---- Helper functions -------------------------------------------------------

/** Create a user. Throws on duplicate email (UNIQUE constraint). */
export function createUser(email, passwordHash) {
  const info = stmts.insertUser.run(email, passwordHash);
  return getUserById(info.lastInsertRowid);
}

export function getUserByEmail(email) {
  return stmts.userByEmail.get(email);
}

export function getUserById(id) {
  return stmts.userById.get(id);
}

/** Store (or clear, with null) the user's own OpenRouter key. */
export function setOpenRouterKey(userId, key) {
  stmts.setKey.run(key ?? null, userId);
}

/** Current usage count for a user on a given day key (0 if none). */
export function getUsageCount(userId, day) {
  const row = stmts.getUsage.get(userId, day);
  return row ? row.count : 0;
}

/**
 * Atomically increment the day's usage iff still under `limit`.
 * Returns true if a slot was consumed, false if the limit was already hit.
 * Race-free: enforcement happens in the single conditional SQL write.
 */
export function tryIncrementUsage(userId, day, limit) {
  const row = stmts.tryIncrement.get({ userId, day, limit });
  return row !== undefined;
}

// ---- Projects / runs --------------------------------------------------------

/** Create a project for a user. Returns the row. */
export function createProject(userId, title) {
  return stmts.insertProject.get(userId, title);
}

/** Project row iff owned by userId, else undefined. */
export function getOwnedProject(userId, projectId) {
  return stmts.projectOwned.get(projectId, userId);
}

/** All projects for a user, newest activity first, with run_count. */
export function listProjectsForUser(userId) {
  return stmts.listProjects.all(userId);
}

/** A project + its runs (ascending), or null if not owned. */
export function getProjectWithRuns(userId, projectId) {
  const project = stmts.projectOwned.get(projectId, userId);
  if (!project) return null;
  return { project, runs: stmts.runsByProject.all(projectId) };
}

/** Rename a project. Returns true if a row was updated (i.e. owned). */
export function renameProject(userId, projectId, title) {
  return stmts.renameProject.run(title, projectId, userId).changes > 0;
}

/** Delete a project (cascades runs). Returns true if owned/removed. */
export function deleteProject(userId, projectId) {
  return stmts.deleteProject.run(projectId, userId).changes > 0;
}

/**
 * Append a run to a project and bump the project's updated_at, atomically.
 * @returns {{ run: object, version: number }} version = 1-based index in project
 */
export const addRun = db.transaction(
  (userId, projectId, { mode, role, model, original, resultJson }) => {
    const version = stmts.countRuns.get(projectId).n + 1;
    const run = stmts.insertRun.get({
      projectId,
      userId,
      mode,
      role,
      model: model ?? null,
      original,
      resultJson,
    });
    stmts.touchProject.run(projectId);
    return { run, version };
  }
);

// ---- Sharing / public showcase ---------------------------------------------

/** Toggle a run's public-share flag. Returns true if owned & updated. */
export function setRunShared(userId, runId, shared) {
  return stmts.setRunShared.run(shared ? 1 : 0, runId, userId).changes > 0;
}

/** All publicly-shared runs (newest first, capped), with project title. */
export function listSharedRuns() {
  return stmts.sharedList.all();
}

/** One shared run by id (only if still shared), with project title. */
export function getSharedRun(runId) {
  return stmts.sharedOne.get(runId);
}

export { db };
export default db;
