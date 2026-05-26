/**
 * backend/routes/books.js
 * Book CRUD — scoped to a workspace.
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :workspaceId
const { getDb } = require('../db/database');

// GET /api/workspaces/:workspaceId/books
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const books = db.prepare(`
      SELECT * FROM books
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `).all(req.params.workspaceId);
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workspaces/:workspaceId/books
router.post('/', (req, res) => {
  const { title, genre, description, cover_notes } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Book title is required.' });
  }
  try {
    const db = getDb();
    // Verify workspace exists
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(req.params.workspaceId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

    const result = db.prepare(`
      INSERT INTO books (workspace_id, title, genre, description, cover_notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.workspaceId, title.trim(), genre || null, description || null, cover_notes || null);

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/books/:id (mounted separately in server.js)
// — returns book with all chapters
function getBookById(req, res) {
  try {
    const db = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    book.chapters = db.prepare(`
      SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC
    `).all(book.id);

    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/books/:id
function updateBook(req, res) {
  const { title, genre, description, cover_notes } = req.body;
  try {
    const db = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    db.prepare(`
      UPDATE books
      SET title = ?, genre = ?, description = ?, cover_notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title?.trim()   || book.title,
      genre           !== undefined ? genre        : book.genre,
      description     !== undefined ? description  : book.description,
      cover_notes     !== undefined ? cover_notes  : book.cover_notes,
      req.params.id,
    );

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/books/:id
function deleteBook(req, res) {
  try {
    const db = getDb();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Book deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/book/:id',    getBookById);
router.put('/book/:id',    updateBook);
router.delete('/book/:id', deleteBook);

module.exports = router;
module.exports.getBookById = getBookById;
module.exports.updateBook  = updateBook;
module.exports.deleteBook  = deleteBook;
