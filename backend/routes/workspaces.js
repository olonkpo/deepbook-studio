/**
 * backend/routes/workspaces.js
 * Workspace CRUD + active workspace switching.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/workspaces — list all workspaces
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all();
    res.json(workspaces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workspaces — create a new workspace
router.post('/', (req, res) => {
  const { name, ai_provider = 'auto', export_path } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Workspace name is required.' });
  }
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO workspaces (name, ai_provider, export_path)
      VALUES (?, ?, ?)
    `).run(name.trim(), ai_provider, export_path || null);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(workspace);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/:id — get a single workspace with its settings
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

    // Attach settings as a flat object
    const settingsRows = db.prepare('SELECT key, value FROM settings WHERE workspace_id = ?').all(req.params.id);
    workspace.settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/workspaces/:id — update workspace name / provider / export path
router.put('/:id', (req, res) => {
  const { name, ai_provider, export_path } = req.body;
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Workspace not found.' });

    db.prepare(`
      UPDATE workspaces
      SET name = ?, ai_provider = ?, export_path = ?
      WHERE id = ?
    `).run(
      name?.trim() || existing.name,
      ai_provider || existing.ai_provider,
      export_path !== undefined ? export_path : existing.export_path,
      req.params.id,
    );

    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/workspaces/:id — delete workspace (cascades to books, chapters, history, settings)
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

    // Prevent deleting the last workspace
    const total = db.prepare('SELECT COUNT(*) as n FROM workspaces').get();
    if (total.n <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last workspace.' });
    }

    // If deleting the active workspace, activate the next one
    if (workspace.is_active) {
      const next = db.prepare('SELECT id FROM workspaces WHERE id != ? LIMIT 1').get(req.params.id);
      if (next) {
        db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(next.id);
      }
    }

    db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Workspace deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workspaces/:id/switch — set as active workspace
router.post('/:id/switch', (req, res) => {
  try {
    const db = getDb();
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });

    // Deactivate all, then activate the target
    const switchWorkspace = db.transaction(id => {
      db.prepare('UPDATE workspaces SET is_active = 0').run();
      db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(id);
    });
    switchWorkspace(req.params.id);

    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workspaces/active — get the currently active workspace
router.get('/active/current', (req, res) => {
  try {
    const db = getDb();
    const workspace = db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
    if (!workspace) return res.status(404).json({ error: 'No active workspace found.' });
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
