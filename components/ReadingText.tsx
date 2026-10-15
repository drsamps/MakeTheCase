import React from 'react';
import MarkdownPreview from './caseWriter/MarkdownPreview';
import { MARKDOWN, PLAIN_TEXT } from '../utils/readingFormat.js';

/**
 * One case file (or outline) of a student reading, as GET /api/llm/case-data returns it in
 * `reading_parts`, with the format of its text (utils/readingFormat.js).
 */
export interface ReadingPart {
  kind: 'file' | 'outline';
  format: ReadingFormat;
  content: string;
}

export type ReadingFormat = typeof MARKDOWN | typeof PLAIN_TEXT;

// mammoth writes Word bookmarks as empty anchors (<a id="_Toc…"></a>), which would show as
// literal text because readings render without raw HTML. An empty anchor shows nothing in any
// Markdown reading, so they are dropped from all of them.
const stripEmptyAnchors = (text: string) => text.replace(/<a\s+id="[^"]*"\s*>\s*<\/a>/gi, '');

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
  /** The text's format: utils/readingFormat.js (readingFormatOf for a case_files row). */
  format: ReadingFormat;
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
const ReadingText: React.FC<Props> = ({ text, format, className, scaleWithText = false, emptyText }) => {
  if (format === MARKDOWN) {
    return <MarkdownPreview markdown={stripEmptyAnchors(text)} scaleWithText={scaleWithText} className={className} emptyText={emptyText} />;
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
