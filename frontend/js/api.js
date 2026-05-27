/**
 * frontend/js/api.js
 * Centralised REST API client — all fetch() calls to the backend go through here.
 */
'use strict';

const API_BASE = 'http://localhost:3001/api';

const api = {
  // ── Internal fetch wrapper ─────────────────────────────────────────────────
  async _request(method, path, body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== null) options.body = JSON.stringify(body);
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return response.json();
  },

  get:    (path)       => api._request('GET',    path),
  post:   (path, body) => api._request('POST',   path, body),
  put:    (path, body) => api._request('PUT',    path, body),
  delete: (path)       => api._request('DELETE', path),

  // ── Health ─────────────────────────────────────────────────────────────────
  health: () => api.get('/health'),

  // ── Workspaces ─────────────────────────────────────────────────────────────
  workspaces: {
    list:   ()         => api.get('/workspaces'),
    create: (data)     => api.post('/workspaces', data),
    get:    (id)       => api.get(`/workspaces/${id}`),
    update: (id, data) => api.put(`/workspaces/${id}`, data),
    delete: (id)       => api.delete(`/workspaces/${id}`),
    switch: (id)       => api.post(`/workspaces/${id}/switch`),
  },

  // ── Books ──────────────────────────────────────────────────────────────────
  books: {
    list:   (wid)       => api.get(`/workspaces/${wid}/books`),
    create: (wid, data) => api.post(`/workspaces/${wid}/books`, data),
    get:    (id)        => api.get(`/books/${id}`),
    update: (id, data)  => api.put(`/books/${id}`, data),
    delete: (id)        => api.delete(`/books/${id}`),
  },

  // ── Chapters ───────────────────────────────────────────────────────────────
  chapters: {
    listByBook:      (bookId) => api.get(`/books/${bookId}/chapters`),
    listByWorkspace: (wid)    => api.get(`/workspaces/${wid}/chapters`),
    create:  (bookId, data)   => api.post(`/books/${bookId}/chapters`, data),
    get:     (id)             => api.get(`/chapters/${id}`),
    update:  (id, data)       => api.put(`/chapters/${id}`, data),
    delete:  (id)             => api.delete(`/chapters/${id}`),
    reorder: (bookId, order)  => api.post(`/books/${bookId}/chapters/reorder`, { order }),
  },

  // ── Continuity Facts ───────────────────────────────────────────────────────
  continuity: {
    list:       (wid)         => api.get(`/workspaces/${wid}/continuity`),
    create:     (wid, data)   => api.post(`/workspaces/${wid}/continuity`, data),
    batch:      (wid, facts)  => api.post(`/workspaces/${wid}/continuity/batch`, { facts }),
    deleteAll:  (wid)         => api.delete(`/workspaces/${wid}/continuity`),
  },

  // ── Codex ──────────────────────────────────────────────────────────────────
  codex: {
    list:   (wid, type)  => api.get(`/workspaces/${wid}/codex${type ? '?type=' + type : ''}`),
    create: (wid, data)  => api.post(`/workspaces/${wid}/codex`, data),
    update: (id, data)   => api.put(`/codex/${id}`, data),
    delete: (id)         => api.delete(`/codex/${id}`),
  },

  // ── Chat ───────────────────────────────────────────────────────────────────
  chat: {
    listConversations:   (wid)       => api.get(`/workspaces/${wid}/conversations`),
    createConversation:  (wid, data) => api.post(`/workspaces/${wid}/conversations`, data),
    getConversation:     (id)        => api.get(`/conversations/${id}`),
    updateConversation:  (id, data)  => api.put(`/conversations/${id}`, data),
    deleteConversation:  (id)        => api.delete(`/conversations/${id}`),
    getMessages:         (convId)    => api.get(`/conversations/${convId}/messages`),
    addMessage:          (convId, data) => api.post(`/conversations/${convId}/messages`, data),
  },

  // ── AI ─────────────────────────────────────────────────────────────────────
  ai: {
    generate:    (data) => api.post('/ai/generate', data),
    outline:     (data) => api.post('/ai/outline', data),
    providers:   ()     => api.get('/ai/providers'),
    setProvider: (data) => api.post('/ai/provider', data),
    history:     (limit) => api.get(`/ai/history${limit ? '?limit=' + limit : ''}`),
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: {
    getAll:     ()              => api.get('/settings'),
    get:        (key)           => api.get(`/settings/${key}`),
    updateAll:  (data)          => api.put('/settings', data),
    update:     (key, value)    => api.put(`/settings/${key}`, { value }),
    saveKey:    (provider, key) => api.post('/settings/keys', { provider, key }),
    ollamaStatus: ()            => api.get('/settings/ollama'),
  },

  // ── Export ─────────────────────────────────────────────────────────────────
  export: {
    docx: (data) => api.post('/export/docx', data),
    txt:  (data) => api.post('/export/txt', data),
    zip:  (data) => api.post('/export/zip', data),
  },
};

window.api = api;
