import React, { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';

interface MineRow {
  id: number;
  submitter_role: string;
  submission_type: string | null;
  sentiment: string | null;
  category_id: number | null;
  category_name: string | null;
  body: string;
  context_route: string | null;
  context_screen: string | null;
  context_case_id: string | null;
  created_at: string;
  is_read: number;
  read_at: string | null;
  needs_follow_up: number;
  follow_up_resolved: number;
  resolved_at: string | null;
  resolution_note: string | null;
}

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

function fmt(date: string): string {
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

function statusBadges(row: MineRow): { label: string; tone: string }[] {
  const out: { label: string; tone: string }[] = [];
  if (row.follow_up_resolved) {
    out.push({ label: 'Resolved', tone: 'bg-green-100 text-green-800' });
  } else if (row.needs_follow_up) {
    out.push({ label: 'Needs follow-up', tone: 'bg-amber-100 text-amber-800' });
  } else if (row.is_read) {
    out.push({ label: 'Read', tone: 'bg-blue-100 text-blue-800' });
  } else {
    out.push({ label: 'Unread', tone: 'bg-gray-100 text-gray-700' });
  }
  return out;
}

const FeedbackMine: React.FC = () => {
  const [items, setItems] = useState<MineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = getActiveToken();
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${getApiBaseUrl()}/feedback/mine`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Request failed'))))
      .then(d => setItems(d.items || []))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">My Feedback</h2>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh feedback"
          title="Refresh feedback"
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {loading && items.length === 0 ? (
        <p className="text-sm text-gray-500">Loading your feedback…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">You haven't submitted any feedback yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map(row => (
            <div key={row.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {statusBadges(row).map(b => (
                    <span key={b.label} className={`text-xs px-2 py-0.5 rounded-full ${b.tone}`}>
                      {b.label}
                    </span>
                  ))}
                  {row.submission_type && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                      {row.submission_type}
                    </span>
                  )}
                  {row.category_name && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      {row.category_name}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">{fmt(row.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{row.body}</p>
              {row.resolution_note && (
                <div className="mt-2 text-sm text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2">
                  <span className="font-semibold">Resolution: </span>
                  {row.resolution_note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeedbackMine;
