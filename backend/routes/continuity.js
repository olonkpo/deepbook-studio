/**
 * backend/routes/continuity.js
 * CRUD for continuity facts and codex entries, chat conversations and messages.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function tryParse(s) { if (!s) return []; try { const r = JSON.parse(s); return Array.isArray(r) ? r : []; } catch { return []; } }
function toJson(v) { return v == null ? '[]' : (typeof v === 'string' ? v : JSON.stringify(v)); }

// ═══════════════════════════════════════════════════════════
// CONTINUITY FACTS
// ═══════════════════════════════════════════════════════════

// GET /api/workspaces/:wid/continuity
router.get('/workspaces/:wid/continuity', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM continuity_facts WHERE workspace_id = ? ORDER BY book_num ASC, chapter_num ASC').all(req.params.wid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:wid/continuity  (upsert single fact)
router.post('/workspaces/:wid/continuity', (req, res) => {
  try {
    const db = getDb();
    const { id: clientId, book_num, chapter_num, category, content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required.' });
    const id = clientId || uid();
    db.prepare(`
      INSERT OR REPLACE INTO continuity_facts (id, workspace_id, book_num, chapter_num, category, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.wid, book_num || 1, chapter_num || 1, category || 'character', content);
    res.status(201).json(db.prepare('SELECT * FROM continuity_facts WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:wid/continuity/batch  (upsert many facts at once)
router.post('/workspaces/:wid/continuity/batch', (req, res) => {
  try {
    const db   = getDb();
    const { facts } = req.body;
    if (!Array.isArray(facts)) return res.status(400).json({ error: 'facts must be an array.' });
    const ins = db.prepare(`
      INSERT OR REPLACE INTO continuity_facts (id, workspace_id, book_num, chapter_num, category, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const batch = db.transaction(items => items.forEach(f =>
      ins.run(f.id || uid(), req.params.wid, f.book_num || f.bookNum || 1,
              f.chapter_num || f.chapterNum || 1, f.category || 'character', f.content)
    ));
    batch(facts);
    res.json({ saved: facts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/workspaces/:wid/continuity  (delete all facts for workspace)
router.delete('/workspaces/:wid/continuity', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM continuity_facts WHERE workspace_id = ?').run(req.params.wid);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════
// CODEX ENTRIES
// ═══════════════════════════════════════════════════════════

function fmtCodex(row) {
  if (!row) return null;
  return {
    id:           row.id,
    workspace_id: row.workspace_id,
    type:         row.type,
    name:         row.name,
    aliases:      tryParse(row.aliases),
    tags:         tryParse(row.tags),
    description:  row.description || '',
    notes:        row.notes || '',
    fields:       tryParse(row.fields),
    created_at:   row.created_at,
    updated_at:   row.updated_at,
  };
}

// GET /api/workspaces/:wid/codex
router.get('/workspaces/:wid/codex', (req, res) => {
  try {
    const db = getDb();
    const { type } = req.query;
    const rows = type
      ? db.prepare('SELECT * FROM codex_entries WHERE workspace_id = ? AND type = ? ORDER BY name ASC').all(req.params.wid, type)
      : db.prepare('SELECT * FROM codex_entries WHERE workspace_id = ? ORDER BY type ASC, name ASC').all(req.params.wid);
    res.json(rows.map(fmtCodex));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:wid/codex
router.post('/workspaces/:wid/codex', (req, res) => {
  try {
    const db = getDb();
    const { id: clientId, type, name, aliases, tags, description, notes, fields } = req.body;
    const id = clientId || uid();
    db.prepare(`
      INSERT OR REPLACE INTO codex_entries
        (id, workspace_id, type, name, aliases, tags, description, notes, fields, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, req.params.wid, type || 'character', name || '', toJson(aliases), toJson(tags),
           description || '', notes || '', toJson(fields));
    res.status(201).json(fmtCodex(db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/codex/:id
router.put('/codex/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Codex entry not found.' });
    const { type, name, aliases, tags, description, notes, fields } = req.body;
    db.prepare(`
      UPDATE codex_entries SET
        type = COALESCE(?, type), name = COALESCE(?, name),
        aliases = ?, tags = ?, description = ?, notes = ?, fields = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(type || null, name || null,
           aliases  !== undefined ? toJson(aliases)  : row.aliases,
           tags     !== undefined ? toJson(tags)      : row.tags,
           description !== undefined ? description   : row.description,
           notes    !== undefined ? notes            : row.notes,
           fields   !== undefined ? toJson(fields)   : row.fields,
           req.params.id);
    res.json(fmtCodex(db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/codex/:id
router.delete('/codex/:id', (req, res) => {
  try {
    const db = getDb();
    if (!db.prepare('SELECT id FROM codex_entries WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Codex entry not found.' });
    }
    db.prepare('DELETE FROM codex_entries WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════
// CHAT CONVERSATIONS + MESSAGES
// ═══════════════════════════════════════════════════════════

// GET /api/workspaces/:wid/conversations
router.get('/workspaces/:wid/conversations', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM chat_conversations WHERE workspace_id = ? ORDER BY updated_at DESC').all(req.params.wid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces/:wid/conversations
router.post('/workspaces/:wid/conversations', (req, res) => {
  try {
    const db = getDb();
    const { id: clientId, title, last_preview } = req.body;
    const id = clientId || uid();
    db.prepare(`
      INSERT OR REPLACE INTO chat_conversations (id, workspace_id, title, last_preview, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(id, req.params.wid, title || 'New Chat', last_preview || null);
    res.status(201).json(db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conversations/:id
router.get('/conversations/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/conversations/:id
router.put('/conversations/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Conversation not found.' });
    const { title, last_preview } = req.body;
    db.prepare(`UPDATE chat_conversations SET title = ?, last_preview = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(title !== undefined ? title : row.title, last_preview !== undefined ? last_preview : row.last_preview, req.params.id);
    res.json(db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/conversations/:id  (also deletes messages via CASCADE)
router.delete('/conversations/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conversations/:id/messages
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/conversations/:id/messages
router.post('/conversations/:id/messages', (req, res) => {
  try {
    const db   = getDb();
    const conv = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    const { id: clientId, role, content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required.' });
    const id = clientId || uid();
    db.prepare(`
      INSERT OR REPLACE INTO chat_messages (id, conversation_id, workspace_id, role, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.params.id, conv.workspace_id, role || 'user', content);
    res.status(201).json(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
