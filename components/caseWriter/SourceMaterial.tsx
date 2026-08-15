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
import ReferenceDetail from './ReferenceDetail';
import ReferenceLibraryPicker from './ReferenceLibraryPicker';
import {
  USE_MODE_LABEL,
  USE_MODE_LABEL_SELECTED,
  ApprovedToggle,
  InlineTitleEditor,
  ReferenceFieldGrid,
  describeContribution,
  displayTitle,
  hasSelection,
  hasText,
  fmt
} from './referenceDisplay';

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
  const [linkFetchNow, setLinkFetchNow] = useState(true);
  const [addingLink, setAddingLink] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [summarizeModelByRef, setSummarizeModelByRef] = useState<Record<string, string>>({});
  const [modelOpenId, setModelOpenId] = useState<string | null>(null);
  const [justSummarizedId, setJustSummarizedId] = useState<string | null>(null);
  const [pickerRefId, setPickerRefId] = useState<string | null>(null);
  const [detailRefId, setDetailRefId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [justFetchedId, setJustFetchedId] = useState<string | null>(null);
  const [fetchDegradedId, setFetchDegradedId] = useState<string | null>(null);
  const [urlFetchEnabled, setUrlFetchEnabled] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
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
      title: pasteTitle.trim() || undefined,
      content: pasteContent
    });
    if (error) { onError(error.message); return; }
    setPasteTitle(''); setPasteContent(''); setPasting(false); setAddMenuOpen(false);
    reload();
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    setAddingLink(true);
    // Deliberately send no title when the instructor left it blank: the row then
    // stores NULL, which is the only way the fetch route's
    // `COALESCE(NULLIF(title,''), <page title>)` can adopt the page's own title.
    const { data, error } = await caseWriterApi.createReference(projectId, {
      type: 'link',
      title: linkTitle.trim() || undefined,
      link_url: linkUrl.trim()
    });
    if (error) { setAddingLink(false); onError(error.message); return; }

    const newId = data?.reference_id;
    if (newId && linkFetchNow && urlFetchEnabled) {
      setFetchingId(newId);
      const fetched = await caseWriterApi.fetchReferenceUrl(projectId, newId);
      setFetchingId(null);
      // Keep the reference on failure — the instructor may want to retry or paste
      // the text manually. Deleting it would throw away the URL they just typed.
      if (fetched.error) onError(fetched.error.message);
      else if (fetched.data?.fetch_degraded) setFetchDegradedId(newId);
    }

    setAddingLink(false);
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

  // A null title stores NULL rather than '', so displayTitle() falls back to
  // `URL: <url>` for links instead of showing a blank name.
  async function saveTitle(refId: string, title: string | null) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { title });
    if (error) { onError(error.message); return; }
    reload();
  }

  async function remove(r: CaseWriterReference) {
    if (!confirm(`Delete reference "${displayTitle(r)}"?`)) return;
    const { error } = await caseWriterApi.deleteReference(projectId, r.reference_id);
    if (error) { onError(error.message); return; }
    if (detailRefId === r.reference_id) setDetailRefId(null);
    reload();
  }

  // The drill-in replaces the list inside the Source Material pane, so the step
  // rail and project header stay put and the editor gets the full pane width.
  if (detailRefId) {
    const detailRef = refs.find(r => r.reference_id === detailRefId);
    if (detailRef) {
      return (
        <ReferenceDetail
          projectId={projectId}
          reference={detailRef}
          models={models}
          projectDefaultModelId={projectDefaultModelId}
          urlFetchEnabled={urlFetchEnabled}
          isAdmin={isAdmin}
          onBack={() => setDetailRefId(null)}
          onChanged={reload}
          onError={onError}
        />
      );
    }
  }

  const btn = 'text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Optional. Every <strong>Approved</strong> reference is sent to every generation step, using the
          text selected in its <strong>Sends in generation</strong> setting.
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
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-md z-10 min-w-[200px]">
              <button onClick={() => { setPasting(true); setAddMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Paste text</button>
              <button onClick={() => { setLinking(true); setAddMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Web page link</button>
              <label className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                Upload file
                <input type="file" accept=".pdf,.docx,.doc,.md,.txt" onChange={onUploadFile} className="hidden" />
              </label>
              <div className="border-t border-gray-200" />
              <button onClick={() => { setLibraryOpen(true); setAddMenuOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">Copy from another project</button>
            </div>
          )}
          </div>
        </div>
      </div>

      {uploading && <div className="text-sm text-blue-700">Uploading…</div>}

      {importNotice && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start justify-between gap-3">
          <span>{importNotice}</span>
          <button onClick={() => setImportNotice(null)} className="text-amber-700 hover:text-amber-900">×</button>
        </div>
      )}

      {pasting && (
        <div className="border border-gray-300 rounded-lg p-3 space-y-2 bg-white">
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
        <div className="border border-gray-300 rounded-lg p-3 space-y-2 bg-white">
          <input
            placeholder="Title (optional — taken from the page when fetched)"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <input
            placeholder="https://…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
          {urlFetchEnabled && (
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={linkFetchNow} onChange={(e) => setLinkFetchNow(e.target.checked)} />
              Fetch page text now
            </label>
          )}
          <div className="flex gap-2 items-center">
            <button
              onClick={addLink}
              disabled={addingLink || !linkUrl.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {addingLink ? (fetchingId ? `Fetching… ${fetchTimer}` : 'Adding…') : 'Add'}
            </button>
            <button onClick={() => setLinking(false)} disabled={addingLink} className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && refs.length === 0 && (
        <div className="text-sm text-gray-500 italic">No source material attached.</div>
      )}

      <ul className="space-y-3">
        {refs.map(r => {
          const busy = fetchingId === r.reference_id || summarizingId === r.reference_id;
          return (
            <li key={r.reference_id} className="border border-gray-300 rounded-lg bg-white shadow-sm overflow-hidden">

              {/* Identity band — the name and the one decision that matters most. */}
              <div className="flex items-start justify-between gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <InlineTitleEditor reference={r} onSave={(t) => saveTitle(r.reference_id, t)} />
                <ApprovedToggle
                  approved={!!r.approved_by_user}
                  onChange={(approved) => setApproved(r.reference_id, approved)}
                />
              </div>

              {/* Facts band. */}
              <div className="px-3 py-2 space-y-2">
                <ReferenceFieldGrid
                  r={r}
                  useModeControl={
                    <select
                      value={r.use_mode || 'full_text'}
                      onChange={(e) => setUseMode(r.reference_id, e.target.value as ReferenceUseMode)}
                      disabled={!hasText(r)}
                      className="text-xs px-1 py-0.5 border border-gray-300 rounded disabled:opacity-50"
                    >
                      {(Object.keys(USE_MODE_LABEL) as ReferenceUseMode[]).map(m => (
                        <option key={m} value={m}>
                          {(hasSelection(r) ? USE_MODE_LABEL_SELECTED : USE_MODE_LABEL)[m]}
                        </option>
                      ))}
                    </select>
                  }
                />
                <div className={`text-xs ${r.approved_by_user ? 'text-gray-600' : 'text-gray-400 italic'}`}>
                  {r.approved_by_user
                    ? describeContribution(r)
                    : 'Not approved — nothing from this reference is sent to any generation step'}
                </div>
              </div>

              {/* Action band — wraps, so it never collides with anything above. */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
                <button
                  onClick={() => setDetailRefId(r.reference_id)}
                  className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                >
                  View / Edit
                </button>
                <button
                  onClick={() => setPickerRefId(r.reference_id)}
                  disabled={!hasText(r)}
                  className={btn}
                  title={hasText(r) ? 'Choose which portions of this document to use' : 'No stored text to select from'}
                >
                  Select portions
                </button>
                <button
                  onClick={() => summarize(r.reference_id)}
                  disabled={busy || !hasText(r)}
                  className={`${btn} ${summarizingId === r.reference_id ? 'bg-green-500 text-white animate-pulse border-green-500' : ''}`}
                  title={hasText(r) ? '' : 'No stored text to summarize'}
                >
                  {summarizingId === r.reference_id
                    ? `Summarizing… ${summarizeTimer}`
                    : (r.content_summary ? 'Re-summarize' : 'Summarize')}
                </button>
                {/* The model override is hidden behind a toggle, the way
                    MarkdownStepEditor does it — a permanently visible <select>
                    on every row is noise the instructor rarely touches. */}
                <button
                  onClick={() => setModelOpenId(id => (id === r.reference_id ? null : r.reference_id))}
                  disabled={!hasText(r)}
                  className={btn}
                  title="Choose the model used for summarization"
                >
                  ⚙
                </button>
                {modelOpenId === r.reference_id && (
                  <select
                    value={summarizeModelByRef[r.reference_id] || ''}
                    onChange={(e) => setSummarizeModelByRef(s => ({ ...s, [r.reference_id]: e.target.value }))}
                    disabled={summarizingId === r.reference_id}
                    className="text-xs px-1 py-0.5 border border-gray-300 rounded disabled:opacity-50"
                    title="Model for summarization"
                  >
                    <option value="">{projectDefaultModelId ? `default (${projectDefaultModelId})` : 'project default'}</option>
                    {models.map(m => (
                      <option key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</option>
                    ))}
                  </select>
                )}
                {r.type === 'link' && urlFetchEnabled && (
                  <button
                    onClick={() => fetchPage(r.reference_id)}
                    disabled={busy}
                    className={`${btn} ${fetchingId === r.reference_id ? 'bg-green-500 text-white animate-pulse border-green-500' : ''}`}
                    title={hasText(r) ? 'Download the page again, replacing the stored text' : 'Download the page text so it can be used in generation'}
                  >
                    {fetchingId === r.reference_id
                      ? `Fetching… ${fetchTimer}`
                      : (hasText(r) ? 'Re-fetch' : 'Fetch page text')}
                  </button>
                )}
                <button
                  onClick={() => remove(r)}
                  className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 ml-auto"
                >
                  Delete
                </button>
              </div>

              {/* Notices sit below the actions so they never push the controls around. */}
              {(r.summary_stale
                || (justFetchedId === r.reference_id && !r.approved_by_user)
                || fetchDegradedId === r.reference_id
                || (justSummarizedId === r.reference_id && !r.approved_by_user)) && (
                <div className="px-3 pb-3 pt-2 space-y-2">
                  {r.summary_stale && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      This summary was made from a different portion of the document than the current
                      selection, so it is <strong>not</strong> being sent. Click <strong>Re-summarize</strong> to
                      summarize what you have selected.
                    </div>
                  )}

                  {justFetchedId === r.reference_id && !r.approved_by_user && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      Page text fetched{r.content_length ? ` (${fmt(r.content_length)} chars)` : ''}, and{' '}
                      <strong>Approved</strong> was cleared so you can review it. Re-check{' '}
                      <strong>Approved</strong> to include this reference in generation.
                    </div>
                  )}

                  {fetchDegradedId === r.reference_id && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      Reader-mode extraction found little article text, so the raw page text was stored —
                      it may include navigation and boilerplate, or the page may be rendered by JavaScript.
                      Open <strong>View / Edit</strong> to check what was captured.
                    </div>
                  )}

                  {justSummarizedId === r.reference_id && !r.approved_by_user && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      New summary generated, and <strong>Approved</strong> was cleared so you can review it.
                      Re-check <strong>Approved</strong> to include this reference in generation.
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

      {libraryOpen && (
        <ReferenceLibraryPicker
          projectId={projectId}
          onClose={() => setLibraryOpen(false)}
          onImported={(count) => {
            setImportNotice(
              `${count} reference${count === 1 ? '' : 's'} copied. Approved was cleared so you can review `
              + `${count === 1 ? 'it' : 'them'} before generating.`
            );
            reload();
          }}
          onError={onError}
        />
      )}
    </div>
  );
};

export default SourceMaterial;
