import React, { useEffect, useState } from 'react';
import { caseWriterApi, CaseWriterReference } from '../../services/caseWriter/api';
import { useGenerationTimer } from './useGenerationTimer';

interface ModelOption {
  model_id: string;
  display_name?: string;
}

interface Props {
  projectId: string;
  onError: (message: string) => void;
  onChange?: () => void;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  pasted_text: 'Pasted text',
  uploaded_file: 'Uploaded file',
  link: 'Link',
  saved_framework: 'Saved framework'
};

const SourceMaterial: React.FC<Props> = ({ projectId, onError, onChange, models = [], projectDefaultModelId = null }) => {
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
  const summarizeTimer = useGenerationTimer(!!summarizingId);

  async function reload() {
    setLoading(true);
    const { data, error } = await caseWriterApi.listReferences(projectId);
    setLoading(false);
    if (error) { onError(error.message); return; }
    setRefs(data || []);
    onChange?.();
  }

  useEffect(() => { reload(); }, [projectId]);

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
    reload();
  }

  async function setApproved(refId: string, approved: boolean) {
    const { error } = await caseWriterApi.updateReference(projectId, refId, { approved_by_user: approved ? 1 : 0 });
    if (error) { onError(error.message); return; }
    reload();
  }

  async function remove(refId: string) {
    if (!confirm('Delete this reference?')) return;
    const { error } = await caseWriterApi.deleteReference(projectId, refId);
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
          Optional. Approved references are passed to every step's prompt to ground the generated content.
        </p>
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
                <div>
                  <div className="text-sm font-semibold text-gray-900">{r.title || '(untitled)'}</div>
                  <div className="text-xs text-gray-500">{TYPE_LABEL[r.type] || r.type}</div>
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
                  <select
                    value={summarizeModelByRef[r.reference_id] || ''}
                    onChange={(e) => setSummarizeModelByRef(s => ({ ...s, [r.reference_id]: e.target.value }))}
                    disabled={summarizingId === r.reference_id || r.type === 'link'}
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
                    disabled={summarizingId === r.reference_id || r.type === 'link'}
                    className={`text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 ${
                      summarizingId === r.reference_id ? 'bg-green-500 text-white animate-pulse border-green-500' : ''
                    }`}
                    title={r.type === 'link' ? 'Links not yet supported' : ''}
                  >
                    {summarizingId === r.reference_id
                      ? `Summarizing… ${summarizeTimer}`
                      : (r.content_summary ? 'Re-summarize' : 'Summarize')}
                  </button>
                  <button
                    onClick={() => remove(r.reference_id)}
                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
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
    </div>
  );
};

export default SourceMaterial;
