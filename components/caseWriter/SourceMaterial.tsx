import React, { useEffect, useState } from 'react';
import {
  caseWriterApi,
  CaseWriterReference,
  ReferenceUseMode,
  REFERENCE_TEXT_CHAR_CAP
} from '../../services/caseWriter/api';
import { useGenerationTimer } from './useGenerationTimer';
import PromptInfoButton from './PromptInfoButton';
import ReferenceContentViewer from './ReferenceContentViewer';

interface ModelOption {
  model_id: string;
  display_name?: string;
}

interface Props {
  projectId: string;
  onError: (message: string) => void;
  onChange?: (refs: CaseWriterReference[]) => void;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
  isAdmin?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  pasted_text: 'Pasted text',
  uploaded_file: 'Uploaded file',
  link: 'Link',
  saved_framework: 'Saved framework'
};

// `use_mode` chooses how much detail; the selection chooses which part of the
// document. Labels track whether a selection exists so the two read as one
// coherent statement rather than two unrelated controls.
const USE_MODE_LABEL: Record<ReferenceUseMode, string> = {
  full_text: 'Full text',
  summary: 'Summary only',
  summary_and_full_text: 'Summary + full text'
};

const USE_MODE_LABEL_SELECTED: Record<ReferenceUseMode, string> = {
  full_text: 'Selected text',
  summary: 'Summary of selection',
  summary_and_full_text: 'Summary + selected text'
};

const hasSelection = (r: CaseWriterReference) =>
  (r.selected_section_count || 0) > 0 || (r.excerpt_count || 0) > 0;

// The disable condition for the selection/summary/use-mode controls. A link whose
// page has been fetched has text like any other reference and gets the full set;
// what disables them is having no stored text, not being a link.
const hasText = (r: CaseWriterReference) => !!r.content_length;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// One line describing exactly what this reference will contribute to the next
// generation, so "approved" never again means "silently sends nothing".
function describeContribution(r: CaseWriterReference): string {
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

const SourceMaterial: React.FC<Props> = ({ projectId, onError, onChange, models = [], projectDefaultModelId = null, isAdmin = false }) => {
  const [refs, setRefs] = useState<CaseWriterReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summarizeModelByRef, setSummarizeModelByRef] = useState<Record<string, string>>({});
  const [justSummarizedId, setJustSummarizedId] = useState<string | null>(null);
  const [pickerRefId, setPickerRefId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [justFetchedId, setJustFetchedId] = useState<string | null>(null);
  const [fetchDegradedId, setFetchDegradedId] = useState<string | null>(null);
  const [urlFetchEnabled, setUrlFetchEnabled] = useState(false);
  const summarizeTimer = useGenerationTimer(!!summarizingId);
  const fetchTimer = useGenerationTimer(!!fetchingId);

  async function reload() {
    setLoading(true);
    const { data, error } = await caseWriterApi.listReferences(projectId);
    setLoading(false);
    if (error) { onError(error.message); return; }
    setRefs(data || []);
    onChange?.(data || []);
  }

  useEffect(() => { reload(); }, [projectId]);

  // URL fetching is admin-gated and ships off, so the button is absent rather than
  // present-and-failing when the setting is disabled.
  useEffect(() => {
    let cancelled = false;
    caseWriterApi.getConfig().then(({ data }) => {
      if (!cancelled) setUrlFetchEnabled(!!data?.url_fetch_enabled);
    });
    return () => { cancelled = true; };
  }, []);

  async function addPaste() {
    if (!pasteContent.trim()) return;
    const { error } = await caseWriterApi.createReference(projectId, {
      type: 'pasted_text',
      title: pasteTitle || undefined,
      content: pasteContent
    });
    if (error) { onError(error.message); return; }
    setPasteTitle(''); setPasteContent(''); setPasting(false); setAddMenuOpen(false);
    reload();
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    const { error } = await caseWriterApi.createReference(projectId, {
      type: 'link',
      title: linkTitle || linkUrl,
      link_url: linkUrl
    });
    if (error) { onError(error.message); return; }
    setLinkTitle(''); setLinkUrl(''); setLinking(false); setAddMenuOpen(false);
    reload();
  }

  async function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { error } = await caseWriterApi.uploadReference(projectId, file);
    setUploading(false);
    e.target.value = '';
    if (error) { onError(error.message); return; }
    setAddMenuOpen(false);
    reload();
  }

  async function summarize(refId: string) {
    setSummarizingId(refId);
    const modelOverride = summarizeModelByRef[refId];
    const { error } = await caseWriterApi.summarizeReference(projectId, refId, modelOverride ? { model_id: modelOverride } : {});
    setSummarizingId(null);
    if (error) { onError(error.message); return; }
    // The server clears approved_by_user on every new summary so the instructor
    // has to review it. Say so out loud — silently unchecking the box drops the
    // reference out of every generation prompt with no visible signal.
    setJustSummarizedId(refId);
    reload();
  }

  async function fetchPage(refId: string) {
    setFetchingId(refId);
    setFetchDegradedId(id => (id === refId ? null : id));
    const { data, error } = await caseWriterApi.fetchReferenceUrl(projectId, refId);
    setFetchingId(null);
    if (error) { onError(error.message); return; }
    // Same contract as summarize: the server clears approved_by_user because the
    // reference just went from "a URL" to thousands of words that will feed five
    // generation steps. Say it out loud rather than silently unchecking the box.
    setJustFetchedId(refId);
    if (data?.fetch_degraded) setFetchDegradedId(refId);
    reload();
  }

  async function setApproved(refId: string, approved: boolean) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { approved_by_user: approved ? 1 : 0 });
    if (error) { onError(error.message); return; }
    if (approved) {
      setJustSummarizedId(id => (id === refId ? null : id));
      setJustFetchedId(id => (id === refId ? null : id));
    }
    reload();
  }

  async function setUseMode(refId: string, useMode: ReferenceUseMode) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { use_mode: useMode });
    if (error) { onError(error.message); return; }
    reload();
  }

  async function remove(r: { reference_id: string; title?: string | null }) {
    if (!confirm(`Delete reference "${r.title || '(untitled)'}"?`)) return;
    const { error } = await caseWriterApi.deleteReference(projectId, r.reference_id);
    if (error) { onError(error.message); return; }
    reload();
  }

  function parseSummary(s: string | null): { summary?: string; key_facts?: string[]; useful_for?: string[]; cautions?: string[] } | null {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return { summary: s }; }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Optional. Every <strong>Approved</strong> reference is sent to every generation step, using the
          text selected in its <strong>Use in generation</strong> setting.
        </p>
        <div className="flex items-center gap-2">
          <PromptInfoButton use="case_writer.reference_summary" isAdmin={isAdmin} />
          <div className="relative">
          <button
            type="button"
            onClick={() => setAddMenuOpen(o => !o)}
            className="px-3 py-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md"
          >
            + Add reference
          </button>
          {addMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-md z-10 min-w-[180px]">
              <button onClick={() => { setPasting(true); setAddMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Paste text</button>
              <button onClick={() => { setLinking(true); setAddMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Paste link</button>
              <label className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                Upload file
                <input type="file" accept=".pdf,.docx,.doc,.md,.txt" onChange={onUploadFile} className="hidden" />
              </label>
            </div>
          )}
          </div>
        </div>
      </div>

      {uploading && <div className="text-sm text-blue-700">Uploading…</div>}

      {pasting && (
        <div className="border border-gray-200 rounded-md p-3 space-y-2">
          <input
            placeholder="Title (optional)"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <textarea
            placeholder="Paste reference text here…"
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            className="w-full min-h-[160px] px-2 py-1 border border-gray-300 rounded text-sm font-mono"
          />
          <div className="flex gap-2">
            <button onClick={addPaste} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded">Add</button>
            <button onClick={() => setPasting(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Cancel</button>
          </div>
        </div>
      )}

      {linking && (
        <div className="border border-gray-200 rounded-md p-3 space-y-2">
          <input placeholder="Title (optional)" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
          <input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
          <div className="flex gap-2">
            <button onClick={addLink} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded">Add</button>
            <button onClick={() => setLinking(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && refs.length === 0 && (
        <div className="text-sm text-gray-500 italic">No source material attached.</div>
      )}

      <ul className="space-y-2">
        {refs.map(r => {
          const summary = parseSummary(r.content_summary);
          const expanded = expandedId === r.reference_id;
          return (
            <li key={r.reference_id} className="border border-gray-200 rounded-md p-3 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{r.title || '(untitled)'}</div>
                  <div className="text-xs text-gray-500">{TYPE_LABEL[r.type] || r.type}</div>
                  {/* A redirect to a login page or a consent wall should be visible
                      rather than mysterious, so show where we actually ended up. */}
                  {r.fetched_final_url && r.fetched_final_url !== r.link_url && (
                    <div className="text-xs text-gray-500 truncate max-w-md" title={r.fetched_final_url}>
                      Redirected to {r.fetched_final_url}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-700 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!r.approved_by_user}
                      onChange={(e) => setApproved(r.reference_id, e.target.checked)}
                    />
                    Approved
                  </label>
                  {r.type === 'link' && urlFetchEnabled && (
                    <button
                      onClick={() => fetchPage(r.reference_id)}
                      disabled={fetchingId === r.reference_id}
                      className={`text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 ${
                        fetchingId === r.reference_id ? 'bg-green-500 text-white animate-pulse border-green-500' : ''
                      }`}
                      title={hasText(r) ? 'Download the page again, replacing the stored text' : 'Download the page text so it can be used in generation'}
                    >
                      {fetchingId === r.reference_id
                        ? `Fetching… ${fetchTimer}`
                        : (hasText(r) ? 'Re-fetch' : 'Fetch page text')}
                    </button>
                  )}
                  <select
                    value={r.use_mode || 'full_text'}
                    onChange={(e) => setUseMode(r.reference_id, e.target.value as ReferenceUseMode)}
                    disabled={!hasText(r)}
                    className="text-xs px-1 py-0.5 border border-gray-300 rounded disabled:opacity-50"
                    title="Use in generation"
                  >
                    {(Object.keys(USE_MODE_LABEL) as ReferenceUseMode[]).map(m => (
                      <option key={m} value={m}>
                        {(hasSelection(r) ? USE_MODE_LABEL_SELECTED : USE_MODE_LABEL)[m]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={summarizeModelByRef[r.reference_id] || ''}
                    onChange={(e) => setSummarizeModelByRef(s => ({ ...s, [r.reference_id]: e.target.value }))}
                    disabled={summarizingId === r.reference_id || !hasText(r)}
                    className="text-xs px-1 py-0.5 border border-gray-300 rounded disabled:opacity-50"
                    title="Model for summarization"
                  >
                    <option value="">{projectDefaultModelId ? `default (${projectDefaultModelId})` : 'project default'}</option>
                    {models.map(m => (
                      <option key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => summarize(r.reference_id)}
                    disabled={summarizingId === r.reference_id || !hasText(r)}
                    className={`text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 ${
                      summarizingId === r.reference_id ? 'bg-green-500 text-white animate-pulse border-green-500' : ''
                    }`}
                    title={hasText(r) ? '' : 'No stored text to summarize'}
                  >
                    {summarizingId === r.reference_id
                      ? `Summarizing… ${summarizeTimer}`
                      : (r.content_summary ? 'Re-summarize' : 'Summarize')}
                  </button>
                  <button
                    onClick={() => setPickerRefId(r.reference_id)}
                    disabled={!hasText(r)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                    title={r.content_length ? 'Choose which portions of this document to use' : 'No stored text to select from'}
                  >
                    Select portions
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className={`mt-1 text-xs ${r.approved_by_user ? 'text-gray-600' : 'text-gray-400 italic'}`}>
                {r.approved_by_user
                  ? describeContribution(r)
                  : 'Not approved — nothing from this reference is sent to any generation step'}
              </div>

              {r.summary_stale && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  This summary was made from a different portion of the document than the current
                  selection, so it is <strong>not</strong> being sent. Click <strong>Re-summarize</strong> to
                  summarize what you have selected.
                </div>
              )}

              {justFetchedId === r.reference_id && !r.approved_by_user && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Page text fetched{r.content_length ? ` (${fmt(r.content_length)} chars)` : ''}, and{' '}
                  <strong>Approved</strong> was cleared so you can review it. Re-check{' '}
                  <strong>Approved</strong> to include this reference in generation.
                </div>
              )}

              {fetchDegradedId === r.reference_id && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  Reader-mode extraction found little article text, so the raw page text was stored —
                  it may include navigation and boilerplate, or the page may be rendered by JavaScript.
                  Open <strong>Select portions</strong> to check what was captured.
                </div>
              )}

              {justSummarizedId === r.reference_id && !r.approved_by_user && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  New summary generated, and <strong>Approved</strong> was cleared so you can review it.
                  Re-check <strong>Approved</strong> to include this reference in generation.
                </div>
              )}

              {r.content_summary && (
                <div className="mt-2">
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.reference_id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {expanded ? 'Hide summary' : 'Show summary'}
                  </button>
                  {expanded && summary && (
                    <div className="mt-2 text-sm text-gray-700 space-y-1">
                      {summary.summary && <p>{summary.summary}</p>}
                      {Array.isArray(summary.key_facts) && summary.key_facts.length > 0 && (
                        <>
                          <div className="text-xs font-semibold text-gray-600">Key facts</div>
                          <ul className="list-disc list-inside text-xs">
                            {summary.key_facts.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pickerRefId && (
        <ReferenceContentViewer
          projectId={projectId}
          referenceId={pickerRefId}
          charCap={REFERENCE_TEXT_CHAR_CAP}
          onClose={() => setPickerRefId(null)}
          onSaved={reload}
          onError={onError}
        />
      )}
    </div>
  );
};

export default SourceMaterial;
