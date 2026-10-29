import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ReadingText, { type ReadingFormat } from '../ReadingText';
import { MARKDOWN, PLAIN_TEXT } from '../../utils/readingFormat.js';
import {
  countImages, countLinks, markdownToText, removeImages, removeLinks, textToMarkdown,
} from '../../utils/readingMarkdown.js';

const MarkdownCodeEditor = React.lazy(() => import('./MarkdownCodeEditor'));

/** The text as first extracted or fetched, and its format. */
export interface OriginalText {
  text: string;
  format: ReadingFormat;
}

interface Props {
  value: string;
  format: ReadingFormat;
  /** Every change to the text, with the format it is now in (Auto-format and Text only change it). */
  onChange: (value: string, format: ReadingFormat) => void;
  /** For Restore auto-format; null or absent for pasted text, which has no extraction. */
  original?: OriginalText | null;
  /** Extra details after the word count (e.g. "fetched 10/8/2026"). */
  meta?: React.ReactNode;
  /** Shown at the right of the header row (e.g. "Unsaved changes"). */
  status?: React.ReactNode;
  placeholder?: string;
}

const MIN_HEIGHT = 200;
const DEFAULT_HEIGHT = 460;
const PREVIEW_DELAY_MS = 250;
const VIEW_KEY = 'mtc_reading_editor_view';

function readView(): { toolbar: boolean; preview: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return { toolbar: stored.toolbar !== false, preview: stored.preview !== false };
  } catch {
    return { toolbar: true, preview: true };
  }
}

function writeView(view: { toolbar: boolean; preview: boolean }) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // A private window or blocked storage: the choice just isn't remembered.
  }
}

const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

/** If EasyMDE fails to load (or throws), the plain textarea takes over. */
class EditorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[ReadingEditor] Markdown editor unavailable; using a plain text box.', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The text a case file contributes to the chat prompt and the student reading: a Markdown editor
 * with a toolbar, beside a preview drawn by ReadingText, the renderer students see. Used by the
 * Add-from-web / Paste review and the Extracted Text window.
 *
 * Reading-changing actions (utils/readingMarkdown.js; nothing is saved until the caller saves):
 * - Restore auto-format: the original extraction with its automatic formatting (a web page or
 *   Word file as converted; a PDF's text run through Auto-format).
 * - Text only: strip the formatting from what is in the box; students see plain paragraphs.
 * - Auto-format this text: only while the text is plain. Restoring and re-deriving are separate
 *   buttons on purpose: re-deriving a web page's structure from its plain text loses most of it.
 * - Remove links / Remove images: shown only when there are some.
 * Plain text is edited in a plain box: Markdown typed there would show its symbols to students.
 */
const ReadingEditor: React.FC<Props> = ({ value, format, onChange, original, meta, status, placeholder }) => {
  const [view, setView] = useState(readView);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [note, setNote] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(value);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setPreviewText(value), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const updateView = (change: Partial<typeof view>) => {
    const next = { ...view, ...change };
    setView(next);
    writeView(next);
  };

  // The original's automatic formatting: as converted for Markdown sources, Auto-format for plain.
  const autoFormatted = useMemo(
    () => (original ? (original.format === MARKDOWN ? original.text : textToMarkdown(original.text)) : null),
    [original],
  );
  const isMarkdown = format === MARKDOWN;
  const links = useMemo(() => (isMarkdown ? countLinks(value) : 0), [isMarkdown, value]);
  const images = useMemo(() => (isMarkdown ? countImages(value) : 0), [isMarkdown, value]);
  const showingAutoFormat = autoFormatted !== null && isMarkdown && value === autoFormatted;
  // Edits that a Restore would throw away: the text is neither the extraction nor its formatting.
  const hasHandEdits = original ? value !== original.text && value !== autoFormatted : value.trim() !== '';

  const apply = (text: string, nextFormat: ReadingFormat, message: string | null) => {
    onChange(text, nextFormat);
    setNote(message);
  };

  const handleRestore = () => {
    if (autoFormatted === null) return;
    if (hasHandEdits && !confirm('Put back the automatic formatting of the original text? Your edits will be replaced.')) return;
    apply(autoFormatted, MARKDOWN, 'Automatic formatting restored. Undo in the toolbar takes it back.');
  };

  const handleTextOnly = () => {
    const plain = markdownToText(value);
    const lost = [links && `${links} link${links === 1 ? '' : 's'}`, images && `${images} image${images === 1 ? '' : 's'}`]
      .filter(Boolean).join(' and ');
    apply(plain, PLAIN_TEXT, `Formatting removed${lost ? `, including ${lost}` : ''}. Students see plain paragraphs.`);
  };

  const handleAutoFormat = () => {
    const formatted = textToMarkdown(value);
    apply(formatted, MARKDOWN, formatted === value
      ? 'This text already looks like Markdown, so it was left as it is.'
      : 'Formatted automatically. Check the headings: they are guessed from the shape of each line.');
  };

  const handleRemoveLinks = () => {
    if (!confirm(`Remove ${links} link${links === 1 ? '' : 's'}? The linked words stay in the text.`)) return;
    const result = removeLinks(value);
    apply(result.text, MARKDOWN, `Removed ${result.removed} link${result.removed === 1 ? '' : 's'}; the linked words stay.`);
  };

  const handleRemoveImages = () => {
    if (!confirm(`Remove ${images} image${images === 1 ? '' : 's'} and their descriptions?`)) return;
    const result = removeImages(value);
    apply(result.text, MARKDOWN, `Removed ${result.removed} image${result.removed === 1 ? '' : 's'}.`);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startY: e.clientY, startHeight: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setHeight(Math.max(MIN_HEIGHT, dragRef.current.startHeight + e.clientY - dragRef.current.startY));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const plainBox = (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value, format)}
      placeholder={placeholder}
      style={{ height }}
      className="w-full border rounded p-3 font-mono text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
      spellCheck
    />
  );

  const actionButton = 'px-3 py-1 text-xs border rounded bg-white text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-white';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-xs text-gray-500">
          {wordCount(value).toLocaleString()} words &middot; {value.length.toLocaleString()} characters &middot;{' '}
          <span title={isMarkdown ? 'Headings, lists, bold and links show formatted' : 'Each line shows as a paragraph'}>
            {isMarkdown ? 'Markdown' : 'plain text'}
          </span>
          {meta}
        </span>
        {status}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-1" role="toolbar" aria-label="Reading formatting">
        {autoFormatted !== null && (
          <button
            type="button"
            onClick={handleRestore}
            disabled={showingAutoFormat}
            className={actionButton}
            title="Put back the original text with its automatic formatting"
          >
            Restore auto-format
          </button>
        )}
        <button
          type="button"
          onClick={handleTextOnly}
          disabled={!isMarkdown}
          className={actionButton}
          title="Remove headings, lists, bold and links, keeping every word"
        >
          Text only
        </button>
        {!isMarkdown && (
          <button
            type="button"
            onClick={handleAutoFormat}
            disabled={!value.trim()}
            className={actionButton}
            title="Guess headings, lists and paragraphs from the shape of each line"
          >
            Auto-format this text
          </button>
        )}
        {links > 0 && (
          <button type="button" onClick={handleRemoveLinks} className={actionButton} title="Unlink every link; the linked words stay">
            Remove links ({links})
          </button>
        )}
        {images > 0 && (
          <button type="button" onClick={handleRemoveImages} className={actionButton} title="Remove every image and its description">
            Remove images ({images})
          </button>
        )}
        <span className="mx-1 h-5 border-l" aria-hidden="true" />
        {isMarkdown && (
          <button type="button" onClick={() => updateView({ toolbar: !view.toolbar })} className={actionButton} aria-pressed={!view.toolbar}>
            {view.toolbar ? 'Hide toolbar' : 'Show toolbar'}
          </button>
        )}
        <button type="button" onClick={() => updateView({ preview: !view.preview })} className={actionButton} aria-pressed={!view.preview}>
          {view.preview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>
      <p className="text-xs text-gray-600 min-h-[1.25rem] mb-1" aria-live="polite">{note}</p>

      <div className={`grid gap-3 ${view.preview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="min-w-0">
          {isMarkdown ? (
            <EditorBoundary fallback={plainBox}>
              <Suspense fallback={plainBox}>
                <MarkdownCodeEditor
                  value={value}
                  onChange={(text) => onChange(text, MARKDOWN)}
                  height={height}
                  showToolbar={view.toolbar}
                  placeholder={placeholder}
                />
              </Suspense>
            </EditorBoundary>
          ) : plainBox}
        </div>
        {view.preview && (
          // Absolutely filled, so a long reading scrolls inside the preview instead of making the
          // row taller: side by side, the editor alone sets the height; stacked, minHeight does.
          <div className="min-w-0 relative" style={{ minHeight: height }}>
            <div className="absolute inset-0 flex flex-col">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Preview: what a student sees</div>
              <ReadingText
                text={previewText}
                format={format}
                emptyText="No text"
                className="flex-1 min-h-0 w-full overflow-auto border rounded p-4 bg-gray-50 text-sm"
              />
            </div>
          </div>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to change the editor height"
        title="Drag to make the editor taller or shorter"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="h-3 cursor-ns-resize flex items-center justify-center group touch-none"
      >
        <div className="w-12 h-1 rounded bg-gray-300 group-hover:bg-gray-400" />
      </div>
      <p className="text-xs text-gray-500">
        Trim front matter, headers, page numbers and anything that isn't part of the reading. Nothing changes for
        students until you save.
      </p>
    </div>
  );
};

export default ReadingEditor;
