/**
 * backend/services/bookService.js
 * Business logic helpers for books and chapters.
 */

const { getDb } = require('../db/database');

/**
 * Get a book with all its chapters, ordered by position.
 */
function getBookWithChapters(bookId) {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return null;
  book.chapters = db.prepare(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY position ASC',
  ).all(bookId);
  return book;
}

/**
 * Recalculate total word count for a book from its chapters.
 */
function refreshWordCount(bookId) {
  const db = getDb();
  const result = db.prepare(`
    SELECT COALESCE(SUM(word_count), 0) as total FROM chapters WHERE book_id = ?
  `).get(bookId);
  db.prepare("UPDATE books SET word_count = ?, updated_at = datetime('now') WHERE id = ?")
    .run(result.total, bookId);
  return result.total;
}

/**
 * Count words in a string.
 */
function countWords(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Get all books for a workspace, with chapter count and word count.
 */
function getBooksForWorkspace(workspaceId) {
  const db = getDb();
  return db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM chapters WHERE book_id = b.id) as chapter_count
    FROM books b
    WHERE b.workspace_id = ?
    ORDER BY b.updated_at DESC
  `).all(workspaceId);
}

/**
 * Build a plain text representation of the book (used for AI context).
 */
function bookToContext(book, maxChars = 3000) {
  if (!book) return '';
  let text = `Title: ${book.title}\n`;
  if (book.genre) text += `Genre: ${book.genre}\n`;
  if (book.description) text += `Description: ${book.description}\n`;
  text += '\n';

  for (const ch of book.chapters || []) {
    const entry = `${ch.title}:\n${ch.content}\n\n`;
    if (text.length + entry.length > maxChars) break;
    text += entry;
  }

  return text.slice(0, maxChars);
}

module.exports = {
  getBookWithChapters,
  refreshWordCount,
  countWords,
  getBooksForWorkspace,
  bookToContext,
};
