import React, { useEffect, useRef } from 'react';
import EasyMDE from 'easymde';
import 'easymde/dist/easymde.min.css';
import './markdownCodeEditor.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Editor height in px; the reading editor's drag handle sets it, and the preview follows. */
  height: number;
  showToolbar: boolean;
  placeholder?: string;
}

// Inline SVG icons: MakeTheCase does not load Font Awesome, which EasyMDE's own icons need.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  heading: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  bold: svg('<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>'),
  italic: svg('<path d="M14 4h-4M14 20h-4M15 4 9 20"/>'),
  ul: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  ol: svg('<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5a1.5 1.5 0 1 1 2.4 1.2L4 19h3"/>'),
  quote: svg('<path d="M7 7H4v6h4v-2a4 4 0 0 1-4 4M17 7h-3v6h4v-2a4 4 0 0 1-4 4"/>'),
  code: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  rule: svg('<path d="M4 12h16"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
};

const button = (name: string, action: (editor: EasyMDE) => void, title: string, icon: string) =>
  ({ name, action, title, icon, className: `mtc-md-${name}` });

const TOOLBAR = [
  button('heading', EasyMDE.toggleHeadingSmaller, 'Heading (press again for a smaller one)', ICONS.heading),
  button('bold', EasyMDE.toggleBold, 'Bold', ICONS.bold),
  button('italic', EasyMDE.toggleItalic, 'Italic', ICONS.italic),
  '|' as const,
  button('unordered-list', EasyMDE.toggleUnorderedList, 'Bulleted list', ICONS.ul),
  button('ordered-list', EasyMDE.toggleOrderedList, 'Numbered list', ICONS.ol),
  button('quote', EasyMDE.toggleBlockquote, 'Quote', ICONS.quote),
  button('code', EasyMDE.toggleCodeBlock, 'Code', ICONS.code),
  '|' as const,
  button('link', EasyMDE.drawLink, 'Link', ICONS.link),
  button('table', EasyMDE.drawTable, 'Table', ICONS.table),
  button('horizontal-rule', EasyMDE.drawHorizontalRule, 'Horizontal rule', ICONS.rule),
  '|' as const,
  button('undo', EasyMDE.undo, 'Undo', ICONS.undo),
  button('redo', EasyMDE.redo, 'Redo', ICONS.redo),
];

/**
 * EasyMDE (CodeMirror 5) as a controlled Markdown editor. Loaded lazily by ReadingEditor, so it
 * stays out of the student bundle; if it fails to load, ReadingEditor uses a plain textarea.
 *
 * Settings that matter (learned in Quizzer, which uses the same editor):
 * - Its own preview, side-by-side and fullscreen are off: the preview beside it is drawn by
 *   ReadingText, the renderer students see. A second renderer would be a second opinion.
 * - autosave is off: it would bring one reading's abandoned draft back over the next one.
 * - spellChecker is off (it downloads dictionaries); the browser's own spellcheck is used.
 * - Links insert a template rather than calling prompt(), which would block the page.
 * - CodeMirror measures rather than reflows, so it is refreshed after its size changes.
 */
const MarkdownCodeEditor: React.FC<Props> = ({ value, onChange, height, showToolbar, placeholder }) => {
  const hostRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EasyMDE | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = new EasyMDE({
      element: hostRef.current,
      initialValue: value,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      nativeSpellcheck: true,
      status: false,
      toolbar: TOOLBAR,
      toolbarTips: true,
      promptURLs: false,
      placeholder,
      minHeight: '0px',
      shortcuts: { togglePreview: null, toggleSideBySide: null, toggleFullScreen: null },
      indentWithTabs: false,
      tabSize: 2,
      // turndown and the automatic formatting write "-" bullets; keep new ones the same.
      unorderedListStyle: '-',
    });
    editorRef.current = editor;
    editor.codemirror.on('change', () => onChangeRef.current(editor.value()));
    return () => {
      editor.toTextArea();
      editor.cleanup();
      editorRef.current = null;
    };
    // The editor is created once; later values arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value set from outside (Restore, Text only, Remove links, Format with AI). setValue is an
  // ordinary change in CodeMirror's history, so the toolbar's Undo takes it back.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.value() !== value) editor.value(value);
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.codemirror.setSize(null, height);
    editor.codemirror.refresh();
  }, [height, showToolbar]);

  // The width changes when the preview is shown or hidden, or the window resizes.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width = box.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (box.offsetWidth === width) return;
      width = box.offsetWidth;
      editorRef.current?.codemirror.refresh();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={`mtc-md-editor ${showToolbar ? '' : 'mtc-md-editor--no-toolbar'}`}>
      <textarea ref={hostRef} defaultValue={value} />
    </div>
  );
};

export default MarkdownCodeEditor;
