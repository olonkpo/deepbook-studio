/**
 * frontend/js/db.js
 * DB abstraction layer — maps v4.1's IndexedDB API surface to backend REST calls.
 *
 * Exposes the same interface as the old DB module:
 *   DB.get(store, key)
 *   DB.getAll(store)
 *   DB.put(store, obj)
 *   DB.del(store, key)
 *   DB.getByIndex(store, index, value)
 *   DB.delByIndex(store, index, value)
 *   DB.getSetting(key, default)
 *   DB.setSetting(key, value)
 *
 * Store name mapping (v4.1 → backend):
 *   projects          → /api/workspaces
 *   books             → /api/workspaces/:wid/books
 *   chapters          → /api/books/:bookId/chapters
 *   continuityFacts   → /api/workspaces/:wid/continuity
 *   codexEntries      → /api/workspaces/:wid/codex
 *   chatConversations → /api/workspaces/:wid/conversations
 *   chatMessages      → /api/conversations/:cid/messages
 *   globalSettings    → /api/settings
 */
'use strict';

// Simple in-memory cache so we don't re-fetch on every render call.
// Invalidated on any write.
const _cache = {
  data: {},
  get(key)        { return this.data[key]; },
  set(key, val)   { this.data[key] = val; },
  del(key)        { delete this.data[key]; },
  clear()         { this.data = {}; },
  clearPrefix(p)  { Object.keys(this.data).filter(k => k.startsWith(p)).forEach(k => delete this.data[k]); },
};

// ── Workspace ID helper — the active workspace is cached after first load ──
let _activeWorkspaceId = null;

async function _getActiveWorkspaceId() {
  if (_activeWorkspaceId) return _activeWorkspaceId;
  const list = await api.workspaces.list();
  const active = list.find(w => w.is_active) || list[0];
  if (!active) throw new Error('No workspace found.');
  _activeWorkspaceId = active.id;
  return _activeWorkspaceId;
}

// ── Store router: knows how to GET / PUT / DELETE each v4.1 store name ──
const _storeHandlers = {

  // ── PROJECTS (=workspaces) ──────────────────────────────────────────────────
  projects: {
    async getAll() {
      const cacheKey = 'projects:all';
      if (_cache.get(cacheKey)) return _cache.get(cacheKey);
      const list = await api.workspaces.list();
      const normed = list.map(_normalizeProject);
      _cache.set(cacheKey, normed);
      return normed;
    },
    async get(id) {
      const cacheKey = `projects:${id}`;
      if (_cache.get(cacheKey)) return _cache.get(cacheKey);
      const ws = await api.workspaces.get(id);
      const np = _normalizeProject(ws);
      _cache.set(cacheKey, np);
      return np;
    },
    async put(obj) {
      let result;
      // Map v4.1 field names → backend field names
      const payload = {
        id:          obj.id,
        name:        obj.title || obj.name,
        author_name: obj.authorName || obj.author_name,
        genre:       obj.genre,
        mode:        obj.mode || 'series',
        status:      obj.status || 'idle',
        series_plan: obj.seriesPlan || obj.series_plan || null,
        settings:    obj.settings || {},
        max_books:   obj.maxBooks   || obj.max_books   || 5,
        ai_provider: obj.ai_provider || 'auto',
      };
      // If the workspace already exists, update; otherwise create
      try {
        result = await api.workspaces.update(obj.id, payload);
      } catch (e) {
        result = await api.workspaces.create(payload);
      }
      _cache.del(`projects:${obj.id}`);
      _cache.del('projects:all');
      return result;
    },
    async del(id) {
      await api.workspaces.delete(id);
      _cache.del(`projects:${id}`);
      _cache.del('projects:all');
    },
  },

  // ── BOOKS ───────────────────────────────────────────────────────────────────
  books: {
    async getAll() {
      // Get all books across all workspaces — used by v4.1's getAll('books')
      const wid = await _getActiveWorkspaceId();
      const cacheKey = `books:all:${wid}`;
      if (_cache.get(cacheKey)) return _cache.get(cacheKey);
      const list = await api.books.list(wid);
      _cache.set(cacheKey, list.map(_normalizeBook));
      return _cache.get(cacheKey);
    },
    async get(id) {
      const cacheKey = `books:${id}`;
      if (_cache.get(cacheKey)) return _cache.get(cacheKey);
      const b = await api.books.get(id);
      const nb = _normalizeBook(b);
      _cache.set(cacheKey, nb);
      return nb;
    },
    async put(obj) {
      const wid = obj.projectId || obj.workspace_id || await _getActiveWorkspaceId();
      const payload = {
        id:          obj.id,
        title:       obj.title || 'Untitled Book',
        genre:       obj.genre,
        description: obj.description,
        number:      obj.number,
        roadmap:     obj.roadmap || null,
        front_matter: obj.frontMatter || obj.front_matter || null,
        status:      obj.status || 'planning',
        word_count:  obj.wordCount || obj.word_count || 0,
      };
      // Try update first (book already exists), fall back to create
      let result;
      if (obj.id) {
        try {
          result = await api.books.update(obj.id, payload);
        } catch (_) {
          result = await api.books.create(wid, payload);
        }
      } else {
        result = await api.books.create(wid, payload);
      }
      _cache.del(`books:${obj.id}`);
      _cache.clearPrefix(`books:all`);
      _cache.clearPrefix(`books:by_project:${wid}`);
      return _normalizeBook(result);
    },
    async del(id) {
      await api.books.delete(id);
      _cache.del(`books:${id}`);
      _cache.clearPrefix('books:all');
      _cache.clearPrefix('books:by_project');
    },
    // Index lookups
    async getByIndex(idx, val) {
      if (idx === 'by_project') {
        const cacheKey = `books:by_project:${val}`;
        if (_cache.get(cacheKey)) return _cache.get(cacheKey);
        const list = await api.books.list(val);
        const normed = list.map(_normalizeBook);
        _cache.set(cacheKey, normed);
        return normed;
      }
      throw new Error(`Unknown book index: ${idx}`);
    },
    async delByIndex(idx, val) {
      if (idx === 'by_project') {
        const list = await api.books.list(val);
        await Promise.all(list.map(b => api.books.delete(b.id)));
        _cache.clearPrefix('books:');
        return;
      }
      throw new Error(`Unknown book index: ${idx}`);
    },
  },

  // ── CHAPTERS ────────────────────────────────────────────────────────────────
  chapters: {
    async getAll() {
      const wid = await _getActiveWorkspaceId();
      const list = await api.chapters.listByWorkspace(wid);
      return list.map(_normalizeChapter);
    },
    async get(id) {
      const cacheKey = `chapters:${id}`;
      if (_cache.get(cacheKey)) return _cache.get(cacheKey);
      const ch = await api.chapters.get(id);
      const nc = _normalizeChapter(ch);
      _cache.set(cacheKey, nc);
      return nc;
    },
    async put(obj) {
      const bookId = obj.bookId || obj.book_id;
      if (!bookId) throw new Error('chapter.put: bookId required');
      const payload = {
        id:              obj.id,
        title:           obj.title || 'Untitled Chapter',
        content:         obj.content || '',
        position:        obj.number != null ? obj.number - 1 : obj.position,
        status:          obj.status || 'draft',
        continuity_log:  obj.continuityLog || obj.continuity_log || null,
        contradictions:  obj.contradictions || null,
        repair_attempts: obj.repairAttempts || obj.repair_attempts || 0,
        generated_at:    obj.generatedAt || obj.generated_at || null,
      };
      const result = await api.chapters.create(bookId, payload);
      _cache.del(`chapters:${obj.id}`);
      _cache.clearPrefix(`chapters:by_book:${bookId}`);
      _cache.clearPrefix(`chapters:by_project`);
      return _normalizeChapter(result);
    },
    async del(id) {
      const ch = await api.chapters.get(id).catch(() => null);
      await api.chapters.delete(id);
      _cache.del(`chapters:${id}`);
      if (ch) _cache.clearPrefix(`chapters:by_book:${ch.book_id}`);
      _cache.clearPrefix('chapters:by_project');
    },
    async getByIndex(idx, val) {
      if (idx === 'by_book' || idx === 'by_book_num') {
        const cacheKey = `chapters:by_book:${val}`;
        if (_cache.get(cacheKey)) return _cache.get(cacheKey);
        const list = await api.chapters.listByBook(val);
        const normed = list.map(_normalizeChapter);
        _cache.set(cacheKey, normed);
        return normed;
      }
      if (idx === 'by_project') {
        const cacheKey = `chapters:by_project:${val}`;
        if (_cache.get(cacheKey)) return _cache.get(cacheKey);
        const list = await api.chapters.listByWorkspace(val);
        const normed = list.map(_normalizeChapter);
        _cache.set(cacheKey, normed);
        return normed;
      }
      throw new Error(`Unknown chapter index: ${idx}`);
    },
    async delByIndex(idx, val) {
      if (idx === 'by_book') {
        const list = await api.chapters.listByBook(val);
        await Promise.all(list.map(c => api.chapters.delete(c.id)));
        _cache.clearPrefix('chapters:');
        return;
      }
      if (idx === 'by_project') {
        const books = await api.books.list(val);
        for (const b of books) {
          const chaps = await api.chapters.listByBook(b.id);
          await Promise.all(chaps.map(c => api.chapters.delete(c.id)));
        }
        _cache.clearPrefix('chapters:');
        return;
      }
      throw new Error(`Unknown chapter index: ${idx}`);
    },
  },

  // ── CONTINUITY FACTS ────────────────────────────────────────────────────────
  continuityFacts: {
    async getAll() {
      const wid = await _getActiveWorkspaceId();
      return api.continuity.list(wid);
    },
    async get(id) {
      // No single-fact endpoint — search in list
      const wid = await _getActiveWorkspaceId();
      const list = await api.continuity.list(wid);
      return list.find(f => f.id === id) || null;
    },
    async put(obj) {
      const wid = obj.projectId || obj.workspace_id || await _getActiveWorkspaceId();
      const payload = {
        id:          obj.id,
        book_num:    obj.bookNum  || obj.book_num  || 1,
        chapter_num: obj.chapterNum || obj.chapter_num || 1,
        category:    obj.category || 'character',
        content:     obj.content,
      };
      const result = await api.continuity.create(wid, payload);
      _cache.clearPrefix('continuity:');
      return result;
    },
    async del(id) {
      // No single-delete endpoint; skip silently
      _cache.clearPrefix('continuity:');
    },
    async getByIndex(idx, val) {
      if (idx === 'by_project' || idx === 'by_project_book') {
        const cacheKey = `continuity:${val}`;
        if (_cache.get(cacheKey)) return _cache.get(cacheKey);
        const list = await api.continuity.list(val);
        _cache.set(cacheKey, list);
        return list;
      }
      throw new Error(`Unknown continuityFacts index: ${idx}`);
    },
    async delByIndex(idx, val) {
      if (idx === 'by_project') {
        await api.continuity.deleteAll(val);
        _cache.clearPrefix('continuity:');
        return;
      }
      throw new Error(`Unknown continuityFacts index: ${idx}`);
    },
  },

  // ── CODEX ENTRIES ───────────────────────────────────────────────────────────
  codexEntries: {
    async getAll() {
      const wid = await _getActiveWorkspaceId();
      return api.codex.list(wid);
    },
    async get(id) {
      const wid = await _getActiveWorkspaceId();
      const list = await api.codex.list(wid);
      return list.find(e => e.id === id) || null;
    },
    async put(obj) {
      const wid = obj.projectId || obj.workspace_id || await _getActiveWorkspaceId();
      const payload = {
        id:          obj.id,
        type:        obj.type        || 'character',
        name:        obj.name        || '',
        aliases:     obj.aliases     || [],
        tags:        obj.tags        || [],
        description: obj.description || '',
        notes:       obj.notes       || '',
        fields:      obj.fields      || [],
      };
      let result;
      try {
        result = await api.codex.update(obj.id, payload);
      } catch {
        result = await api.codex.create(wid, payload);
      }
      _cache.clearPrefix('codex:');
      return result;
    },
    async del(id) {
      await api.codex.delete(id);
      _cache.clearPrefix('codex:');
    },
    async getByIndex(idx, val) {
      if (idx === 'by_project') {
        const cacheKey = `codex:${val}`;
        if (_cache.get(cacheKey)) return _cache.get(cacheKey);
        const list = await api.codex.list(val);
        _cache.set(cacheKey, list);
        return list;
      }
      if (idx === 'by_project_type') {
        // val is [projectId, type]
        const [wid, type] = Array.isArray(val) ? val : [val, null];
        const list = await api.codex.list(wid, type);
        return list;
      }
      throw new Error(`Unknown codexEntries index: ${idx}`);
    },
    async delByIndex(idx, val) {
      if (idx === 'by_project') {
        const list = await api.codex.list(val);
        await Promise.all(list.map(e => api.codex.delete(e.id)));
        _cache.clearPrefix('codex:');
        return;
      }
      throw new Error(`Unknown codexEntries index: ${idx}`);
    },
  },

  // ── CHAT CONVERSATIONS ──────────────────────────────────────────────────────
  chatConversations: {
    async getAll() {
      const wid = await _getActiveWorkspaceId();
      return api.chat.listConversations(wid);
    },
    async get(id) {
      return api.chat.getConversation(id);
    },
    async put(obj) {
      const wid = obj.projectId || obj.workspace_id || await _getActiveWorkspaceId();
      const payload = {
        id:           obj.id,
        title:        obj.title        || 'New Chat',
        last_preview: obj.last_preview || null,
      };
      let result;
      try {
        result = await api.chat.updateConversation(obj.id, payload);
      } catch {
        result = await api.chat.createConversation(wid, payload);
      }
      return result;
    },
    async del(id) {
      await api.chat.deleteConversation(id);
    },
    async getByIndex(idx, val) {
      if (idx === 'by_project') {
        return api.chat.listConversations(val);
      }
      throw new Error(`Unknown chatConversations index: ${idx}`);
    },
  },

  // ── CHAT MESSAGES ───────────────────────────────────────────────────────────
  chatMessages: {
    async getAll() {
      return []; // not used globally
    },
    async get(id) {
      return null; // not used
    },
    async put(obj) {
      const convId = obj.conversationId || obj.conversation_id;
      if (!convId) throw new Error('chatMessages.put: conversationId required');
      const payload = {
        id:      obj.id,
        role:    obj.role    || 'user',
        content: obj.content || '',
      };
      return api.chat.addMessage(convId, payload);
    },
    async del(id) {
      // No single-delete endpoint
    },
    async getByIndex(idx, val) {
      if (idx === 'by_conversation' || idx === 'by_conversation_time') {
        return api.chat.getMessages(val);
      }
      if (idx === 'by_project') {
        return []; // not commonly needed
      }
      throw new Error(`Unknown chatMessages index: ${idx}`);
    },
  },

  // ── GLOBAL SETTINGS ─────────────────────────────────────────────────────────
  globalSettings: {
    async getAll() {
      return api.settings.getAll();
    },
    async get(key) {
      const r = await api.settings.get(key);
      return r?.value != null ? { key, value: r.value } : null;
    },
    async put(obj) {
      await api.settings.update(obj.key, obj.value);
      return obj;
    },
    async del(key) {
      // no delete endpoint — set to null
      await api.settings.update(key, null);
    },
  },

  // ── JOB QUEUE (legacy) — maps to no-op ──────────────────────────────────────
  jobQueue: {
    async getAll()                  { return []; },
    async get()                     { return null; },
    async put(obj)                  { return obj; },
    async del()                     {},
    async getByIndex()              { return []; },
    async delByIndex()              {},
  },
};

// ── Field name normalisers ────────────────────────────────────────────────────

// Map backend workspace fields → v4.1 project field names
function _normalizeProject(p) {
  if (!p) return p;
  return {
    ...p,
    title:      p.name       || p.title,
    authorName: p.author_name || p.authorName || '',
    seriesPlan: p.series_plan || p.seriesPlan || null,
    maxBooks:   p.max_books  || p.maxBooks  || 5,
    createdAt:  p.created_at || p.createdAt || new Date().toISOString(),
    updatedAt:  p.updated_at || p.updatedAt || new Date().toISOString(),
  };
}

function _normalizeBook(b) {
  if (!b) return b;
  return {
    ...b,
    // v4.1 field names
    projectId:    b.workspace_id,
    number:       b.number,
    roadmap:      b.roadmap       || null,
    frontMatter:  b.front_matter  || null,
    wordCount:    b.word_count    || 0,
  };
}

function _normalizeChapter(c) {
  if (!c) return c;
  return {
    ...c,
    // v4.1 field names
    bookId:          c.book_id,
    projectId:       c.workspace_id,
    number:          (c.position != null ? c.position + 1 : c.number || 1),
    wordCount:       c.word_count    || 0,
    continuityLog:   c.continuity_log || null,
    repairAttempts:  c.repair_attempts || 0,
    generatedAt:     c.generated_at   || null,
  };
}

// ── Public DB API (identical surface to v4.1 IndexedDB module) ───────────────
const DB = {
  async init() { /* no-op in fullstack version */ },

  async get(store, key) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    return h.get(key);
  },

  async getAll(store) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    return h.getAll();
  },

  async put(store, obj) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    return h.put(obj);
  },

  async del(store, key) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    return h.del(key);
  },

  async getByIndex(store, idx, val) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    if (!h.getByIndex) throw new Error(`Store ${store} does not support getByIndex`);
    return h.getByIndex(idx, val);
  },

  async delByIndex(store, idx, val) {
    const h = _storeHandlers[store];
    if (!h) throw new Error(`Unknown store: ${store}`);
    if (!h.delByIndex) throw new Error(`Store ${store} does not support delByIndex`);
    return h.delByIndex(idx, val);
  },

  async getSetting(key, def = null) {
    try {
      const r = await api.settings.get(key);
      return r?.value != null ? r.value : def;
    } catch { return def; }
  },

  async setSetting(key, value) {
    await api.settings.update(key, value);
  },

  // Allow external code to set the active workspace ID (called from app.js after workspace switch)
  setActiveWorkspaceId(id) {
    _activeWorkspaceId = id;
    _cache.clear();
  },

  getActiveWorkspaceId() {
    return _activeWorkspaceId;
  },
};

window.DB = DB;
window._normalizeProject = _normalizeProject;
window._normalizeChapter = _normalizeChapter;
window._normalizeBook    = _normalizeBook;
