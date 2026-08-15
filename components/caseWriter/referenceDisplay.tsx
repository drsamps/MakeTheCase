/**
 * Shared presentation helpers for a Case Writer source-material reference.
 *
 * Both the Source Material list row and the reference detail screen describe the
 * same row, so the labels, the derived title, the "what does this actually send"
 * sentence, and the labelled field grid live here rather than being written twice
 * and drifting.
 */
import React from 'react';
import { CaseWriterReference, ReferenceUseMode, REFERENCE_TEXT_CHAR_CAP } from '../../services/caseWriter/api';

export const TYPE_LABEL: Record<string, string> = {
  pasted_text: 'Pasted text',
  uploaded_file: 'Uploaded file',
  link: 'Web page link',
  saved_framework: 'Saved framework'
};

// `use_mode` chooses how much detail; the selection chooses which part of the
// document. Labels track whether a selection exists so the two read as one
// coherent statement rather than two unrelated controls.
export const USE_MODE_LABEL: Record<ReferenceUseMode, string> = {
  full_text: 'Full text',
  summary: 'Summary only',
  summary_and_full_text: 'Summary + full text'
};

export const USE_MODE_LABEL_SELECTED: Record<ReferenceUseMode, string> = {
  full_text: 'Selected text',
  summary: 'Summary of selection',
  summary_and_full_text: 'Summary + selected text'
};

export const hasSelection = (r: CaseWriterReference) =>
  (r.selected_section_count || 0) > 0 || (r.excerpt_count || 0) > 0;

// The disable condition for the selection/summary/use-mode controls. A link whose
// page has been fetched has text like any other reference and gets the full set;
// what disables them is having no stored text, not being a link.
export const hasText = (r: CaseWriterReference) => !!r.content_length;

export const fmt = (n: number) => n.toLocaleString('en-US');

export const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * What to show as this reference's name.
 *
 * A link created without a title stores NULL rather than the URL, so that the
 * fetch route can adopt the page's own <title>. Until that happens — and again if
 * the instructor clears the title — the URL stands in for it.
 */
export const displayTitle = (r: Pick<CaseWriterReference, 'title' | 'type' | 'link_url'>) =>
  r.title?.trim() || (r.type === 'link' && r.link_url ? `URL: ${r.link_url}` : '(untitled)');

// One line describing exactly what this reference will contribute to the next
// generation, so "approved" never again means "silently sends nothing".
export function describeContribution(r: CaseWriterReference): string {
  const mode = r.use_mode || 'full_text';

  // An unfetched link really does send nothing but its URL. A fetched one falls
  // through to the ordinary text/summary/selection description below.
  if (r.type === 'link' && !hasText(r)) {
    return 'Sends the URL only — click Fetch page text to use the page contents';
  }
  const fetchedSuffix = r.type === 'link' && r.fetched_at ? ` · fetched ${fmtDate(r.fetched_at)}` : '';

  // A saved section/excerpt selection replaces the whole document.
  const selected = hasSelection(r);
  const chars = selected ? (r.selected_chars || 0) : (r.content_length || 0);

  const scope = selected
    ? [
        r.selected_section_count ? `${r.selected_section_count} of ${r.section_count} sections` : '',
        r.excerpt_count ? `${r.excerpt_count} excerpt${r.excerpt_count === 1 ? '' : 's'}` : ''
      ].filter(Boolean).join(' + ')
    : 'the whole document';

  const textPhrase = chars
    ? `${scope} — ${fmt(chars)} chars${chars > REFERENCE_TEXT_CHAR_CAP ? ` (truncated to ${fmt(REFERENCE_TEXT_CHAR_CAP)})` : ''}`
    : 'the whole document — but no text is stored for this reference';

  // A summary only counts when it was built from the same portion the text
  // channel would send; otherwise the server drops it and sends the text.
  const summaryUsable = !!r.content_summary && !r.summary_stale;

  if (mode === 'summary') {
    if (summaryUsable) return `Sends the AI summary of ${scope}${fetchedSuffix}`;
    return (r.content_summary
      ? `Summary is out of date with the selection — sends ${textPhrase} until you re-summarize`
      : `Not summarized yet — sends ${textPhrase}`) + fetchedSuffix;
  }
  if (mode === 'summary_and_full_text') {
    if (summaryUsable) return `Sends the AI summary, then the text — both covering ${textPhrase}${fetchedSuffix}`;
    return (r.content_summary
      ? `Summary is out of date with the selection — sends ${textPhrase} until you re-summarize`
      : `Not summarized yet — sends ${textPhrase}`) + fetchedSuffix;
  }
  return `Sends ${textPhrase}${fetchedSuffix}`;
}

// ---------------------------------------------------------------------------
// Approved toggle
// ---------------------------------------------------------------------------

interface ApprovedToggleProps {
  approved: boolean;
  onChange: (approved: boolean) => void;
}

/**
 * The Approved checkbox, colour-coded.
 *
 * Approved is the switch that decides whether a reference reaches any generation
 * step at all, and a bare checkbox reads the same at a glance whichever way it is
 * set. The green/pink pill makes an unapproved row visible while scanning a list,
 * which is when it matters — several routes (fetch, summarize, import) clear the
 * flag deliberately, so a row can go back to unapproved without the instructor
 * having touched it.
 */
export const ApprovedToggle: React.FC<ApprovedToggleProps> = ({ approved, onChange }) => (
  <label
    className={`text-xs flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded border cursor-pointer ${
      approved
        ? 'bg-green-100 text-green-900 border-green-300'
        : 'bg-pink-100 text-pink-900 border-pink-300'
    }`}
    title={approved
      ? 'This reference is sent to every generation step'
      : 'Not approved — nothing from this reference is sent to any generation step'}
  >
    <input
      type="checkbox"
      checked={approved}
      onChange={(e) => onChange(e.target.checked)}
    />
    Approved
  </label>
);

// ---------------------------------------------------------------------------
// Inline title editor
// ---------------------------------------------------------------------------

interface TitleEditorProps {
  reference: CaseWriterReference;
  /** Receives null when the instructor clears the field. */
  onSave: (title: string | null) => void;
  titleClassName?: string;
}

/**
 * Click ✎ to rename. Clearing the field stores NULL, which is what makes a link
 * fall back to `URL: <url>` — and what lets a later fetch adopt the page's title.
 */
export const InlineTitleEditor: React.FC<TitleEditorProps> = ({
  reference, onSave, titleClassName = 'text-sm font-semibold text-gray-900'
}) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const btn = 'text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50';

  if (editing) {
    const commit = () => { setEditing(false); onSave(draft.trim() || null); };
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder={reference.type === 'link' ? 'Leave empty to use the URL' : 'Reference title'}
          className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-sm"
        />
        <button onClick={commit} className={btn}>Save</button>
        <button onClick={() => setEditing(false)} className={btn}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className={`${titleClassName} break-words`}>{displayTitle(reference)}</span>
      <button
        onClick={() => { setDraft(reference.title || ''); setEditing(true); }}
        className="text-xs text-gray-400 hover:text-gray-700 flex-shrink-0"
        title="Rename (clear it to fall back to the URL)"
      >
        ✎
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Field grid
// ---------------------------------------------------------------------------

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-gray-500 whitespace-nowrap">{label}</dt>
    <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
  </>
);

const ExternalLink: React.FC<{ href: string }> = ({ href }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-blue-600 hover:underline break-all"
    title={href}
  >
    {href}
  </a>
);

interface FieldGridProps {
  r: CaseWriterReference;
  /** Rendered under a "Sends in generation" heading. The list row passes its use_mode select. */
  useModeControl?: React.ReactNode;
}

/**
 * The labelled facts about a reference.
 *
 * Only fields that apply are rendered — a pasted-text row is two lines, a fetched
 * link is five — which is what keeps the list scannable while still giving every
 * number a heading to hang on.
 */
export const ReferenceFieldGrid: React.FC<FieldGridProps> = ({ r, useModeControl }) => {
  const sections = hasText(r)
    ? [
        r.section_count ? `${r.section_count} detected${r.outline_strategy ? ` (${r.outline_strategy.replace(/_/g, ' ')})` : ''}` : 'not detected yet',
        hasSelection(r)
          ? `${[
              r.selected_section_count ? `${r.selected_section_count} selected` : '',
              r.excerpt_count ? `${r.excerpt_count} excerpt${r.excerpt_count === 1 ? '' : 's'}` : ''
            ].filter(Boolean).join(' + ')} · ${fmt(r.selected_chars || 0)} chars`
          : 'whole document'
      ].join(' · ')
    : null;

  const summaryState = !r.content_summary
    ? 'none'
    : r.summary_stale
      ? 'saved, but out of date with the current selection'
      : 'saved';

  return (
    <dl className="grid grid-cols-[max-content_1fr] sm:grid-cols-[max-content_1fr_max-content_1fr] gap-x-3 gap-y-1 text-xs">
      <Field label="Type">{TYPE_LABEL[r.type] || r.type}</Field>

      <Field label="Stored text">
        {r.content_length ? `${fmt(r.content_length)} chars` : <span className="text-gray-400 italic">none yet</span>}
      </Field>

      {r.type === 'link' && r.link_url && (
        <Field label="URL"><ExternalLink href={r.link_url} /></Field>
      )}

      {/* A redirect to a login page or a consent wall should be visible rather
          than mysterious, so show where the fetch actually ended up. */}
      {r.fetched_final_url && r.fetched_final_url !== r.link_url && (
        <Field label="Final URL"><ExternalLink href={r.fetched_final_url} /></Field>
      )}

      {r.fetched_at && <Field label="Fetched">{fmtDate(r.fetched_at)}</Field>}

      {sections && <Field label="Sections">{sections}</Field>}

      <Field label="Summary">
        {r.summary_stale
          ? <span className="text-amber-700">{summaryState}</span>
          : <span className={r.content_summary ? '' : 'text-gray-400 italic'}>{summaryState}</span>}
      </Field>

      {useModeControl && <Field label="Sends in generation">{useModeControl}</Field>}

      {r.override_steps && r.override_steps.length > 0 && (
        <Field label="Per-step overrides">
          <span className="text-blue-700">{r.override_steps.join(', ')}</span>
        </Field>
      )}
    </dl>
  );
};
