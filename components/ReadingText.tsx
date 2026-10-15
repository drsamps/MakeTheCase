import React from 'react';
import MarkdownPreview from './caseWriter/MarkdownPreview';

/**
 * One case file (or outline) of a student reading, as GET /api/llm/case-data returns it in
 * `reading_parts`. case_content is the same text joined, kept for the chat prompt.
 */
export interface ReadingPart {
  kind: 'file' | 'outline';
  file_format: string | null;
  content: string;
}

// Markdown sources: .md files, web pages and pasted text (stored as 'md'), and Word files
// (mammoth converts them to Markdown). PDF and .txt text has no Markdown structure: pdf-parse
// ends every visual line with one newline and never writes a blank line, so as Markdown a
// whole PDF would run into one paragraph.
const MARKDOWN_FORMATS = new Set(['md', 'markdown', 'docx', 'doc']);

/** The format to render a case file as: its file_format, else its filename's extension. */
export function readingFormatOf(fileFormat: string | null | undefined, filename?: string | null): string | null {
  if (fileFormat) return fileFormat.toLowerCase();
  const match = /\.([a-z0-9]+)$/i.exec(filename || '');
  return match ? match[1].toLowerCase() : null;
}

export function isMarkdownFormat(fileFormat: string | null | undefined): boolean {
  return MARKDOWN_FORMATS.has((fileFormat || '').toLowerCase());
}

// mammoth writes Word bookmarks as empty anchors (<a id="_Toc…"></a>), which show as literal
// text because readings render without raw HTML.
const stripWordBookmarks = (text: string) => text.replace(/<a id="[^"]*"><\/a>/g, '');

/**
 * Plain-text readings (PDF, .txt), one paragraph per line, as the reading panel always showed
 * them: a short line with no closing period or question mark is taken as a heading, and a line
 * wrapped in underscores is italic.
 */
const PlainReading: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('\n').filter((line) => line.trim() !== '').map((line, i) => {
      const p = line.trim();
      if (p.length < 50 && !p.endsWith('.') && !p.endsWith('?')) {
        return <h3 key={i} className="text-[1.25em] font-bold text-gray-800 mt-6 mb-2">{p}</h3>;
      }
      if (p.startsWith('_') && p.endsWith('_')) {
        return <p key={i} className="text-gray-700 mb-4 italic">{p.slice(1, -1)}</p>;
      }
      return <p key={i} className="text-gray-700 mb-4">{p}</p>;
    })}
  </>
);

interface Props {
  text: string;
  fileFormat: string | null | undefined;
  className?: string;
  /** Size text from `className` (the student font control) instead of fixed preview sizes. */
  scaleWithText?: boolean;
  emptyText?: string;
}

/**
 * A case file's text as students read it: Markdown sources through MarkdownPreview, PDF and
 * plain text line by line. The instructor's Case Files preview uses the same component, so the
 * two views match. Memoized: a long reading takes tens of milliseconds to parse, and the chat
 * screen re-renders on every turn.
 */
const ReadingText: React.FC<Props> = ({ text, fileFormat, className, scaleWithText = false, emptyText }) => {
  if (isMarkdownFormat(fileFormat)) {
    const markdown = fileFormat === 'docx' || fileFormat === 'doc' ? stripWordBookmarks(text) : text;
    return <MarkdownPreview markdown={markdown} scaleWithText={scaleWithText} className={className} emptyText={emptyText} />;
  }
  if (!text.trim()) {
    return <div className={className}><p className="text-gray-400 italic text-sm">{emptyText ?? ''}</p></div>;
  }
  return (
    <div className={className}>
      <PlainReading text={text} />
    </div>
  );
};

export default React.memo(ReadingText);
