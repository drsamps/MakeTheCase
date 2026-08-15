import React, { useEffect, useState } from 'react';
import { caseWriterApi, CaseWriterReference, REFERENCE_TEXT_CHAR_CAP } from '../../services/caseWriter/api';
import MarkdownStepEditor from './MarkdownStepEditor';
import ReferenceContentViewer from './ReferenceContentViewer';
import { useGenerationTimer } from './useGenerationTimer';
import { saveText, saveBlob, filenameSlug } from './download';
import {
  ApprovedToggle,
  InlineTitleEditor,
  ReferenceFieldGrid,
  describeContribution,
  displayTitle,
  hasSelection,
  hasText
} from './referenceDisplay';

interface ModelOption {
  model_id: string;
  display_name?: string;
}

interface Props {
  projectId: string;
  reference: CaseWriterReference;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
  urlFetchEnabled: boolean;
  isAdmin?: boolean;
  onBack: () => void;
  /** Parent reload() — keeps the rail dot and StepSourceScope in sync. */
  onChanged: () => void;
  onError: (message: string) => void;
}

type Tab = 'text' | 'summary';

/**
 * Render a stored summary as editable markdown.
 *
 * Client mirror of `formatReferenceSummary()` in server/routes/caseWriter.js,
 * which parses the `{summary, key_facts, …}` JSON the summarize route writes and
 * falls back to the raw string for hand-edited values. Editing here flattens the
 * JSON to markdown; Re-summarize restores the structured form.
 */
export function formatSummaryForEditing(raw: string | null): string {
  if (!raw) return '';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return String(raw);
  }
  if (!parsed || typeof parsed !== 'object') return String(raw);

  const parts: string[] = [];
  if (parsed.summary) parts.push(String(parsed.summary));
  const section = (label: string, arr: unknown) => {
    if (Array.isArray(arr) && arr.length > 0) {
      parts.push(`**${label}**\n\n${arr.map(x => `- ${x}`).join('\n')}`);
    }
  };
  section('Key facts', parsed.key_facts);
  section('Useful for', parsed.useful_for);
  section('Cautions', parsed.cautions);
  return parts.join('\n\n');
}

// Scoped to this screen rather than admin.css, which is not loaded anywhere.
// Follows the precedent of the `.cw-input` block in CaseWriterProject.tsx.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .cw-print-region, .cw-print-region * { visibility: visible !important; }
  .cw-print-region {
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    max-height: none !important;
    overflow: visible !important;
    border: none !important;
    padding: 0 !important;
  }
  .cw-no-print { display: none !important; }
}
@page { margin: 0.75in; }
`;

const ReferenceDetail: React.FC<Props> = ({
  projectId, reference, models = [], projectDefaultModelId = null,
  urlFetchEnabled, isAdmin = false, onBack, onChanged, onError
}) => {
  const [tab, setTab] = useState<Tab>('text');
  const [loading, setLoading] = useState(true);

  const [loadedText, setLoadedText] = useState('');
  const [draftText, setDraftText] = useState('');

  const [loadedSummary, setLoadedSummary] = useState('');
  const [draftSummary, setDraftSummary] = useState('');

  const [summarizing, setSummarizing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fetchTimer = useGenerationTimer(fetching);

  const refId = reference.reference_id;

  // `content` ships from exactly one route, so the body is fetched here rather
  // than coming down with the list payload.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    caseWriterApi.getReferenceContent(projectId, refId).then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error) { onError(error.message); onBack(); return; }
      const text = data?.content || '';
      setLoadedText(text);
      setDraftText(text);
    });
    return () => { cancelled = true; };
  }, [projectId, refId]);

  // The summary comes down with the list row, so it re-syncs whenever the parent
  // reloads (after a summarize, a fetch, or an approve).
  useEffect(() => {
    const s = formatSummaryForEditing(reference.content_summary);
    setLoadedSummary(s);
    setDraftSummary(s);
  }, [reference.content_summary]);

  const selectionAtRisk =
    hasSelection(reference) || (reference.override_steps?.length || 0) > 0;

  async function saveTextValue() {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { content: draftText });
    if (error) return { ok: false, message: error.message };
    setLoadedText(draftText);
    setNotice(selectionAtRisk
      ? 'Text saved. The section selection and any per-step overrides were cleared, because the character offsets no longer match.'
      : 'Text saved.');
    onChanged();
    return { ok: true };
  }

  async function saveSummaryValue() {
    const value = draftSummary.trim();
    const { error } = await caseWriterApi.updateReference(projectId, refId, {
      content_summary: value || null
    });
    if (error) return { ok: false, message: error.message };
    setLoadedSummary(draftSummary);
    setNotice(value
      ? 'Summary saved. It is now plain text rather than the structured AI form — Re-summarize restores that.'
      : 'Summary cleared.');
    onChanged();
    return { ok: true };
  }

  // `opts` carries MarkdownStepEditor's 💡 Hint text and the admin one-shot
  // "log this prompt with data" flag. Both controls render for any step with a
  // Generate action, so dropping the second argument here would leave them
  // visible and inert — the failure mode CLAUDE.md calls out for the hint.
  async function runSummarize(overrideModelId?: string, opts?: Record<string, string>) {
    setSummarizing(true);
    const { data, error } = await caseWriterApi.summarizeReference(projectId, refId, {
      ...(overrideModelId ? { model_id: overrideModelId } : {}),
      ...(opts?.revision_hint ? { revision_hint: opts.revision_hint } : {}),
      log_this_prompt: opts?.log_this_prompt === '1'
    });
    setSummarizing(false);
    if (error) { onError(error.message); return; }
    if (data?.summary) {
      const s = formatSummaryForEditing(JSON.stringify(data.summary));
      setLoadedSummary(s);
      setDraftSummary(s);
    }
    setNotice('New summary generated, and Approved was cleared so you can review it.');
    onChanged();
  }

  async function refetch() {
    setFetching(true);
    const { data, error } = await caseWriterApi.fetchReferenceUrl(projectId, refId);
    setFetching(false);
    if (error) { onError(error.message); return; }
    const { data: fresh } = await caseWriterApi.getReferenceContent(projectId, refId);
    if (fresh) { setLoadedText(fresh.content || ''); setDraftText(fresh.content || ''); }
    setNotice(data?.fetch_degraded
      ? 'Page re-fetched, but reader-mode extraction found little article text — check what was captured below.'
      : 'Page re-fetched. Approved was cleared so you can review the new text.');
    onChanged();
  }

  async function saveTitle(title: string | null) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { title });
    if (error) { onError(error.message); return; }
    onChanged();
  }

  async function setApproved(approved: boolean) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, {
      approved_by_user: approved ? 1 : 0
    });
    if (error) { onError(error.message); return; }
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete reference "${displayTitle(reference)}"?`)) return;
    const { error } = await caseWriterApi.deleteReference(projectId, refId);
    if (error) { onError(error.message); return; }
    onChanged();
    onBack();
  }

  async function downloadOriginal() {
    setDownloadOpen(false);
    const { blob, filename, error } = await caseWriterApi.downloadReferenceOriginal(projectId, refId);
    if (error || !blob) { onError(error || 'Download failed'); return; }
    saveBlob(blob, filename || reference.upload_original_name || 'reference');
  }

  const slug = filenameSlug(displayTitle(reference));
  const btn = 'text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50';

  return (
    <div className="space-y-3">
      <style>{PRINT_CSS}</style>

      <div className="cw-no-print space-y-3">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          ‹ Back to Source Material
        </button>

        <div className="border border-gray-300 rounded-lg bg-white shadow-sm overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200">
            <InlineTitleEditor
              reference={reference}
              onSave={saveTitle}
              titleClassName="text-base font-semibold text-gray-900"
            />
            <ApprovedToggle approved={!!reference.approved_by_user} onChange={setApproved} />
          </div>

          <div className="px-3 py-2 space-y-2">
            <ReferenceFieldGrid r={reference} />
            <div className={`text-xs ${reference.approved_by_user ? 'text-gray-600' : 'text-gray-400 italic'}`}>
              {reference.approved_by_user
                ? describeContribution(reference)
                : 'Not approved — nothing from this reference is sent to any generation step'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
            <button onClick={() => window.print()} className={btn} title="Print the rendered preview">
              Print
            </button>
            <div className="relative">
              <button onClick={() => setDownloadOpen(o => !o)} className={btn}>Download ▾</button>
              {downloadOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-md z-10 min-w-[190px]">
                  <button
                    onClick={() => { setDownloadOpen(false); saveText(draftText, `${slug}.md`); }}
                    disabled={!draftText}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
                  >
                    Text (.md)
                  </button>
                  <button
                    onClick={() => { setDownloadOpen(false); saveText(draftSummary, `${slug}-summary.md`); }}
                    disabled={!draftSummary}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
                  >
                    Summary (.md)
                  </button>
                  {reference.upload_original_name && (
                    <button
                      onClick={downloadOriginal}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      title={reference.upload_original_name}
                    >
                      Original file
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={!hasText(reference)}
              className={btn}
              title={hasText(reference) ? 'Choose which portions of this document to use' : 'No stored text to select from'}
            >
              Select portions
            </button>
            {reference.type === 'link' && urlFetchEnabled && (
              <button
                onClick={refetch}
                disabled={fetching}
                className={`${btn} ${fetching ? 'bg-green-500 text-white animate-pulse border-green-500' : ''}`}
              >
                {fetching ? `Fetching… ${fetchTimer}` : (hasText(reference) ? 'Re-fetch' : 'Fetch page text')}
              </button>
            )}
            <button
              onClick={remove}
              className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 ml-auto"
            >
              Delete
            </button>
          </div>
        </div>

        {notice && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-amber-700 hover:text-amber-900">×</button>
          </div>
        )}

        <div className="flex items-center gap-1 border-b border-gray-200">
          {(['text', 'summary'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-t ${
                tab === t
                  ? 'bg-blue-50 text-blue-900 font-medium border-b-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'text' ? 'Text' : 'Summary'}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading text…</div>}

      {!loading && tab === 'text' && (
        <>
          {selectionAtRisk && (
            <div className="cw-no-print text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              This reference has a saved section selection
              {(reference.override_steps?.length || 0) > 0 ? ' and per-step overrides' : ''}.
              <strong> Saving new text will clear them</strong> — the stored character offsets would no
              longer line up with the text you are editing.
            </div>
          )}
          <MarkdownStepEditor
            label="Reference text"
            description={`The stored text this reference contributes to generation. Capped at ${REFERENCE_TEXT_CHAR_CAP.toLocaleString('en-US')} characters per reference when sent.`}
            loadedValue={loadedText}
            currentValue={draftText}
            onChange={setDraftText}
            onSave={saveTextValue}
            previewClassName="cw-print-region"
          />
        </>
      )}

      {!loading && tab === 'summary' && (
        <>
          <div className="cw-no-print text-xs text-gray-500">
            Editing by hand replaces the structured AI summary with plain markdown. That is sent to
            generation exactly as written; <strong>Generate</strong> restores the structured form.
          </div>
          <MarkdownStepEditor
            label="AI summary"
            description="Used instead of (or alongside) the full text, depending on this reference's Sends in generation setting."
            loadedValue={loadedSummary}
            currentValue={draftSummary}
            onChange={setDraftSummary}
            onSave={saveSummaryValue}
            onGenerate={runSummarize}
            generating={summarizing}
            generateDisabledReason={hasText(reference) ? null : 'No stored text to summarize'}
            models={models}
            projectDefaultModelId={projectDefaultModelId}
            promptUse="case_writer.reference_summary"
            isAdmin={isAdmin}
            previewClassName="cw-print-region"
          />
        </>
      )}

      {pickerOpen && (
        <ReferenceContentViewer
          projectId={projectId}
          referenceId={refId}
          charCap={REFERENCE_TEXT_CHAR_CAP}
          onClose={() => setPickerOpen(false)}
          onSaved={onChanged}
          onError={onError}
        />
      )}
    </div>
  );
};

export default ReferenceDetail;
