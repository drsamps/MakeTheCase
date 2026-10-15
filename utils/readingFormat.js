/**
 * How a case file's text renders for students (components/ReadingText.tsx): as Markdown, or as
 * plain text one paragraph per line. The one rule the server (GET /api/llm/case-data) and the
 * dashboard (Case Files → Text → Preview) both use, so the two views match.
 *
 * The format belongs to the TEXT, not the original file: pdf-parse text has one line per visual
 * line and no blank lines, so as Markdown a whole PDF would run into one paragraph, while a .docx
 * is Markdown when mammoth's Markdown conversion worked and plain text when it fell back. It is
 * stored in case_files.text_format (migration 087) wherever the text is produced.
 */

export const MARKDOWN = 'markdown';
export const PLAIN_TEXT = 'text';

/**
 * convertFile's `format` (services/fileConverter.js) as a reading format.
 * @param {string|null|undefined} format
 * @returns {'markdown'|'text'}
 */
export function textFormatOfConversion(format) {
  return format === 'markdown' || format === 'docx-markdown' ? MARKDOWN : PLAIN_TEXT;
}

// Rows from before migration 087 have no text_format: md, web pages and pasted text are
// Markdown, and Word files almost always converted to Markdown.
const MARKDOWN_FILE_FORMATS = new Set(['md', 'markdown', 'docx', 'doc']);

/**
 * A case file's reading format: its stored text_format, else a guess from file_format or the
 * filename's extension.
 * @param {{ text_format?: string|null, file_format?: string|null, filename?: string|null }} file
 * @returns {'markdown'|'text'}
 */
export function readingFormatOf(file) {
  const stored = file?.text_format;
  if (stored === MARKDOWN || stored === PLAIN_TEXT) return stored;
  const ext = /\.([a-z0-9]+)$/i.exec(file?.filename || '')?.[1];
  const format = String(file?.file_format || ext || '').toLowerCase();
  return MARKDOWN_FILE_FORMATS.has(format) ? MARKDOWN : PLAIN_TEXT;
}
