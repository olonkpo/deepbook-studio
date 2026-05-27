/**
 * frontend/js/continuity.js
 * Continuity engine — ported from v4.1 with DB/callAI adapted for fullstack.
 */
'use strict';

async function buildCanonicalRegistry(project, roadmap, projectId) {
  const bible   = project.seriesPlan?.series_bible || {};
  const rm      = roadmap || {};
  const names   = [];
  const locs    = [];

  if (bible.protagonist?.name)  names.push(bible.protagonist.name);
  if (bible.love_interest?.name) names.push(bible.love_interest.name);
  const sc = bible.side_characters || {};
  ['mentor', 'enabler', 'antagonist_rival', 'best_friend', 'deputy', 'sheriff', 'coroner'].forEach(f => {
    if (!sc[f]) return;
    if (typeof sc[f] === 'string') names.push(sc[f]);
    else if (sc[f].name) names.push(sc[f].name);
  });
  if (rm.case_lock?.victim?.name)  names.push(rm.case_lock.victim.name);
  if (rm.case_lock?.killer?.name)  names.push(rm.case_lock.killer.name);
  if (Array.isArray(rm.suspects)) rm.suspects.forEach(s => { if (s.name && !names.includes(s.name)) names.push(s.name); });
  if (Array.isArray(rm.canonical_name_register)) rm.canonical_name_register.forEach(n => { if (n && !names.includes(n)) names.push(n); });
  if (bible.setting?.name) locs.push(bible.setting.name);
  if (Array.isArray(rm.location_registry)) rm.location_registry.forEach(l => { if (l && !locs.includes(l)) locs.push(l); });

  // Add Codex entries
  try {
    const entries = await DB.getByIndex('codexEntries', 'by_project', projectId);
    if (entries) {
      entries.filter(e => e.type === 'character').forEach(c => { if (c.name && !names.includes(c.name)) names.push(c.name); });
      entries.filter(e => e.type === 'location').forEach(l => { if (l.name && !locs.includes(l.name)) locs.push(l.name); });
    }
  } catch (e) { /* non-critical */ }

  const sections = [];
  if (names.length) sections.push('CANONICAL CHARACTER NAMES (use exactly as written):\n' + names.map(n => '  - ' + n).join('\n'));
  if (locs.length)  sections.push('CANONICAL LOCATIONS (use exactly as written):\n' + locs.map(l => '  - ' + l).join('\n'));
  return sections.join('\n\n');
}

async function buildCodexBlock(projectId, chapterNum) {
  const entries = await DB.getByIndex('codexEntries', 'by_project', projectId);
  if (!entries || !entries.length) return '';
  const chars = entries.filter(e => e.type === 'character').slice(0, 15);
  const locs  = entries.filter(e => e.type === 'location').slice(0, 10);
  const lore  = entries.filter(e => e.type === 'lore').slice(0, 8);
  const items = entries.filter(e => e.type === 'item').slice(0, 8);
  const parts = [];
  if (chars.length) parts.push('CHARACTERS:\n' + chars.map(c => '  - ' + c.name + (c.tags?.length ? ' (' + c.tags.join(', ') + ')' : '') + (c.description ? ' — ' + c.description.substring(0, 200) : '')).join('\n'));
  if (locs.length)  parts.push('LOCATIONS:\n'  + locs.map(l  => '  - ' + l.name + (l.description  ? ' — ' + l.description.substring(0, 200)  : '')).join('\n'));
  if (lore.length)  parts.push('LORE:\n'       + lore.map(l  => '  - ' + l.name + (l.description  ? ' — ' + l.description.substring(0, 200)  : '')).join('\n'));
  if (items.length) parts.push('ITEMS:\n'      + items.map(i => '  - ' + i.name + (i.description  ? ' — ' + i.description.substring(0, 200)  : '')).join('\n'));
  return parts.length ? 'CODEX — Story Bible (use these names and details exactly):\n\n' + parts.join('\n\n') : '';
}

function buildClueExclusionList(roadmap, chapterNum) {
  if (!roadmap?.chapters || chapterNum <= 1) return '';
  const used = [];
  for (let i = 0; i < chapterNum - 1 && i < roadmap.chapters.length; i++) {
    const prev = roadmap.chapters[i];
    if (!prev) continue;
    if (Array.isArray(prev.evidence_introduced)) prev.evidence_introduced.forEach(e => { if (e && !used.includes(String(e))) used.push(String(e)); });
    else if (prev.evidence_introduced) { const s = String(prev.evidence_introduced); if (!used.includes(s)) used.push(s); }
  }
  if (!used.length) return '';
  return 'CLUES ALREADY INTRODUCED — do NOT re-introduce:\n' + used.map(e => '  - ' + e).join('\n');
}

function buildContinuityBlock(chapters, bookId, chapterNum) {
  const logs = [];
  for (let i = Math.max(1, chapterNum - 2); i < chapterNum; i++) {
    const ch = chapters.find(c => c.number === i);
    if (ch?.continuityLog) logs.push('--- End-of-Chapter-' + i + ' log ---\n' + ch.continuityLog);
  }
  if (!logs.length) return '';
  return 'CONTINUITY FROM PRIOR CHAPTERS (treat as ground truth):\n' + logs.join('\n');
}

function buildCrossBookMemory(facts) {
  if (!facts || !facts.length) return '';
  const byCategory = {};
  facts.forEach(f => {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f.content);
  });
  const parts = ['SERIES MEMORY (established facts from prior books — treat as canonical):'];
  Object.entries(byCategory).forEach(([cat, items]) => {
    parts.push(cat.toUpperCase() + ':');
    items.forEach(c => parts.push('  - ' + c));
  });
  return parts.join('\n');
}

async function extractContinuityFacts(projectId, bookNum, chapterNum, content, _settings, canonicalNames = '') {
  const canonBlock = canonicalNames ? `CANONICAL NAMES (use these exact names in the log): ${canonicalNames}\n\n` : '';
  const prompt = `You just wrote Chapter ${chapterNum} of Book ${bookNum}. Extract a CONTINUITY LOG in this exact format — one bullet per line, no prose:
- Key facts established:
- Character locations at chapter end:
- Day/time at chapter end:
- Clues revealed this chapter:
- Suspects cleared or newly suspicious:
- Unresolved threads:

${canonBlock}CHAPTER:
${content.substring(0, 8000)}`;
  const logText = await callAI(prompt);

  const facts = [];
  const sectionHeaders = [
    { re: /key facts/i,           cat: 'character' },
    { re: /character locations/i, cat: 'location'  },
    { re: /day\/time/i,           cat: 'timeline'  },
    { re: /clues revealed/i,      cat: 'clue'      },
    { re: /suspects/i,            cat: 'character' },
    { re: /unresolved threads/i,  cat: 'thread'    },
  ];
  let currentCat = 'character';
  logText.split('\n').forEach(line => {
    const trimmed = line.trim();
    const hdr = sectionHeaders.find(h => h.re.test(trimmed));
    if (hdr) currentCat = hdr.cat;
    else if (trimmed.startsWith('-') && trimmed.length > 2) {
      facts.push({ id: uid(), projectId, bookNum, chapterNum, category: currentCat, content: trimmed.replace(/^-\s*/, ''), createdAt: new Date().toISOString() });
    }
  });
  return { logText, facts };
}

async function detectContradictions(chapters, bookId, chapterNum, newContent, _settings, canonicalNames = '') {
  const priorChapters = chapters.filter(c => c.number < chapterNum && c.continuityLog);
  if (!priorChapters.length) return null;
  const priorLogs   = priorChapters.slice(-3).map(c => `Ch ${c.number} log:\n${c.continuityLog}`).join('\n---\n');
  const canonBlock  = canonicalNames ? `CANONICAL NAMES (check these are used consistently): ${canonicalNames}\n\n` : '';
  const prompt = `Review this new chapter against the established continuity logs. List any contradictions (character names wrong, timeline violations, clues re-revealed, location errors). If none, output exactly: NONE

${canonBlock}ESTABLISHED CONTINUITY:
${priorLogs}

NEW CHAPTER (excerpt):
${newContent.substring(0, 5000)}`;
  const result = await callAI(prompt);
  return result.trim() === 'NONE' ? null : result;
}

Object.assign(window, {
  buildCanonicalRegistry,
  buildCodexBlock,
  buildClueExclusionList,
  buildContinuityBlock,
  buildCrossBookMemory,
  extractContinuityFacts,
  detectContradictions,
});
