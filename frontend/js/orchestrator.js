/**
 * frontend/js/orchestrator.js
 * Orchestrator — manages the full generation queue (ported from v4.1).
 * Runs in the browser; calls backend AI endpoint for all text generation.
 */
'use strict';

const Orchestrator = (() => {
  let _running        = false;
  let _stopRequested  = false;
  let _currentProjectId = null;
  let _hideTimer      = null;

  async function run(projectId, options = {}) {
    if (_running) { showToast('Generation already running', 'warning'); return; }
    _running = true;
    _stopRequested = false;
    _currentProjectId = projectId;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

    const { startBook = 1, startChapter = 1 } = options;
    updateWorkerBar('Starting…', 0, 'running');
    let done = 0, skipped = 0, errors = 0;

    try {
      if (!isAIReady()) {
        showToast('No AI provider configured — open ⚙ Settings', 'danger');
        return;
      }

      const project = await DB.get('projects', projectId);
      const books   = await DB.getByIndex('books', 'by_project', projectId);
      books.sort((a, b) => a.number - b.number);
      const totalChapters = books.reduce((s, b) => s + (b.roadmap?.chapters?.length || 0), 0);

      for (const book of books) {
        if (_stopRequested) break;
        if (book.number < startBook) continue;
        const roadmap = book.roadmap;
        if (!roadmap?.chapters?.length) continue;

        const chapters    = await DB.getByIndex('chapters', 'by_book', book.id);
        const priorFacts  = await DB.getByIndex('continuityFacts', 'by_project', projectId);
        const prevBookFacts  = priorFacts.filter(f => (f.book_num || f.bookNum) < book.number);
        const sameBookFacts  = priorFacts.filter(f => (f.book_num || f.bookNum) === book.number);

        const chapStart = (book.number === startBook) ? startChapter : 1;
        for (let cn = chapStart; cn <= roadmap.chapters.length; cn++) {
          if (_stopRequested) break;
          const existing = chapters.find(c => c.number === cn);
          if (existing?.content?.trim()) { skipped++; continue; }

          const pct = Math.round(((done + skipped) / totalChapters) * 100);
          updateWorkerBar(`Book ${book.number} · Ch ${cn} — generating… (${done} done, ${skipped} skipped)`, pct, 'running');

          try {
            // ── GENERATE CHAPTER ──
            const prompt  = await buildChapterPrompt({ project, book, chapterNum: cn, chapters, allFacts: prevBookFacts, sameBookFacts });
            const content = cleanEmDash(await callAI(prompt));
            const wc      = countWords(content);
            const chId    = existing?.id || uid();
            const chObj   = {
              id:              chId,
              bookId:          book.id,
              book_id:         book.id,
              projectId,
              workspace_id:    projectId,
              number:          cn,
              title:           roadmap.chapters[cn - 1]?.title || 'Chapter ' + cn,
              content,
              status:          'draft',
              wordCount:       wc,
              repairAttempts:  0,
              generatedAt:     new Date().toISOString(),
              continuityLog:   null,
              contradictions:  null,
            };
            await DB.put('chapters', chObj);
            chapters.push(chObj);
            done++;

            // ── EXTRACT CONTINUITY LOG (non-fatal) ──
            updateWorkerBar(`Book ${book.number} · Ch ${cn} — extracting continuity…`, pct, 'running');
            try {
              const { logText, facts } = await extractContinuityFacts(projectId, book.number, cn, content);
              chObj.continuityLog = logText;
              await DB.put('chapters', chObj);
              if (facts.length) await api.continuity.batch(projectId, facts.map(f => ({
                id: f.id, book_num: f.bookNum || f.book_num, chapter_num: f.chapterNum || f.chapter_num,
                category: f.category, content: f.content,
              })));
              sameBookFacts.push(...facts);
            } catch (logErr) { console.warn('Continuity extraction failed (non-fatal):', logErr); }

            // ── VALIDATE WORD COUNT + AUTO-REPAIR ──
            const target = project.settings?.targetWordCount || 3000;
            const lo = Math.round(target * 0.8);
            const hi = Math.round(target * 1.25);
            if ((wc < lo || wc > hi) && project.settings?.autoRepair !== false && chObj.repairAttempts < 2) {
              updateWorkerBar(`Book ${book.number} · Ch ${cn} — tightening (${wc} words)…`, pct, 'running');
              try {
                const canonNames = _getCanonNames(project, book);
                const tightened  = cleanEmDash(await callAI(buildTightenPrompt(content, target, canonNames)));
                chObj.content = tightened;
                chObj.wordCount = countWords(tightened);
                chObj.status = 'final';
                chObj.repairAttempts = (chObj.repairAttempts || 0) + 1;
                await DB.put('chapters', chObj);
              } catch (repairErr) { console.warn('Tighten repair failed (non-fatal):', repairErr); }
            }

            // Refresh UI if this project is currently open
            if (APP.currentProjectId === projectId) {
              renderChapterGridLive && renderChapterGridLive(book, chapters);
              refreshDashboardIfActive && refreshDashboardIfActive(projectId);
            }

          } catch (e) {
            errors++;
            showToast(`Book ${book.number} Ch ${cn}: ${e.message}`, 'danger', 6000);
            await new Promise(r => setTimeout(r, 1500));
          }
        }
        prevBookFacts.push(...sameBookFacts);
      }

      const msg = `✅ Done — ${done} generated, ${skipped} skipped, ${errors} errors`;
      updateWorkerBar(msg, 100, 'done');
      showToast(msg, 'success');
      await DB.put('projects', { ...(await DB.get('projects', projectId)), status: done > 0 ? 'complete' : 'idle', updatedAt: new Date().toISOString() });
      if (APP.currentProjectId === projectId) await renderStep(APP.currentStep);

    } catch (e) {
      updateWorkerBar('Error: ' + e.message, 0, 'error');
      showToast('Generation error: ' + e.message, 'danger');
    } finally {
      _running = false;
      _stopRequested = false;
      _currentProjectId = null;
      _hideTimer = setTimeout(() => updateWorkerBar('', 0, 'hidden'), 6000);
    }
  }

  async function tightenAll(projectId, mode = 'draft-only') {
    if (_running) { showToast('Generation already running', 'warning'); return; }
    _running = true;
    _stopRequested = false;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    const modeLabel = { 'draft-only': 'Draft', 'finalize-only': 'Finalize', 'all': 'All' }[mode] || mode;
    updateWorkerBar(`Starting tighten pass (${modeLabel})…`, 0, 'running');
    let done = 0, skipped = 0, errors = 0;
    try {
      const project = await DB.get('projects', projectId);
      const books   = await DB.getByIndex('books', 'by_project', projectId);
      books.sort((a, b) => a.number - b.number);
      const all = [];
      for (const b of books) {
        const cs = await DB.getByIndex('chapters', 'by_book', b.id);
        all.push(...cs.map(c => ({ ...c, bookNum: b.number })));
      }
      const toTighten = all.filter(c => {
        if (!c.content) return false;
        if (mode === 'draft-only') return c.status === 'draft';
        if (mode === 'finalize-only') return true;
        return c.status !== 'final';
      });
      for (let i = 0; i < toTighten.length; i++) {
        if (_stopRequested) break;
        const ch = toTighten[i];
        updateWorkerBar(`Tightening Ch ${ch.number} of Book ${ch.bookNum}… (${done}/${toTighten.length})`, Math.round(i / toTighten.length * 100), 'running');
        try {
          const target    = project.settings?.targetWordCount || 3000;
          const canonNames = _getCanonNames(project, null);
          const result    = cleanEmDash(await callAI(buildTightenPrompt(ch.content, target, canonNames)));
          await DB.put('chapters', { ...ch, content: result, wordCount: countWords(result), status: 'final' });
          done++;
          if (APP.currentProjectId === projectId) refreshDashboardIfActive && refreshDashboardIfActive(projectId);
        } catch (e) { console.warn('Tighten failed (non-fatal):', e); errors++; await new Promise(r => setTimeout(r, 1500)); }
      }
      updateWorkerBar(`✅ Tightened ${done}, ${skipped} skipped, ${errors} errors`, 100, 'done');
      showToast(`Tighten ${modeLabel} complete — ${done} chapters`, 'success');
      if (APP.currentProjectId === projectId) await renderStep(APP.currentStep);
    } finally {
      _running = false;
      _stopRequested = false;
      _hideTimer = setTimeout(() => updateWorkerBar('', 0, 'hidden'), 6000);
    }
  }

  function stop()      { _stopRequested = true; showToast('Stopping after current chapter…', 'info'); }
  function isRunning() { return _running; }

  function _getCanonNames(project, book) {
    const bible = project.seriesPlan?.series_bible || {};
    const names = [];
    if (bible.protagonist?.name) names.push(bible.protagonist.name);
    if (bible.love_interest?.name) names.push(bible.love_interest.name);
    if (book?.roadmap?.suspects) book.roadmap.suspects.forEach(s => { if (s.name) names.push(s.name); });
    return names.join(', ');
  }

  return { run, tightenAll, stop, isRunning };
})();

// ── autoGenerateAll — one-click full generation ───────────────────────────────
async function autoGenerateAll() {
  const projectId = APP.currentProjectId;
  if (!projectId) return;
  showToast('Starting full generation — go make a cup of tea ☕', 'info', 4000);
  updateWorkerBar('Starting full generation…', 0, 'running');
  try {
    const project = await DB.get('projects', projectId);

    // 1 — Save DNA if not saved
    const dnaField = document.getElementById('dnaField');
    if (dnaField?.value) {
      const dna = dnaField.value;
      await DB.put('projects', { ...project, settings: { ...project.settings, dna }, updatedAt: new Date().toISOString() });
    }

    // 2 — Series plan
    if (!project.seriesPlan) {
      updateWorkerBar('Generating series plan…', 5, 'running');
      await genSeriesPlan();
      await saveSeriesPlan();
    }

    // 3 — Roadmaps
    const refreshedProject = await DB.get('projects', projectId);
    const maxBooks = refreshedProject.maxBooks || 5;
    for (let b = 1; b <= maxBooks; b++) {
      const books = await DB.getByIndex('books', 'by_project', projectId);
      const book  = books.find(x => x.number === b);
      if (!book?.roadmap) {
        updateWorkerBar(`Generating Book ${b} roadmap…`, Math.round(5 + (b / maxBooks) * 20), 'running');
        APP.currentBook = b;
        await genRoadmap(b);
        await saveRoadmap(b);
      }
    }

    // 4 — Chapters (Orchestrator handles all books)
    await Orchestrator.run(projectId, { startBook: 1, startChapter: 1 });

    // 5 — Front matter
    const freshBooks = await DB.getByIndex('books', 'by_project', projectId);
    freshBooks.sort((a, b) => a.number - b.number);
    for (const book of freshBooks) {
      if (!book.frontMatter?.dedication) {
        await genFrontMatter(book.id, projectId);
      }
    }
  } catch (e) {
    updateWorkerBar('Auto-generation error: ' + e.message, 0, 'error');
    showToast('Auto-generation error: ' + e.message, 'danger');
  }
}

window.Orchestrator    = Orchestrator;
window.autoGenerateAll = autoGenerateAll;
