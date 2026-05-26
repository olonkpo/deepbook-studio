/**
 * backend/routes/chapters.js
 * Chapter CRUD within a book.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// Helper: recalculate and update book word count
function updateBookWordCount(db, bookId) {
  const result = db.prepare(`
    SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE book_id = ?
  `).get(bookId);
  db.prepare(`
    UPDATE books SET word_count = ?, updated_at = datetime('now') WHERE id = ?
  `).run(result.total, bookId);
}

// Helper: count words in text
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// GET /api/books/:bookId/chapters
router.get('/books/:bookId/chapters', (req, res) => {
  try {
    const db = getDb();
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    const chapters = db.prepare(`
      SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC
    `).all(req.params.bookId);
    res.json(chapters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/books/:bookId/chapters
router.post('/books/:bookId/chapters', (req, res) => {
  const { title = 'Untitled Chapter', content = '', position } = req.body;
  try {
    const db = getDb();
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(req.params.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    // Auto-assign position if not provided
    const maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), -1) as m FROM chapters WHERE book_id = ?
    `).get(req.params.bookId);
    const pos = (position !== undefined) ? position : maxPos.m + 1;
    const words = countWords(content);

    const result = db.prepare(`
      INSERT INTO chapters (book_id, title, content, position, word_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.bookId, title.trim(), content, pos, words);

    updateBookWordCount(db, req.params.bookId);

    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(chapter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chapters/:id
router.get('/chapters/:id', (req, res) => {
  try {
    const db = getDb();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found.' });
    res.json(chapter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chapters/:id
router.put('/chapters/:id', (req, res) => {
  const { title, content, position } = req.body;
  try {
    const db = getDb();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found.' });

    const newContent = content !== undefined ? content : chapter.content;
    const words = countWords(newContent);

    db.prepare(`
      UPDATE chapters
      SET title = ?, content = ?, position = ?, word_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title?.trim()    || chapter.title,
      newContent,
      position !== undefined ? position : chapter.position,
      words,
      req.params.id,
    );

    updateBookWordCount(db, chapter.book_id);

    const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chapters/:id
router.delete('/chapters/:id', (req, res) => {
  try {
    const db = getDb();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found.' });

    db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.id);
    updateBookWordCount(db, chapter.book_id);

    res.json({ success: true, message: 'Chapter deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/books/:bookId/chapters/reorder — reorder chapters by array of IDs
router.post('/books/:bookId/chapters/reorder', (req, res) => {
  const { order } = req.body; // Array of chapter IDs in desired order
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of chapter IDs.' });
  }
  try {
    const db = getDb();
    const reorder = db.transaction(ids => {
      ids.forEach((id, index) => {
        db.prepare('UPDATE chapters SET position = ? WHERE id = ? AND book_id = ?')
          .run(index, id, req.params.bookId);
      });
    });
    reorder(order);
    const chapters = db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC')
      .all(req.params.bookId);
    res.json(chapters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
