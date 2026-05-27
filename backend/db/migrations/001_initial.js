/**
 * backend/db/migrations/001_initial.js
 * Full schema — rebuilt with TEXT primary keys and all v4.1-compatible columns.
 * Uses IF NOT EXISTS so it is safe to run on every startup.
 */

function runMigrations(db) {
  db.exec(`
    -- ── Workspaces (≈ v4.1 "projects") ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS workspaces (
      id           TEXT PRIMARY KEY,
      name         TEXT    NOT NULL DEFAULT 'Untitled',
      author_name  TEXT,
      genre        TEXT    DEFAULT 'cozy-mystery',
      mode         TEXT    DEFAULT 'series',
      status       TEXT    DEFAULT 'idle',
      series_plan  TEXT,                        -- JSON: {series_title, series_bible, bookRoadmaps}
      settings     TEXT,                        -- JSON: {dna, targetWordCount, autoRepair, chaptersPerBook}
      max_books    INTEGER DEFAULT 5,
      is_active    INTEGER NOT NULL DEFAULT 0,
      ai_provider  TEXT    NOT NULL DEFAULT 'auto',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Books ─────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS books (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title        TEXT NOT NULL DEFAULT 'Untitled Book',
      genre        TEXT,
      description  TEXT,
      number       INTEGER NOT NULL DEFAULT 1,
      roadmap      TEXT,          -- JSON: {chapters:[], case_lock, suspects, ...}
      front_matter TEXT,          -- JSON: {dedication, prologue, synopsis, ...}
      word_count   INTEGER NOT NULL DEFAULT 0,
      status       TEXT    NOT NULL DEFAULT 'draft',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Chapters ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chapters (
      id              TEXT PRIMARY KEY,
      book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title           TEXT NOT NULL DEFAULT 'Chapter 1',
      content         TEXT NOT NULL DEFAULT '',
      position        INTEGER NOT NULL DEFAULT 1,
      status          TEXT    NOT NULL DEFAULT 'draft',
      word_count      INTEGER NOT NULL DEFAULT 0,
      continuity_log  TEXT,
      contradictions  TEXT,
      repair_attempts INTEGER NOT NULL DEFAULT 0,
      generated_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Continuity Facts ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS continuity_facts (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      book_num     INTEGER NOT NULL,
      chapter_num  INTEGER NOT NULL,
      category     TEXT    NOT NULL DEFAULT 'character',
      content      TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Codex Entries ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS codex_entries (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      type         TEXT    NOT NULL DEFAULT 'character',
      name         TEXT    NOT NULL DEFAULT '',
      aliases      TEXT    DEFAULT '[]',   -- JSON array
      tags         TEXT    DEFAULT '[]',   -- JSON array
      description  TEXT    DEFAULT '',
      notes        TEXT    DEFAULT '',
      fields       TEXT    DEFAULT '[]',   -- JSON [{label,value}]
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Chat Conversations ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title        TEXT NOT NULL DEFAULT 'New Chat',
      last_preview TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Chat Messages ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS chat_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      role            TEXT NOT NULL DEFAULT 'user',
      content         TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Global Settings ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS global_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- ── Generation History ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS generation_history (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      book_id      TEXT REFERENCES books(id) ON DELETE SET NULL,
      chapter_id   TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      type         TEXT NOT NULL DEFAULT 'generate',
      prompt       TEXT NOT NULL,
      result       TEXT NOT NULL DEFAULT '',
      provider     TEXT NOT NULL DEFAULT 'deepseek',
      model        TEXT,
      tokens_used  INTEGER,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Indexes ───────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_books_workspace        ON books(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_books_number           ON books(workspace_id, number);
    CREATE INDEX IF NOT EXISTS idx_chapters_book          ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_workspace     ON chapters(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_continuity_workspace   ON continuity_facts(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_codex_workspace        ON codex_entries(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_codex_type             ON codex_entries(workspace_id, type);
    CREATE INDEX IF NOT EXISTS idx_chat_conv_workspace    ON chat_conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_chat_msg_conv          ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_history_workspace      ON generation_history(workspace_id);
  `);

  // Seed a default workspace if none exist
  const count = db.prepare('SELECT COUNT(*) as n FROM workspaces').get();
  if (count.n === 0) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    db.prepare(`
      INSERT INTO workspaces (id, name, is_active, ai_provider)
      VALUES (?, 'Default Workspace', 1, 'auto')
    `).run(id);
    console.log('[DB] Default workspace created.');
  }

  console.log('[DB] Migrations complete.');
}

module.exports = { runMigrations };
