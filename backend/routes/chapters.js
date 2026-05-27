/**
 * backend/routes/chapters.js
 * Full v4.1 chapter model: status, continuity_log, contradictions, repair_attempts, TEXT IDs.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function cw(t) { return t ? t.trim().split(/\s+/).filter(w => w.length > 0).length : 0; }

function fmt(ch) {
  if (!ch) return null;
  return {
    id:              ch.id,
    book_id:         ch.book_id,
    workspace_id:    ch.workspace_id,
    title:           ch.title,
    content:         ch.content,
    position:        ch.position,
    status:          ch.status   || 'draft',
    word_count:      ch.word_count || 0,
    continuity_log:  ch.continuity_log  || null,
    contradictions:  ch.contradictions  || null,
    repair_attempts: ch.repair_attempts || 0,
    generated_at:    ch.generated_at    || null,
    created_at:      ch.created_at,
    updated_at:      ch.updated_at,
  };
}

function refreshBookWordCount(db, bookId) {
  const r = db.prepare('SELECT COALESCE(SUM(word_count),0) as t FROM chapters WHERE book_id = ?').get(bookId);
  db.prepare("UPDATE books SET word_count = ?, updated_at = datetime('now') WHERE id = ?").run(r.t, bookId);
}

// ── GET /api/books/:bookId/chapters ──────────────────────────────────────────
router.get('/books/:bookId/chapters', (req, res) => {
  try {
    const db = getDb();
    if (!db.prepare('SELECT id FROM books WHERE id = ?').get(req.params.bookId)) {
      return res.status(404).json({ error: 'Book not found.' });
    }
    const rows = db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC').all(req.params.bookId);
    res.json(rows.map(fmt));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/workspaces/:workspaceId/chapters  (all chapters in workspace) ────
router.get('/workspaces/:workspaceId/chapters', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM chapters WHERE workspace_id = ? ORDER BY position ASC').all(req.params.workspaceId);
    res.json(rows.map(fmt));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/books/:bookId/chapters ─────────────────────────────────────────
router.post('/books/:bookId/chapters', (req, res) => {
  try {
    const db   = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    const {
      title = 'Untitled Chapter', content = '', position,
      status = 'draft', continuity_log, contradictions,
      repair_attempts = 0, generated_at, id: clientId,
    } = req.body;

    const id = clientId || uid();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position),-1) as m FROM chapters WHERE book_id = ?').get(req.params.bookId);
    const pos    = position != null ? position : maxPos.m + 1;
    const wc     = cw(content);

    db.prepare(`
      INSERT OR REPLACE INTO chapters
        (id, book_id, workspace_id, title, content, position, status, word_count,
         continuity_log, contradictions, repair_attempts, generated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, req.params.bookId, book.workspace_id, title.trim(), content, pos, status, wc,
           continuity_log || null, contradictions || null, repair_attempts, generated_at || null);

    refreshBookWordCount(db, req.params.bookId);
    res.status(201).json(fmt(db.prepare('SELECT * FROM chapters WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/chapters/:id ─────────────────────────────────────────────────────
router.get('/chapters/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Chapter not found.' });
    res.json(fmt(row));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/chapters/:id ─────────────────────────────────────────────────────
router.put('/chapters/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Chapter not found.' });

    const {
      title, content, position, status,
      continuity_log, contradictions, repair_attempts, generated_at,
    } = req.body;

    const newContent = content !== undefined ? content : row.content;
    const wc = cw(newContent);

    db.prepare(`
      UPDATE chapters SET
        title           = COALESCE(?, title),
        content         = ?,
        position        = COALESCE(?, position),
        status          = COALESCE(?, status),
        word_count      = ?,
        continuity_log  = ?,
        contradictions  = ?,
        repair_attempts = COALESCE(?, repair_attempts),
        generated_at    = COALESCE(?, generated_at),
        updated_at      = datetime('now')
      WHERE id = ?
    `).run(
      title?.trim() || null,
      newContent,
      position != null ? position : null,
      status || null,
      wc,
      continuity_log  !== undefined ? (continuity_log  || null) : row.continuity_log,
      contradictions  !== undefined ? (contradictions  || null) : row.contradictions,
      repair_attempts != null ? repair_attempts : null,
      generated_at || null,
      req.params.id,
    );

    refreshBookWordCount(db, row.book_id);
    res.json(fmt(db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/chapters/:id ──────────────────────────────────────────────────
router.delete('/chapters/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Chapter not found.' });
    db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.id);
    refreshBookWordCount(db, row.book_id);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/books/:bookId/chapters/reorder ──────────────────────────────────
router.post('/books/:bookId/chapters/reorder', (req, res) => {
  try {
    const db    = getDb();
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array.' });
    const reorder = db.transaction(ids => {
      ids.forEach((id, i) => db.prepare('UPDATE chapters SET position = ? WHERE id = ? AND book_id = ?').run(i, id, req.params.bookId));
    });
    reorder(order);
    res.json(db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC').all(req.params.bookId).map(fmt));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
