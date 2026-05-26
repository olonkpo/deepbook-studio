/**
 * frontend/js/api.js
 * Centralised API client — all fetch() calls to the backend go through here.
 * Phase 1: Base setup with health check.
 * Phase 3: Full API methods added here during frontend migration.
 */

const API_BASE = 'http://localhost:3001/api';

const api = {
  // ── Internal fetch wrapper ──────────────────────────────────────────────
  async _request(method, path, body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${API_BASE}${path}`, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  },

  get:    (path)        => api._request('GET',    path),
  post:   (path, body)  => api._request('POST',   path, body),
  put:    (path, body)  => api._request('PUT',    path, body),
  delete: (path)        => api._request('DELETE', path),

  // ── Health ──────────────────────────────────────────────────────────────
  health: () => api.get('/health'),

  // ── Workspaces ──────────────────────────────────────────────────────────
  // Implemented in Phase 3
  workspaces: {
    list:    ()         => api.get('/workspaces'),
    create:  (data)     => api.post('/workspaces', data),
    get:     (id)       => api.get(`/workspaces/${id}`),
    update:  (id, data) => api.put(`/workspaces/${id}`, data),
    delete:  (id)       => api.delete(`/workspaces/${id}`),
    switch:  (id)       => api.post(`/workspaces/${id}/switch`),
  },

  // ── Books ───────────────────────────────────────────────────────────────
  books: {
    list:    (workspaceId) => api.get(`/workspaces/${workspaceId}/books`),
    create:  (workspaceId, data) => api.post(`/workspaces/${workspaceId}/books`, data),
    get:     (id)       => api.get(`/books/${id}`),
    update:  (id, data) => api.put(`/books/${id}`, data),
    delete:  (id)       => api.delete(`/books/${id}`),
  },

  // ── AI Generation ───────────────────────────────────────────────────────
  ai: {
    generate:  (data) => api.post('/ai/generate', data),
    outline:   (data) => api.post('/ai/outline', data),
    rewrite:   (data) => api.post('/ai/rewrite', data),
    continue:  (data) => api.post('/ai/continue', data),
    providers: ()     => api.get('/ai/providers'),
    setProvider: (data) => api.post('/ai/provider', data),
  },

  // ── Export ──────────────────────────────────────────────────────────────
  export: {
    docx: (data) => api.post('/export/docx', data),
    pdf:  (data) => api.post('/export/pdf', data),
    txt:  (data) => api.post('/export/txt', data),
  },

  // ── Settings ────────────────────────────────────────────────────────────
  settings: {
    get:       ()     => api.get('/settings'),
    update:    (data) => api.put('/settings', data),
    saveKey:   (data) => api.post('/settings/keys', data),
    ollamaStatus: () => api.get('/settings/ollama'),
  },
};

// Make available globally in the browser
window.api = api;
