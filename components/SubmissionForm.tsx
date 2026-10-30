import React, { useEffect, useState } from 'react';
import { api, getApiBaseUrl, getAuthHeaders } from '../services/apiClient';

export interface SavedSubmission { id: number; filename: string | null; text: string; uploaded_by_role: string; created_at: string }

interface Props {
  sectionId: string;
  caseId: string;
  /** Set when staff upload for a student; absent on the student's own start screen. */
  studentId?: string;
  title: string;
  help: string;
  /** Called with the saved submission (null when there is none), on load and after each save. */
  onChange?: (saved: SavedSubmission | null) => void;
}

/**
 * The student's own work for an activity that takes a submission (StudyChat Phase 6): paste it or
 * upload a file. Used by the student on the start screen and by instructors on the Students screen.
 */
const SubmissionForm: React.FC<Props> = ({ sectionId, caseId, studentId, title, help, onChange }) => {
  const [saved, setSaved] = useState<SavedSubmission | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readUrl = studentId
    ? `/submissions/student?section_id=${encodeURIComponent(sectionId)}&case_id=${encodeURIComponent(caseId)}&student_id=${encodeURIComponent(studentId)}`
    : `/submissions/mine?section_id=${encodeURIComponent(sectionId)}&case_id=${encodeURIComponent(caseId)}`;

  /** `isCurrent` is false once the form has moved to another assignment, so a late reply is dropped. */
  const load = async (isCurrent: () => boolean = () => true) => {
    const { data, error: loadError } = await api.get<SavedSubmission | null>(readUrl);
    if (!isCurrent()) return;
    if (loadError) {
      setError('Could not load the saved submission. Please refresh the page.');
      return;
    }
    const row = data ?? null;
    setSaved(row);
    setEditing(!row);
    onChange?.(row);
  };

  // A new assignment starts empty, and the parent hears "none" until its own answer arrives.
  useEffect(() => {
    let current = true;
    setSaved(null);
    setEditing(false);
    setText('');
    setError(null);
    onChange?.(null);
    load(() => current);
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, caseId, studentId]);

  const submit = async (file: File | null) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('section_id', sectionId);
      form.append('case_id', caseId);
      if (studentId) form.append('student_id', studentId);
      if (file) form.append('file', file);
      else form.append('text', text);
      // FormData sets its own Content-Type, with the boundary.
      const { 'Content-Type': _omit, ...headers } = getAuthHeaders() as Record<string, string>;
      const r = await fetch(`${getApiBaseUrl()}/submissions`, { method: 'POST', headers, body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { setError(j.error?.message || 'Could not save that. Please try again.'); return; }
      setText('');
      await load();
    } catch {
      setError('Could not save that. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-300 p-3 space-y-2">
      <div>
        <div className="text-sm font-medium text-gray-700">{title}</div>
        <p className="mt-0.5 text-xs text-gray-500">{help}</p>
      </div>
      {saved && !editing ? (
        <div className="text-sm">
          <p className="text-green-700">
            ✓ Saved {saved.filename ? `"${saved.filename}"` : studentId ? 'text' : 'your text'} ({saved.text.length.toLocaleString()} characters){saved.uploaded_by_role !== 'student' && !studentId ? ', added by your instructor' : ''}.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-gray-600">Show the text</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{saved.text}</pre>
          </details>
          <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs text-blue-700 hover:underline">Replace it</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={60000}
            placeholder="Paste the text here…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => submit(null)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save text'}
            </button>
            <label className={`rounded-lg border border-gray-300 px-3 py-1.5 text-sm ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50'}`}>
              Upload a file
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.md,.txt"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) submit(f); }}
              />
            </label>
            {saved && <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-600 hover:underline">Keep the saved one</button>}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
};

export default SubmissionForm;
