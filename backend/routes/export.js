/**
 * backend/routes/export.js
 * Export a book to .docx, .pdf, or .txt
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const exportService = require('../services/exportService');

// Helper: fetch a book with all chapters
function getBookWithChapters(db, bookId) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return null;
  book.chapters = db.prepare(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC',
  ).all(bookId);
  return book;
}

// POST /api/export/docx
router.post('/docx', async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId is required.' });

  try {
    const db = getDb();
    const book = getBookWithChapters(db, bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    const buffer = await exportService.toDocx(book);

    const filename = `${sanitizeFilename(book.title)}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[Export DOCX]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export/pdf
router.post('/pdf', async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId is required.' });

  try {
    const db = getDb();
    const book = getBookWithChapters(db, bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    const buffer = await exportService.toPdf(book);

    const filename = `${sanitizeFilename(book.title)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[Export PDF]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export/txt
router.post('/txt', async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId is required.' });

  try {
    const db = getDb();
    const book = getBookWithChapters(db, bookId);
    if (!book) return res.status(404).json({ error: 'Book not found.' });

    const text = exportService.toTxt(book);

    const filename = `${sanitizeFilename(book.title)}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeFilename(name) {
  return (name || 'book').replace(/[^a-z0-9_\-\s]/gi, '').replace(/\s+/g, '_').slice(0, 100);
}

module.exports = router;
