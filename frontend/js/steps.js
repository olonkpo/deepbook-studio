/**
 * frontend/js/steps.js
 * All workspace step renderers (0–9) + generation pipeline helpers.
 *
 * Ported from v4.1 with these fullstack adaptations:
 *  - callAI(prompt) — no settings param (backend handles provider selection)
 *  - isAIReady() / aiProviderLabel() — from ai.js (checks backend status)
 *  - DB calls go to backend API via db.js abstraction layer
 *  - Export uses frontend/js/export.js (client-side DOCX builder)
 */
'use strict';

// ── Step router ───────────────────────────────────────────────────────────────
async function renderStep(n) {
  APP.currentStep = n;
  if (APP.dashInterval) { clearInterval(APP.dashInterval); APP.dashInterval = null; }
  document.querySelectorAll('.step-btn').forEach(b => b.classList.toggle('active', b.dataset.step == String(n)));
  const container = document.getElementById('wsContent');
  container.innerHTML = '<div style="color:var(--text-muted);padding:40px;text-align:center">Loading…</div>';
  const project = await DB.get('projects', APP.currentProjectId);
  switch (n) {
    case 0: return renderStepDNA(container, project);
    case 1: return renderStepSeriesPlan(container, project);
    case 2: return renderStepRoadmaps(container, project);
    case 3: return renderStepChapters(container, project);
    case 4: return renderStepFrontMatter(container, project);
    case 5: return renderStepExport(container, project);
    case 6: return renderDashboard(container, project);
    case 7: return renderContinuityLog(container, project);
    case 8: return renderStepCodex(container, project);
    case 9: return renderStepChat(container, project);
  }
}

// Helper — re-render any step from within template-string onclick handlers
async function renderProjectStep(n) {
  APP.currentStep = n;
  await renderStep(n);
}

// ── STEP 0: DNA & SETTINGS ────────────────────────────────────────────────────
async function renderStepDNA(container, project) {
  const hasAI       = isAIReady();
  const providerName = aiProviderLabel();

  container.innerHTML = `
  <div class="step-card">
    <h2>🧬 Series DNA</h2>
    <p class="step-desc">Write the core concept for your series — protagonist, setting, tone, and themes. This feeds every generation prompt from series plan through to final chapters.</p>

    ${!hasAI ? `<div style="display:flex;align-items:center;gap:10px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:16px;font-size:.83rem;color:var(--amber)">
      <span>⚠</span>
      <span>No AI provider configured. <button class="btn btn-sm btn-secondary" onclick="openSettings()" style="margin-left:4px">⚙ Open Settings</button></span>
    </div>` : `<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span class="ai-badge">🤖 ${esc(providerName)}</span>
      <button class="btn btn-sm btn-secondary" onclick="openSettings()">⚙ Change</button>
    </div>`}

    <div class="field-group">
      <label class="field-label">Author Name</label>
      <input id="dnaAuthorField" class="field" placeholder="e.g. Jane Smith" value="${esc(project.authorName || '')}" />
    </div>
    <div class="field-group">
      <label class="field-label">Series DNA / Core Concept</label>
      <textarea id="dnaField" class="field" rows="10" placeholder="Describe the heart of your series:

• Protagonist — who are they, what's their job, what's their flaw?
• Setting — where and when does the story take place?
• Tone — cozy and warm? Dark and gritty? Witty and fast-paced?
• Recurring themes — what does every book explore?
• Series hook — what keeps readers coming back for the next book?">${esc(project.settings?.dna || '')}</textarea>
      <div class="word-count" id="dnaWc"></div>
    </div>
    <div class="btn-row">
      ${hasAI ? `<button class="btn btn-accent" onclick="genDNA()">🤖 Generate DNA from title</button>` : ''}
      <button class="btn btn-primary" onclick="saveDNA()">💾 Save DNA</button>
    </div>
    <div id="dnaStatus" class="status-msg"></div>

    ${hasAI ? `
    <div style="margin-top:24px;border:2px solid var(--green-border);border-radius:var(--radius-sm);background:var(--green-bg);padding:18px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:.95rem;color:var(--green)">🚀 One-Click Full Generation</div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-top:3px">Saves DNA → Series Plan → All Roadmaps → All Chapters → All Front Matter. Skips any steps already done.</div>
        </div>
        <button class="btn btn-green autoGenBtn" onclick="autoGenerateAll()" style="white-space:nowrap;font-size:.95rem;padding:10px 22px;flex-shrink:0">🚀 Generate Everything</button>
      </div>
    </div>` : ''}
  </div>`;

  attachWc('dnaField', 'dnaWc', 50, 500);
}

async function saveDNA() {
  const project    = await DB.get('projects', APP.currentProjectId);
  const dna        = document.getElementById('dnaField')?.value || '';
  const authorName = (document.getElementById('dnaAuthorField')?.value || '').trim() || project.authorName || '';
  await DB.put('projects', { ...project, authorName, settings: { ...project.settings, dna }, updatedAt: new Date().toISOString() });
  showStatus('dnaStatus', '✅ DNA saved', 'success', 3000);
  showToast('DNA saved', 'success');
}

async function genDNA() {
  const project = await DB.get('projects', APP.currentProjectId);
  showStatus('dnaStatus', '🤖 Generating…', 'info', 0);
  try {
    const prompt = `Generate a rich Series DNA for a ${genreLabel(project.genre)} titled "${project.title || project.name}". Include: protagonist name & backstory, setting, recurring themes, tone, unique hook. 200 words max.`;
    const r = await callAI(prompt);
    document.getElementById('dnaField').value = r;
    showStatus('dnaStatus', '✅ Done — review and save', 'success', 5000);
  } catch (e) { showStatus('dnaStatus', '❌ ' + e.message, 'danger', 8000); }
}

// ── STEP 1: SERIES PLAN ───────────────────────────────────────────────────────
async function renderStepSeriesPlan(container, project) {
  const hasAI   = isAIReady();
  const planJson = project.seriesPlan ? JSON.stringify(project.seriesPlan, null, 2) : '';
  container.innerHTML = `
  <div class="step-card">
    <h2>📋 Series Plan</h2>
    <p class="step-desc">Generate the full series plan: series bible, protagonist, setting, plot arc, and book list. The AI will produce structured JSON you can review and edit.</p>
    ${hasAI ? `<div class="btn-row" style="margin-bottom:16px">
      <button class="btn btn-accent" onclick="genSeriesPlan()">🤖 Generate Series Plan</button>
    </div>` : '<p style="color:var(--amber);font-size:.85rem">⚠ Configure an AI provider in DNA &amp; Settings first.</p>'}
    <div id="seriesStatus" class="status-msg"></div>
    <div class="field-group" style="margin-top:12px">
      <label class="field-label">Series Plan JSON — review &amp; edit, then save</label>
      <textarea id="seriesPlanField" class="field" rows="22" placeholder='{"series_title":"…","series_bible":{…},"books":[…]}'>${esc(planJson)}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveSeriesPlan()">💾 Save Plan</button>
      ${project.seriesPlan ? `<button class="btn btn-secondary btn-sm" onclick="copyText('seriesPlanField')">📋 Copy</button>` : ''}
    </div>
    <div id="seriesSaveStatus" class="status-msg"></div>
  </div>`;
}

async function genSeriesPlan() {
  const project  = await DB.get('projects', APP.currentProjectId);
  showStatus('seriesStatus', '🤖 Generating series plan…', 'info', 0);
  const genre    = genreLabel(project.genre);
  const dna      = project.settings?.dna || project.title || project.name;
  const maxBooks = project.maxBooks || 5;
  const prompt = `You are a professional ${genre} series planner. Create a complete series plan for "${project.title || project.name}" in valid JSON.

DNA: ${dna}

Output ONLY valid JSON matching this structure:
{
  "series_title": "string",
  "series_bible": {
    "protagonist": {"name":"","age":"","occupation":"","backstory":"","personality":"","flaw":""},
    "love_interest": {"name":"","role":""},
    "side_characters": {"mentor":{"name":"","role":""},"best_friend":{"name":"","role":""},"antagonist_rival":{"name":"","role":""}},
    "setting": {"name":"","description":"","unique_features":""},
    "themes": [],
    "tone": "",
    "series_hook": ""
  },
  "books": [{"number":1,"title":"","premise":"","mystery_type":"","arc":"","end_state":""}],
  "plot_arc": {"overarching_mystery":"","resolution_book":${maxBooks}}
}

Create ${maxBooks} books. Make it compelling and original.`;
  try {
    const r = await callAI(prompt);
    const clean = extractJSON(r);
    JSON.parse(clean);
    document.getElementById('seriesPlanField').value = JSON.stringify(JSON.parse(clean), null, 2);
    showStatus('seriesStatus', '✅ Plan generated — review and save', 'success', 6000);
  } catch (e) { showStatus('seriesStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function saveSeriesPlan() {
  const raw = document.getElementById('seriesPlanField').value.trim();
  if (!raw) { showStatus('seriesSaveStatus', 'Nothing to save', 'warning', 3000); return; }
  try {
    const plan    = JSON.parse(raw);
    const project = await DB.get('projects', APP.currentProjectId);
    await DB.put('projects', { ...project, seriesPlan: plan, updatedAt: new Date().toISOString() });
    showStatus('seriesSaveStatus', '✅ Series plan saved', 'success', 3000);
    showToast('Series plan saved', 'success');
  } catch (e) { showStatus('seriesSaveStatus', '❌ Invalid JSON: ' + e.message, 'danger', 6000); }
}

// ── STEP 2: ROADMAPS ──────────────────────────────────────────────────────────
async function renderStepRoadmaps(container, project) {
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  books.sort((a, b) => a.number - b.number);
  const hasAI    = isAIReady();
  const maxBooks = project.maxBooks || 5;

  let bookTabs = '';
  for (let i = 1; i <= maxBooks; i++) {
    const b    = books.find(x => x.number === i);
    const done = !!b?.roadmap;
    bookTabs += `<button class="btn btn-sm ${APP.currentBook === i ? 'btn-primary' : 'btn-secondary'}" onclick="APP.currentBook=${i};renderStep(2)">${done ? '✅' : '📄'} Book ${i}</button>`;
  }

  const selBook     = books.find(b => b.number === APP.currentBook) || { number: APP.currentBook, roadmap: null };
  const roadmapJson = selBook.roadmap ? JSON.stringify(selBook.roadmap, null, 2) : '';
  const bookMeta    = project.seriesPlan?.books?.[APP.currentBook - 1];

  container.innerHTML = `
  <div class="step-card">
    <h2>🗺 Roadmaps</h2>
    <p class="step-desc">Generate a detailed chapter-by-chapter roadmap for each book. Each roadmap locks in the case, suspects, clues, and chapter beats.</p>
    <div class="btn-row" style="margin-bottom:16px">${bookTabs}</div>
    ${bookMeta ? `<div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:.83rem"><strong>${esc(bookMeta.title || 'Book ' + APP.currentBook)}</strong> — ${esc(bookMeta.premise || '')}</div>` : ''}
    ${hasAI ? `<div class="btn-row" style="margin-bottom:14px">
      <button class="btn btn-accent" onclick="genRoadmap(${APP.currentBook})">🤖 Generate Book ${APP.currentBook} Roadmap</button>
    </div>` : ''}
    <div id="roadmapStatus" class="status-msg"></div>
    <div class="field-group">
      <label class="field-label">Book ${APP.currentBook} Roadmap JSON</label>
      <textarea id="roadmapField" class="field" rows="22" placeholder='{"chapters":[…],"case_lock":{…},"suspects":[…]}'>${esc(roadmapJson)}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveRoadmap(${APP.currentBook})">💾 Save Roadmap</button>
      <button class="btn btn-secondary btn-sm" onclick="genAllRoadmaps()">🤖 Generate All Roadmaps</button>
    </div>
    <div id="roadmapSaveStatus" class="status-msg"></div>
  </div>`;
}

async function genRoadmap(bookNum) {
  const project = await DB.get('projects', APP.currentProjectId);
  if (!project.seriesPlan) { showStatus('roadmapStatus', '⚠ Generate a Series Plan first', 'warning', 4000); return; }
  showStatus('roadmapStatus', '🤖 Generating roadmap for Book ' + bookNum + '…', 'info', 0);
  const bookMeta    = project.seriesPlan.books?.[bookNum - 1] || {};
  const genre       = genreLabel(project.genre);
  const numChapters = project.settings?.chaptersPerBook || 15;
  const prompt = `You are a ${genre} planner. Create a detailed chapter roadmap for Book ${bookNum} of "${project.seriesPlan.series_title}".

Book premise: ${bookMeta.premise || ''}
Series bible: ${JSON.stringify(project.seriesPlan.series_bible || {})}

Output ONLY valid JSON:
{
  "case_lock": {"victim":{"name":"","background":""},"killer":{"name":"","motive":"","method":""},"secret":""},
  "suspects": [{"name":"","motive":"","alibi":"","is_killer":false}],
  "location_registry": [],
  "canonical_name_register": [],
  "chapters": [{"number":1,"title":"","premise":"","key_events":[],"evidence_introduced":[],"suspects_featured":[],"end_hook":"","day_number":1,"time_of_day":"morning","pov_location":""}]
}

Create exactly ${numChapters} chapters. Make the mystery tight and fair-play.`;
  try {
    const r = await callAI(prompt);
    const clean = extractJSON(r);
    JSON.parse(clean);
    document.getElementById('roadmapField').value = JSON.stringify(JSON.parse(clean), null, 2);
    showStatus('roadmapStatus', '✅ Roadmap generated — review and save', 'success', 6000);
  } catch (e) { showStatus('roadmapStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function saveRoadmap(bookNum) {
  const raw = document.getElementById('roadmapField').value.trim();
  if (!raw) { showStatus('roadmapSaveStatus', 'Nothing to save', 'warning', 3000); return; }
  try {
    const roadmap = JSON.parse(raw);
    const project = await DB.get('projects', APP.currentProjectId);
    const books   = await DB.getByIndex('books', 'by_project', project.id);
    let book      = books.find(b => b.number === bookNum);
    const bookMeta = project.seriesPlan?.books?.[bookNum - 1] || {};
    if (!book) {
      book = { id: uid(), projectId: project.id, number: bookNum, title: bookMeta.title || 'Book ' + bookNum, roadmap, status: 'writing', createdAt: new Date().toISOString() };
    } else {
      book = { ...book, roadmap, title: bookMeta.title || book.title, status: 'writing' };
    }
    await DB.put('books', book);
    showStatus('roadmapSaveStatus', '✅ Roadmap saved', 'success', 3000);
    showToast('Book ' + bookNum + ' roadmap saved', 'success');
  } catch (e) { showStatus('roadmapSaveStatus', '❌ Invalid JSON: ' + e.message, 'danger', 6000); }
}

let _roadmapsRunning = false;
async function genAllRoadmaps() {
  if (_roadmapsRunning) { showToast('Roadmap generation already running', 'warning'); return; }
  const project = await DB.get('projects', APP.currentProjectId);
  if (!project.seriesPlan) { showToast('Generate a Series Plan first', 'warning'); return; }
  _roadmapsRunning = true;
  try {
    showToast('Generating all roadmaps sequentially…', 'info');
    showStatus('roadmapStatus', 'Generating all roadmaps — this will take a moment…', 'info', 0);
    const maxBooks = project.maxBooks || 5;
    for (let b = 1; b <= maxBooks; b++) {
      APP.currentBook = b;
      showStatus('roadmapStatus', '🤖 Book ' + b + '/' + maxBooks + '…', 'info', 0);
      try { await genRoadmap(b); await saveRoadmap(b); } catch (e) { showToast('Book ' + b + ' failed: ' + e.message, 'danger'); }
      await new Promise(r => setTimeout(r, 500));
    }
    showStatus('roadmapStatus', '✅ All roadmaps generated', 'success', 5000);
    await renderStep(2);
  } finally { _roadmapsRunning = false; }
}

// ── HEADLESS PIPELINE HELPERS (used by autoGenerateAll) ──────────────────────
async function _pipeGenSeriesPlan(project) {
  const genre    = genreLabel(project.genre);
  const dna      = project.settings?.dna || project.title || project.name;
  const maxBooks = project.maxBooks || 5;
  const prompt = `You are a professional ${genre} series planner. Create a complete series plan for "${project.title || project.name}" in valid JSON.

DNA: ${dna}

Output ONLY valid JSON matching this structure:
{
  "series_title": "string",
  "series_bible": {
    "protagonist": {"name":"","age":"","occupation":"","backstory":"","personality":"","flaw":""},
    "love_interest": {"name":"","role":""},
    "side_characters": {"mentor":{"name":"","role":""},"best_friend":{"name":"","role":""},"antagonist_rival":{"name":"","role":""}},
    "setting": {"name":"","description":"","unique_features":""},
    "themes": [], "tone": "", "series_hook": ""
  },
  "books": [{"number":1,"title":"","premise":"","mystery_type":"","arc":"","end_state":""}],
  "plot_arc": {"overarching_mystery":"","resolution_book":${maxBooks}}
}
Create ${maxBooks} books. Make it compelling and original.`;
  const r       = await callAI(prompt);
  const plan    = JSON.parse(extractJSON(r));
  const updated = { ...project, seriesPlan: plan, updatedAt: new Date().toISOString() };
  await DB.put('projects', updated);
  return updated;
}

async function _pipeGenRoadmap(project, bookNum) {
  if (!project.seriesPlan) throw new Error('Series plan missing');
  const bookMeta    = project.seriesPlan.books?.[bookNum - 1] || {};
  const genre       = genreLabel(project.genre);
  const numChapters = project.settings?.chaptersPerBook || 15;
  const prompt = `You are a ${genre} planner. Create a detailed chapter roadmap for Book ${bookNum} of "${project.seriesPlan.series_title}".
Book premise: ${bookMeta.premise || ''}
Series bible: ${JSON.stringify(project.seriesPlan.series_bible || {})}
Output ONLY valid JSON:
{"case_lock":{"victim":{"name":"","background":""},"killer":{"name":"","motive":"","method":""},"secret":""},"suspects":[{"name":"","motive":"","alibi":"","is_killer":false}],"location_registry":[],"canonical_name_register":[],"chapters":[{"number":1,"title":"","premise":"","key_events":[],"evidence_introduced":[],"suspects_featured":[],"end_hook":"","day_number":1,"time_of_day":"morning","pov_location":""}]}
Create exactly ${numChapters} chapters.`;
  const r       = await callAI(prompt);
  const roadmap = JSON.parse(extractJSON(r));
  const books   = await DB.getByIndex('books', 'by_project', project.id);
  let book      = books.find(b => b.number === bookNum);
  if (!book) {
    book = { id: uid(), projectId: project.id, number: bookNum, title: bookMeta.title || 'Book ' + bookNum, roadmap, status: 'writing', createdAt: new Date().toISOString() };
  } else {
    book = { ...book, roadmap, title: bookMeta.title || book.title, status: 'writing' };
  }
  await DB.put('books', book);
  return book;
}

async function _pipeGenFrontMatter(project, book) {
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  if (!chapters.length) return null;
  const synopsis = chapters.sort((a, b) => a.number - b.number).slice(0, 3).map(c => c.content?.substring(0, 500)).join('\n');
  const prompt = `Generate front & back matter for Book ${book.number} of "${project.seriesPlan?.series_title || project.title || project.name}".
Book title: ${book.title || 'Book ' + book.number}
Series bible: ${JSON.stringify(project.seriesPlan?.series_bible || {}).substring(0, 600)}
Story beginning: ${synopsis}
Output valid JSON with ALL these fields:
{"dedication":"(warm, 1-3 lines)","prologue":"(optional 300-500 word scene-setting prologue)","synopsis":"(100 words, back-cover style)","blurb":"(50 words, punchy back-cover hook)","authors_note":"(brief, warm 100-word author note)","acknowledgements":"(brief warm thank-yous)","readers_guide":"(5-8 discussion questions for book clubs)","series_note":"(teaser for next book)"}`;
  const r  = await callAI(prompt);
  const fm = JSON.parse(extractJSON(r));
  Object.keys(fm).forEach(k => { if (Array.isArray(fm[k])) fm[k] = fm[k].join('\n'); });
  await DB.put('books', { ...book, frontMatter: fm });
  return fm;
}

// ── FULL AUTO-GENERATE PIPELINE ───────────────────────────────────────────────
let _autoRunning = false;

async function autoGenerateAll() {
  if (_autoRunning)             { showToast('Pipeline already running', 'warning'); return; }
  if (Orchestrator.isRunning()) { showToast('Chapter generation already running — stop it first', 'warning'); return; }
  if (!isAIReady())             { showToast('No AI configured — open ⚙ Settings first', 'danger'); return; }
  const _pid = APP.currentProjectId;
  if (!_pid) return;

  _autoRunning = true;
  document.querySelectorAll('.autoGenBtn').forEach(b => { b.disabled = true; b.textContent = '⏳ Running…'; });

  try {
    const dnaField = document.getElementById('dnaField');
    if (dnaField) await saveDNA();

    let project = await DB.get('projects', _pid);
    if (!project.settings?.dna && !project.seriesPlan) {
      showToast('Add a Series DNA first — describe your story concept', 'warning');
      return;
    }
    const maxBooks = project.maxBooks || 5;

    // Switch to dashboard so user can watch live
    APP.currentStep = 6;
    await renderStep(6);

    // 1 — Series Plan
    if (!project.seriesPlan) {
      updateWorkerBar('📋 Generating series plan…', 3, 'running');
      project = await _pipeGenSeriesPlan(project);
      showToast('Series plan done', 'success');
    } else {
      updateWorkerBar('📋 Series plan exists — skipping', 5, 'running');
    }
    await new Promise(r => setTimeout(r, 300));

    // 2 — Roadmaps
    const existingBooks = await DB.getByIndex('books', 'by_project', project.id);
    for (let b = 1; b <= maxBooks; b++) {
      const alreadyHasRoadmap = existingBooks.find(bk => bk.number === b && bk.roadmap);
      if (alreadyHasRoadmap) {
        updateWorkerBar(`🗺 Book ${b}/${maxBooks} roadmap exists — skipping`, 5 + Math.round((b / maxBooks) * 20), 'running');
        continue;
      }
      updateWorkerBar(`🗺 Generating roadmap: Book ${b}/${maxBooks}…`, 5 + Math.round(((b - 1) / maxBooks) * 20), 'running');
      project = await DB.get('projects', _pid);
      await _pipeGenRoadmap(project, b);
      showToast(`Book ${b} roadmap done`, 'success');
      await new Promise(r => setTimeout(r, 400));
    }

    // 3 — Chapters
    updateWorkerBar('✍️ Starting chapter generation…', 25, 'running');
    await new Promise(r => setTimeout(r, 300));
    await Orchestrator.run(_pid, { startBook: 1, startChapter: 1, mode: 'chapters' });

    // 4 — Front Matter
    project = await DB.get('projects', _pid);
    const booksForFM = await DB.getByIndex('books', 'by_project', project.id);
    booksForFM.sort((a, b) => a.number - b.number);
    for (let i = 0; i < booksForFM.length; i++) {
      const book = booksForFM[i];
      const chs  = await DB.getByIndex('chapters', 'by_book', book.id);
      if (!chs.length) continue;
      if (book.frontMatter && Object.keys(book.frontMatter).length > 2) continue;
      updateWorkerBar(`📑 Front matter: Book ${i + 1}/${booksForFM.length}…`, 92 + Math.round((i / booksForFM.length) * 6), 'running');
      try { await _pipeGenFrontMatter(project, book); } catch (e) { console.warn('Front matter gen failed (non-fatal):', e); }
      await new Promise(r => setTimeout(r, 300));
    }

    updateWorkerBar('🎉 Complete — everything generated!', 100, 'done');
    showToast('Full series generated successfully!', 'success');
    await renderStep(6);
  } catch (e) {
    updateWorkerBar('❌ Pipeline error: ' + e.message, 0, 'running');
    showToast('Pipeline failed: ' + e.message, 'danger');
    console.error('autoGenerateAll error', e);
  } finally {
    _autoRunning = false;
    document.querySelectorAll('.autoGenBtn').forEach(b => { b.disabled = false; b.textContent = '🚀 Generate Everything'; });
  }
}

// ── STEP 3: CHAPTERS ──────────────────────────────────────────────────────────
async function renderStepChapters(container, project) {
  const books     = await DB.getByIndex('books', 'by_project', project.id);
  books.sort((a, b) => a.number - b.number);
  const hasAI     = isAIReady();
  const hasRoadmaps = books.some(b => b.roadmap);

  let bookTabs = '';
  books.forEach(b => {
    bookTabs += `<button class="btn btn-sm ${APP.currentBook === b.number ? 'btn-primary' : 'btn-secondary'}" onclick="APP.currentBook=${b.number};renderStep(3)">${esc((b.title || 'Book ' + b.number).substring(0, 20))}</button>`;
  });
  if (!books.length) bookTabs = '<span style="color:var(--text-muted);font-size:.85rem">No books yet — generate roadmaps first</span>';

  const selBook  = books.find(b => b.number === APP.currentBook);
  const chapters = selBook ? (await DB.getByIndex('chapters', 'by_book', selBook.id)).sort((a, b) => a.number - b.number) : [];
  const planned  = selBook?.roadmap?.chapters?.length || 0;
  const written  = chapters.filter(c => c.content).length;
  const finalized = chapters.filter(c => c.status === 'final').length;
  const running  = Orchestrator.isRunning() || _autoRunning;

  container.innerHTML = `
  <div class="step-card">
    <h2>✍️ Chapters</h2>
    <p class="step-desc">Generate, review, and refine chapters. The engine uses your roadmap, series bible, and continuity logs to maintain consistency across the entire series.</p>

    ${!hasAI ? '<div class="status-msg show warning">⚠ Configure an AI provider in DNA &amp; Settings first.</div>' : ''}
    ${!hasRoadmaps ? '<div class="status-msg show warning">⚠ Generate roadmaps in the Roadmaps step first.</div>' : ''}

    <div class="btn-row" style="margin-bottom:16px">${bookTabs}</div>

    ${selBook ? `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
      <span class="inline-badge badge-blue">📖 ${written}/${planned} written</span>
      <span class="inline-badge badge-green">✅ ${finalized} finalized</span>
      <span class="inline-badge badge-amber">✍️ ${chapters.filter(c => c.status === 'draft').length} draft</span>
    </div>` : ''}

    ${hasAI && hasRoadmaps ? `<div class="btn-row" style="margin-bottom:16px">
      <button class="btn btn-green autoGenBtn" onclick="autoGenerateAll()" ${running ? 'disabled' : ''}>🚀 Generate Everything</button>
      <button class="btn btn-secondary" onclick="Orchestrator.run('${project.id}',{startBook:${APP.currentBook},startChapter:1,mode:'chapters'})" ${running ? 'disabled' : ''}>▶ Chapters Only</button>
    </div>
    <div class="btn-row" style="margin-bottom:12px">
      <select id="tightenModeSel" class="field" style="width:auto;padding:6px 10px;font-size:.78rem">
        <option value="draft-only">✂ Drafts → Final</option>
        <option value="finalize-only">🔁 Re-tighten All</option>
        <option value="all">📋 All Non-Final</option>
      </select>
      <button class="btn btn-secondary" onclick="Orchestrator.tightenAll('${project.id}',document.getElementById('tightenModeSel').value)" ${running ? 'disabled' : ''}>✂ Tighten</button>
    </div>` : ''}

    <div id="chapterGrid"></div>
    <hr class="divider">
    <h3 style="font-family:var(--font-display);font-size:1rem;margin-bottom:14px">Edit Chapter</h3>
    <div class="select-row">
      <label>Book</label>
      <select id="editBookSel" class="field" style="width:auto" onchange="APP.currentBook=+this.value;loadChapterEditor()">
        ${books.map(b => `<option value="${b.number}" ${b.number === APP.currentBook ? 'selected' : ''}>${esc(b.title || 'Book ' + b.number)}</option>`).join('')}
      </select>
      <label>Chapter</label>
      <select id="editChapSel" class="field" style="width:auto" onchange="APP.currentChapter=+this.value;loadChapterEditor()">
        ${(selBook?.roadmap?.chapters || []).map((ch, i) => `<option value="${i + 1}" ${i + 1 === APP.currentChapter ? 'selected' : ''}>Ch ${i + 1}: ${esc((ch.title || '').substring(0, 25))}</option>`).join('')}
      </select>
    </div>
    <div id="chapterEditorArea"></div>
  </div>`;

  renderChapterGrid(selBook, chapters);
  loadChapterEditor();
}

function renderChapterGrid(book, chapters) {
  const grid = document.getElementById('chapterGrid');
  if (!grid || !book?.roadmap) return;
  const planned = book.roadmap.chapters || [];
  let html = '<div class="chapter-grid">';
  planned.forEach((plan, i) => {
    const cn     = i + 1;
    const ch     = chapters.find(c => c.number === cn);
    const status = ch?.content ? ch.status || 'draft' : 'pending';
    const wc     = ch?.wordCount ? fmtWords(ch.wordCount) : '—';
    html += `<div class="ch-card ${status}" onclick="APP.currentChapter=${cn};loadChapterEditor();document.getElementById('editChapSel').value=${cn}">
      <h4>Ch ${cn}: ${esc((plan.title || '').substring(0, 28))}</h4>
      <div class="ch-meta">${wc} words</div>
      <span class="ch-status-badge ${status}">${status}</span>
    </div>`;
  });
  html += '</div>';
  grid.innerHTML = html;
}

function renderChapterGridLive(book, chapters) {
  if (APP.currentStep !== 3) return;
  renderChapterGrid(book, chapters);
}

async function loadChapterEditor() {
  const area = document.getElementById('chapterEditorArea');
  if (!area) return;
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === APP.currentBook);
  if (!book) return;
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  const ch       = chapters.find(c => c.number === APP.currentChapter);
  const plan     = book.roadmap?.chapters?.[APP.currentChapter - 1] || {};
  const hasAI    = isAIReady();

  area.innerHTML = `
    ${ch?.contradictions ? `<div class="status-msg show danger" style="margin-bottom:12px">⚠ Contradiction detected: ${esc(ch.contradictions.substring(0, 200))}</div>` : ''}
    ${ch?.continuityLog ? `<details style="margin-bottom:12px"><summary style="cursor:pointer;font-size:.8rem;color:var(--text-muted)">📋 Continuity log</summary><div class="scrollable-code">${esc(ch.continuityLog)}</div></details>` : ''}
    <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">
      <strong>Ch ${APP.currentChapter}: ${esc(plan.title || '')}</strong>
      ${plan.key_events ? ' · Events: ' + esc(safeJoin(plan.key_events, '; ').substring(0, 80)) : ''}</div>
    <textarea id="chapterContent" class="chapter-editor" placeholder="Chapter content will appear here…">${esc(ch?.content || '')}</textarea>
    <div class="word-count" id="chapterWc"></div>
    <div class="btn-row" style="margin-top:10px">
      ${hasAI ? `<button class="btn btn-accent btn-sm" onclick="genSingleChapter(${APP.currentBook},${APP.currentChapter})">🤖 Generate This Chapter</button>` : ''}
      ${hasAI && ch?.content ? `<button class="btn btn-secondary btn-sm" onclick="tightenSingleChapter(${APP.currentBook},${APP.currentChapter})">✂ Tighten</button>` : ''}
      ${ch?.content ? `<button class="btn btn-secondary btn-sm" onclick="detectContradictionsUI(${APP.currentBook},${APP.currentChapter})">🔍 Check Continuity</button>` : ''}
      <button class="btn btn-primary btn-sm" onclick="saveChapterEdit(${APP.currentBook},${APP.currentChapter})">💾 Save</button>
      ${ch?.status !== 'final' && ch?.content ? `<button class="btn btn-green btn-sm" onclick="markFinal(${APP.currentBook},${APP.currentChapter})">✅ Mark Final</button>` : ''}
    </div>
    <div id="chapEditStatus" class="status-msg"></div>`;
  attachWc('chapterContent', 'chapterWc', 500, 8000);
}

async function genSingleChapter(bookNum, chapterNum) {
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === bookNum);
  if (!book?.roadmap) { showToast('No roadmap for this book', 'warning'); return; }
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  if (chapters.some(c => c.number === chapterNum)) {
    showStatus('chapEditStatus', '⚠ Chapter already exists — delete it first or use Generate Everything to auto-skip', 'warning', 5000);
    return;
  }
  const priorFacts  = await DB.getByIndex('continuityFacts', 'by_project', project.id);
  const allFacts    = priorFacts.filter(f => (f.bookNum || f.book_num) < bookNum);
  const sameBookFacts = priorFacts.filter(f => (f.bookNum || f.book_num) === bookNum);
  showStatus('chapEditStatus', '🤖 Generating…', 'info', 0);
  try {
    const prompt  = await buildChapterPrompt({ project, book, chapterNum, chapters, allFacts, sameBookFacts });
    const content = cleanEmDash(await callAI(prompt));
    const wc      = countWords(content);
    document.getElementById('chapterContent').value = content;
    document.getElementById('chapterContent').dispatchEvent(new Event('input'));
    await saveChapterEdit(bookNum, chapterNum, content, 'draft', wc);
    // Extract continuity log
    try {
      const { logText, facts } = await extractContinuityFacts(project.id, bookNum, chapterNum, content);
      const allCh = await DB.getByIndex('chapters', 'by_book', book.id);
      const saved = allCh.find(c => c.number === chapterNum);
      if (saved) await DB.put('chapters', { ...saved, continuityLog: logText });
      for (const f of facts) await DB.put('continuityFacts', f);
    } catch (_) { console.warn('Continuity extract (non-fatal):', _); }
    showStatus('chapEditStatus', `✅ Generated (${fmtWords(wc)} words) — review and save`, 'success', 5000);
    loadChapterEditor();
  } catch (e) { showStatus('chapEditStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function tightenSingleChapter(bookNum, chapterNum) {
  const content = document.getElementById('chapterContent')?.value;
  if (!content) return;
  const project = await DB.get('projects', APP.currentProjectId);
  showStatus('chapEditStatus', '✂ Tightening…', 'info', 0);
  try {
    const result = cleanEmDash(await callAI(buildTightenPrompt(content, project.settings?.targetWordCount || 3000)));
    document.getElementById('chapterContent').value = result;
    document.getElementById('chapterContent').dispatchEvent(new Event('input'));
    await saveChapterEdit(bookNum, chapterNum, result, 'final', countWords(result));
    showStatus('chapEditStatus', `✅ Tightened to ${fmtWords(countWords(result))} words`, 'success', 5000);
  } catch (e) { showStatus('chapEditStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function detectContradictionsUI(bookNum, chapterNum) {
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === bookNum);
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  const ch       = chapters.find(c => c.number === chapterNum);
  if (!ch?.content) return;
  showStatus('chapEditStatus', '🔍 Checking continuity…', 'info', 0);
  try {
    const result = await detectContradictions(chapters, book.id, chapterNum, ch.content);
    if (result) {
      await DB.put('chapters', { ...ch, contradictions: result, status: 'needs-repair' });
      showStatus('chapEditStatus', '⚠ Contradictions found: ' + result.substring(0, 200), 'danger', 0);
    } else {
      showStatus('chapEditStatus', '✅ No contradictions detected', 'success', 5000);
    }
    loadChapterEditor();
  } catch (e) { showStatus('chapEditStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function saveChapterEdit(bookNum, chapterNum, content, status, wc) {
  content = content ?? document.getElementById('chapterContent')?.value;
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === bookNum);
  if (!book) return;
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  const existing = chapters.find(c => c.number === chapterNum);
  const plan     = book.roadmap?.chapters?.[chapterNum - 1] || {};
  const chObj = {
    id:             existing?.id || uid(),
    bookId:         book.id,
    book_id:        book.id,
    projectId:      project.id,
    workspace_id:   project.id,
    number:         chapterNum,
    title:          plan.title || 'Chapter ' + chapterNum,
    content:        content ?? '',
    status:         status ?? (existing?.status || 'draft'),
    wordCount:      wc ?? countWords(content ?? ''),
    continuityLog:  existing?.continuityLog || null,
    contradictions: existing?.contradictions || null,
    repairAttempts: existing?.repairAttempts || 0,
    generatedAt:    existing?.generatedAt || new Date().toISOString(),
  };
  await DB.put('chapters', chObj);
  if (!status) showStatus('chapEditStatus', '💾 Saved', 'success', 2000);
}

async function markFinal(bookNum, chapterNum) {
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === bookNum);
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  const ch       = chapters.find(c => c.number === chapterNum);
  if (ch) { await DB.put('chapters', { ...ch, status: 'final' }); showToast('Chapter marked final', 'success'); loadChapterEditor(); }
}

// ── STEP 4: FRONT MATTER ──────────────────────────────────────────────────────
async function renderStepFrontMatter(container, project) {
  const books  = await DB.getByIndex('books', 'by_project', project.id);
  books.sort((a, b) => a.number - b.number);
  const hasAI  = isAIReady();
  const tabs   = books.map(b => `<button class="btn btn-sm ${APP.currentBook === b.number ? 'btn-primary' : 'btn-secondary'}" onclick="APP.currentBook=${b.number};renderStep(4)">${esc((b.title || 'Book ' + b.number).substring(0, 18))}</button>`).join('');
  const book   = books.find(b => b.number === APP.currentBook);
  const fm     = book?.frontMatter || book?.front_matter || {};

  const fmFields = [
    { key: 'dedication',     label: 'Dedication',          rows: 3 },
    { key: 'prologue',       label: 'Prologue',             rows: 6 },
    { key: 'synopsis',       label: 'Synopsis (back cover)', rows: 5 },
    { key: 'blurb',          label: 'Back Cover Blurb',     rows: 4 },
    { key: 'authors_note',   label: "Author's Note",        rows: 4 },
    { key: 'acknowledgements', label: 'Acknowledgements',   rows: 4 },
    { key: 'readers_guide',  label: "Reader's Guide",       rows: 8 },
    { key: 'series_note',    label: 'Series Note',          rows: 3 },
  ];

  container.innerHTML = `
  <div class="step-card">
    <h2>📑 Front &amp; Back Matter</h2>
    <p class="step-desc">Generate the dedication, author's note, synopsis, blurb, and series note for each book.</p>
    <div class="btn-row" style="margin-bottom:16px">${tabs}</div>
    ${!book ? '<p style="color:var(--text-muted)">No books yet.</p>' : `
    ${hasAI ? `<button class="btn btn-accent" style="margin-bottom:16px" onclick="genFrontMatter(${book.number})">🤖 Generate All Front Matter</button>` : ''}
    <div id="fmStatus" class="status-msg"></div>
    <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px">Front matter: Dedication, Prologue. Back matter: Acknowledgements, Reader's Guide, Author's Note, Series Note.</p>
    ${fmFields.map(({ key, label, rows }) => `
    <div class="field-group">
      <label class="field-label">${label}</label>
      <textarea id="fm_${key}" class="field" rows="${rows}">${esc(fm[key] || '')}</textarea>
    </div>`).join('')}
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveFrontMatter(${book.number})">💾 Save Front Matter</button>
    </div>
    <div id="fmSaveStatus" class="status-msg"></div>
    `}
  </div>`;
}

async function genFrontMatter(bookNum) {
  const project  = await DB.get('projects', APP.currentProjectId);
  const books    = await DB.getByIndex('books', 'by_project', project.id);
  const book     = books.find(b => b.number === bookNum);
  if (!book) return;
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  const synopsis = chapters.slice(0, 3).map(c => c.content?.substring(0, 500)).join('\n');
  showStatus('fmStatus', '🤖 Generating front matter…', 'info', 0);
  const prompt = `Generate front & back matter for Book ${bookNum} of "${project.seriesPlan?.series_title || project.title || project.name}".
Book title: ${book.title || 'Book ' + bookNum}
Series bible: ${JSON.stringify(project.seriesPlan?.series_bible || {}).substring(0, 600)}
Story beginning: ${synopsis}
Output valid JSON with ALL these fields:
{"dedication":"(warm, 1-3 lines)","prologue":"(optional 300-500 word scene-setting prologue)","synopsis":"(100 words, back-cover style)","blurb":"(50 words, punchy back-cover hook)","authors_note":"(brief, warm 100-word author note)","acknowledgements":"(brief warm thank-yous)","readers_guide":"(5-8 discussion questions for book clubs)","series_note":"(teaser for next book)"}`;
  try {
    const r = await callAI(prompt);
    const d = JSON.parse(extractJSON(r));
    ['dedication', 'prologue', 'synopsis', 'blurb', 'authors_note', 'acknowledgements', 'readers_guide', 'series_note'].forEach(k => {
      const el = document.getElementById('fm_' + k);
      if (!el || !d[k]) return;
      el.value = Array.isArray(d[k]) ? d[k].join('\n') : d[k];
    });
    showStatus('fmStatus', '✅ Generated — review and save', 'success', 5000);
  } catch (e) { showStatus('fmStatus', '❌ ' + e.message, 'danger', 8000); }
}

async function saveFrontMatter(bookNum) {
  const project = await DB.get('projects', APP.currentProjectId);
  const books   = await DB.getByIndex('books', 'by_project', project.id);
  const book    = books.find(b => b.number === bookNum);
  if (!book) return;
  const fm = {};
  ['dedication', 'prologue', 'synopsis', 'blurb', 'authors_note', 'acknowledgements', 'readers_guide', 'series_note'].forEach(k => {
    const el = document.getElementById('fm_' + k);
    if (el) fm[k] = el.value;
  });
  await DB.put('books', { ...book, frontMatter: fm, front_matter: fm });
  showStatus('fmSaveStatus', '✅ Saved', 'success', 3000);
  showToast('Front matter saved', 'success');
}

// ── STEP 5: EXPORT ────────────────────────────────────────────────────────────
async function renderStepExport(container, project) {
  const books = await DB.getByIndex('books', 'by_project', project.id);
  books.sort((a, b) => a.number - b.number);

  const bookRows = books.map(b => {
    const fname = docxFilename(project, b.number, b.title);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:600">${esc(b.title || 'Book ' + b.number)}</div>
        <div style="font-size:.73rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fname)}</div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="exportBookTxt('${project.id}',${b.number})">📄 TXT</button>
      <button class="btn btn-secondary btn-sm" onclick="exportBookDocx('${project.id}',${b.number})">📝 DOCX</button>
    </div>`;
  }).join('');

  container.innerHTML = `
  <div class="step-card">
    <h2>📤 Export</h2>
    <p class="step-desc">Download your books in multiple formats. All exports are generated from the saved chapters in your project.</p>
    <div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <div style="font-weight:600;font-size:.9rem">📦 Download Complete Series</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">All book DOCXs + backup JSON + series bible in one ZIP</div>
      </div>
      <button id="downloadAllBtn" class="btn btn-primary" onclick="exportAllBooks('${project.id}')">📦 Download All Books (ZIP)</button>
    </div>
    <h3 style="font-family:var(--font-display);font-size:.95rem;margin-bottom:8px">Export Individual Book</h3>
    ${bookRows || '<p style="color:var(--text-muted)">No books with chapters yet.</p>'}
    <hr class="divider">
    <h3 style="font-family:var(--font-display);font-size:.95rem;margin-bottom:12px">Project Backup</h3>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="exportBackupJson('${project.id}')">💾 Download Full Backup (JSON)</button>
    </div>
    <p style="font-size:.78rem;color:var(--text-muted);margin-top:8px">Includes all chapters, roadmaps, continuity logs, and series data. Can be re-imported to restore.</p>
    <hr class="divider">
    <h3 style="font-family:var(--font-display);font-size:.95rem;margin-bottom:12px">Import</h3>
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:10px">Import a v4 backup or a v3 export JSON to restore a project.</p>
    <input type="file" id="importFile" accept=".json" style="display:none" onchange="handleImportExportPage(this)">
    <button class="btn btn-secondary" onclick="document.getElementById('importFile').click()">📥 Import Backup (v3 or v4)</button>
    <div id="importStatus" class="status-msg"></div>
  </div>`;
}

async function handleImportExportPage(input) {
  const file = input.files[0];
  if (!file) return;
  showStatus('importStatus', 'Importing…', 'info', 0);
  try {
    const id = await importV3Backup(file);
    showStatus('importStatus', '✅ Import complete', 'success', 3000);
    showToast('Project imported', 'success');
    setTimeout(() => openProject(id), 1500);
  } catch (e) { showStatus('importStatus', '❌ ' + e.message, 'danger', 8000); }
}

// ── STEP 6: DASHBOARD ─────────────────────────────────────────────────────────
async function renderDashboard(container, project) {
  container.innerHTML = `
  <div class="step-card">
    <h2>📊 Dashboard
      <span id="dashLiveIndicator" style="display:none;margin-left:10px;font-size:.7rem;font-weight:400;color:var(--green);background:var(--green-bg);border:1px solid var(--green-border);padding:2px 10px;border-radius:var(--radius-pill);vertical-align:middle">● Live</span>
    </h2>
    <p class="step-desc">Your project at a glance — updates automatically while generating.</p>
    <div class="dash-grid" id="dashStatGrid">
      <div class="dash-stat"><div class="ds-num" id="dsStat0">—</div><div class="ds-label">Complete</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat1">—</div><div class="ds-label">Chapters Written</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat2">—</div><div class="ds-label">Finalized</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat3">—</div><div class="ds-label">Total Words</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat4">—</div><div class="ds-label">Books</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat5">—</div><div class="ds-label">Drafts</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat6">—</div><div class="ds-label">Avg Words/Ch</div></div>
      <div class="dash-stat"><div class="ds-num" id="dsStat7">—</div><div class="ds-label">Needs Repair</div></div>
    </div>
    <h3 style="font-family:var(--font-display);font-size:.95rem;margin:20px 0 12px">Progress by Book</h3>
    <div id="dashBookBars"></div>
    <div id="dashChapterMap" style="margin-top:16px"></div>
  </div>`;

  await _updateDashboardStats(project.id);

  if (Orchestrator.isRunning()) {
    const ind = document.getElementById('dashLiveIndicator');
    if (ind) ind.style.display = 'inline';
  }

  if (APP.dashInterval) clearInterval(APP.dashInterval);
  APP.dashInterval = setInterval(async () => {
    if (APP.currentStep !== 6 || APP.currentProjectId !== project.id || !Orchestrator.isRunning()) {
      clearInterval(APP.dashInterval); APP.dashInterval = null;
      if (APP.currentStep === 6 && APP.currentProjectId === project.id) await _updateDashboardStats(project.id);
      const ind = document.getElementById('dashLiveIndicator');
      if (ind) ind.style.display = 'none';
      return;
    }
    await _updateDashboardStats(project.id);
    const ind = document.getElementById('dashLiveIndicator');
    if (ind) ind.style.display = 'inline';
  }, 2500);
}

async function _updateDashboardStats(projectId) {
  if (!document.getElementById('dsStat0')) return;
  const books       = await DB.getByIndex('books', 'by_project', projectId);
  books.sort((a, b) => a.number - b.number);
  const allChapters = await DB.getByIndex('chapters', 'by_project', projectId);
  const totalPlanned = books.reduce((s, b) => s + (b.roadmap?.chapters?.length || 0), 0);
  const totalWritten = allChapters.filter(c => c.content).length;
  const totalFinal   = allChapters.filter(c => c.status === 'final').length;
  const totalDraft   = allChapters.filter(c => c.status === 'draft').length;
  const totalRepair  = allChapters.filter(c => c.status === 'needs-repair').length;
  const totalWords   = allChapters.reduce((s, c) => s + (c.wordCount || 0), 0);
  const avgWords     = totalWritten ? Math.round(totalWords / totalWritten) : 0;
  const pct          = totalPlanned ? Math.round(totalWritten / totalPlanned * 100) : 0;

  const set = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== String(v)) el.textContent = v; };
  set('dsStat0', pct + '%');
  set('dsStat1', totalWritten);
  set('dsStat2', totalFinal);
  set('dsStat3', fmtWords(totalWords));
  set('dsStat4', books.length);
  set('dsStat5', totalDraft);
  set('dsStat6', fmtWords(avgWords));
  set('dsStat7', totalRepair);

  const barsEl = document.getElementById('dashBookBars');
  if (barsEl) {
    if (!books.length) { barsEl.innerHTML = '<p style="color:var(--text-muted)">No books yet.</p>'; }
    else {
      barsEl.innerHTML = books.map(b => {
        const bChaps   = allChapters.filter(c => c.bookId === b.id);
        const bWritten = bChaps.filter(c => c.content).length;
        const bPlanned = b.roadmap?.chapters?.length || 0;
        const bPct     = bPlanned ? Math.round(bWritten / bPlanned * 100) : 0;
        const bWords   = bChaps.reduce((s, c) => s + (c.wordCount || 0), 0);
        const generating = Orchestrator.isRunning() && bWritten < bPlanned && bWritten > 0;
        return `<div class="book-progress-row">
          <div class="bp-title">${esc((b.title || 'Book ' + b.number).substring(0, 18))}</div>
          <div class="bp-bar"><div class="bp-fill" style="width:${bPct}%;${generating ? 'background:var(--blue);animation:progressPulse 1.2s ease-in-out infinite alternate' : ''}"></div></div>
          <div class="bp-pct">${bPct}%</div>
          <div style="font-size:.72rem;color:var(--text-faint);width:90px;text-align:right">${bWritten}/${bPlanned} · ${fmtWords(bWords)}w</div>
        </div>`;
      }).join('');
    }
  }

  const mapEl = document.getElementById('dashChapterMap');
  if (mapEl && books.length) {
    let mapHtml = '<div style="font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint);margin-bottom:8px">Chapter Map</div>';
    books.forEach(b => {
      const bChaps  = allChapters.filter(c => c.bookId === b.id);
      const planned = b.roadmap?.chapters || [];
      if (!planned.length) return;
      mapHtml += `<div style="margin-bottom:10px">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:4px">${esc(b.title || 'Book ' + b.number)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px">`;
      planned.forEach((plan, i) => {
        const cn    = i + 1;
        const ch    = bChaps.find(c => c.number === cn);
        const st    = ch?.content ? ch.status || 'draft' : 'none';
        const colors = { final: 'var(--green)', draft: 'var(--amber)', 'needs-repair': 'var(--red)', none: 'var(--border-strong)' };
        const isGen = Orchestrator.isRunning() && st === 'none' && bChaps.some(c => c.number === cn - 1 && c.content);
        const wc    = ch?.wordCount ? fmtWords(ch.wordCount) : '—';
        const title = esc(plan.title || 'Chapter ' + cn);
        const tooltip = `Ch ${cn}: ${title} | ${st} | ${wc}w`;
        mapHtml += `<div title="${tooltip}" onclick="navigateToChapter(${b.number},${cn})" style="width:16px;height:16px;border-radius:3px;cursor:pointer;background:${isGen ? 'var(--blue)' : colors[st] || 'var(--border)'};${isGen ? 'animation:progressPulse 1s ease-in-out infinite alternate' : ''}"></div>`;
      });
      mapHtml += '</div></div>';
    });
    mapHtml += `<div style="display:flex;gap:12px;margin-top:8px;font-size:.72rem;color:var(--text-muted)">
      <span>⬛ Not started</span><span style="color:var(--amber)">■ Draft</span>
      <span style="color:var(--green)">■ Final</span><span style="color:var(--blue)">■ Generating</span>
    </div>`;
    mapEl.innerHTML = mapHtml;
  }
}

async function navigateToChapter(bookNum, chapterNum) {
  APP.currentBook    = bookNum;
  APP.currentChapter = chapterNum;
  await renderStep(3);
}

async function refreshDashboardIfActive(projectId) {
  if (APP.currentStep === 6 && APP.currentProjectId === projectId) {
    await _updateDashboardStats(projectId);
    const ind = document.getElementById('dashLiveIndicator');
    if (ind) ind.style.display = 'inline';
  }
}

// ── STEP 7: CONTINUITY LOG ────────────────────────────────────────────────────
async function renderContinuityLog(container, project) {
  const facts = await DB.getByIndex('continuityFacts', 'by_project', project.id);
  facts.sort((a, b) => (a.bookNum || a.book_num || 0) - (b.bookNum || b.book_num || 0) || (a.chapterNum || a.chapter_num || 0) - (b.chapterNum || b.chapter_num || 0));

  const byBook = {};
  facts.forEach(f => {
    const k = 'Book ' + (f.bookNum || f.book_num || '?');
    if (!byBook[k]) byBook[k] = [];
    byBook[k].push(f);
  });

  let html = '';
  if (!facts.length) {
    html = '<p style="color:var(--text-muted)">No continuity facts yet — generate some chapters first and the engine will extract facts automatically.</p>';
  } else {
    Object.entries(byBook).forEach(([bookLabel, bFacts]) => {
      html += `<h3 style="font-family:var(--font-display);font-size:.95rem;margin:16px 0 8px">${esc(bookLabel)}</h3>`;
      const byCat = {};
      bFacts.forEach(f => { if (!byCat[f.category]) byCat[f.category] = []; byCat[f.category].push(f); });
      Object.entries(byCat).forEach(([cat, items]) => {
        html += `<div style="margin-bottom:12px"><strong style="font-size:.78rem;text-transform:uppercase;color:var(--text-muted)">${esc(cat)}</strong><div style="margin-top:6px">`;
        items.forEach(f => { html += `<span class="fact-tag">Ch ${f.chapterNum || f.chapter_num || '?'}: ${esc(f.content.substring(0, 60))}</span>`; });
        html += '</div></div>';
      });
    });
  }

  container.innerHTML = `
  <div class="step-card">
    <h2>🧠 Continuity Log</h2>
    <p class="step-desc">Structured facts extracted from every chapter — characters, locations, clues, timeline, and unresolved threads. Used to prevent contradictions across books.</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <span class="inline-badge badge-blue">${facts.length} total facts</span>
      <button class="btn btn-secondary btn-sm" onclick="exportContinuityJson()">📤 Export as JSON</button>
    </div>
    ${html}
  </div>`;
}

async function exportContinuityJson() {
  const facts   = await DB.getByIndex('continuityFacts', 'by_project', APP.currentProjectId);
  const project = await DB.get('projects', APP.currentProjectId);
  download(JSON.stringify(facts, null, 2), 'application/json', slug(project.title || project.name) + '_continuity.json');
}

// ── STEP 8: CODEX ─────────────────────────────────────────────────────────────
let _codexFilter = 'character';
let _codexEditId = null;

async function renderStepCodex(container, project) {
  const entries  = await DB.getByIndex('codexEntries', 'by_project', project.id);
  const filtered = entries.filter(e => e.type === _codexFilter).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const typeMeta = {
    character: { icon: '🧑', label: 'Character', plural: 'Characters' },
    location:  { icon: '📍', label: 'Location',  plural: 'Locations'  },
    lore:      { icon: '📜', label: 'Lore Entry', plural: 'Lore'       },
    item:      { icon: '🔮', label: 'Item',       plural: 'Items'      },
  };
  const typesHtml = Object.entries(typeMeta).map(([key, { icon, plural }]) =>
    `<button class="btn btn-sm ${_codexFilter === key ? 'btn-primary' : 'btn-secondary'}" onclick="switchCodexType('${key}')" style="margin-right:6px">${icon} ${plural}</button>`
  ).join('');

  const editEntry = entries.find(e => e.id === _codexEditId);

  container.innerHTML = `
  <div class="step-card">
    <h2>📖 Codex</h2>
    <p class="step-desc">Your story bible — characters, locations, lore, and items. Everything here is injected into AI prompts for consistent world-building.</p>
    <div class="btn-row" style="margin-bottom:16px">${typesHtml}</div>
    <div style="display:grid;grid-template-columns:280px 1fr;gap:16px">
      <!-- List panel -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface-alt);border-bottom:1px solid var(--border)">
          <span style="font-size:.78rem;font-weight:600;color:var(--text-muted)">${typeMeta[_codexFilter]?.plural || 'Entries'} (${filtered.length})</span>
          <button class="btn btn-sm btn-primary" onclick="newCodexEntry('${_codexFilter}')">+ New</button>
        </div>
        <div style="max-height:420px;overflow-y:auto">
          ${filtered.length === 0
            ? `<div style="padding:20px;text-align:center;color:var(--text-faint);font-size:.82rem">No ${typeMeta[_codexFilter]?.plural || 'entries'} yet</div>`
            : filtered.map(e => {
                const active  = e.id === _codexEditId;
                const preview = e.description?.substring(0, 80) || '';
                const tags    = e.tags?.length ? e.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : '';
                return `<div class="home-project-row ${active ? 'selected' : ''}" onclick="selectCodexEntry('${e.id}')" style="padding:8px 10px;margin:0;border-radius:0;border-bottom:1px solid var(--border)">
                  <div class="home-proj-info">
                    <div class="home-proj-title">${esc(e.name || 'Unnamed')}</div>
                    <div style="font-size:.72rem;color:var(--text-faint);margin-top:2px">${preview ? esc(preview) + '…' : ''}</div>
                    ${tags ? `<div style="margin-top:3px">${tags}</div>` : ''}
                  </div>
                </div>`;
              }).join('')}
        </div>
      </div>
      <!-- Edit panel -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px">
        ${!editEntry
          ? `<div style="text-align:center;padding:40px 0;color:var(--text-faint);font-size:.85rem">Select or create a ${typeMeta[_codexFilter]?.label || 'entry'} to edit</div>`
          : `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-family:var(--font-display);font-size:1rem">${esc(editEntry.name || 'New Entry')}</h3>
            <button class="btn btn-red btn-sm" onclick="deleteCodexEntry()">🗑 Delete</button>
          </div>
          <div class="field-group"><label class="field-label">Name</label><input id="cxName" class="field" value="${esc(editEntry.name || '')}" oninput="markCodexDirty()" /></div>
          <div class="field-group"><label class="field-label">Aliases <span style="font-weight:400;color:var(--text-faint)">(comma-separated)</span></label><input id="cxAliases" class="field" value="${esc((editEntry.aliases || []).join(', '))}" oninput="markCodexDirty()" /></div>
          <div class="field-group"><label class="field-label">Tags</label><input id="cxTags" class="field" placeholder="protagonist, antagonist, suspect…" value="${esc((editEntry.tags || []).join(', '))}" oninput="markCodexDirty()" /></div>
          <div class="field-group"><label class="field-label">Description <span style="font-weight:400;color:var(--text-faint)">(visible to AI)</span></label><textarea id="cxDescription" class="field" rows="5" oninput="markCodexDirty()">${esc(editEntry.description || '')}</textarea></div>
          <div class="field-group"><label class="field-label">Author Notes <span style="font-weight:400;color:var(--text-faint)">(hidden from AI)</span></label><textarea id="cxNotes" class="field" rows="3" oninput="markCodexDirty()">${esc(editEntry.notes || '')}</textarea></div>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn btn-primary" onclick="saveCodexEntry()">💾 Save</button>
            <button class="btn btn-accent btn-sm" onclick="genCodexFromBible()">🤖 Fill from Series Bible</button>
            <span id="cxDirtyBadge" style="font-size:.72rem;color:var(--text-faint);align-self:center;display:none">unsaved changes</span>
          </div>
          <div id="cxStatus" class="status-msg"></div>`}
      </div>
    </div>
  </div>`;
}

async function switchCodexType(type) { _codexFilter = type; _codexEditId = null; await renderProjectStep(8); }
async function newCodexEntry(type) {
  _codexEditId = uid();
  await DB.put('codexEntries', { id: _codexEditId, projectId: APP.currentProjectId, type, name: '', aliases: [], tags: [], description: '', notes: '', fields: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await renderProjectStep(8);
}
async function selectCodexEntry(id) { _codexEditId = id; await renderProjectStep(8); }
async function deleteCodexEntry() {
  if (!_codexEditId) return;
  confirmDialog('Delete Entry', 'Remove this entry from the Codex?', async () => {
    await DB.del('codexEntries', _codexEditId);
    _codexEditId = null;
    await renderProjectStep(8);
    showToast('Entry deleted', 'info');
  });
}
function markCodexDirty() { const b = document.getElementById('cxDirtyBadge'); if (b) b.style.display = 'inline'; }

async function saveCodexEntry() {
  if (!_codexEditId) return;
  const name = (document.getElementById('cxName')?.value || '').trim();
  if (!name) { showStatus('cxStatus', '⚠ Name is required', 'warning', 3000); return; }
  const aliases     = (document.getElementById('cxAliases')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const tags        = (document.getElementById('cxTags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const description = document.getElementById('cxDescription')?.value || '';
  const notes       = document.getElementById('cxNotes')?.value || '';
  const existing    = await DB.get('codexEntries', _codexEditId);
  await DB.put('codexEntries', { ...existing, name, aliases, tags, description, notes, updatedAt: new Date().toISOString() });
  const b = document.getElementById('cxDirtyBadge'); if (b) b.style.display = 'none';
  showStatus('cxStatus', '✅ Saved', 'success', 2000);
  await renderProjectStep(8);
}

async function genCodexFromBible() {
  const project = await DB.get('projects', APP.currentProjectId);
  if (!project.seriesPlan?.series_bible) { showStatus('cxStatus', '⚠ Generate a Series Plan first', 'warning', 3000); return; }
  const bible    = project.seriesPlan.series_bible;
  showStatus('cxStatus', '🤖 Generating Codex entries from series bible…', 'info', 0);
  const existing = await DB.getByIndex('codexEntries', 'by_project', project.id);
  const entries  = [];
  const now      = new Date().toISOString();

  const addChar = (name, tags, desc) => {
    if (name && !existing.find(e => e.name === name))
      entries.push({ id: uid(), projectId: project.id, type: 'character', name, aliases: [], tags, description: desc || '', notes: '', fields: [], createdAt: now, updatedAt: now });
  };
  const addLoc = (name, desc) => {
    if (name && !existing.find(e => e.name === name))
      entries.push({ id: uid(), projectId: project.id, type: 'location', name, aliases: [], tags: [], description: desc || '', notes: '', fields: [], createdAt: now, updatedAt: now });
  };

  if (bible.protagonist?.name)   addChar(bible.protagonist.name,   ['protagonist'],   JSON.stringify(bible.protagonist));
  if (bible.love_interest?.name) addChar(bible.love_interest.name, ['love-interest'],  JSON.stringify(bible.love_interest));
  const sc = bible.side_characters || {};
  ['mentor', 'best_friend', 'antagonist_rival', 'enabler', 'deputy', 'sheriff', 'coroner'].forEach(key => {
    const ch   = sc[key];
    if (!ch) return;
    const name = typeof ch === 'string' ? ch : ch.name;
    if (name) addChar(name, [key], typeof ch === 'string' ? ch : JSON.stringify(ch));
  });
  if (bible.setting?.name) addLoc(bible.setting.name, JSON.stringify(bible.setting));

  const books = await DB.getByIndex('books', 'by_project', project.id);
  for (const book of books) {
    const rm = book.roadmap;
    if (!rm) continue;
    if (rm.case_lock?.victim?.name) addChar(rm.case_lock.victim.name, ['victim', 'book-' + book.number], JSON.stringify(rm.case_lock.victim));
    if (rm.case_lock?.killer?.name) addChar(rm.case_lock.killer.name, ['killer', 'book-' + book.number], JSON.stringify(rm.case_lock.killer));
    (rm.suspects || []).forEach(s => { if (s.name) addChar(s.name, ['suspect', 'book-' + book.number], JSON.stringify(s)); });
    (rm.location_registry || []).forEach(loc => { if (loc) addLoc(loc, ''); });
  }

  for (const e of entries) await DB.put('codexEntries', e);
  if (entries.length) {
    showStatus('cxStatus', `✅ Added ${entries.length} entries from series bible`, 'success', 5000);
    showToast(`Codex: ${entries.length} entries added`, 'success');
  } else {
    showStatus('cxStatus', 'ℹ All bible characters already in Codex', 'info', 4000);
  }
  await renderProjectStep(8);
}

// ── STEP 9: AI CHAT ───────────────────────────────────────────────────────────
let _chatSending = false;

async function renderStepChat(container, project) {
  const convs      = await DB.getByIndex('chatConversations', 'by_project', project.id);
  convs.sort((a, b) => new Date(b.updatedAt || b.updated_at) - new Date(a.updatedAt || a.updated_at));
  const currentConv = APP.currentConversationId ? convs.find(c => c.id === APP.currentConversationId) : null;
  const msgs        = currentConv ? await DB.getByIndex('chatMessages', 'by_conversation', currentConv.id) : [];
  msgs.sort((a, b) => new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at));
  const hasAI       = isAIReady();
  const providerName = aiProviderLabel();

  const convListHtml = convs.map(c => {
    const preview = c.last_preview || c.lastPreview || '';
    const date    = new Date(c.updatedAt || c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const active  = c.id === APP.currentConversationId;
    return `<div class="chat-conv-item ${active ? 'active' : ''}" onclick="selectChatConversation('${c.id}')">
      <div class="cct-title">${esc(c.title || 'New Chat')}</div>
      ${preview ? `<div class="cct-preview">${esc(preview.substring(0, 60))}</div>` : ''}
      <div class="cct-meta">${date}</div>
    </div>`;
  }).join('');

  const msgsHtml = msgs.map(m => {
    const time = new Date(m.createdAt || m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `<div class="chat-msg ${m.role}">
      <div class="cm-role">${m.role === 'user' ? 'You' : 'AI'}</div>
      <div class="cm-content">${esc(m.content)}</div>
      <div class="cm-time">${time}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
  <div class="step-card">
    <h2>💬 AI Chat</h2>
    <p class="step-desc">Chat with your AI writing assistant. Conversations are saved per project — brainstorm, refine, or ask questions about your story.</p>
    ${!hasAI ? `<div style="display:flex;align-items:center;gap:10px;background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:16px;font-size:.83rem;color:var(--amber)">
      <span>⚠</span><span>No AI configured. <button class="btn btn-sm btn-secondary" onclick="openSettings()" style="margin-left:4px">⚙ Settings</button></span>
    </div>` : `<div style="margin-bottom:12px"><span class="ai-badge">🤖 ${esc(providerName)}</span></div>`}
    <div class="chat-layout">
      <div class="chat-conv-list">
        <div class="chat-conv-header">
          <span>Conversations</span>
          <button class="btn btn-sm btn-primary" onclick="newChatConversation()">+ New</button>
        </div>
        <div class="chat-conv-scroll">
          ${convListHtml || `<div style="padding:20px;text-align:center;color:var(--text-faint);font-size:.82rem">No conversations yet</div>`}
        </div>
      </div>
      <div class="chat-main" id="chatMain">
        ${!currentConv ? `
          <div class="chat-empty">
            <div class="ce-icon">💬</div>
            <div class="ce-text">Select a conversation or start a new one</div>
            <button class="btn btn-primary btn-sm" onclick="newChatConversation()">+ New Conversation</button>
          </div>
        ` : `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--surface-alt)">
            <span style="font-size:.82rem;font-weight:600">${esc(currentConv.title || 'Chat')}</span>
            <button class="btn btn-sm btn-red" onclick="deleteChatConversation()" style="font-size:.7rem">🗑 Delete</button>
          </div>
          <div class="chat-msg-area" id="chatMsgArea">${msgsHtml || `<div style="text-align:center;color:var(--text-faint);padding:40px;font-size:.85rem">Send a message to start</div>`}</div>
          <div class="chat-input-area">
            <textarea id="chatInput" placeholder="Type your message… (Enter to send, Shift+Enter for newline)" oninput="chatAutoResize(this)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}"></textarea>
            <button class="chat-send-btn" id="chatSendBtn" onclick="sendChatMessage()">Send</button>
          </div>
        `}
      </div>
    </div>
    <div id="chatStatus" class="status-msg"></div>
  </div>`;

  const area = document.getElementById('chatMsgArea');
  if (area) area.scrollTop = area.scrollHeight;
  const inp = document.getElementById('chatInput');
  if (inp) setTimeout(() => inp.focus(), 100);
}

async function newChatConversation() {
  const id  = APP.currentConversationId = uid();
  const now = new Date().toISOString();
  await DB.put('chatConversations', { id, projectId: APP.currentProjectId, title: 'New Chat', lastPreview: '', last_preview: '', createdAt: now, updatedAt: now });
  await renderProjectStep(9);
}

async function selectChatConversation(id) { APP.currentConversationId = id; await renderProjectStep(9); }

async function deleteChatConversation() {
  const id = APP.currentConversationId;
  if (!id) return;
  confirmDialog('Delete Conversation', 'Remove this conversation and all its messages?', async () => {
    await DB.del('chatConversations', id);
    APP.currentConversationId = null;
    await renderProjectStep(9);
  });
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function sendChatMessage() {
  if (_chatSending) return;
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text           = input.value.trim();
  if (!text) return;
  const conversationId = APP.currentConversationId;
  if (!conversationId) return;
  const project = await DB.get('projects', APP.currentProjectId);
  if (!isAIReady()) { showStatus('chatStatus', '⚠ No AI configured — open ⚙ Settings', 'warning', 4000); return; }

  _chatSending = true;
  const sendBtn = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const now     = new Date().toISOString();
    const userMsg = { id: uid(), conversationId, projectId: APP.currentProjectId, role: 'user', content: text, createdAt: now };
    await DB.put('chatMessages', userMsg);

    const conv       = await DB.get('chatConversations', conversationId);
    const isNew      = conv.title === 'New Chat';
    const updTitle   = isNew ? text.substring(0, 60) : conv.title;
    await DB.put('chatConversations', { ...conv, title: updTitle, lastPreview: text.substring(0, 120), last_preview: text.substring(0, 120), updatedAt: now });

    input.value = '';
    input.style.height = 'auto';
    await renderProjectStep(9);

    const area = document.getElementById('chatMsgArea');
    if (area) {
      const typingEl = document.createElement('div');
      typingEl.className = 'chat-typing'; typingEl.id = 'chatTyping';
      typingEl.innerHTML = '<span>AI is thinking</span><div class="ct-dot"></div><div class="ct-dot"></div><div class="ct-dot"></div>';
      area.appendChild(typingEl); area.scrollTop = area.scrollHeight;
    }

    const allMsgs   = await DB.getByIndex('chatMessages', 'by_conversation', conversationId);
    allMsgs.sort((a, b) => new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at));
    const history   = allMsgs.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
    const systemCtx = project.genre ? `The user is writing a ${project.genre.replace('-', ' ')}. ` : '';
    const prompt    = history
      ? `${systemCtx}Previous conversation:\n${history}\n\nUser: ${text}\n\nRespond as a helpful fiction-writing assistant. Be concise, creative, and practical.`
      : `${systemCtx}User: ${text}\n\nRespond as a helpful fiction-writing assistant. Be concise, creative, and practical.`;

    const response  = await callAI(prompt);
    const aiMsg     = { id: uid(), conversationId, projectId: APP.currentProjectId, role: 'assistant', content: response, createdAt: new Date().toISOString() };
    await DB.put('chatMessages', aiMsg);
    await DB.put('chatConversations', { ...conv, title: updTitle, lastPreview: response.substring(0, 120), last_preview: response.substring(0, 120), updatedAt: new Date().toISOString() });
    await renderProjectStep(9);
  } catch (e) {
    showStatus('chatStatus', '⚠ Error: ' + e.message, 'danger', 6000);
    console.error('Chat error:', e);
  } finally {
    _chatSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Expose everything on window
Object.assign(window, {
  renderStep, renderProjectStep,
  renderStepDNA, saveDNA, genDNA,
  renderStepSeriesPlan, genSeriesPlan, saveSeriesPlan,
  renderStepRoadmaps, genRoadmap, saveRoadmap, genAllRoadmaps,
  _pipeGenSeriesPlan, _pipeGenRoadmap, _pipeGenFrontMatter,
  autoGenerateAll,
  renderStepChapters, renderChapterGrid, renderChapterGridLive, loadChapterEditor,
  genSingleChapter, tightenSingleChapter, detectContradictionsUI, saveChapterEdit, markFinal,
  renderStepFrontMatter, genFrontMatter, saveFrontMatter,
  renderStepExport, handleImportExportPage,
  renderDashboard, _updateDashboardStats, navigateToChapter, refreshDashboardIfActive,
  renderContinuityLog, exportContinuityJson,
  renderStepCodex, switchCodexType, newCodexEntry, selectCodexEntry, deleteCodexEntry,
  markCodexDirty, saveCodexEntry, genCodexFromBible,
  renderStepChat, newChatConversation, selectChatConversation, deleteChatConversation,
  chatAutoResize, sendChatMessage,
});
