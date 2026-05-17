// Project history routes — all Bearer-protected, all ownership-scoped.
// A project groups multiple rewrite "runs" (versions) the user iterates on.
import express from 'express';
import { requireAuth } from './auth.js';
import {
  listProjectsForUser,
  getProjectWithRuns,
  renameProject,
  deleteProject,
} from './db.js';

const router = express.Router();

const MAX_TITLE = 80;

/** Shape a runs row for the client: parse result_json, expose version index. */
function publicRun(row, idx) {
  let result = null;
  try {
    result = JSON.parse(row.result_json);
  } catch {
    result = null;
  }
  return {
    id: row.id,
    version: idx + 1,
    mode: row.mode,
    role: row.role,
    model: row.model,
    original: row.original,
    result,
    createdAt: row.created_at,
  };
}

// ---- GET /api/projects — list (no run bodies, just summaries) ----
router.get('/', requireAuth, (req, res) => {
  const rows = listProjectsForUser(req.user.id);
  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      title: p.title,
      runCount: p.run_count,
      lastRole: p.last_role,
      lastMode: p.last_mode,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
  });
});

// ---- GET /api/projects/:id — project + all runs (versions) ----
router.get('/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  const data = getProjectWithRuns(req.user.id, id);
  if (!data) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({
    project: {
      id: data.project.id,
      title: data.project.title,
      createdAt: data.project.created_at,
      updatedAt: data.project.updated_at,
    },
    runs: data.runs.map(publicRun),
  });
});

// ---- PATCH /api/projects/:id — rename ----
router.patch('/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  const { title } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) {
    return res.status(400).json({
      error: `title must be a non-empty string ≤ ${MAX_TITLE} chars`,
    });
  }
  if (!renameProject(req.user.id, id, title.trim())) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({ ok: true });
});

// ---- DELETE /api/projects/:id — remove (cascades runs) ----
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  if (!deleteProject(req.user.id, id)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({ ok: true });
});

export default router;
