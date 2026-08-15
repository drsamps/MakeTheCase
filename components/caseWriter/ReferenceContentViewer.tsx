import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  caseWriterApi,
  ReferenceContent,
  ReferenceSelection,
  ReferenceExcerpt,
  OutlineSection,
  SelectionStep,
  SELECTION_STEP_LABEL
} from '../../services/caseWriter/api';
import { useGenerationTimer } from './useGenerationTimer';

interface Props {
  projectId: string;
  referenceId: string;
  /** Mirrors REFERENCE_TEXT_CHAR_CAP on the server; the picker warns past it. */
  charCap: number;
  /**
   * When set, the picker edits that step's override instead of the default
   * selection used by every step.
   */
  step?: SelectionStep;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh its summary line. */
  onSaved: () => void;
  onError: (message: string) => void;
}

const EMPTY: ReferenceSelection = { sections: [], excerpts: [] };

const fmt = (n: number) => n.toLocaleString('en-US');

const STRATEGY_NOTE: Record<string, string> = {
  markdown_headings: 'Sections detected from the document’s own headings.',
  text_headings: 'Sections detected from chapter and heading lines in the extracted text.',
  chunks: 'This document has no detectable headings, so it is split into equal blocks. Use the Excerpts tab to pick exact passages.',
  empty: 'This reference has no text.'
};

/**
 * Section/excerpt picker for one reference.
 *
 * Character offsets are the shared currency: outline sections carry
 * {start,end} into the document text, and an excerpt is just a hand-made range.
 * The text is rendered as one span per outline section carrying data-start, so
 * a DOM selection can be mapped back to absolute offsets.
 */
const ReferenceContentViewer: React.FC<Props> = ({
  projectId, referenceId, charCap, step, onClose, onSaved, onError
}) => {
  const [doc, setDoc] = useState<ReferenceContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ rationale: string; dropped: number } | null>(null);
  const [tab, setTab] = useState<'sections' | 'excerpts'>('sections');
  const [selection, setSelection] = useState<ReferenceSelection>(EMPTY);
  const [pending, setPending] = useState<{ start: number; end: number; text: string } | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const suggestTimer = useGenerationTimer(suggesting);

  // Whether this step currently deviates from the default selection.
  const [hasOverride, setHasOverride] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await caseWriterApi.getReferenceContent(projectId, referenceId);
      if (cancelled) return;
      setLoading(false);
      if (error || !data) { onError(error?.message || 'Failed to load reference text'); onClose(); return; }
      setDoc(data);

      // In per-step mode start from that step's override if it has one,
      // otherwise from the default — so "Customize" begins where generation
      // currently stands rather than from a blank slate.
      const override = step ? data.selection_overrides?.[step] : undefined;
      setHasOverride(!!override);
      const initial = override ?? data.selection ?? EMPTY;
      setSelection(data.outline_stale ? EMPTY : initial);

      if (data.outline?.strategy === 'chunks') setTab('excerpts');
    })();
    return () => { cancelled = true; };
  }, [projectId, referenceId, step]);

  const sections = doc?.outline?.sections || [];
  const selectedIds = useMemo(() => new Set(selection.sections), [selection.sections]);

  const selectedChars = useMemo(() => {
    const fromSections = sections
      .filter(s => selectedIds.has(s.id))
      .reduce((n, s) => n + s.chars, 0);
    const fromExcerpts = selection.excerpts.reduce((n, e) => n + (e.end - e.start), 0);
    return fromSections + fromExcerpts;
  }, [sections, selectedIds, selection.excerpts]);

  const nothingSelected = selection.sections.length === 0 && selection.excerpts.length === 0;
  const overCap = selectedChars > charCap;

  function toggleSection(id: string) {
    setSelection(s => ({
      ...s,
      sections: s.sections.includes(id) ? s.sections.filter(x => x !== id) : [...s.sections, id]
    }));
  }

  /** Select a heading and everything nested under it, up to the next same-or-higher level. */
  function selectSubtree(index: number) {
    const root = sections[index];
    const ids = [root.id];
    for (let i = index + 1; i < sections.length && sections[i].level > root.level; i++) {
      ids.push(sections[i].id);
    }
    setSelection(s => ({ ...s, sections: Array.from(new Set([...s.sections, ...ids])) }));
  }

  /**
   * Map the current DOM selection back to absolute character offsets. Every
   * rendered span carries data-start, so the absolute offset is that span's
   * start plus the offset within it.
   */
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !textRef.current) { setPending(null); return; }
    if (!textRef.current.contains(sel.anchorNode) || !textRef.current.contains(sel.focusNode)) return;

    const absolute = (node: Node | null, offset: number): number | null => {
      let el: Node | null = node;
      while (el && !(el instanceof HTMLElement && el.dataset.start !== undefined)) el = el.parentNode;
      if (!el) return null;
      return Number((el as HTMLElement).dataset.start) + offset;
    };

    const a = absolute(sel.anchorNode, sel.anchorOffset);
    const b = absolute(sel.focusNode, sel.focusOffset);
    if (a == null || b == null) return;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start < 20) { setPending(null); return; }
    setPending({ start, end, text: sel.toString() });
  }

  function addExcerpt() {
    if (!pending) return;
    const label = pending.text.replace(/\s+/g, ' ').trim().slice(0, 60);
    const excerpt: ReferenceExcerpt = {
      id: `e${Date.now().toString(36)}`,
      start: pending.start,
      end: pending.end,
      label
    };
    setSelection(s => ({ ...s, excerpts: [...s.excerpts, excerpt] }));
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  function removeExcerpt(id: string) {
    setSelection(s => ({ ...s, excerpts: s.excerpts.filter(e => e.id !== id) }));
  }

  async function save() {
    setSaving(true);
    const payload = nothingSelected ? null : selection;

    let patch;
    if (step) {
      // Merge into the existing override map rather than replacing it, so
      // saving one step does not wipe another step's override.
      const next = { ...(doc?.selection_overrides || {}) };
      if (payload) next[step] = payload; else delete next[step];
      patch = { selection_overrides: Object.keys(next).length ? next : null };
    } else {
      patch = { selection: payload };
    }

    const { error } = await caseWriterApi.updateReference(projectId, referenceId, patch);
    setSaving(false);
    if (error) { onError(error.message); return; }
    onSaved();
    onClose();
  }

  /** Drop this step's override so it follows the default selection again. */
  async function resetToDefault() {
    if (!step) return;
    setSaving(true);
    const next = { ...(doc?.selection_overrides || {}) };
    delete next[step];
    const { error } = await caseWriterApi.updateReference(projectId, referenceId, {
      selection_overrides: Object.keys(next).length ? next : null
    });
    setSaving(false);
    if (error) { onError(error.message); return; }
    onSaved();
    onClose();
  }

  async function suggestSections() {
    setSuggesting(true);
    setSuggestion(null);
    const { data, error } = await caseWriterApi.suggestReferenceSections(projectId, referenceId, step ? { step } : {});
    setSuggesting(false);
    if (error || !data) { onError(error?.message || 'Suggestion failed'); return; }
    // Pre-check the boxes but save nothing — the instructor confirms.
    setSelection(s => ({ ...s, sections: data.section_ids }));
    setSuggestion({ rationale: data.rationale, dropped: data.dropped_unknown_ids });
    setTab('sections');
  }

  async function rebuild() {
    setSaving(true);
    const { error } = await caseWriterApi.rebuildReferenceOutline(projectId, referenceId);
    if (error) { setSaving(false); onError(error.message); return; }
    const { data } = await caseWriterApi.getReferenceContent(projectId, referenceId);
    setSaving(false);
    if (data) { setDoc(data); setSelection(EMPTY); }
  }

  // One span per section so DOM selections map to absolute offsets. Sections
  // tile the document exactly (see referenceOutline.js), so this reproduces the
  // full text with no gaps.
  const spans = useMemo(() => {
    if (!doc) return [];
    if (sections.length === 0) return [{ id: 'whole', start: 0, text: doc.content, selected: false }];
    return sections.map(s => ({
      id: s.id,
      start: s.start,
      text: doc.content.slice(s.start, s.end),
      selected: selectedIds.has(s.id)
    }));
  }, [doc, sections, selectedIds]);

  const excerptRanges = selection.excerpts;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">

        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {doc?.title || 'Reference'}
              {step && (
                <span className="ml-2 text-xs font-normal text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                  {SELECTION_STEP_LABEL[step]} only
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              {doc ? `${fmt(doc.content_length)} characters` : 'Loading…'}
              {doc?.outline ? ` · ${sections.length} sections` : ''}
              {step && (hasOverride
                ? ' · this step has its own selection'
                : ' · currently follows the default selection')}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2" aria-label="Close">×</button>
        </div>

        {doc?.outline_stale && (
          <div className="mx-4 mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            This document changed since the last selection was saved, so the previous
            selection was discarded — its positions no longer match the text. Pick sections again.
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 gap-3">
          <div className="flex gap-1">
            {(['sections', 'excerpts'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm rounded-t ${
                  tab === t ? 'bg-blue-50 text-blue-900 font-medium border-b-2 border-blue-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t === 'sections' ? `Sections${sections.length ? ` (${sections.length})` : ''}` : `Excerpts (${selection.excerpts.length})`}
              </button>
            ))}
          </div>
          <div className={`text-sm font-mono ${overCap ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
            {nothingSelected
              ? `whole document — ${fmt(doc?.content_length || 0)} / ${fmt(charCap)}`
              : `${fmt(selectedChars)} / ${fmt(charCap)}`}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-sm text-gray-500">Loading document…</div>}

          {!loading && tab === 'sections' && (
            <>
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="text-xs text-gray-500">
                  {STRATEGY_NOTE[doc?.outline?.strategy || 'empty']}
                  {nothingSelected && ' Nothing selected sends the whole document (capped).'}
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={suggestSections}
                    disabled={suggesting || saving || sections.length === 0}
                    className={`text-xs px-2 py-1 border rounded disabled:opacity-50 ${
                      suggesting
                        ? 'bg-green-500 text-white border-green-500 animate-pulse'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                    title="Ask the model which sections match your teaching principle. Only the outline is sent, never the document text."
                  >
                    {suggesting ? `Suggesting… ${suggestTimer}` : '✨ Suggest sections'}
                  </button>
                  <button onClick={() => setSelection(s => ({ ...s, sections: sections.map(x => x.id) }))}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Select all</button>
                  <button onClick={() => setSelection(s => ({ ...s, sections: [] }))}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Clear</button>
                  <button onClick={rebuild} disabled={saving}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                          title="Re-run section detection on this document">Re-detect</button>
                </div>
              </div>

              {suggestion && (
                <div className="mb-2 text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  <strong>Suggested:</strong> {suggestion.rationale || 'No rationale returned.'}
                  {suggestion.dropped > 0 && (
                    <> {' '}<span className="text-blue-700">({suggestion.dropped} suggested id{suggestion.dropped === 1 ? '' : 's'} did not match this outline and were dropped.)</span></>
                  )}
                  <div className="mt-1 text-blue-700">Nothing is saved until you click Save selection.</div>
                </div>
              )}

              {sections.length === 0 && <div className="text-sm text-gray-500 italic">No sections detected.</div>}

              <ul className="divide-y divide-gray-100 border border-gray-200 rounded">
                {sections.map((s: OutlineSection, i: number) => {
                  const hasChildren = i + 1 < sections.length && sections[i + 1].level > s.level;
                  return (
                    <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSection(s.id)}
                        id={`sec-${s.id}`}
                      />
                      <label htmlFor={`sec-${s.id}`} className="flex-1 text-sm text-gray-800 cursor-pointer truncate"
                             style={{ paddingLeft: `${(s.level - 1) * 16}px` }} title={s.title}>
                        {s.title}
                      </label>
                      {hasChildren && (
                        <button onClick={() => selectSubtree(i)}
                                className="text-xs text-blue-600 hover:underline flex-shrink-0"
                                title="Select this section and everything under it">+ subtree</button>
                      )}
                      <span className="text-xs text-gray-500 font-mono w-16 text-right flex-shrink-0">{fmt(s.chars)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {!loading && tab === 'excerpts' && (
            <>
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="text-xs text-gray-500">
                  Select any passage below, then add it. Excerpts are sent in addition to
                  whatever sections are checked; overlapping text is only sent once.
                </p>
                {pending && (
                  <button onClick={addExcerpt}
                          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded flex-shrink-0">
                    + Add excerpt ({fmt(pending.end - pending.start)})
                  </button>
                )}
              </div>

              {selection.excerpts.length > 0 && (
                <ul className="mb-3 border border-gray-200 rounded divide-y divide-gray-100">
                  {selection.excerpts.map(e => (
                    <li key={e.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                      <span className="flex-1 truncate text-gray-700" title={e.label}>“{e.label}”</span>
                      <span className="text-xs text-gray-500 font-mono">{fmt(e.end - e.start)}</span>
                      <button onClick={() => removeExcerpt(e.id)} className="text-xs text-red-600 hover:underline">remove</button>
                    </li>
                  ))}
                </ul>
              )}

              <div
                ref={textRef}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
                className="border border-gray-200 rounded p-3 bg-gray-50 text-xs font-mono whitespace-pre-wrap leading-relaxed select-text max-h-[45vh] overflow-auto"
              >
                {spans.map(sp => (
                  <span
                    key={sp.id}
                    data-start={sp.start}
                    className={sp.selected ? 'bg-blue-50' : undefined}
                  >
                    {sp.text}
                  </span>
                ))}
              </div>
              {excerptRanges.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  Saved excerpts are listed above; the text pane highlights checked sections only.
                </p>
              )}
            </>
          )}
        </div>

        {doc?.has_summary && !step && (
          <div className="mx-4 mb-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            This reference has an AI summary. A summary only applies to the portion it was made
            from, so changing the selection means re-summarizing before the summary is used again.
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 gap-3">
          <div className="text-xs text-gray-500">
            {overCap
              ? `Over the ${fmt(charCap)} character limit — the excess will be truncated at generation time.`
              : nothingSelected
                ? 'No selection: the whole document is used, capped at the limit.'
                : `${selection.sections.length} section(s), ${selection.excerpts.length} excerpt(s).`}
          </div>
          <div className="flex gap-2">
            {step && hasOverride && (
              <button onClick={resetToDefault} disabled={saving}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50"
                      title="Drop this step's override so it follows the default selection again">
                Reset to default
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Cancel</button>
            <button onClick={save} disabled={saving || loading}
                    className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
              {saving ? 'Saving…' : (step ? `Save for ${SELECTION_STEP_LABEL[step]}` : 'Save selection')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferenceContentViewer;
