// Public showcase routes — **no auth**. Lets anyone browse resume/项目经验
// versions their authors explicitly chose to share. Privacy guard: ONLY the
// rewritten result is exposed — never the raw `original`, the owner's email,
// or any user id. Sharing is strictly opt-in per version (runs.shared).
import express from 'express';
import { listSharedRuns, getSharedRun } from './db.js';

const router = express.Router();

const ROLE_LABEL = {
  frontend: '前端工程师',
  fullstack: '全栈工程师',
  ai: 'AI 应用工程师',
};
const MODE_LABEL = { auto: '快速重写', review: '精修诊断' };

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A short, privacy-safe teaser for the showcase grid. */
function teaser(result) {
  if (!result) return '';
  if (typeof result.summary === 'string' && result.summary.trim()) {
    return result.summary.trim().slice(0, 160);
  }
  if (typeof result.verdict === 'string') {
    return result.verdict.trim().slice(0, 160);
  }
  return '';
}

// ---- GET /api/public/showcase — list shared versions (no bodies) ----
router.get('/showcase', (_req, res) => {
  const items = listSharedRuns().map((r) => {
    const result = safeParse(r.result_json);
    const segCount = Array.isArray(result?.segments)
      ? result.segments.length
      : 0;
    return {
      id: r.id,
      title: r.title,
      role: r.role,
      roleLabel: ROLE_LABEL[r.role] ?? r.role,
      mode: r.mode,
      modeLabel: MODE_LABEL[r.mode] ?? r.mode,
      teaser: teaser(result),
      segCount,
      hasKnowledge: Array.isArray(result?.knowledge)
        ? result.knowledge.length > 0
        : false,
      hasMindmap: Boolean(result?.mindmap?.phases?.length),
      createdAt: r.created_at,
    };
  });
  res.json({ items });
});

// ---- GET /api/public/showcase/:id — one shared version (rewritten only) ----
router.get('/showcase/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const row = getSharedRun(id);
  if (!row) {
    // Either never shared or un-shared since — treat the same (don't leak).
    return res.status(404).json({ error: '该分享不存在或已被作者取消分享' });
  }
  const result = safeParse(row.result_json);
  if (!result) {
    return res.status(404).json({ error: '该分享内容已损坏' });
  }
  res.json({
    item: {
      id: row.id,
      title: row.title,
      role: row.role,
      roleLabel: ROLE_LABEL[row.role] ?? row.role,
      mode: row.mode,
      modeLabel: MODE_LABEL[row.mode] ?? row.mode,
      createdAt: row.created_at,
      // Privacy: result ONLY. No `original`, no owner identity.
      result,
    },
  });
});

export default router;
