import React, { useState } from 'react';
import { CaseVersion, CaseSize, caseWriterApi } from '../../services/caseWriter/api';

interface Props {
  projectId: string;
  versions: CaseVersion[];
  workingDraft: string;
  currentSize: CaseSize;
  onReload: () => Promise<void> | void;
  onLoadedFromVersion: (text: string) => void;
}

const SIZE_LABELS: Record<CaseSize, string> = {
  story_problem: 'Story-problem',
  mini: 'Mini-Case',
  abridged: 'Abridged Case',
  regular: 'Regular Case',
  expanded: 'Expanded Case'
};

const SIZE_BADGE_CLASS: Record<CaseSize, string> = {
  story_problem: 'bg-slate-100 text-slate-700 border-slate-200',
  mini:          'bg-sky-100 text-sky-700 border-sky-200',
  abridged:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  regular:       'bg-blue-100 text-blue-800 border-blue-200',
  expanded:      'bg-violet-100 text-violet-700 border-violet-200'
};

const ALL_SIZES: CaseSize[] = ['story_problem', 'mini', 'abridged', 'regular', 'expanded'];

function countWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

const CaseVersionsPanel: React.FC<Props> = ({
  projectId,
  versions,
  workingDraft,
  currentSize,
  onReload,
  onLoadedFromVersion
}) => {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveSize, setSaveSize] = useState<CaseSize>(currentSize);
  const [saveNotes, setSaveNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [busyVid, setBusyVid] = useState<string | null>(null);

  function openSaveModal() {
    setSaveName(`Version ${versions.length + 1}`);
    setSaveSize(currentSize);
    setSaveNotes('');
    setSaveError(null);
    setShowSaveModal(true);
  }

  async function handleSaveAsVersion() {
    if (!saveName.trim()) {
      setSaveError('Name is required');
      return;
    }
    if (!workingDraft.trim()) {
      setSaveError('The working draft is empty — generate or paste content first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await caseWriterApi.createVersion(projectId, {
      version_name: saveName.trim(),
      version_notes: saveNotes || undefined,
      case_size: saveSize
    });
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setShowSaveModal(false);
    await onReload();
  }

  async function handleLoad(v: CaseVersion) {
    if (workingDraft.trim() && !confirm('Replace the current working draft with this version? (Your current draft will be saved to the revisions history.)')) {
      return;
    }
    setBusyVid(v.case_version_id);
    const { data, error } = await caseWriterApi.loadVersion(projectId, v.case_version_id);
    setBusyVid(null);
    if (error) {
      alert(`Load failed: ${error.message}`);
      return;
    }
    if (data) onLoadedFromVersion(data.student_case);
  }

  async function handleDelete(v: CaseVersion) {
    if (!confirm(`Delete version "${v.version_name}"? This cannot be undone.`)) return;
    setBusyVid(v.case_version_id);
    const { error } = await caseWriterApi.deleteVersion(projectId, v.case_version_id);
    setBusyVid(null);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    await onReload();
  }

  async function commitFieldEdit(v: CaseVersion, field: 'version_name' | 'version_notes', value: string) {
    const patch: any = {};
    if (field === 'version_name') {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed === v.version_name) return;
      patch.version_name = trimmed;
    } else {
      if ((value || '') === (v.version_notes || '')) return;
      patch.version_notes = value || null;
    }
    setBusyVid(v.case_version_id);
    const { error } = await caseWriterApi.updateVersion(projectId, v.case_version_id, patch);
    setBusyVid(null);
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    await onReload();
  }

  async function commitSizeEdit(v: CaseVersion, size: CaseSize) {
    if (size === v.case_size) return;
    setBusyVid(v.case_version_id);
    const { error } = await caseWriterApi.updateVersion(projectId, v.case_version_id, { case_size: size });
    setBusyVid(null);
    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    await onReload();
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Saved versions</h3>
          <p className="text-xs text-gray-500">
            Snapshot the current working draft (above) under a name + size so you can keep multiple variants.
          </p>
        </div>
        <button
          type="button"
          onClick={openSaveModal}
          className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
        >
          + Save current draft as version…
        </button>
      </div>

      {versions.length === 0 ? (
        <div className="text-xs italic text-gray-500 py-2">
          No saved versions yet — generate a case and save it to build a library of variants.
        </div>
      ) : (
        <ul className="space-y-1">
          {versions.map(v => {
            const busy = busyVid === v.case_version_id;
            const notesExpanded = !!expandedNotes[v.case_version_id];
            const editingName = editingNameId === v.case_version_id;
            const editingNotes = editingNotesId === v.case_version_id;
            return (
              <li
                key={v.case_version_id}
                className="bg-white border border-gray-200 rounded-md p-2 text-sm flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={v.case_size}
                    disabled={busy}
                    onChange={(e) => commitSizeEdit(v, e.target.value as CaseSize)}
                    className={`text-xs px-2 py-0.5 border rounded-full ${SIZE_BADGE_CLASS[v.case_size]}`}
                  >
                    {ALL_SIZES.map(s => (
                      <option key={s} value={s}>{SIZE_LABELS[s]}</option>
                    ))}
                  </select>

                  {editingName ? (
                    <input
                      autoFocus
                      value={editBuffer}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      onBlur={() => { commitFieldEdit(v, 'version_name', editBuffer); setEditingNameId(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                        else if (e.key === 'Escape') { setEditingNameId(null); }
                      }}
                      className="text-sm font-medium px-1 py-0.5 border border-gray-300 rounded flex-1 min-w-[200px]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditBuffer(v.version_name); setEditingNameId(v.case_version_id); }}
                      title="Click to rename"
                      className="text-sm font-medium text-gray-900 hover:underline"
                    >
                      {v.version_name}
                    </button>
                  )}

                  <span className="text-xs text-gray-500">
                    {v.word_count != null ? `${v.word_count.toLocaleString()} words` : ''}
                    {v.word_count != null ? ' · ' : ''}
                    {formatDate(v.version_created)}
                  </span>

                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => handleLoad(v)}
                    disabled={busy}
                    className="text-xs px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    Load into editor
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(v)}
                    disabled={busy}
                    className="text-xs px-2 py-0.5 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>

                <div className="ml-1 text-xs">
                  {editingNotes ? (
                    <textarea
                      autoFocus
                      value={editBuffer}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      onBlur={() => { commitFieldEdit(v, 'version_notes', editBuffer); setEditingNotesId(null); }}
                      placeholder="Notes about this version (when it was used, how it went)…"
                      className="w-full p-1 border border-gray-300 rounded text-xs"
                      rows={3}
                    />
                  ) : v.version_notes ? (
                    <button
                      type="button"
                      onClick={() => setExpandedNotes(prev => ({ ...prev, [v.case_version_id]: !notesExpanded }))}
                      className="text-left text-gray-600 hover:text-gray-800"
                    >
                      <span className="font-medium">Notes:</span>{' '}
                      {notesExpanded
                        ? <span onClick={(e) => { e.stopPropagation(); setEditBuffer(v.version_notes || ''); setEditingNotesId(v.case_version_id); }}>{v.version_notes}</span>
                        : <span className="italic">{v.version_notes.length > 80 ? v.version_notes.slice(0, 80) + '…' : v.version_notes}</span>
                      }
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditBuffer(''); setEditingNotesId(v.case_version_id); }}
                      className="text-gray-400 italic hover:text-gray-600"
                    >
                      + Add notes
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full flex flex-col">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Save draft as version</h3>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                aria-label="Close"
              >×</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Version name</label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded"
                  placeholder="e.g. Mini for Monday's section"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Case size</label>
                <select
                  value={saveSize}
                  onChange={(e) => setSaveSize(e.target.value as CaseSize)}
                  className="w-full px-2 py-1 border border-gray-300 rounded"
                >
                  {ALL_SIZES.map(s => (
                    <option key={s} value={s}>{SIZE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={saveNotes}
                  onChange={(e) => setSaveNotes(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded"
                  rows={4}
                  placeholder="When used, what worked, what to adjust next time…"
                />
              </div>
              <div className="text-xs text-gray-500">
                Will snapshot the current working draft ({countWords(workingDraft).toLocaleString()} words).
              </div>
              {saveError && <div className="text-xs text-red-600">{saveError}</div>}
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >Cancel</button>
              <button
                type="button"
                onClick={handleSaveAsVersion}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold disabled:opacity-50"
              >{saving ? 'Saving…' : 'Save version'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaseVersionsPanel;
