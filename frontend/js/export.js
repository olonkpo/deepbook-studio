/**
 * frontend/js/export.js
 * Export functions — ported from v4.1.
 * All file generation happens client-side; backend export routes used for large server-side zips.
 */
'use strict';

// ── TXT export ────────────────────────────────────────────────────────────────
async function exportBookTxt(projectId, bookNum) {
  const project  = await DB.get('projects', projectId);
  const books    = await DB.getByIndex('books', 'by_project', projectId);
  const book     = books.find(b => b.number === bookNum);
  if (!book) return;
  const chapters = await DB.getByIndex('chapters', 'by_book', book.id);
  chapters.sort((a, b) => a.number - b.number);
  let out = `${project.seriesPlan?.series_title || project.title || project.name}\n${book.title || 'Book ' + bookNum}\n\n`;
  chapters.forEach(ch => { out += ch.content + '\n\n---\n\n'; });
  download(out, 'text/plain', `${slug(project.title || project.name)}_book${bookNum}.txt`);
}

// ── Canonical DOCX filename ───────────────────────────────────────────────────
function docxFilename(project, bookNum, bookTitle) {
  const st = project.seriesPlan?.series_title || project.title || project.name;
  return `${slug(st)}_Book${bookNum}_${slug(bookTitle || 'Book_' + bookNum)}.docx`;
}

// ── Build DOCX blob ───────────────────────────────────────────────────────────
async function buildDocxBlob(projectId, bookNum, _optChapters) {
  const project  = await DB.get('projects', projectId);
  const books    = await DB.getByIndex('books', 'by_project', projectId);
  const book     = books.find(b => b.number === bookNum);
  if (!book) return null;
  const chapters = _optChapters || (await DB.getByIndex('chapters', 'by_book', book.id));
  chapters.sort((a, b) => a.number - b.number);

  const seriesTitle = project.seriesPlan?.series_title || project.title || project.name;
  const bookTitle   = book.title || 'Book ' + bookNum;
  const authorName  = project.authorName || project.author_name || project.settings?.authorName || '';
  const fm          = book.frontMatter || book.front_matter || {};

  function fmStr(v) { return Array.isArray(v) ? v.join('\n') : String(v || ''); }
  function xe(s) {
    return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[m]);
  }
  function mdRuns(line) {
    const parts = [];
    const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let last = 0, m;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(`<w:r><w:t xml:space="preserve">${xe(line.slice(last, m.index))}</w:t></w:r>`);
      if (m[1]) parts.push(`<w:r><w:rPr><w:b/></w:rPr><w:t>${xe(m[1])}</w:t></w:r>`);
      else      parts.push(`<w:r><w:rPr><w:i/></w:rPr><w:t>${xe(m[2])}</w:t></w:r>`);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(`<w:r><w:t xml:space="preserve">${xe(line.slice(last))}</w:t></w:r>`);
    return parts.join('');
  }
  function bodyXml(text) {
    if (!text) return '';
    return text.split(/\n/).map(line => {
      if (!line.trim()) return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
      if (line.startsWith('# '))  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>${mdRuns(line.slice(2))}</w:p>`;
      if (line.startsWith('## ')) return `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:jc w:val="center"/></w:pPr>${mdRuns(line.slice(3))}</w:p>`;
      return `<w:p><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="720"/><w:spacing w:after="0"/></w:pPr>${mdRuns(line)}</w:p>`;
    }).join('');
  }

  // Title page
  let docBody = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="2880" w:after="240"/></w:pPr><w:r><w:rPr><w:sz w:val="78"/><w:szCs w:val="78"/></w:rPr><w:t>${xe(bookTitle)}</w:t></w:r></w:p>`;
  docBody += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t>${xe(seriesTitle + ' · Book ' + bookNum)}</w:t></w:r></w:p>`;
  if (authorName) docBody += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="480" w:after="0"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t>${xe(authorName)}</w:t></w:r></w:p>`;
  docBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  // Front matter
  const ded = fmStr(fm.dedication);
  if (ded.trim()) { docBody += `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Dedication</w:t></w:r></w:p>`; docBody += bodyXml(ded); docBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`; }
  const prol = fmStr(fm.prologue);
  if (prol.trim()) { docBody += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Prologue</w:t></w:r></w:p>`; docBody += bodyXml(prol); docBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`; }

  // Chapters
  chapters.forEach((ch, i) => {
    if (i > 0) docBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    docBody += bodyXml(ch.content);
  });

  // Back matter
  const backMatter = [
    { key: 'acknowledgements', label: 'Acknowledgements' },
    { key: 'readers_guide',    label: "Reader's Guide"   },
    { key: 'authors_note',     label: "Author's Note"    },
    { key: 'series_note',      label: 'A Note on the Series' },
  ];
  backMatter.forEach(({ key, label }) => {
    const val = fmStr(fm[key]);
    if (val.trim()) {
      docBody += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
      docBody += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>${xe(label)}</w:t></w:r></w:p>`;
      docBody += bodyXml(val);
    }
  });

  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels  = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles   = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="480" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;

  return makeZipBlob({
    '[Content_Types].xml':          contentTypes,
    '_rels/.rels':                   rootRels,
    'word/document.xml':             doc,
    'word/styles.xml':               styles,
    'word/_rels/document.xml.rels':  docRels,
  });
}

// ── Single book DOCX export ───────────────────────────────────────────────────
async function exportBookDocx(projectId, bookNum) {
  try {
    const project = await DB.get('projects', projectId);
    const books   = await DB.getByIndex('books', 'by_project', projectId);
    const book    = books.find(b => b.number === bookNum);
    if (!book) return;
    const blob    = await buildDocxBlob(projectId, bookNum);
    downloadBlob(blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxFilename(project, bookNum, book.title));
    showToast(`Book ${bookNum} DOCX downloading…`, 'success');
  } catch (e) {
    showToast('DOCX export failed: ' + e.message, 'danger');
    console.error('DOCX export error', e);
  }
}

// ── Backup JSON export ────────────────────────────────────────────────────────
async function exportBackupJson(projectId) {
  const project  = await DB.get('projects', projectId);
  const books    = await DB.getByIndex('books', 'by_project', projectId);
  books.sort((a, b) => a.number - b.number);
  const chapters = await DB.getByIndex('chapters', 'by_project', projectId);
  chapters.sort((a, b) => (a.bookId || a.book_id || '').localeCompare(b.bookId || b.book_id || '') || a.number - b.number);
  const facts    = await DB.getByIndex('continuityFacts', 'by_project', projectId);
  facts.sort((a, b) => (a.book_num || a.bookNum || 0) - (b.book_num || b.bookNum || 0));
  const blob     = new Blob([JSON.stringify({ version: 4, exportDate: new Date().toISOString(), project, books, chapters, facts }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'application/json', `${slug(project.title || project.name)}_backup.json`);
}

// ── Download all books as ZIP ─────────────────────────────────────────────────
let _exportingAll = false;

async function exportAllBooks(projectId) {
  if (_exportingAll) { showToast('Export already in progress', 'warning'); return; }
  const btn = document.getElementById('downloadAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building ZIP…'; }
  _exportingAll = true;
  try {
    const project     = await DB.get('projects', projectId);
    const books       = await DB.getByIndex('books', 'by_project', projectId);
    books.sort((a, b) => a.number - b.number);
    const allChapters = await DB.getByIndex('chapters', 'by_project', projectId);
    const enc         = new TextEncoder();
    const zipFiles    = {};

    for (const book of books) {
      const chapters = allChapters.filter(c => (c.bookId || c.book_id) === book.id);
      if (!chapters.length) continue;
      const blob   = await buildDocxBlob(projectId, book.number, chapters);
      if (!blob) continue;
      const arrBuf = await blob.arrayBuffer();
      zipFiles[docxFilename(project, book.number, book.title)] = new Uint8Array(arrBuf);
    }

    const facts       = await DB.getByIndex('continuityFacts', 'by_project', projectId);
    const backupJson  = JSON.stringify({ version: 4, exportDate: new Date().toISOString(), project, books, chapters: allChapters, facts }, null, 2);
    zipFiles[`${slug(project.title || project.name)}_backup.json`] = enc.encode(backupJson);
    if (project.seriesPlan) {
      zipFiles[`${slug(project.title || project.name)}_series_bible.json`] = enc.encode(JSON.stringify(project.seriesPlan, null, 2));
    }

    const outerBlob = makeZipBlob(zipFiles);
    const seriesTitle = project.seriesPlan?.series_title || project.title || project.name;
    downloadBlob(outerBlob, 'application/zip', `${slug(seriesTitle)}_Complete_Series.zip`);
    showToast('All books packaged — downloading now', 'success');
  } catch (e) {
    showToast('Download All failed: ' + e.message, 'danger');
    console.error('Download All error', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📦 Download All Books (ZIP)'; }
    _exportingAll = false;
  }
}

// ── Import v3/v4 backup ───────────────────────────────────────────────────────
async function importV3Backup(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async e => {
      try {
        const d = JSON.parse(e.target.result);
        if (d.version === 4 && d.project) {
          // v4 format — restore directly
          await DB.put('projects', d.project);
          for (const b of (d.books   || [])) await DB.put('books',   b);
          for (const c of (d.chapters|| [])) await DB.put('chapters', c);
          for (const f of (d.facts   || [])) await DB.put('continuityFacts', f);
          resolve(d.project.id);
          return;
        }
        // v3 format — migrate
        const projectId = uid();
        const project = {
          id: projectId,
          title: d.seriesPlan?.series_title || 'Imported Project',
          genre: 'cozy-mystery',
          mode: d.settings?.mode || 'series',
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
            await DB.put('books', { id: bookId, projectId, workspace_id: projectId, number: +bNum, title: d.seriesPlan?.books?.[+bNum - 1]?.title || 'Book ' + bNum, roadmap, status: 'writing', createdAt: new Date().toISOString() });
            const bookChapters = (d.chapters || []).filter(c => c.book === +bNum);
            for (const ch of bookChapters) {
              await DB.put('chapters', { id: uid(), bookId, projectId, workspace_id: projectId, number: ch.chapter, title: '', content: ch.content || '', status: ch.status || 'draft', wordCount: countWords(ch.content || ''), continuityLog: d.continuityLogs?.[+bNum]?.[ch.chapter] || null, repairAttempts: 0, generatedAt: new Date().toISOString() });
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
  exportBookTxt, docxFilename, buildDocxBlob, exportBookDocx,
  exportBackupJson, exportAllBooks, importV3Backup,
});
