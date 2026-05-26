/**
 * frontend/js/app.js
 * Application bootstrap — initialises the app on page load.
 * Phase 1: Health check + splash screen.
 * Phase 3: Full app initialisation (workspaces, router, UI) added here.
 */

const App = {
  statusEl: null,

  async init() {
    this.statusEl = document.getElementById('status');

    try {
      // Wait for backend health check
      this.setStatus('Connecting to backend...');
      await this.waitForBackend();

      this.setStatus('Backend connected. Loading app...');

      // Phase 3: Replace splash with full UI
      // For now, show a simple ready state
      this.showReady();
    } catch (err) {
      this.setStatus(`Error: ${err.message}. Please restart the app.`);
      console.error('[App] Init failed:', err);
    }
  },

  async waitForBackend(retries = 20, delay = 300) {
    for (let i = 0; i < retries; i++) {
      try {
        await window.api.health();
        return; // Success
      } catch {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('Could not connect to backend after multiple attempts.');
  },

  setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  },

  showReady() {
    // Phase 1: Simple ready indicator.
    // Phase 3: This method will mount the full workspace/book UI.
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="splash">
        <div class="splash__logo">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="12" fill="#1F3A6E"/>
            <path d="M16 20h32M16 28h24M16 36h28M16 44h20" stroke="#5B9BD5"
              stroke-width="3" stroke-linecap="round"/>
            <circle cx="48" cy="44" r="8" fill="#2E6DA4"/>
            <path d="M45 44l2 2 4-4" stroke="white" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 class="splash__title">DeepBook Studio</h1>
        <p class="splash__subtitle">Phase 1 Scaffold — Ready</p>
        <p style="color:#4caf50; margin-top:12px; font-size:0.9rem;">
          ✓ Backend connected &nbsp;|&nbsp; ✓ Electron running &nbsp;|&nbsp;
          ✓ Phase 1 complete
        </p>
        <p style="color:#888; margin-top:8px; font-size:0.8rem;">
          Full UI replaces this screen in Phase 3.
        </p>
      </div>
    `;
  },
};

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
