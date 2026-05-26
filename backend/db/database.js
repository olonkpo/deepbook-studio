/**
 * backend/db/database.js
 * SQLite connection and initialisation.
 * Creates the database file in the OS user-data folder (production)
 * or in the project root (development).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrations/001_initial');

let db = null;

function getDbPath() {
  if (process.env.NODE_ENV === 'production') {
    // In production the Electron main process sets APPDATA_PATH
    const base = process.env.APPDATA_PATH || require('os').homedir();
    const dir = path.join(base, 'DeepBook Studio');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'deepbook.db');
  }
  // Development: store next to the backend folder
  return path.join(__dirname, '..', '..', 'deepbook.dev.db');
}

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);

    // Performance settings
    db.pragma('journal_mode = WAL');   // Write-Ahead Logging — faster concurrent reads
    db.pragma('foreign_keys = ON');    // Enforce referential integrity
    db.pragma('synchronous = NORMAL'); // Safe and faster than FULL

    // Run migrations on every startup (idempotent)
    runMigrations(db);

    console.log(`[DB] Connected: ${dbPath}`);
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Connection closed.');
  }
}

module.exports = { getDb, closeDb };
