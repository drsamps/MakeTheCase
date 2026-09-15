import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../../services/apiClient';
import MultiSelect from '../ui/MultiSelect';
import SortableHeader from '../ui/SortableHeader';
import { quote } from '../../utils/confirmLabels';

/**
 * Admin > Models list. Dashboard owns the data, modals and API handlers; this component owns
 * the view: Show filter, the collapsible "Search & display" panel (search, Provider, Columns,
 * Test all, Reset), sorting, and the delete guard driven by GET /api/models/usage.
 *
 * Kept deliberately uncluttered: only Show and the panel toggle are always visible. Columns,
 * sort and the panel's open state are remembered; Show, Provider and search reset per visit so
 * a forgotten filter can't hide a model. The component unmounts when the tab is left, which is
 * what drops rows kept visible after being disabled.
 */

export interface Model {
  model_id: string;
  model_name: string;
  vendor?: string;
  enabled: boolean;
  default?: boolean;
  cpm_input?: number | null;
  cpm_input_cache?: number | null;
  cpm_output?: number | null;
  temperature?: number | null;
  reasoning_effort?: string | null;
  release_date?: string | null;
  type?: string | null;
  supported_parameters?: string[] | null;
  default_parameters?: Record<string, unknown> | null;
  parameter_settings?: Record<string, unknown> | null;
  test_date?: string | null;
  test_status?: 'pass' | 'fail' | null;
  test_result?: string | null;
  test_results?: Record<string, unknown> | null;
}

/** Where a model is referenced, from GET /api/models/usage. */
export interface ModelUsage {
  sections: number;
  chats: number;
  evaluations: number;
}

export interface ModelTestOutcome {
  success: boolean;
  message: string;
}

interface Props {
  models: Model[];
  isLoading: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (model: Model) => void;
  onToggle: (model: Model) => Promise<void>;
  onMakeDefault: (model: Model) => void;
  /** Single Test button: runs the test and reports it in a popup. */
  onTest: (model: Model) => void;
  /** Test all: runs one test and returns the outcome, no popup. */
  runTest: (model: Model) => Promise<ModelTestOutcome>;
  onDelete: (model: Model, usage?: ModelUsage) => void;
  testingModelId: string | null;
}

// Optional columns. Model, Default, Status and Actions always show.
type ColumnKey = 'provider' | 'cpm_input' | 'cpm_output' | 'cpm_input_cache' | 'type' | 'release_date';
const COLUMN_OPTIONS: { value: ColumnKey; label: string }[] = [
  { value: 'provider', label: 'Provider' },
  { value: 'cpm_input', label: 'Input $/M' },
  { value: 'cpm_output', label: 'Output $/M' },
  { value: 'cpm_input_cache', label: 'Cached $/M' },
  { value: 'type', label: 'Model Type' },
  { value: 'release_date', label: 'Release Date' },
];
const DEFAULT_COLUMNS: ColumnKey[] = ['provider', 'cpm_input', 'cpm_output'];

type SortKey = 'name' | 'status' | ColumnKey;
type SortState = { key: SortKey; dir: 'asc' | 'desc' };
const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

const COLUMNS_STORAGE_KEY = 'mtc_models_columns';
const SORT_STORAGE_KEY = 'mtc_models_sort';
const PANEL_STORAGE_KEY = 'mtc_models_panel_open';

const readStorage = <T,>(key: string, parse: (raw: string) => T | null, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw === null ? null : parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not persisted; the choice still applies for this visit
  }
};

const parseColumns = (raw: string): ColumnKey[] | null => {
  const stored = JSON.parse(raw);
  if (!Array.isArray(stored)) return null;
  const valid = COLUMN_OPTIONS.map(o => o.value).filter(k => stored.includes(k));
  return valid.length > 0 ? valid : null;
};

const SORT_KEYS: SortKey[] = ['name', 'status', ...COLUMN_OPTIONS.map(o => o.value)];
const parseSort = (raw: string): SortState | null => {
  const stored = JSON.parse(raw);
  if (stored && SORT_KEYS.includes(stored.key) && (stored.dir === 'asc' || stored.dir === 'desc')) {
    return { key: stored.key, dir: stored.dir };
  }
  return null;
};

export const vendorLabel = (vendor?: string | null) => {
  switch ((vendor || '').toLowerCase()) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'google': return 'Google';
    case 'openrouter': return 'OpenRouter';
    default: return vendor || 'Unknown';
  }
};

const vendorBadgeClasses = (vendor?: string | null) => {
  switch ((vendor || '').toLowerCase()) {
    case 'openrouter': return 'bg-purple-100 text-purple-700';
    case 'anthropic': return 'bg-orange-100 text-orange-700';
    case 'google': return 'bg-blue-100 text-blue-700';
    case 'openai': return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-gray-100 text-gray-700';
  }
};

// Prices arrive as strings from DECIMAL columns.
const toNumber = (val: unknown): number | null => {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'string' ? parseFloat(val) : Number(val);
  return Number.isNaN(num) ? null : num;
};

const formatCost = (val: number | null | undefined) => {
  const num = toNumber(val);
  return num === null ? '—' : `$${num.toFixed(2)}`;
};

// DATE column: use the stored day as-is (new Date() would shift it by timezone).
const releaseDay = (model: Model) => (model.release_date ? String(model.release_date).slice(0, 10) : null);

const sanitizeTextForDisplay = (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const sortValue = (model: Model, key: SortKey): string | number | null => {
  switch (key) {
    case 'name': return model.model_name.toLowerCase();
    case 'status': return model.enabled ? 0 : 1;
    case 'provider': return vendorLabel(model.vendor).toLowerCase();
    case 'type': return model.type ? model.type.toLowerCase() : null;
    case 'release_date': return releaseDay(model);
    case 'cpm_input': return toNumber(model.cpm_input);
    case 'cpm_output': return toNumber(model.cpm_output);
    case 'cpm_input_cache': return toNumber(model.cpm_input_cache);
  }
};

const pluralize = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const HEADER_CLASSES = 'px-4 py-3 whitespace-nowrap text-left text-xs font-medium text-gray-500 uppercase tracking-wider';

const ModelsList: React.FC<Props> = ({
  models,
  isLoading,
  onRefresh,
  onAdd,
  onImport,
  onEdit,
  onToggle,
  onMakeDefault,
  onTest,
  runTest,
  onDelete,
  testingModelId,
}) => {
  const [showAll, setShowAll] = useState(false);
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [columns, setColumns] = useState<ColumnKey[]>(() => readStorage(COLUMNS_STORAGE_KEY, parseColumns, DEFAULT_COLUMNS));
  const [sort, setSort] = useState<SortState>(() => readStorage(SORT_STORAGE_KEY, parseSort, DEFAULT_SORT));
  const [panelOpen, setPanelOpen] = useState(() => readStorage(PANEL_STORAGE_KEY, raw => raw === '1', false));
  // Rows disabled while Show is "Enabled" stay visible (dimmed) so they can be switched back on.
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<Record<string, ModelUsage>>({});
  const [testAll, setTestAll] = useState<{ done: number; total: number } | null>(null);
  const [testAllSummary, setTestAllSummary] = useState<string | null>(null);
  const stopTestAllRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchOnOpenRef = useRef(false);

  const fetchUsage = useCallback(async () => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/usage`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const result = await response.json();
      if (response.ok && result?.data) setUsage(result.data);
    } catch (err) {
      // Delete icons stay enabled; the server still refuses unsafe deletes.
      console.error('Failed to fetch model usage:', err);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // The Test all loop outlives this component (runTest belongs to Dashboard),
  // so stop it on unmount — otherwise leaving the tab keeps billing tests with no Stop button.
  useEffect(() => () => { stopTestAllRef.current = true; }, []);

  useEffect(() => {
    if (panelOpen && focusSearchOnOpenRef.current) {
      focusSearchOnOpenRef.current = false;
      searchInputRef.current?.focus();
    }
  }, [panelOpen]);

  const handleRefresh = () => {
    setKeptIds(new Set());
    onRefresh();
    fetchUsage();
  };

  const changeShowAll = (all: boolean) => {
    setShowAll(all);
    setKeptIds(new Set());
  };

  const changeProvider = (value: string) => {
    setProvider(value);
    setKeptIds(new Set());
  };

  const togglePanel = () => {
    const next = !panelOpen;
    if (next) focusSearchOnOpenRef.current = true;
    setPanelOpen(next);
    writeStorage(PANEL_STORAGE_KEY, next ? '1' : '0');
  };

  // MultiSelect reports ['all'] for "All Columns" (and when the last column is unchecked).
  const changeColumns = (selected: string[]) => {
    const next = selected.includes('all')
      ? COLUMN_OPTIONS.map(o => o.value)
      : COLUMN_OPTIONS.map(o => o.value).filter(k => selected.includes(k));
    setColumns(next);
    writeStorage(COLUMNS_STORAGE_KEY, JSON.stringify(next));
  };

  const changeSort = (key: SortKey) => {
    const next: SortState = sort.key === key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'release_date' ? 'desc' : 'asc' };
    setSort(next);
    writeStorage(SORT_STORAGE_KEY, JSON.stringify(next));
  };

  const clearFilters = () => {
    setSearch('');
    changeProvider('');
  };

  const resetView = () => {
    clearFilters();
    changeColumns(DEFAULT_COLUMNS);
    setSort(DEFAULT_SORT);
    writeStorage(SORT_STORAGE_KEY, JSON.stringify(DEFAULT_SORT));
  };

  const handleToggle = async (model: Model) => {
    if (model.enabled) {
      if (model.default && !window.confirm(`Disable ${quote(model.model_name)}? It will also stop being the default model.`)) {
        return;
      }
      if (!showAll) setKeptIds(prev => new Set(prev).add(model.model_id));
    }
    await onToggle(model);
  };

  const has = (key: ColumnKey) => columns.includes(key);

  const providerOptions = useMemo(() => {
    const vendors = Array.from(new Set(models.map(m => (m.vendor || '').toLowerCase()).filter(Boolean)));
    return vendors.sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b)));
  }, [models]);

  const shownByStatus = useMemo(
    () => (showAll ? models : models.filter(m => m.enabled || keptIds.has(m.model_id))),
    [models, showAll, keptIds]
  );
  const hiddenDisabledCount = models.length - shownByStatus.length;

  const searchTerm = search.trim().toLowerCase();
  const filtersActive = Boolean(searchTerm || provider);

  // A sort on a hidden column would be invisible, so fall back to name.
  const effectiveSort: SortState =
    sort.key === 'name' || sort.key === 'status' || columns.includes(sort.key) ? sort : DEFAULT_SORT;

  const displayedModels = useMemo(() => {
    const filtered = shownByStatus.filter(m =>
      (!provider || (m.vendor || '').toLowerCase() === provider) &&
      (!searchTerm || m.model_name.toLowerCase().includes(searchTerm) || m.model_id.toLowerCase().includes(searchTerm))
    );
    const direction = effectiveSort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = sortValue(a, effectiveSort.key);
      const bv = sortValue(b, effectiveSort.key);
      // Empty values last in both directions; ties by name.
      if (av !== bv) {
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        if (cmp !== 0) return cmp * direction;
      }
      return a.model_name.localeCompare(b.model_name);
    });
  }, [shownByStatus, provider, searchTerm, effectiveSort.key, effectiveSort.dir]);

  const testAllRunning = testAll !== null;

  const handleTestAll = async () => {
    const targets = [...displayedModels];
    if (targets.length === 0) return;
    if (!window.confirm(`Test ${pluralize(targets.length, 'model')}? Each sends one short prompt (billed like any AI call).`)) {
      return;
    }
    stopTestAllRef.current = false;
    setTestAllSummary(null);
    const failed: string[] = [];
    let done = 0;
    setTestAll({ done, total: targets.length });
    for (const model of targets) {
      if (stopTestAllRef.current) break;
      const outcome = await runTest(model);
      if (!outcome.success) failed.push(model.model_name);
      done += 1;
      setTestAll({ done, total: targets.length });
    }
    setTestAll(null);

    const passed = done - failed.length;
    const failedText = failed.length === 0
      ? ''
      : `, ${failed.length} failed: ${failed.slice(0, 3).map(n => quote(n)).join(', ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}`;
    const lead = done < targets.length
      ? `Stopped after ${done} of ${pluralize(targets.length, 'model')}`
      : `Tested ${pluralize(done, 'model')}`;
    setTestAllSummary(`${lead}: ${passed} passed${failedText}.`);
  };

  const deleteBlockedReason = (model: Model): string | null => {
    if (model.default) return 'Default model: make another model the default first';
    const sections = usage[model.model_id]?.sections ?? 0;
    if (sections > 0) return `Used by ${pluralize(sections, 'section')}: reassign them first`;
    return null;
  };

  const sortHeader = (label: string, key: SortKey, title?: string) => (
    <SortableHeader
      label={label}
      sortKey={key}
      currentSortKey={effectiveSort.key}
      sortDirection={effectiveSort.dir}
      onSort={changeSort}
      cellClassName="px-4 py-3 whitespace-nowrap"
      title={title}
    />
  );

  const visibleColumnCount = 4 + columns.length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-2xl font-bold text-gray-900">AI Models</h2>
          <p className="text-sm text-gray-500">
            {pluralize(models.length, 'model')} configured
            {hiddenDisabledCount > 0 && (
              <span className="text-gray-400"> ({hiddenDisabledCount} disabled hidden)</span>
            )}
            {filtersActive && <span className="text-gray-400"> · {displayedModels.length} shown</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            + Add Model
          </button>
          <button
            onClick={onImport}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            + Add Model from OpenRouter
          </button>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh models list"
            title="Refresh models list"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Show:</span>
          <div role="group" aria-label="Show models" className="flex items-center bg-gray-100 rounded-lg p-1">
            {([false, true] as const).map(all => (
              <button
                key={String(all)}
                type="button"
                aria-pressed={showAll === all}
                onClick={() => changeShowAll(all)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  showAll === all ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {all ? 'All Models' : 'Enabled'}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={togglePanel}
          aria-expanded={panelOpen}
          aria-controls="models-search-display-panel"
          title={filtersActive ? 'Search & display (filters active)' : 'Search & display'}
          className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            panelOpen ? 'bg-gray-100 text-gray-900 border-gray-300' : 'bg-white text-gray-600 border-gray-200 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          {testAll ? `Testing ${Math.min(testAll.done + 1, testAll.total)}/${testAll.total}…` : 'Search & display'}
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-gray-400 transition-transform ${panelOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          {filtersActive && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-white" aria-hidden="true" />
          )}
        </button>
      </div>

      {panelOpen && (
        <div id="models-search-display-panel" className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearch(''); }}
                placeholder="Search name or ID…"
                aria-label="Search models by name or ID"
                className="w-64 max-w-full pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 rounded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
            <label className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Provider:</span>
              <select
                value={provider}
                onChange={e => changeProvider(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All providers</option>
                {providerOptions.map(v => (
                  <option key={v} value={v}>{vendorLabel(v)}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Columns:</span>
              <MultiSelect
                className="w-44"
                options={COLUMN_OPTIONS}
                selected={columns.length === COLUMN_OPTIONS.length ? ['all'] : columns}
                onChange={changeColumns}
                allLabel="All Columns"
                countLabel="columns showing"
                defaultLabel="Default Columns"
                defaultValues={DEFAULT_COLUMNS}
              />
            </div>
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={handleTestAll}
                disabled={testAllRunning || testingModelId !== null || displayedModels.length === 0}
                title={`Test the ${pluralize(displayedModels.length, 'model')} shown`}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testAll ? `Testing ${Math.min(testAll.done + 1, testAll.total)} of ${testAll.total}…` : 'Test all'}
              </button>
              {testAll && (
                <button
                  type="button"
                  onClick={() => { stopTestAllRef.current = true; }}
                  className="text-sm font-medium text-red-600 hover:underline"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={resetView}
                title="Clear search and Provider; restore default columns and sort"
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {testAllSummary && (
        <div className="mb-3 flex items-start justify-between gap-3 px-3 py-2 text-sm bg-blue-50 text-blue-900 border border-blue-200 rounded-lg" role="status">
          <span>{testAllSummary}</span>
          <button
            type="button"
            onClick={() => setTestAllSummary(null)}
            aria-label="Dismiss test summary"
            className="text-blue-700 hover:text-blue-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {/* Only the first load blanks the table; refreshes after edits and tests update in place. */}
        {isLoading && models.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">Loading models...</div>
        ) : models.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">No models found. Add a model to get started.</div>
        ) : displayedModels.length === 0 && filtersActive ? (
          <div className="p-6 text-sm text-gray-600">
            No models match these filters.{' '}
            <button type="button" onClick={clearFilters} className="font-medium text-blue-600 hover:underline">
              Clear filters
            </button>
          </div>
        ) : displayedModels.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">
            No enabled models.{' '}
            <button type="button" onClick={() => changeShowAll(true)} className="font-medium text-blue-600 hover:underline">
              Show all models
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {sortHeader('Model', 'name')}
                  {has('provider') && sortHeader('Provider', 'provider')}
                  {has('type') && sortHeader('Type', 'type')}
                  {has('release_date') && sortHeader('Released', 'release_date')}
                  <th className={HEADER_CLASSES}>Default</th>
                  {sortHeader('Enabled', 'status')}
                  {has('cpm_input') && sortHeader('In $/M', 'cpm_input', 'Model input cost per million tokens')}
                  {has('cpm_output') && sortHeader('Out $/M', 'cpm_output', 'Model output cost per million tokens')}
                  {has('cpm_input_cache') && sortHeader('Cached $/M', 'cpm_input_cache', 'Model cached input cost per million tokens')}
                  <th className={HEADER_CLASSES}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {displayedModels.map(model => {
                  const hasPassedTest = model.test_status === 'pass';
                  const hasFailedTest = model.test_status === 'fail';
                  const isTesting = testingModelId === model.model_id;
                  const testTime = model.test_date ? new Date(model.test_date).toLocaleString() : 'unknown date';
                  const failDetail = (model.test_results && typeof model.test_results === 'object'
                    ? ((model.test_results as Record<string, unknown>).error || (model.test_results as Record<string, unknown>).message) as string | undefined
                    : undefined) || model.test_result || '';
                  const safeResult = sanitizeTextForDisplay(String(failDetail));
                  const kept = !model.enabled && keptIds.has(model.model_id);
                  const deleteBlocked = deleteBlockedReason(model);
                  return (
                    <React.Fragment key={model.model_id}>
                      <tr className={`hover:bg-gray-50 ${model.default ? 'bg-yellow-50' : ''} ${kept ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-gray-900">{model.model_name}</div>
                          <div className="text-xs text-gray-500">{model.model_id}</div>
                          {(model.temperature !== null && model.temperature !== undefined) || model.reasoning_effort ? (
                            <div className="text-[11px] text-gray-500 mt-1 space-x-2">
                              {model.temperature !== null && model.temperature !== undefined && (
                                <span>temp: {model.temperature}</span>
                              )}
                              {model.reasoning_effort && (
                                <span>effort: {model.reasoning_effort}</span>
                              )}
                            </div>
                          ) : null}
                        </td>
                        {has('provider') && (
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${vendorBadgeClasses(model.vendor)}`}>
                              {vendorLabel(model.vendor)}
                            </span>
                            {/* Without a Type column, keep flagging non-regular types here. */}
                            {!has('type') && model.type && model.type !== 'regular' && (
                              <div className="text-[10px] text-gray-500 mt-1">{model.type}</div>
                            )}
                          </td>
                        )}
                        {has('type') && (
                          <td className="px-4 py-3 text-sm text-gray-700">{model.type || '—'}</td>
                        )}
                        {has('release_date') && (
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{releaseDay(model) || '—'}</td>
                        )}
                        <td className="px-4 py-3">
                          {model.default ? (
                            <span className="px-2 py-1 text-xs font-semibold text-green-700 bg-green-100 rounded-full border border-green-200">
                              Default
                            </span>
                          ) : (
                            // Only one model is the default; setting another clears it (server-side).
                            <button
                              onClick={() => onMakeDefault(model)}
                              disabled={!model.enabled}
                              title={model.enabled ? 'Set as the default model' : 'Enable this model to set it as the default'}
                              aria-label={`Set ${model.model_name} as the default model`}
                              className={`px-2 py-1 text-xs font-medium rounded-md border ${
                                model.enabled
                                  ? 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:text-gray-900'
                                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              }`}
                            >
                              Set
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(model.enabled)}
                            aria-label={`${model.model_name} enabled`}
                            onClick={() => handleToggle(model)}
                            title={model.enabled ? 'Enabled: click to disable' : 'Disabled: click to enable'}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                              model.enabled ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                                model.enabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </td>
                        {has('cpm_input') && (
                          <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.cpm_input)}</td>
                        )}
                        {has('cpm_output') && (
                          <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.cpm_output)}</td>
                        )}
                        {has('cpm_input_cache') && (
                          <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.cpm_input_cache)}</td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                            <button
                              onClick={() => onTest(model)}
                              disabled={isTesting || testAllRunning}
                              title={
                                hasFailedTest
                                  ? 'failed last test, check API key'
                                  : hasPassedTest
                                    ? 'passed test'
                                    : undefined
                              }
                              className={`min-w-[4.5rem] px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                isTesting || testAllRunning
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                  : hasFailedTest
                                    ? 'bg-pink-100 text-pink-800 border-pink-300 hover:bg-pink-200'
                                    : hasPassedTest
                                      ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200'
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {isTesting
                                ? 'Testing...'
                                : hasFailedTest
                                  ? 'Retest'
                                  : hasPassedTest
                                    ? 'Tested'
                                    : 'Test'}
                            </button>
                            <button
                              onClick={() => onEdit(model)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Edit model"
                              aria-label={`Edit ${model.model_name}`}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => onDelete(model, usage[model.model_id])}
                              disabled={deleteBlocked !== null}
                              className={`p-1.5 rounded transition-colors ${
                                deleteBlocked
                                  ? 'text-gray-300 cursor-not-allowed'
                                  : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title={deleteBlocked ?? 'Delete model'}
                              aria-label={`Delete ${model.model_name}`}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {hasFailedTest && (() => {
                        const fullText = `↳ Tested ${testTime} and ${safeResult}`;
                        const displayText = fullText.length > 200 ? `${fullText.slice(0, 200)}…` : fullText;
                        return (
                          <tr className="bg-pink-50">
                            <td colSpan={visibleColumnCount} className="px-4 pt-1 pb-1 text-[11px] text-gray-600 italic">
                              <span className="block whitespace-normal break-words" title={fullText}>
                                {displayText}
                              </span>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelsList;
