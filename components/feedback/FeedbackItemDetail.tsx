import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';

interface Item {
  id: number;
  submitter_user_id: string | null;
  submitter_role: string;
  submitter_name: string | null;
  submitter_email: string | null;
  submission_type: string | null;
  sentiment: string | null;
  category_id: number | null;
  category_name: string | null;
  body: string;
  context_route: string | null;
  context_screen: string | null;
  context_case_id: string | null;
  user_agent: string | null;
  build_sha: string | null;
  viewport: string | null;
  created_at: string;
  is_read: number;
  read_at: string | null;
  read_by_user_id: string | null;
  needs_follow_up: number;
  follow_up_resolved: number;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  priority: number;
  archived_at: string | null;
}

interface Props {
  itemId: number;
  isAdmin?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

const FeedbackItemDetail: React.FC<Props> = ({ itemId, isAdmin = false, onClose, onChanged }) => {
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    const token = getActiveToken();
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${getApiBaseUrl()}/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Request failed'))))
      .then(d => {
        setItem(d.item);
        setNote(d.item?.resolution_note || '');
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [itemId]);

  const remove = async () => {
    const token = getActiveToken();
    if (!token) return;
    const ok = window.confirm('Permanently delete this feedback item? This cannot be undone.');
    if (!ok) return;
    setSaving(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/feedback/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d?.error || 'Delete failed');
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setSaving(false);
    }
  };

  const patch = async (body: Record<string, any>) => {
    const token = getActiveToken();
    if (!token) return;
    setSaving(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/feedback/${itemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d?.error || 'Update failed');
      }
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white shadow-2xl w-full max-w-xl h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-gray-900">Feedback #{itemId}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : item ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {item.submitter_role}
                </span>
                {item.submission_type && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                    {item.submission_type}
                  </span>
                )}
                {item.sentiment && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                    {item.sentiment}
                  </span>
                )}
                {item.category_name && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                    {item.category_name}
                  </span>
                )}
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">
                  From{' '}
                  <span className="font-medium text-gray-700">
                    {item.submitter_name || item.submitter_email || item.submitter_user_id || 'anonymous'}
                  </span>{' '}
                  · {new Date(item.created_at).toLocaleString()}
                </div>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{item.body}</p>
              </div>

              <div className="text-xs text-gray-500 space-y-0.5">
                {item.context_screen && (
                  <div>
                    <span className="font-semibold text-gray-700">Screen:</span> {item.context_screen}
                  </div>
                )}
                {item.context_route && <div>Route: <code>{item.context_route}</code></div>}
                {item.context_case_id && <div>Case: <code>{item.context_case_id}</code></div>}
                {item.viewport && <div>Viewport: {item.viewport}</div>}
                {item.build_sha && <div>Build: <code>{item.build_sha}</code></div>}
                {item.user_agent && <div className="truncate" title={item.user_agent}>UA: {item.user_agent}</div>}
              </div>

              <div className="border-t border-gray-200 pt-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Triage</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => patch({ is_read: !item.is_read })}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm border rounded-md border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {item.is_read ? 'Mark unread' : 'Mark read'}
                  </button>
                  <button
                    onClick={() => patch({ needs_follow_up: !item.needs_follow_up })}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm border rounded-md border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {item.needs_follow_up ? 'Clear follow-up' : 'Needs follow-up'}
                  </button>
                </div>

                <div className="mt-3">
                  <label htmlFor="fb-note" className="block text-sm font-medium text-gray-700">
                    Resolution note
                  </label>
                  <textarea
                    id="fb-note"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mt-1"
                    placeholder="Short note shown back to the submitter."
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => patch({ follow_up_resolved: true, resolution_note: note || null })}
                      disabled={saving}
                      className="px-3 py-1.5 text-sm font-semibold rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    >
                      Mark resolved
                    </button>
                    {item.follow_up_resolved ? (
                      <button
                        onClick={() => patch({ follow_up_resolved: false })}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    ) : null}
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label htmlFor="fb-priority" className="text-sm font-medium text-gray-700">
                      Priority
                    </label>
                    <select
                      id="fb-priority"
                      value={item.priority ?? 0}
                      onChange={e => patch({ priority: Number(e.target.value) })}
                      disabled={saving}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                      title="Admin-only. Submitters do not see this value."
                    >
                      {PRIORITY_OPTIONS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-500">Visible to admins only</span>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
                  <button
                    onClick={() => patch({ archived: !item.archived_at })}
                    disabled={saving}
                    className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {item.archived_at ? 'Unarchive' : 'Archive'}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={remove}
                      disabled={saving}
                      className="px-3 py-1.5 text-sm rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                  )}
                  {item.archived_at && (
                    <span className="text-xs text-gray-500">
                      Archived {new Date(item.archived_at).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default FeedbackItemDetail;
