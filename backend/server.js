/**
 * backend/server.js
 * Express API server — entry point.
 * Runs on localhost:3001 and serves both the API and the frontend static files.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: `http://localhost:${PORT}` }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── Health check (used by Electron to know backend is ready) ─────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
// Uncomment each route as it is built in Phase 2:
// app.use('/api/workspaces', require('./routes/workspaces'));
// app.use('/api/books',      require('./routes/books'));
// app.use('/api/chapters',   require('./routes/chapters'));
// app.use('/api/ai',         require('./routes/ai'));
// app.use('/api/export',     require('./routes/export'));
// app.use('/api/settings',   require('./routes/settings'));

// ── 404 handler for unknown API routes ───────────────────────────────────────
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ── SPA fallback — serve index.html for all non-API routes ───────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Backend] DeepBook Studio API running on http://localhost:${PORT}`);
  console.log(`[Backend] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
