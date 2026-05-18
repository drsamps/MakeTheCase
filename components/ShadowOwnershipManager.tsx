/**
 * Shadow-Ownership Manager
 *
 * Admin-only screen for reassigning legacy resources off the shadow
 * instructor account (UUID 00000000-0000-0000-0000-000000000001) onto real
 * instructors.
 *
 * After running the multi-instructor migrations + backfill, every pre-existing
 * Case, Rubric, Persona, Course, Section etc. lives on the shadow until an
 * admin claims it for a specific instructor here.
 *
 * Flow:
 *   1. summary fetch -> counts per resource type
 *   2. pick a type   -> show the orphan rows
 *   3. pick rows (or "all")  + a target instructor  -> POST /transfer
 */
import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/apiClient';

type ResourceType =
  | 'case'
  | 'rubric'
  | 'rubric_criteria'
  | 'persona'
  | 'case_writer_project'
  | 'course'
  | 'section';

const TYPE_LABELS: Record<ResourceType, string> = {
  case: 'Cases',
  rubric: 'Rubrics',
  rubric_criteria: 'Rubric Criteria',
  persona: 'Personas',
  case_writer_project: 'Case Writer Projects',
  course: 'Courses',
  section: 'Sections'
};

interface ShadowRow {
  id: string | number;
  label: string;
  extra: string | number | null;
}

interface InstructorOption {
  id: string;
  email: string;
  full_name?: string;
  is_system_account?: number;
}

const ShadowOwnershipManager: React.FC = () => {
  const [counts, setCounts] = useState<Record<ResourceType, number> | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [activeType, setActiveType] = useState<ResourceType | null>(null);
  const [rows, setRows] = useState<ShadowRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [targetId, setTargetId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoadingCounts(true);
    setError(null);
    const { data, error } = await api.get<{ counts: Record<ResourceType, number> }>(
      '/admin/shadow-ownership/summary'
    );
    setLoadingCounts(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCounts(data?.counts || null);
  }, []);

  const loadInstructors = useCallback(async () => {
    const { data, error } = await api.get<InstructorOption[]>('/instructors');
    if (error) return;
    const list = Array.isArray(data) ? data : [];
    setInstructors(list.filter(i => !i.is_system_account));
  }, []);

  const loadRows = useCallback(async (type: ResourceType) => {
    setLoadingRows(true);
    setError(null);
    setRows([]);
    setSelected(new Set());
    const { data, error } = await api.get<{ rows: ShadowRow[] }>(
      `/admin/shadow-ownership/list/${type}`
    );
    setLoadingRows(false);
    if (error) {
      setError(error.message);
      return;
    }
    setRows(data?.rows || []);
  }, []);

  useEffect(() => {
    loadSummary();
    loadInstructors();
  }, [loadSummary, loadInstructors]);

  const handleSelectType = (type: ResourceType) => {
    setActiveType(type);
    setMessage(null);
    loadRows(type);
  };

  const toggleRow = (id: string | number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  const targetLabel = () => {
    const t = instructors.find(i => i.id === targetId);
    return t ? (t.full_name || t.email) : '';
  };

  const transfer = async (mode: 'selected' | 'allOfType' | 'everything') => {
    if (!targetId) {
      setError('Pick a target instructor first.');
      return;
    }
    const targetName = targetLabel();
    let confirmMsg = '';
    let body: any = { targetInstructorId: targetId };

    if (mode === 'everything') {
      confirmMsg = `Transfer ALL shadow-owned resources (every type) to ${targetName}? This cannot be undone here — only by another transfer.`;
      body.all = true;
    } else if (mode === 'allOfType') {
      if (!activeType) return;
      confirmMsg = `Transfer every shadow-owned ${TYPE_LABELS[activeType]} row to ${targetName}?`;
      body.resourceType = activeType;
      body.all = true;
    } else {
      if (!activeType || selected.size === 0) return;
      if (selected.size > 1) {
        // /transfer only supports one specific row at a time, so loop.
        confirmMsg = `Transfer ${selected.size} selected ${TYPE_LABELS[activeType]} rows to ${targetName}?`;
      } else {
        confirmMsg = `Transfer this row to ${targetName}?`;
      }
    }
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'selected') {
        let total = 0;
        for (const rid of selected) {
          const { error } = await api.post('/admin/shadow-ownership/transfer', {
            resourceType: activeType,
            resourceId: rid,
            targetInstructorId: targetId
          });
          if (error) throw new Error(error.message);
          total += 1;
        }
        setMessage(`Transferred ${total} row(s) to ${targetName}.`);
      } else {
        const { data, error } = await api.post<{ summary: { type: string; rows: number }[] }>(
          '/admin/shadow-ownership/transfer',
          body
        );
        if (error) throw new Error(error.message);
        const total = (data?.summary || []).reduce((a, s) => a + (s.rows || 0), 0);
        setMessage(`Transferred ${total} row(s) to ${targetName}.`);
      }

      // Refresh counts + current type list.
      await loadSummary();
      if (activeType) await loadRows(activeType);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totalShadow = counts
    ? Object.values(counts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Shadow-Owned Resources</h2>
        <p className="text-sm text-gray-500 mt-1">
          Legacy resources currently parked on the shadow account
          (<code className="text-xs">admin_instructor@system.local</code>).
          Transfer them to a real instructor here.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded border border-green-200">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: type counts */}
        <div className="md:col-span-1 bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">By resource type</h3>
            <button
              onClick={loadSummary}
              className="text-xs text-blue-600 hover:underline"
              disabled={loadingCounts}
            >
              {loadingCounts ? '…' : 'refresh'}
            </button>
          </div>

          <ul className="space-y-1">
            {(Object.keys(TYPE_LABELS) as ResourceType[]).map(type => {
              const n = counts?.[type] ?? 0;
              const isActive = activeType === type;
              return (
                <li key={type}>
                  <button
                    onClick={() => handleSelectType(type)}
                    className={`w-full flex justify-between items-center px-3 py-2 rounded text-sm ${
                      isActive
                        ? 'bg-purple-100 text-purple-700 font-medium'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span>{TYPE_LABELS[type]}</span>
                    <span className={`text-xs ${n > 0 ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}>
                      {n}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
            Total: <span className="font-semibold text-gray-700">{totalShadow}</span>
          </div>
        </div>

        {/* Right: target picker + row list */}
        <div className="md:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Transfer to instructor
            </label>
            <select
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
            >
              <option value="">— pick instructor —</option>
              {instructors.map(i => (
                <option key={i.id} value={i.id}>
                  {(i.full_name || i.email)}
                </option>
              ))}
            </select>
            <button
              onClick={() => transfer('everything')}
              disabled={busy || !targetId || totalShadow === 0}
              className="mt-2 text-xs text-red-600 hover:underline disabled:opacity-50"
              title="Move every shadow-owned row to this instructor"
            >
              Transfer EVERYTHING (all types) to this instructor
            </button>
          </div>

          {!activeType ? (
            <div className="text-sm text-gray-500 py-8 text-center">
              Pick a resource type on the left to see orphan rows.
            </div>
          ) : loadingRows ? (
            <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">
              No shadow-owned {TYPE_LABELS[activeType]} remaining.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {TYPE_LABELS[activeType]} ({rows.length})
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={toggleAll}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {selected.size === rows.length ? 'Unselect all' : 'Select all'}
                  </button>
                  <button
                    onClick={() => transfer('allOfType')}
                    disabled={busy || !targetId}
                    className="text-xs text-purple-600 hover:underline disabled:opacity-50"
                    title="Transfer every shadow-owned row of this type"
                  >
                    Transfer all of this type
                  </button>
                  <button
                    onClick={() => transfer('selected')}
                    disabled={busy || !targetId || selected.size === 0}
                    className="text-xs font-medium px-2 py-1 bg-purple-600 text-white rounded disabled:opacity-50"
                  >
                    Transfer selected ({selected.size})
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {rows.map(r => (
                  <label
                    key={String(r.id)}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                    />
                    <span className="flex-1 truncate" title={r.label}>
                      {r.label || <em className="text-gray-400">(no label)</em>}
                    </span>
                    <span className="text-xs text-gray-400">{String(r.id).slice(0, 12)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShadowOwnershipManager;
