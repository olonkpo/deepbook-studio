/**
 * frontend/js/utils.js
 * Shared utility functions (ported from v4.1, adapted for fullstack).
 */
'use strict';

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function esc(s) {
  return s ? String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]) : '';
}

function countWords(t) { return t && t.trim() ? t.trim().split(/\s+/).length : 0; }
function fmtWords(n)   { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

function safeJoin(v, sep = ', ') {
  if (Array.isArray(v))  return v.join(sep);
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object') return JSON.stringify(v);
  return '';
}

function slug(s) { return (s || 'project').replace(/[^a-z0-9]/gi, '_').toLowerCase(); }

function cleanEmDash(text) {
  if (!text) return text;
  return text.replace(/\s*—\s*/g, ' - ');
}

// ── Toast notifications ────────────────────────────────────────────────────────
function showToast(msg, type = 'info', dur = 5000) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => {
    d.style.opacity = '0';
    d.style.transform = 'translateX(120%)';
    d.style.transition = 'all .3s';
    setTimeout(() => d.remove(), 300);
  }, dur);
}

// ── Inline status messages ────────────────────────────────────────────────────
function showStatus(id, msg, type = 'info', dur = 4000) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.className = 'status-msg show ' + type;
  el.textContent = msg;
  if (dur > 0) setTimeout(() => { el.className = 'status-msg'; }, dur);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function confirmDialog(title, msg, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOkBtn').onclick = () => { closeModal('confirmModal'); onOk(); };
  openModal('confirmModal');
}

// ── Sidebar collapse ──────────────────────────────────────────────────────────
function toggleSidebarGroup(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const nowCollapsed = el.classList.toggle('collapsed');
  let hdr = el.previousElementSibling;
  while (hdr && !hdr.classList.contains('sidebar-section')) hdr = hdr.previousElementSibling;
  if (hdr) hdr.classList.toggle('collapsed', nowCollapsed);
  DB.getSetting('sidebarGroups', {}).then(m => {
    m[id] = nowCollapsed;
    DB.setSetting('sidebarGroups', m);
  }).catch(() => {});
}

function restoreSidebarGroups() {
  DB.getSetting('sidebarGroups', {}).then(m => {
    Object.entries(m).forEach(([id, collapsed]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (collapsed) {
        el.classList.add('collapsed');
        let hdr = el.previousElementSibling;
        while (hdr && !hdr.classList.contains('sidebar-section')) hdr = hdr.previousElementSibling;
        if (hdr) hdr.classList.add('collapsed');
      }
    });
  }).catch(() => {});
}

// ── Word count badge ──────────────────────────────────────────────────────────
function attachWc(fieldId, wcId, min, max) {
  const f = document.getElementById(fieldId);
  const w = document.getElementById(wcId);
  if (!f || !w) return;
  function upd() {
    const n = countWords(f.value);
    w.textContent = n + ' words';
    w.className = 'word-count' + (n < min ? ' warn' : n > max ? ' over' : ' ok');
  }
  f.addEventListener('input', upd);
  upd();
}

// ── Clipboard copy helper ─────────────────────────────────────────────────────
function copyText(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  const val = el.value || el.textContent;
  navigator.clipboard.writeText(val).then(
    () => showToast('Copied to clipboard', 'success', 2000),
    () => showToast('Copy failed', 'danger'),
  );
}

// ── Download helpers ──────────────────────────────────────────────────────────
function download(text, type, name) {
  downloadBlob(new Blob([text], { type }), type, name);
}
function downloadBlob(blob, _type, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Worker / progress bar ─────────────────────────────────────────────────────
function updateWorkerBar(msg, pct, state = 'running') {
  const bar  = document.getElementById('workerBar');
  const txt  = document.getElementById('workerBarText');
  const fill = document.getElementById('workerBarFill');
  const hw   = document.getElementById('headerWorker');
  const hwt  = document.getElementById('headerWorkerText');
  if (!bar) return;
  if (state === 'hidden') {
    bar.classList.add('hidden');
    if (hw)  hw.className = 'header-worker idle';
    if (hwt) hwt.textContent = 'Idle';
    return;
  }
  bar.classList.remove('hidden', 'error', 'done');
  if (state === 'error') bar.classList.add('error');
  if (state === 'done')  bar.classList.add('done');
  txt.textContent = msg;
  fill.style.width = (pct || 0) + '%';
  if (hw)  hw.className = 'header-worker' + (state === 'running' ? '' : ' idle');
  if (hwt) hwt.textContent = state === 'running' ? 'Generating…' : state === 'done' ? 'Done' : 'Idle';
}

function stopGeneration() { Orchestrator.stop(); }

// ── ZIP helper (pure JS, no compression) ─────────────────────────────────────
const _crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : (c >>> 1);
  _crcTable[i] = c;
}
function _crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ _crcTable[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeZipBlob(files) {
  const enc = new TextEncoder();
  function wU16(buf, off, n) { buf[off] = n & 0xFF; buf[off + 1] = (n >> 8) & 0xFF; }
  function wU32(buf, off, n) { buf[off] = n & 0xFF; buf[off + 1] = (n >> 8) & 0xFF; buf[off + 2] = (n >> 16) & 0xFF; buf[off + 3] = (n >> 24) & 0xFF; }
  function concat(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }
  const _dosDate = ((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate();
  const _dosTime = (new Date().getHours() << 11) | (new Date().getMinutes() << 5) | (new Date().getSeconds() >> 1);
  const localChunks = [];
  const cdChunks    = [];
  let localOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = content instanceof Uint8Array ? content : enc.encode(content);
    const nm = enc.encode(name);
    const crc = _crc32(data);
    const sz = data.length;
    const nmLen = nm.length;

    const lh = new Uint8Array(30 + nmLen + sz);
    lh[0]=0x50;lh[1]=0x4B;lh[2]=0x03;lh[3]=0x04;
    wU16(lh,4,20); wU16(lh,10,_dosTime); wU16(lh,12,_dosDate);
    wU32(lh,14,crc); wU32(lh,18,sz); wU32(lh,22,sz);
    wU16(lh,26,nmLen);
    lh.set(nm,30); lh.set(data,30+nmLen);

    const cd = new Uint8Array(46 + nmLen);
    cd[0]=0x50;cd[1]=0x4B;cd[2]=0x01;cd[3]=0x02;
    wU16(cd,4,20); wU16(cd,6,20); wU16(cd,10,_dosTime); wU16(cd,12,_dosDate);
    wU32(cd,16,crc); wU32(cd,20,sz); wU32(cd,24,sz);
    wU16(cd,28,nmLen);
    wU32(cd,42,localOffset); cd.set(nm,46);

    localChunks.push(lh);
    cdChunks.push(cd);
    localOffset += lh.length;
  }

  const cdData = concat(cdChunks);
  const numFiles = localChunks.length;
  const eocd = new Uint8Array(22);
  eocd[0]=0x50;eocd[1]=0x4B;eocd[2]=0x05;eocd[3]=0x06;
  wU16(eocd,4,0); wU16(eocd,6,0);
  wU16(eocd,8,numFiles); wU16(eocd,10,numFiles);
  wU32(eocd,12,cdData.length); wU32(eocd,16,localOffset);
  return new Blob([concat([...localChunks, ...cdChunks, eocd])], { type: 'application/zip' });
}

// ── Genre label helper ────────────────────────────────────────────────────────
function genreLabel(g) {
  return {
    'cozy-mystery': '🔍 Cozy Mystery',
    'thriller':     '⚡ Thriller',
    'romance':      '💕 Romance',
    'fantasy':      '🧙 Fantasy',
    'sci-fi':       '🚀 Sci-Fi',
    'literary':     '📖 Literary Fiction',
  }[g] || g || 'Fiction';
}

// ── Extract JSON from AI response ─────────────────────────────────────────────
function extractJSON(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in AI response');
  return raw.substring(start, end + 1);
}

// Expose on window
Object.assign(window, {
  uid, esc, countWords, fmtWords, safeJoin, slug, cleanEmDash,
  showToast, showStatus, closeModal, openModal, confirmDialog,
  toggleSidebarGroup, restoreSidebarGroups, attachWc, copyText,
  download, downloadBlob, updateWorkerBar, stopGeneration,
  makeZipBlob, genreLabel, extractJSON,
});
