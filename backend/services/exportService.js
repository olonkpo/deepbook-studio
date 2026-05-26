/**
 * backend/services/exportService.js
 * Exports a book to .docx, .pdf, or .txt format.
 *
 * Dependencies (in backend/package.json):
 *   docx    — Word document generation
 *   pdfkit  — PDF generation
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, PageBreak, LevelFormat, Header, Footer, PageNumber,
} = require('docx');
const PDFDocument = require('pdfkit');

// ── DOCX export ──────────────────────────────────────────────────────────────

async function toDocx(book) {
  const children = [];

  // Title page
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2880, after: 480 }, // ~2 inches top
      children: [
        new TextRun({ text: book.title, bold: true, size: 56, font: 'Georgia' }),
      ],
    }),
  );

  if (book.genre) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: book.genre, size: 28, color: '666666', font: 'Georgia' })],
      }),
    );
  }

  if (book.description) {
    children.push(
      new Paragraph({ children: [] }), // spacer
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: book.description, size: 22, color: '555555', italics: true })],
      }),
    );
  }

  // Page break before chapters
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Chapters
  for (const chapter of book.chapters || []) {
    // Chapter heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 480, after: 240 },
        children: [
          new TextRun({ text: chapter.title, bold: true, size: 36, font: 'Georgia' }),
        ],
      }),
    );

    // Chapter content — split by paragraph (double newline)
    const paragraphs = (chapter.content || '').split(/\n\n+/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      children.push(
        new Paragraph({
          spacing: { before: 0, after: 200 },
          indent: { firstLine: 720 }, // 0.5 inch first-line indent
          children: [
            new TextRun({ text: trimmed.replace(/\n/g, ' '), font: 'Georgia', size: 24 }),
          ],
        }),
      );
    }

    // Page break after each chapter (except last)
    if (chapter !== book.chapters[book.chapters.length - 1]) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 24 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: 'Georgia', color: '1a1a2e' },
          paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], size: 20, color: '888888' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ── PDF export ───────────────────────────────────────────────────────────────

function toPdf(book) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 90, right: 90 },
      info: {
        Title: book.title,
        Author: 'DeepBook Studio',
      },
    });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Title page ──
    doc.moveDown(4);
    doc.font('Times-BoldItalic').fontSize(28).text(book.title, { align: 'center' });
    if (book.genre) {
      doc.moveDown(0.5);
      doc.font('Times-Roman').fontSize(14).fillColor('#666666').text(book.genre, { align: 'center' });
    }
    if (book.description) {
      doc.moveDown(1);
      doc.font('Times-Italic').fontSize(12).fillColor('#555555').text(book.description, { align: 'center' });
    }

    // ── Chapters ──
    for (const chapter of book.chapters || []) {
      doc.addPage();
      doc.fillColor('#1a1a2e').font('Times-Bold').fontSize(18)
        .text(chapter.title, { align: 'left' });

      doc.moveDown(0.8);
      doc.fillColor('#222222').font('Times-Roman').fontSize(12);

      const paragraphs = (chapter.content || '').split(/\n\n+/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        doc.text(trimmed, { align: 'justify', indent: 24, lineGap: 2 });
        doc.moveDown(0.5);
      }
    }

    doc.end();
  });
}

// ── TXT export ───────────────────────────────────────────────────────────────

function toTxt(book) {
  const lines = [];
  const divider = '─'.repeat(60);

  lines.push(book.title.toUpperCase());
  if (book.genre)       lines.push(`Genre: ${book.genre}`);
  if (book.description) lines.push(`\n${book.description}`);
  lines.push(`\n${divider}\n`);

  for (let i = 0; i < (book.chapters || []).length; i++) {
    const ch = book.chapters[i];
    lines.push(`CHAPTER ${i + 1}: ${ch.title.toUpperCase()}`);
    lines.push(divider);
    lines.push('');
    lines.push(ch.content || '');
    lines.push('\n');
  }

  return lines.join('\n');
}

module.exports = { toDocx, toPdf, toTxt };
