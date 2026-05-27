/**
 * backend/routes/books.js
 * Book CRUD — full v4.1 data model (TEXT IDs, roadmap, frontMatter, number).
 */

'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { getDb } = require('../db/database');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function tryParse(s) { if (!s) return null; try { return JSON.parse(s); } catch { return s; } }
function toJson(v) { if (v == null) return null; return typeof v === 'string' ? v : JSON.stringify(v); }
function cw(t) { return t ? t.trim().split(/\s+/).filter(w => w.length > 0).length : 0; }

function fmt(row) {
  if (!row) return null;
  return {
    id:           row.id,
    workspace_id: row.workspace_id,
    title:        row.title,
    genre:        row.genre,
    description:  row.description,
    number:       row.number,
    roadmap:      tryParse(row.roadmap),
    front_matter: tryParse(row.front_matter),
    word_count:   row.word_count || 0,
    status:       row.status || 'draft',
    chapter_count: row.chapter_count || 0,
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  };
}

// ── GET /api/workspaces/:workspaceId/books ────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM chapters WHERE book_id = b.id) as chapter_count
      FROM books b
      WHERE b.workspace_id = ?
      ORDER BY b.number ASC, b.updated_at DESC
    `).all(req.params.workspaceId);
    res.json(rows.map(fmt));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/workspaces/:workspaceId/books ───────────────────────────────────
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const ws = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found.' });

    const { title, genre, description, number, roadmap, front_matter, status, id: clientId } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required.' });

    const id = clientId || uid();
    // Auto-number if not provided
    const maxNum = db.prepare('SELECT COALESCE(MAX(number),0) as m FROM books WHERE workspace_id = ?').get(req.params.workspaceId);
    const bookNum = number != null ? number : maxNum.m + 1;

    db.prepare(`
      INSERT OR REPLACE INTO books
        (id, workspace_id, title, genre, description, number, roadmap, front_matter, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, req.params.workspaceId, title.trim(), genre || null, description || null,
           bookNum, toJson(roadmap), toJson(front_matter), status || 'draft');

    res.status(201).json(fmt(db.prepare('SELECT * FROM books WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/books/:id ────────────────────────────────────────────────────────
function getBookById(req, res) {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Book not found.' });
    const book = fmt(row);
    book.chapters = db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC').all(row.id)
      .map(ch => fmtChapter(ch));
    res.json(book);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ── PUT /api/books/:id ────────────────────────────────────────────────────────
function updateBook(req, res) {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Book not found.' });

    const { title, genre, description, number, roadmap, front_matter, status } = req.body;
    db.prepare(`
      UPDATE books SET
        title        = COALESCE(?, title),
        genre        = COALESCE(?, genre),
        description  = ?,
        number       = COALESCE(?, number),
        roadmap      = ?,
        front_matter = ?,
        status       = COALESCE(?, status),
        updated_at   = datetime('now')
      WHERE id = ?
    `).run(
      title?.trim() || null,
      genre || null,
      description !== undefined ? (description || null) : row.description,
      number != null ? number : null,
      roadmap      !== undefined ? toJson(roadmap)      : row.roadmap,
      front_matter !== undefined ? toJson(front_matter) : row.front_matter,
      status || null,
      req.params.id,
    );
    res.json(fmt(db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// ── DELETE /api/books/:id ─────────────────────────────────────────────────────
function deleteBook(req, res) {
  try {
    const db = getDb();
    if (!db.prepare('SELECT id FROM books WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Book not found.' });
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

function fmtChapter(ch) {
  return {
    id:              ch.id,
    book_id:         ch.book_id,
    workspace_id:    ch.workspace_id,
    title:           ch.title,
    content:         ch.content,
    position:        ch.position,
    status:          ch.status,
    word_count:      ch.word_count,
    continuity_log:  ch.continuity_log,
    contradictions:  ch.contradictions,
    repair_attempts: ch.repair_attempts,
    generated_at:    ch.generated_at,
    created_at:      ch.created_at,
    updated_at:      ch.updated_at,
  };
}

module.exports = router;
module.exports.getBookById = getBookById;
module.exports.updateBook  = updateBook;
module.exports.deleteBook  = deleteBook;
