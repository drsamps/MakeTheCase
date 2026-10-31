import React, { useEffect, useState } from 'react';
import { api, AUTH_TOKEN_EVENT } from '../services/apiClient';

// The student token's claims, read without verifying (display only; the server decides).
function studentTokenIsPreview(): boolean {
  try {
    const token = localStorage.getItem('student_auth_token');
    if (!token) return false;
    const part = token.split('.')[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.preview === true;
  } catch {
    return false;
  }
}

// The × hides the label for this browser tab only.
const HIDDEN_KEY = 'mtc_student_view_label_hidden';

function isStudentPage(): boolean {
  const h = window.location.hash;
  return !(h.startsWith('#/admin') || h.startsWith('#/case-writer') || h.startsWith('#evaluation/'));
}

/**
 * Student view: a small bar on every student screen while an instructor or admin is
 * signed in as their preview student (Dashboard > Student view). Rendered beside <App />.
 */
const StudentViewBar: React.FC = () => {
  const [show, setShow] = useState(() => isStudentPage() && studentTokenIsPreview());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const update = () => setShow(isStudentPage() && studentTokenIsPreview());
    // AUTH_TOKEN_EVENT: this tab stored or cleared a token (URL sign-in, Logout, start over).
    const events = ['hashchange', 'storage', AUTH_TOKEN_EVENT];
    events.forEach((e) => window.addEventListener(e, update));
    update(); // the token may have been stored before this effect ran
    return () => events.forEach((e) => window.removeEventListener(e, update));
  }, []);

  if (!show || hidden) return null;

  const startOver = async () => {
    if (!window.confirm('Start over as a new student? Your Student view chats, evaluations and section choices will be deleted.')) return;
    setBusy(true);
    setError(null);
    const { error: err } = await api.auth.restartStudentView();
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    try { sessionStorage.removeItem(HIDDEN_KEY); } catch { /* ignore */ }
    window.location.hash = '';
    window.location.reload();
  };

  const hide = () => {
    try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch { /* storage blocked: hide for this page only */ }
    setHidden(true);
  };

  // Bottom-left and small: the student pages use the top corners (case title, Logout) and
  // the chat screen is full height, so a bar across the top would cover or push them.
  return (
    <div
      className="fixed bottom-3 left-3 z-50 max-w-[calc(100vw-1.5rem)] rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-xs text-amber-900 shadow-sm"
      title="You see what students see. These chats are labeled in Monitor and don't count in Results."
    >
      <div className="flex items-center gap-x-3">
        <strong>Student view</strong>
        <button
          type="button"
          onClick={startOver}
          disabled={busy}
          className="font-semibold text-amber-800 underline hover:text-amber-950 disabled:opacity-50 bg-transparent border-none p-0"
        >
          {busy ? 'Starting over…' : 'Start over as a new student'}
        </button>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide the Student view label"
          className="text-amber-700 hover:text-amber-950 bg-transparent border-none p-0 leading-none text-sm"
        >
          ×
        </button>
      </div>
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
};

export default StudentViewBar;
