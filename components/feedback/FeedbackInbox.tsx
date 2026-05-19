import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';
import FeedbackItemDetail from './FeedbackItemDetail';
import { useFeedbackEligibility } from '../../hooks/useFeedbackEligibility';

interface InboxRow {
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
  created_at: string;
  is_read: number;
  needs_follow_up: number;
  follow_up_resolved: number;
  priority: number;
  archived_at: string | null;
}

interface Category {
  id: number;
  name: string;
}

type StatusFilter = 'all' | 'unread' | 'read' | 'followup' | 'resolved' | 'archived';
type SortField = 'created' | 'priority' | 'role' | 'type' | 'category' | 'read';
type SortDir = 'asc' | 'desc';

const PRIORITY_LABELS: Record<number, string> = {
  0: '—',
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

const PRIORITY_TONES: Record<number, string> = {
  0: 'text-gray-400',
  1: 'bg-gray-100 text-gray-700',
  2: 'bg-orange-100 text-orange-800',
  3: 'bg-red-100 text-red-800 font-semibold',
};

function getActiveToken(): string | null {
  return localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
}

interface FeedbackInboxProps {
  onChange?: () => void;
}

const FeedbackInbox: React.FC<FeedbackInboxProps> = ({ onChange }) => {
  const { eligibility } = useFeedbackEligibility('inbox-view');
  const isAdmin = eligibility?.isFeedbackAdmin || false;

  const [items, setItems] = useState<InboxRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [categoryId, setCategoryId] = useState('');
  const [role, setRole] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pageSize, setPageSize] = useState<number | 'all'>(20);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    const token = getActiveToken();
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (categoryId) params.set('category_id', categoryId);
    if (role) params.set('submitter_role', role);
    if (type) params.set('submission_type', type);
    if (search) params.set('search', search);
    params.set('sort', `${sortField}:${sortDir}`);

    fetch(`${getApiBaseUrl()}/feedback?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Request failed'))))
      .then(d => setItems(d.items || []))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [status, categoryId, role, type, search, sortField, sortDir]);

  useEffect(() => {
    load();
    setSelectedIds(new Set());
    setPage(1);
  }, [load]);

  useEffect(() => {
    const token = getActiveToken();
    if (!token) return;
    fetch(`${getApiBaseUrl()}/feedback/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { categories: [] }))
      .then(d => setCategories(d.categories || []))
      .catch(() => setCategories([]));
  }, []);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const startIdx = pageSize === 'all' ? 0 : (safePage - 1) * pageSize;
  const endIdx = pageSize === 'all' ? items.length : Math.min(items.length, startIdx + pageSize);
  const visibleItems = useMemo(
    () => (pageSize === 'all' ? items : items.slice(startIdx, endIdx)),
    [items, pageSize, startIdx, endIdx]
  );

  const visibleIds = useMemo(() => visibleItems.map(i => i.id), [visibleItems]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const setSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'created' || field === 'priority' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const runBulk = async (action: 'archive' | 'unarchive' | 'delete' | 'mark_read') => {
    const token = getActiveToken();
    if (!token) return;
    if (selectedIds.size === 0) return;
    if (action === 'delete') {
      const ok = window.confirm(`Permanently delete ${selectedIds.size} item(s)? This cannot be undone.`);
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/feedback/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ids: Array.from(selectedIds) }),
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d?.error || 'Bulk action failed');
      }
      setSelectedIds(new Set());
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const archiveResolved = async () => {
    const resolvedIds = items.filter(i => i.follow_up_resolved && !i.archived_at).map(i => i.id);
    if (resolvedIds.length === 0) return;
    const token = getActiveToken();
    if (!token) return;
    const ok = window.confirm(`Archive ${resolvedIds.length} resolved item(s)?`);
    if (!ok) return;
    setBulkBusy(true);
    try {
      await fetch(`${getApiBaseUrl()}/feedback/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'archive', ids: resolvedIds }),
      });
      load();
      onChange?.();
    } finally {
      setBulkBusy(false);
    }
  };

  const viewingArchived = status === 'archived';
  const resolvedAvailable = useMemo(
    () => items.some(i => i.follow_up_resolved && !i.archived_at),
    [items]
  );

  const colSpan = 7 + (isAdmin ? 1 : 0);

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Feedback Inbox</h2>
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

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div>
          <label className="block text-xs text-gray-600">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className="border border-gray-300 rounded px-2 py-1">
            <option value="all">All (active)</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="followup">Needs follow-up</option>
            <option value="resolved">Resolved</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">Category</label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="border border-gray-300 rounded px-2 py-1">
            <option value="">Any</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">Role</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="border border-gray-300 rounded px-2 py-1">
            <option value="">Any</option>
            <option value="student">student</option>
            <option value="ta">ta</option>
            <option value="instructor">instructor</option>
            <option value="primary_instructor">primary_instructor</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">Type</label>
          <select value={type} onChange={e => setType(e.target.value)} className="border border-gray-300 rounded px-2 py-1">
            <option value="">Any</option>
            <option value="bug">bug</option>
            <option value="idea">idea</option>
            <option value="question">question</option>
            <option value="praise">praise</option>
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-600">Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Body contains…"
            className="w-full border border-gray-300 rounded px-2 py-1"
          />
        </div>
        {!viewingArchived && resolvedAvailable && (
          <button
            onClick={archiveResolved}
            disabled={bulkBusy}
            className="px-3 py-1 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
            title="Archive all resolved items currently visible"
          >
            Archive resolved
          </button>
        )}
      </div>

      {/* Always-rendered toolbar row. Swaps between pagination and bulk actions
          so clicking a checkbox does not shift the table downward. */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[44px]">
        {selectedIds.size > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-blue-900">{selectedIds.size} selected</span>
              <button
                onClick={() => runBulk('mark_read')}
                disabled={bulkBusy}
                className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Mark read
              </button>
              {viewingArchived ? (
                <button
                  onClick={() => runBulk('unarchive')}
                  disabled={bulkBusy}
                  className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Unarchive
                </button>
              ) : (
                <button
                  onClick={() => runBulk('archive')}
                  disabled={bulkBusy}
                  className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Archive
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => runBulk('delete')}
                  disabled={bulkBusy}
                  className="px-2 py-1 border border-red-300 rounded bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-2 py-1 text-gray-600 hover:text-gray-900"
              >
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-gray-600">
              {items.length === 0
                ? 'No items'
                : pageSize === 'all'
                  ? `Showing all ${items.length}`
                  : `Showing ${startIdx + 1}–${endIdx} of ${items.length}`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1 || pageSize === 'all'}
                className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
                aria-label="Previous page"
              >
                ‹
              </button>
              <span className="text-xs text-gray-600 whitespace-nowrap">
                {pageSize === 'all' ? '1 / 1' : `${safePage} / ${pageCount}`}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount || pageSize === 'all'}
                className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
                aria-label="Next page"
              >
                ›
              </button>
              <label className="text-xs text-gray-600 ml-2">Per page</label>
              <select
                value={String(pageSize)}
                onChange={e => {
                  const v = e.target.value;
                  setPageSize(v === 'all' ? 'all' : Number(v));
                  setPage(1);
                }}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">All</option>
              </select>
            </div>
          </>
        )}
      </div>


      {error && <div className="text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">No feedback matches.</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={toggleSelectAll}
                    aria-label="Select all on this page"
                    title="Select all on this page"
                  />
                </th>
                <th className="text-left px-3 py-2"></th>
                <th
                  className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => setSort('created')}
                >
                  When{sortIndicator('created')}
                </th>
                <th
                  className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => setSort('role')}
                >
                  From{sortIndicator('role')}
                </th>
                <th
                  className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => setSort('type')}
                >
                  Type{sortIndicator('type')}
                </th>
                <th
                  className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => setSort('category')}
                >
                  Category{sortIndicator('category')}
                </th>
                {isAdmin && (
                  <th
                    className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-900"
                    onClick={() => setSort('priority')}
                    title="Admin-only priority. Submitters do not see this."
                  >
                    Priority{sortIndicator('priority')}
                  </th>
                )}
                <th className="text-left px-3 py-2">Body</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map(row => (
                <tr
                  key={row.id}
                  className={`border-t border-gray-100 hover:bg-blue-50 ${row.is_read ? '' : 'bg-yellow-50/40'} ${row.archived_at ? 'opacity-70' : ''}`}
                >
                  <td className="px-3 py-2 align-top" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      aria-label={`Select item ${row.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 align-top cursor-pointer" onClick={() => setSelectedId(row.id)}>
                    {!row.is_read && <span className="inline-block w-2 h-2 rounded-full bg-blue-600" title="Unread" />}
                    {!!row.needs_follow_up && !row.follow_up_resolved && (
                      <span className="ml-1 inline-block w-2 h-2 rounded-full bg-amber-500" title="Follow-up" />
                    )}
                    {!!row.follow_up_resolved && (
                      <span className="ml-1 inline-block w-2 h-2 rounded-full bg-green-600" title="Resolved" />
                    )}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-gray-600 cursor-pointer" onClick={() => setSelectedId(row.id)}>
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap cursor-pointer" onClick={() => setSelectedId(row.id)}>
                    <div className="text-gray-900">{row.submitter_name || row.submitter_email || '—'}</div>
                    <div className="text-xs text-gray-500">{row.submitter_role}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs cursor-pointer" onClick={() => setSelectedId(row.id)}>{row.submission_type || '—'}</td>
                  <td className="px-3 py-2 align-top text-xs cursor-pointer" onClick={() => setSelectedId(row.id)}>{row.category_name || '—'}</td>
                  {isAdmin && (
                    <td className="px-3 py-2 align-top text-xs cursor-pointer" onClick={() => setSelectedId(row.id)}>
                      {row.priority === 0 ? (
                        <span className={PRIORITY_TONES[0]}>—</span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full ${PRIORITY_TONES[row.priority]}`}>
                          {PRIORITY_LABELS[row.priority]}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 align-top text-gray-800 cursor-pointer" onClick={() => setSelectedId(row.id)}>
                    <div className="line-clamp-2 max-w-xl">{row.body}</div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-4 text-sm text-gray-500 text-center">
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && (
        <FeedbackItemDetail
          itemId={selectedId}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onChanged={() => { load(); onChange?.(); }}
        />
      )}
    </div>
  );
};

export default FeedbackInbox;
