/**
 * backend/routes/workspaces.js
 * CRUD for workspaces (= v4.1 "projects").
 * TEXT primary keys, full v4.1 data model support.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function tryParse(str) {
  if (str == null) return null;
  try { return JSON.parse(str); } catch { return str; }
}
function toJson(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}
function formatWs(row) {
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    author_name: row.author_name || '',
    genre:       row.genre       || 'cozy-mystery',
    mode:        row.mode        || 'series',
    status:      row.status      || 'idle',
    series_plan: tryParse(row.series_plan),
    settings:    tryParse(row.settings) || {},
    max_books:   row.max_books   || 5,
    is_active:   Boolean(row.is_active),
    ai_provider: row.ai_provider || 'auto',
    book_count:  row.book_count  || 0,
    chapter_count: row.chapter_count || 0,
    created_at:  row.created_at,
    updated_at:  row.updated_at,
  };
}

// ── GET /api/workspaces ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM books    WHERE workspace_id = w.id) as book_count,
        (SELECT COUNT(*) FROM chapters WHERE workspace_id = w.id) as chapter_count
      FROM workspaces w ORDER BY w.updated_at DESC
    `).all();
    res.json(rows.map(formatWs));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/workspaces ───────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, author_name, genre, mode, targetWordCount, max_books, id: clientId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });
    const id = clientId || uid();
    const settings = JSON.stringify({
      targetWordCount: targetWordCount || 3000,
      autoRepair: true,
      chaptersPerBook: 15,
      dna: '',
    });
    db.prepare(`
      INSERT OR REPLACE INTO workspaces
        (id, name, author_name, genre, mode, status, settings, max_books, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, 0, datetime('now'))
    `).run(id, name.trim(), author_name || null, genre || 'cozy-mystery', mode || 'series', settings, max_books || 5);
    res.status(201).json(formatWs(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/workspaces/active ────────────────────────────────────────────────
router.get('/active', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
    if (!row) return res.status(404).json({ error: 'No active workspace.' });
    res.json(formatWs(row));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/workspaces/active/current ────────────────────────────────────────
router.get('/active/current', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
    if (!row) return res.status(404).json({ error: 'No active workspace.' });
    res.json(formatWs(row));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/workspaces/:id ───────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workspace not found.' });
    res.json(formatWs(row));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/workspaces/:id ───────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workspace not found.' });

    const { name, author_name, genre, mode, status, series_plan, settings, max_books, ai_provider } = req.body;

    db.prepare(`
      UPDATE workspaces SET
        name        = COALESCE(?, name),
        author_name = ?,
        genre       = COALESCE(?, genre),
        mode        = COALESCE(?, mode),
        status      = COALESCE(?, status),
        series_plan = ?,
        settings    = ?,
        max_books   = COALESCE(?, max_books),
        ai_provider = COALESCE(?, ai_provider),
        updated_at  = datetime('now')
      WHERE id = ?
    `).run(
      name?.trim() || null,
      author_name !== undefined ? (author_name || null) : row.author_name,
      genre   || null,
      mode    || null,
      status  || null,
      series_plan !== undefined ? toJson(series_plan) : row.series_plan,
      settings    !== undefined ? toJson(settings)    : row.settings,
      max_books != null ? max_books : null,
      ai_provider || null,
      req.params.id,
    );

    res.json(formatWs(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/workspaces/:id/switch ──────────────────────────────────────────
router.post('/:id/switch', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workspace not found.' });
    db.prepare('UPDATE workspaces SET is_active = 0').run();
    db.prepare("UPDATE workspaces SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json(formatWs(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/workspaces/:id ────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const db    = getDb();
    const count = db.prepare('SELECT COUNT(*) as n FROM workspaces').get();
    if (count.n <= 1) return res.status(400).json({ error: 'Cannot delete the last workspace.' });
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Workspace not found.' });
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
    if (row.is_active) {
      const next = db.prepare("SELECT id FROM workspaces ORDER BY updated_at DESC LIMIT 1").get();
      if (next) db.prepare("UPDATE workspaces SET is_active = 1 WHERE id = ?").run(next.id);
    }
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
