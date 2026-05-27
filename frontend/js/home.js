/**
 * frontend/js/home.js
 * Home view — project list, new-project modal, import/export.
 */
'use strict';

// ── Render home view ──────────────────────────────────────────────────────────
async function renderHome() {
  document.getElementById('homeView').classList.add('active');
  document.getElementById('workspaceView').classList.remove('active');
  APP.currentProjectId = null;

  const body     = document.getElementById('homeRightBody');
  const projects = await DB.getAll('projects');
  projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  let html = `
  <button class="home-create-btn" onclick="openNewProjectModal()">
    <div class="home-create-icon">+</div>
    <div class="home-create-label">
      <strong>Create new</strong>
      <span>New series, standalone, any genre</span>
    </div>
  </button>`;

  if (!projects.length) {
    html += `<div class="home-empty">
      <div style="font-size:3rem">📚</div>
      <p>No projects yet — create one above or import an existing file below.</p>
    </div>`;
    body.innerHTML = html;
    return;
  }

  html += `<div class="home-recents-title">Recents</div>`;

  for (const p of projects) {
    const books        = await DB.getByIndex('books', 'by_project', p.id);
    const chapters     = await DB.getByIndex('chapters', 'by_project', p.id);
    const totalPlanned = books.reduce((s, b) => s + (b.roadmap?.chapters?.length || 0), 0);
    const totalWritten = chapters.filter(c => c.content).length;
    const pct          = totalPlanned ? Math.round(totalWritten / totalPlanned * 100) : 0;
    const isGenerating = Orchestrator.isRunning() && APP.currentProjectId === p.id;
    const statusLabel  = p.status === 'complete' ? 'Complete' : isGenerating ? 'Generating…' : 'Idle';
    const statusCls    = p.status === 'complete' ? 'complete' : isGenerating ? 'generating' : 'idle';
    const updDate      = new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const genreIcon    = { 'cozy-mystery': '🔍', 'thriller': '⚡', 'romance': '💕', 'fantasy': '🧙', 'sci-fi': '🚀', 'literary': '📖' }[p.genre] || '📚';
    const title        = p.title || p.name || 'Untitled';

    html += `<div class="home-project-row" onclick="openProject('${p.id}')">
      <div class="home-proj-icon">${genreIcon}</div>
      <div class="home-proj-info">
        <div class="home-proj-title">${esc(title)}</div>
        <div class="home-proj-meta">${updDate} · ${esc(genreLabel(p.genre))} · ${totalWritten}/${totalPlanned} chapters</div>
      </div>
      ${pct > 0 ? `<div class="home-proj-pct">${pct}%</div>` : ''}
      <span class="home-proj-badge ${statusCls}">${statusLabel}</span>
    </div>`;
  }

  body.innerHTML = html;
}

// ── File import ───────────────────────────────────────────────────────────────
function triggerImportFile() {
  document.getElementById('homeImportInput').click();
}

async function handleHomeImport(input) {
  const file = input.files[0];
  if (!file) return;
  showToast('Importing…', 'info');
  try {
    const id = await importV3Backup(file);
    showToast('Project imported successfully', 'success');
    setTimeout(() => openProject(id), 800);
  } catch (e) {
    showToast('Import failed: ' + e.message, 'danger');
  }
  input.value = '';
}

// ── New project modal ─────────────────────────────────────────────────────────
function openNewProjectModal() {
  document.getElementById('newProjectBody').innerHTML = `
    <div class="field-group">
      <label class="field-label">Project / Series Title</label>
      <input id="npTitle" class="field" placeholder="e.g. The Maple Creek Mysteries" />
    </div>
    <div class="field-group">
      <label class="field-label">Author Name</label>
      <input id="npAuthor" class="field" placeholder="e.g. Jane Smith" />
    </div>
    <div class="field-group">
      <label class="field-label">Genre</label>
      <select id="npGenre" class="field">
        <option value="cozy-mystery">🔍 Cozy Mystery</option>
        <option value="thriller">⚡ Thriller / Suspense</option>
        <option value="romance">💕 Romance</option>
        <option value="fantasy">🧙 Fantasy</option>
        <option value="sci-fi">🚀 Sci-Fi</option>
        <option value="literary">📖 Literary Fiction</option>
      </select>
    </div>
    <div class="field-group">
      <label class="field-label">Mode</label>
      <select id="npMode" class="field">
        <option value="series">Series (multiple books)</option>
        <option value="single">Standalone book</option>
      </select>
    </div>
    <div class="field-group">
      <label class="field-label">Target words per chapter</label>
      <input id="npWords" type="number" class="field" value="3000" min="500" max="8000" />
    </div>`;
  openModal('newProjectModal');
  setTimeout(() => document.getElementById('npTitle').focus(), 100);
}

async function createProject() {
  const title = (document.getElementById('npTitle').value || '').trim();
  if (!title) { showToast('Please enter a project title', 'warning'); return; }
  const authorName      = (document.getElementById('npAuthor').value || '').trim();
  const genre           = document.getElementById('npGenre').value;
  const mode            = document.getElementById('npMode').value;
  const targetWordCount = +document.getElementById('npWords').value || 3000;
  const id              = uid();
  const project = {
    id, title, name: title, authorName, genre, mode, status: 'idle',
    seriesPlan: null,
    settings: { targetWordCount, autoRepair: true },
    maxBooks: mode === 'series' ? 10 : 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await DB.put('projects', project);
  closeModal('newProjectModal');
  showToast(`Project "${title}" created`, 'success');
  openProject(id);
}

// ── Import v3/v4 backup ───────────────────────────────────────────────────────
async function importV3Backup(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async e => {
      try {
        const d = JSON.parse(e.target.result);

        if (d.version === 4) {
          // v4 format — restore directly
          await DB.put('projects', d.project);
          for (const b of (d.books    || [])) await DB.put('books',           b);
          for (const c of (d.chapters || [])) await DB.put('chapters',        c);
          for (const f of (d.facts    || [])) await DB.put('continuityFacts', f);
          resolve(d.project.id);
          return;
        }

        // v3 format
        const projectId = uid();
        const project = {
          id: projectId,
          title: d.seriesPlan?.series_title || 'Imported Project',
          name:  d.seriesPlan?.series_title || 'Imported Project',
          genre: 'cozy-mystery',
          mode:  d.settings?.mode || 'series',
          status: 'idle',
          seriesPlan: d.seriesPlan || null,
          settings: { targetWordCount: 3000, autoRepair: true },
          maxBooks: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await DB.put('projects', project);
        if (d.roadmaps) {
          for (const [bNum, roadmap] of Object.entries(d.roadmaps)) {
            const bookId = uid();
            await DB.put('books', {
              id: bookId, projectId,
              number: +bNum,
              title:  d.seriesPlan?.books?.[+bNum - 1]?.title || 'Book ' + bNum,
              roadmap, status: 'writing',
              createdAt: new Date().toISOString(),
            });
            const bookChapters = (d.chapters || []).filter(c => c.book === +bNum);
            for (const ch of bookChapters) {
              await DB.put('chapters', {
                id: uid(), bookId, projectId,
                number:      ch.chapter,
                title:       '',
                content:     ch.content || '',
                status:      ch.status || 'draft',
                wordCount:   countWords(ch.content || ''),
                continuityLog: d.continuityLogs?.[+bNum]?.[ch.chapter] || null,
                contradictions: null,
                repairAttempts: 0,
                generatedAt: new Date().toISOString(),
              });
            }
          }
        }
        resolve(projectId);
      } catch (err) { reject(err); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

Object.assign(window, {
  renderHome, triggerImportFile, handleHomeImport,
  openNewProjectModal, createProject, importV3Backup,
});
