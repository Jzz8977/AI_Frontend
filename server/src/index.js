// Express app entrypoint. Loads env, mounts routes, CORS, JSON body limit.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './auth.js';
import rewriteRouter from './rewrite.js';
import orchestrateRouter from './orchestrate.js';
import projectsRouter from './projects.js';
import './db.js'; // ensures tables are created at boot

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- Health ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'resume-rewriter-server', time: new Date().toISOString() });
});

// ---- Routes ----
app.use('/api/auth', authRouter);
app.use('/api/rewrite', rewriteRouter);
app.use('/api/orchestrate', orchestrateRouter);
app.use('/api/projects', projectsRouter);

// ---- 404 fallback ----
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ---- Centralized error handler (always JSON) ----
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (limit 1mb)' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`resume-rewriter-server listening on http://localhost:${PORT}`);
});

export default app;
