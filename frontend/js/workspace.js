/**
 * frontend/js/workspace.js
 * Workspace switcher and management UI.
 * Phase 1: Scaffold / stub — implemented fully in Phase 3.
 */

const WorkspaceManager = {
  activeWorkspace: null,

  async load() {
    try {
      const workspaces = await window.api.workspaces.list();
      this.activeWorkspace = workspaces.find(w => w.is_active) || workspaces[0] || null;
      this.render();
    } catch (err) {
      console.warn('[WorkspaceManager] Could not load workspaces:', err.message);
    }
  },

  async switchTo(id) {
    await window.api.workspaces.switch(id);
    await this.load();
  },

  render() {
    // Full workspace UI rendered in Phase 3
    console.log('[WorkspaceManager] Active workspace:', this.activeWorkspace?.name || 'None');
  },
};

window.WorkspaceManager = WorkspaceManager;
