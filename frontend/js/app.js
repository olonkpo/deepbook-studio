/**
 * frontend/js/app.js
 * Application bootstrap — global APP state, routing, and initialisation.
 *
 * Fullstack differences from v4.1:
 *  - init() waits for Express backend health, then DB.init() (REST-backed)
 *  - AI provider status polled via loadProviderStatus() / startProviderPolling()
 *  - No IndexedDB open/upgrade needed — DB layer calls backend REST API
 *  - lastProjectId persisted via DB.setSetting() (server-side settings table)
 */
'use strict';

// ── Global application state ──────────────────────────────────────────────────
const APP = {
  currentProjectId:      null,
  currentStep:           0,
  currentBook:           1,
  currentChapter:        1,
  currentConversationId: null,
  dashInterval:          null,
};

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * Open a project by ID. Shows workspace view, loads project metadata
 * into the sidebar header, and renders step 0 (DNA & Settings).
 */
async function openProject(id) {
  APP.currentProjectId      = id;
  APP.currentStep           = 0;
  APP.currentBook           = 1;
  APP.currentChapter        = 1;
  APP.currentConversationId = null;

  // Clear any running dashboard interval
  if (APP.dashInterval) {
    clearInterval(APP.dashInterval);
    APP.dashInterval = null;
  }

  // Sync db.js active workspace so all DB calls resolve to the right project
  DB.setActiveWorkspaceId(id);

  // Persist last-opened project for session restore
  DB.setSetting('lastProjectId', id).catch(() => {});

  // Load project metadata for sidebar
  let project = null;
  try {
    project = await DB.get('projects', id);
  } catch (_) { /* continue even if metadata load fails */ }

  // Update sidebar header
  const titleEl = document.getElementById('sidebarProjectTitle');
  const genreEl = document.getElementById('sidebarProjectGenre');
  const hdrEl   = document.getElementById('headerTitle');
  if (project) {
    const title = project.title || project.name || 'Untitled';
    if (titleEl) titleEl.textContent = title;
    if (genreEl) genreEl.textContent = genreLabel(project.genre || '');
    if (hdrEl)   hdrEl.textContent   = 'DeepBook Studio';
  }

  // Switch views
  document.getElementById('homeView').classList.remove('active');
  document.getElementById('workspaceView').classList.add('active');

  // Render first step
  renderStep(0);
}

/**
 * Navigate back to the home (project list) screen.
 */
function goHome() {
  // Stop any running orchestrator
  if (Orchestrator.isRunning()) {
    Orchestrator.stop();
  }

  // Clear dashboard interval
  if (APP.dashInterval) {
    clearInterval(APP.dashInterval);
    APP.dashInterval = null;
  }

  APP.currentProjectId = null;

  // Switch views
  document.getElementById('workspaceView').classList.remove('active');
  document.getElementById('homeView').classList.add('active');

  // Clear last-project so a full restart lands on home
  DB.setSetting('lastProjectId', '').catch(() => {});

  renderHome();
}

/**
 * Navigate to a numbered workflow step within the current project.
 * Highlights the matching sidebar button and delegates rendering to steps.js.
 */
function goStep(n) {
  // Clear dashboard auto-refresh when leaving step 6
  if (APP.currentStep === 6 && n !== 6) {
    if (APP.dashInterval) {
      clearInterval(APP.dashInterval);
      APP.dashInterval = null;
    }
  }

  APP.currentStep = n;

  // Update sidebar active button
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.step === n);
  });

  // Render the step content
  renderStep(n);
}

// ── Backend connectivity ──────────────────────────────────────────────────────

/**
 * Poll the backend health endpoint until it responds, up to `retries` times.
 */
async function waitForBackend(retries = 30, delayMs = 400) {
  const statusEl = document.getElementById('loadingStatus');
  for (let i = 0; i < retries; i++) {
    try {
      await api.health();
      return; // Backend is up
    } catch (_) {
      if (statusEl) statusEl.textContent = `Connecting to backend… (${i + 1}/${retries})`;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Backend did not respond after ' + retries + ' attempts.');
}

// ── App initialisation ────────────────────────────────────────────────────────

async function init() {
  const statusEl = document.getElementById('loadingStatus');

  try {
    // 1. Wait for Express backend
    if (statusEl) statusEl.textContent = 'Connecting to backend…';
    await waitForBackend();

    // 2. Initialise DB layer (REST-backed, no IndexedDB open needed)
    if (statusEl) statusEl.textContent = 'Initialising database…';
    await DB.init();

    // 3. Load AI provider status and start polling
    if (statusEl) statusEl.textContent = 'Checking AI providers…';
    try {
      await loadProviderStatus();
      startProviderPolling(30_000);
    } catch (_) { /* non-fatal — provider status will show as offline */ }

    // 4. Apply persisted theme
    await loadTheme();

    // 5. Restore sidebar group collapse state
    restoreSidebarGroups();

    // 6. Hide loading screen and show the app
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) loadingScreen.style.display = 'none';

    // 7. Restore last-opened project, or go to home
    let lastId = '';
    try {
      lastId = await DB.getSetting('lastProjectId', '');
    } catch (_) { /* ignore */ }

    if (lastId) {
      // Verify the project still exists before restoring
      try {
        const project = await DB.get('projects', lastId);
        if (project) {
          await openProject(lastId);
          return;
        }
      } catch (_) { /* project not found — fall through to home */ }
    }

    // Default: show home view
    document.getElementById('loadingScreen') && (document.getElementById('loadingScreen').style.display = 'none');
    document.getElementById('homeView').classList.add('active');
    await renderHome();

  } catch (err) {
    console.error('[App] Init failed:', err);
    if (statusEl) statusEl.textContent = '⚠ ' + err.message + ' — please restart DeepBook Studio.';
  }
}

// ── Expose globals ────────────────────────────────────────────────────────────
Object.assign(window, {
  APP,
  openProject,
  goHome,
  goStep,
  init,
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => init());
