/**
 * backend/db/migrations/001_initial.js
 * Initial database schema.
 * Uses IF NOT EXISTS so it is safe to run on every startup.
 */

function runMigrations(db) {
  db.exec(`
    -- ── Workspaces ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS workspaces (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 0,
      export_path TEXT,
      ai_provider TEXT    NOT NULL DEFAULT 'auto',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Books ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS books (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title        TEXT    NOT NULL,
      genre        TEXT,
      description  TEXT,
      cover_notes  TEXT,
      word_count   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Chapters ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chapters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL DEFAULT 'Untitled Chapter',
      content    TEXT    NOT NULL DEFAULT '',
      position   INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Generation History ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS generation_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      book_id      INTEGER REFERENCES books(id) ON DELETE SET NULL,
      chapter_id   INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      type         TEXT    NOT NULL DEFAULT 'generate',
      prompt       TEXT    NOT NULL,
      result       TEXT    NOT NULL DEFAULT '',
      provider     TEXT    NOT NULL DEFAULT 'deepseek',
      model        TEXT,
      tokens_used  INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Settings (per workspace key-value store) ────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      value        TEXT,
      UNIQUE(workspace_id, key)
    );

    -- ── Indexes ─────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_books_workspace    ON books(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_book      ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_history_workspace  ON generation_history(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_settings_workspace ON settings(workspace_id);
  `);

  // Seed a default workspace if none exist
  const count = db.prepare('SELECT COUNT(*) as n FROM workspaces').get();
  if (count.n === 0) {
    db.prepare(`
      INSERT INTO workspaces (name, is_active, ai_provider)
      VALUES ('Default Workspace', 1, 'auto')
    `).run();
    console.log('[DB] Default workspace created.');
  }

  console.log('[DB] Migrations complete.');
}

module.exports = { runMigrations };
