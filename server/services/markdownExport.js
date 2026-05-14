// Minimal markdown → DOCX/PDF rendering for Case Writer exports.
//
// This is intentionally narrow: we only need to render the markdown that the
// Case Writer prompts emit (#/##/### headings, paragraphs, dash bullets,
// numbered lists, **bold** runs). It is NOT a general-purpose markdown
// renderer — anything beyond that gets passed through as plain text.

import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType
} from 'docx';
import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function splitInlineBold(line) {
  // Split a line into [{ text, bold }] runs based on **bold** spans.
  const parts = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });
  if (parts.length === 0) parts.push({ text: line, bold: false });
  return parts;
}

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', runs: splitInlineBold(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph();
      blocks.push({ type: 'heading', level: h[1].length, runs: splitInlineBold(h[2]) });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', runs: splitInlineBold(bullet[1]) });
      continue;
    }

    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({ type: 'numbered', runs: splitInlineBold(numbered[1]) });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
];

function runsToTextRuns(runs) {
  return runs.map(r => new TextRun({ text: r.text, bold: r.bold }));
}

export async function markdownToDocxBuffer(markdown) {
  const blocks = parseMarkdownBlocks(markdown);
  const children = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(new Paragraph({
        heading: HEADING_LEVELS[block.level] || HeadingLevel.HEADING_3,
        children: runsToTextRuns(block.runs)
      }));
    } else if (block.type === 'bullet') {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: runsToTextRuns(block.runs)
      }));
    } else if (block.type === 'numbered') {
      children.push(new Paragraph({
        numbering: { reference: 'cw-numbered', level: 0 },
        children: runsToTextRuns(block.runs)
      }));
    } else {
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        children: runsToTextRuns(block.runs)
      }));
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'cw-numbered',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.START
        }]
      }]
    },
    sections: [{ children }]
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function markdownToPdfBuffer(markdown) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 56 }); // ~0.78in margins
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const blocks = parseMarkdownBlocks(markdown);
      const writeRuns = (runs, fontSize) => {
        for (let i = 0; i < runs.length; i++) {
          const r = runs[i];
          doc.font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
          // Continue the line for all runs but the last.
          doc.text(r.text, { continued: i < runs.length - 1 });
        }
      };

      for (const block of blocks) {
        if (block.type === 'heading') {
          const size = block.level === 1 ? 20 : block.level === 2 ? 16 : block.level === 3 ? 13 : 12;
          doc.moveDown(0.6);
          writeRuns(block.runs, size);
          doc.moveDown(0.3);
        } else if (block.type === 'bullet') {
          doc.font('Helvetica').fontSize(11).text('•  ', { continued: true });
          writeRuns(block.runs, 11);
        } else if (block.type === 'numbered') {
          // PDFKit doesn't auto-number, so we just keep the text after the
          // marker the model already emitted (the marker was stripped during
          // parsing). For simplicity, render as a bullet with a dash.
          doc.font('Helvetica').fontSize(11).text('–  ', { continued: true });
          writeRuns(block.runs, 11);
        } else {
          writeRuns(block.runs, 11);
          doc.moveDown(0.4);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
