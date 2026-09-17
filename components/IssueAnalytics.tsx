import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import HelpTooltip from './ui/HelpTooltip';
import { IssueAnalyticsHelp } from '../help/dashboard';
import { SemesterScopeNote, useSemesterFilter } from './courses/semesterFilter';
import { quote } from '../utils/confirmLabels';
import ThemeCard from './issueAnalytics/ThemeCard';
import TranscriptModal from './issueAnalytics/TranscriptModal';
import PresentMode from './issueAnalytics/PresentMode';
import LeanBar from './issueAnalytics/LeanBar';
import { downloadQuotesCsv, runToMarkdown } from './issueAnalytics/exportUtils';
import {
  ACTIVE_STATUSES, Estimate, Quote, RunStatusPoll, RunSummary, RunView, ThemeType, ThemeView,
  TYPE_META, coverageText, isSampled, money, unusableInScope,
} from './issueAnalytics/types';

/**
 * Results > Issue Analytics. An AI pass over one case + scenario's completed transcripts:
 * themes, how many students raised each, which position each leans toward, and verbatim
 * quotes. Server: server/routes/issueAnalytics.js. Design: docs/issue-analytics.md.
 *
 * Flow: filters -> Estimate -> Start (the estimate is the confirmation) -> progress
 * (polling) -> curate themes -> export. Runs are saved; history is per case + scenario.
 */

interface SectionOption { section_id: string; section_title: string; year_term?: string; semester_id?: number | null }
interface ScenarioOption { scenario_id: number; scenario_name: string; chat_count: number }
interface CaseOption { case_id: string; case_title: string; is_open_now: boolean; latest_open_date: string | null; latest_close_date: string | null; scenarios: ScenarioOption[] }
interface ModelOption { model_id: string; model_name: string; enabled: boolean; default: number; available?: boolean }

const LS_NAMES = 'mtc_ia_show_names';
const LS_SAMPLE = 'mtc_ia_sample';
const DEFAULT_SAMPLE_SIZE = 40;
const POLL_MS = 2000;

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage blocked */ }
}

/** Last "Transcripts to analyze" choice: { on, n }. */
function readSample(): { on: boolean; n: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LS_SAMPLE) || 'null');
    if (v && typeof v.on === 'boolean' && Number.isInteger(v.n) && v.n > 0) return v;
  } catch { /* storage blocked or bad value */ }
  return { on: false, n: DEFAULT_SAMPLE_SIZE };
}
function writeSample(v: { on: boolean; n: number }) {
  try { localStorage.setItem(LS_SAMPLE, JSON.stringify(v)); } catch { /* storage blocked */ }
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .ia-print-region, .ia-print-region * { visibility: visible !important; }
  .ia-print-region { position: absolute !important; left: 0; top: 0; width: 100%; }
  .ia-no-print, .ia-unselected { display: none !important; }
  .ia-print-show { display: block !important; }
  .ia-theme { break-inside: avoid; border: none !important; padding: 0.25rem 0 !important; opacity: 1 !important; }
}
@page { margin: 0.75in; }
`;

const STATUS_LABEL: Record<string, string> = {
  running: 'Analyzing',
  clustering: 'Grouping themes',
  completed: 'Completed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  failed: 'Failed',
};

const IssueAnalytics: React.FC = () => {
  const { inScope, semesterId } = useSemesterFilter();

  const [sectionOptions, setSectionOptions] = useState<SectionOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [caseSections, setCaseSections] = useState<Record<string, string[]>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  const [selectedSections, setSelectedSections] = useState<string[]>(['all']);
  const [selectedCase, setSelectedCase] = useState('');
  const [selectedScenario, setSelectedScenario] = useState<number | null>(null);
  const [themeMin, setThemeMin] = useState(6);
  const [themeMax, setThemeMax] = useState(12);
  const [modelId, setModelId] = useState('');
  const [sampleOn, setSampleOn] = useState(() => readSample().on);
  const [sampleN, setSampleN] = useState(() => readSample().n);
  // null = the server's stable per-scope seed; set by "Draw a different sample".
  const [sampleSeed, setSampleSeed] = useState<string | null>(null);

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [starting, setStarting] = useState(false);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [poll, setPoll] = useState<RunStatusPoll | null>(null);
  const [compareRunId, setCompareRunId] = useState<number | null>(null);
  const [compareView, setCompareView] = useState<RunView | null>(null);

  const [showNames, setShowNames] = useState(() => readFlag(LS_NAMES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openQuote, setOpenQuote] = useState<Quote | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const [newTheme, setNewTheme] = useState({ label: '', description: '', theme_type: 'topic' as ThemeType });
  const [rescanEstimates, setRescanEstimates] = useState<Record<number, { chats: number; est_cost_usd: number | null; exceeds_cap: boolean }>>({});

  const viewSeq = useRef(0);

  // --- Filters ----------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const [filters, modelList] = await Promise.all([
        api.get('/analytics/filters'),
        api.get<ModelOption[]>('/models?enabled=true'),
      ]);
      if (filters.error) setError(filters.error.message);
      else if (filters.data) {
        setSectionOptions(filters.data.sections || []);
        setCaseOptions(filters.data.cases || []);
        setCaseSections(filters.data.case_sections || {});
      }
      if (modelList.data) setModels(modelList.data.filter(m => m.enabled && m.available !== false));
      setFiltersLoaded(true);
    })().catch(e => { setError(e instanceof Error ? e.message : String(e)); setFiltersLoaded(true); });
  }, []);

  const sectionsInScope = useMemo(() => sectionOptions.filter(s => inScope(s)), [sectionOptions, inScope]);
  const sectionSelectOptions: MultiSelectOption[] = useMemo(
    () => sectionsInScope.map(s => ({ value: s.section_id, label: s.section_title, subtitle: s.year_term })),
    [sectionsInScope]
  );
  const pickedSectionIds = selectedSections.includes('all') ? null : selectedSections;

  // Same narrowing as Position Analytics: only cases assigned to in-scope (and picked) sections.
  const casesForPicks = useMemo(() => {
    const visible = caseOptions.filter(c =>
      (caseSections[c.case_id] || []).some(id => inScope(sectionOptions.find(s => s.section_id === id))));
    if (!pickedSectionIds) return visible;
    return visible.filter(c => pickedSectionIds.some(id => (caseSections[c.case_id] || []).includes(id)));
  }, [caseOptions, caseSections, sectionOptions, inScope, pickedSectionIds]);

  const caseOption = casesForPicks.find(c => c.case_id === selectedCase) || null;
  const scenarios = caseOption?.scenarios ?? [];
  const needsScenario = scenarios.length > 1;

  // Auto-pick: currently open first, then most recent. (Unlike Position Analytics there is
  // no "has position data" signal for transcripts, so recency decides.)
  useEffect(() => {
    if (!filtersLoaded || casesForPicks.length === 0) return;
    if (selectedCase && casesForPicks.some(c => c.case_id === selectedCase)) return;
    const recency = (c: CaseOption) => Math.max(0, ...[c.latest_open_date, c.latest_close_date]
      .filter(Boolean).map(d => new Date(d as string).getTime()));
    const ranked = [...casesForPicks].sort((a, b) =>
      (Number(b.is_open_now) - Number(a.is_open_now)) || (recency(b) - recency(a)) || a.case_title.localeCompare(b.case_title));
    setSelectedCase(ranked[0].case_id);
  }, [filtersLoaded, casesForPicks, selectedCase]);

  useEffect(() => {
    if (scenarios.length === 0) {
      if (selectedScenario !== null) setSelectedScenario(null);
      return;
    }
    if (selectedScenario !== null && scenarios.some(s => s.scenario_id === selectedScenario)) return;
    setSelectedScenario([...scenarios].sort((a, b) => b.chat_count - a.chat_count)[0].scenario_id);
  }, [scenarios, selectedScenario]);

  useEffect(() => {
    if (selectedSections.includes('all') || sectionOptions.length === 0) return;
    const kept = selectedSections.filter(id => inScope(sectionOptions.find(s => s.section_id === id)));
    if (kept.length !== selectedSections.length) setSelectedSections(kept.length ? kept : ['all']);
  }, [inScope, selectedSections, sectionOptions]);

  // Any scope change invalidates the estimate.
  useEffect(() => { setEstimate(null); }, [selectedCase, selectedScenario, selectedSections, semesterId, modelId, sampleOn, sampleN, sampleSeed]);
  // A different case or scenario goes back to its own stable sample.
  useEffect(() => { setSampleSeed(null); }, [selectedCase, selectedScenario]);
  useEffect(() => { writeSample({ on: sampleOn, n: sampleN }); }, [sampleOn, sampleN]);

  const scopeParams = useCallback((seed: string | null = sampleSeed) => {
    const p = new URLSearchParams();
    p.set('case_id', selectedCase);
    if (selectedScenario != null) p.set('scenario_id', String(selectedScenario));
    if (pickedSectionIds) p.set('section_ids', pickedSectionIds.join(','));
    else if (semesterId != null) p.set('semester_id', String(semesterId));
    if (modelId) p.set('model_id', modelId);
    if (sampleOn) {
      p.set('sample_size', String(sampleN));
      if (seed) p.set('sample_seed', seed);
    }
    return p;
  }, [selectedCase, selectedScenario, pickedSectionIds, semesterId, modelId, sampleOn, sampleN, sampleSeed]);

  // --- Runs -------------------------------------------------------------------------
  const loadRuns = useCallback(async () => {
    if (!selectedCase) { setRuns([]); return; }
    const p = new URLSearchParams({ case_id: selectedCase });
    if (selectedScenario != null) p.set('scenario_id', String(selectedScenario));
    const r = await api.get<RunSummary[]>(`/issue-analytics/runs?${p}`);
    if (r.error) { setError(r.error.message); return; }
    setRuns(r.data || []);
  }, [selectedCase, selectedScenario]);

  useEffect(() => {
    setActiveRunId(null);
    setView(null);
    setCompareRunId(null);
    loadRuns();
  }, [loadRuns]);

  // Open the newest run for this case+scenario when nothing is open.
  useEffect(() => {
    if (activeRunId == null && runs.length > 0) setActiveRunId(runs[0].id);
  }, [runs, activeRunId]);

  const loadView = useCallback(async (id: number) => {
    const seq = ++viewSeq.current;
    const r = await api.get<RunView>(`/issue-analytics/runs/${id}${showNames ? '?names=1' : ''}`);
    if (seq !== viewSeq.current) return;
    if (r.error) { setError(r.error.message); return; }
    setView(r.data);
  }, [showNames]);

  useEffect(() => {
    if (activeRunId == null) { setView(null); return; }
    loadView(activeRunId);
  }, [activeRunId, loadView]);

  useEffect(() => {
    if (compareRunId == null) { setCompareView(null); return; }
    api.get<RunView>(`/issue-analytics/runs/${compareRunId}${showNames ? '?names=1' : ''}`)
      .then(r => setCompareView(r.data));
  }, [compareRunId, showNames]);

  // Poll while the open run, or a re-scan in it, is working.
  const working = !!view && (ACTIVE_STATUSES.includes(view.run.status)
    || view.themes.some(t => t.rescan_status === 'pending' || t.rescan_status === 'running'));
  useEffect(() => {
    if (!working || activeRunId == null) { setPoll(null); return; }
    let stopped = false;
    const tick = async () => {
      const r = await api.get<RunStatusPoll>(`/issue-analytics/runs/${activeRunId}/status`);
      if (stopped || !r.data) return;
      setPoll(r.data);
      const runDone = !ACTIVE_STATUSES.includes(r.data.status);
      const rescansDone = r.data.rescans.every(x => x.rescan_status !== 'pending' && x.rescan_status !== 'running');
      if (runDone && rescansDone) {
        await loadView(activeRunId);
        loadRuns();
      } else if (r.data.rescans.length) {
        // Re-scan progress lives on the theme cards.
        setView(v => v && ({
          ...v,
          themes: v.themes.map(t => {
            const x = r.data!.rescans.find(y => y.id === t.id);
            return x ? { ...t, rescan_status: x.rescan_status, rescan_done: x.rescan_done, rescan_error: x.rescan_error } : t;
          }),
        }));
      }
    };
    const handle = setInterval(tick, POLL_MS);
    tick();
    return () => { stopped = true; clearInterval(handle); };
  }, [working, activeRunId, loadView, loadRuns]);

  // --- Actions ----------------------------------------------------------------------
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const getEstimate = (seed: string | null = sampleSeed) => {
    setEstimating(true);
    setError(null);
    api.get<Estimate>(`/issue-analytics/estimate?${scopeParams(seed)}`)
      .then(r => (r.error ? setError(r.error.message) : setEstimate(r.data)))
      .finally(() => setEstimating(false));
  };

  const redrawSample = () => {
    const seed = Math.random().toString(36).slice(2, 12);
    setSampleSeed(seed);
    getEstimate(seed);
  };

  const startRun = () => {
    if (!estimate) return;
    setStarting(true);
    setError(null);
    const body: Record<string, unknown> = {
      case_id: selectedCase,
      scenario_id: selectedScenario,
      theme_target_min: themeMin,
      theme_target_max: themeMax,
      model_id: modelId || undefined,
      confirmed: true,
    };
    // Start exactly what was estimated: the same size request and the same draw. Keyed on
    // sample_size, not sample_requested — a request that resolved to a full run (N >= the pool)
    // must stay full, or a chat finished between Estimate and Start silently makes it a sample.
    if (estimate.sample_size != null) {
      body.sample_size = estimate.sample_requested;
      body.sample_seed = estimate.sample_seed;
    }
    if (pickedSectionIds) body.section_ids = pickedSectionIds;
    else if (semesterId != null) body.semester_id = semesterId;
    api.post<RunSummary>('/issue-analytics/runs', body)
      .then(async r => {
        if (r.error) { setError(r.error.message); return; }
        setEstimate(null);
        await loadRuns();
        setActiveRunId(r.data!.id);
      })
      .finally(() => setStarting(false));
  };

  const act = (path: string, method: 'post' | 'patch' | 'put' | 'delete', body?: unknown, after?: () => Promise<void> | void) =>
    run(async () => {
      const call = method === 'delete' ? api.delete(path) : api[method](path, body);
      const r = await call;
      if (r.error) throw new Error(r.error.message);
      if (after) await after();
      else if (activeRunId != null) await loadView(activeRunId);
    });

  const base = activeRunId != null ? `/issue-analytics/runs/${activeRunId}` : '';

  const toggleNames = (next: boolean) => {
    setShowNames(next);
    writeFlag(LS_NAMES, next);
  };

  const deleteRun = (r: RunSummary) => {
    const when = new Date(r.created_at).toLocaleString();
    if (!window.confirm(`Delete the ${quote(r.case_title)} analysis from ${when}? Its themes and quotes will be removed.`)) return;
    act(`/issue-analytics/runs/${r.id}`, 'delete', undefined, async () => {
      if (activeRunId === r.id) { setActiveRunId(null); setView(null); }
      if (compareRunId === r.id) setCompareRunId(null);
      await loadRuns();
    });
  };

  const addTheme = () => act(`${base}/themes`, 'post', newTheme, async () => {
    setNewTheme({ label: '', description: '', theme_type: newTheme.theme_type });
    if (activeRunId != null) await loadView(activeRunId);
  });

  // Rescan estimates for instructor themes that have not been checked yet.
  useEffect(() => {
    if (!view) return;
    for (const t of view.themes) {
      if (t.origin === 'instructor' && t.rescan_status === 'none' && !rescanEstimates[t.id]) {
        api.get<{ chats: number; est_cost_usd: number | null; exceeds_cap: boolean }>(`/issue-analytics/runs/${view.run.id}/themes/${t.id}/rescan-estimate`)
          .then(r => { if (r.data) setRescanEstimates(m => ({ ...m, [t.id]: r.data! })); });
      }
    }
  }, [view, rescanEstimates]);

  const copyMarkdown = () => {
    if (!view) return;
    navigator.clipboard.writeText(runToMarkdown(view))
      .then(() => setNotice(`Copied ${view.themes.filter(t => t.selected).length} themes as Markdown${showNames ? ' (with student names)' : ''}.`))
      .catch(() => setError('The browser blocked clipboard access.'));
  };

  const togglePromptPreview = () => {
    if (promptPreview !== null) { setPromptPreview(null); return; }
    api.get<{ template: string }>('/issue-analytics/prompt-preview')
      .then(r => (r.error ? setError(r.error.message) : setPromptPreview(r.data!.template)));
  };

  // --- Render -----------------------------------------------------------------------
  const currentRun = view?.run ?? null;
  const editable = currentRun?.status === 'completed';
  const progress = poll ?? currentRun;

  const renderFilters = () => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4 ia-no-print">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="min-w-56">
          <label className="block text-xs font-medium text-gray-700 mb-1">Course Sections</label>
          <MultiSelect options={sectionSelectOptions} selected={selectedSections} onChange={setSelectedSections}
            placeholder="Select sections..." allLabel="ALL Sections" />
          <SemesterScopeNote className="mt-1" />
        </div>
        <div className="min-w-56">
          <label className="block text-xs font-medium text-gray-700 mb-1">Case</label>
          <select value={selectedCase} onChange={e => { setSelectedCase(e.target.value); setSelectedScenario(null); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Select a case…</option>
            {casesForPicks.map(c => <option key={c.case_id} value={c.case_id}>{c.case_title}</option>)}
          </select>
        </div>
        {needsScenario && (
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Scenario <span className="text-amber-600">*</span></label>
            <select value={selectedScenario ?? ''} onChange={e => setSelectedScenario(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
              {scenarios.map(s => <option key={s.scenario_id} value={s.scenario_id}>{s.scenario_name} ({s.chat_count} chats)</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500">Each scenario has its own positions, so runs cover one.</p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Themes to find</label>
          <div className="flex items-center gap-1 text-sm">
            <input type="number" min={1} max={30} value={themeMin} aria-label="Fewest themes"
              onChange={e => setThemeMin(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="w-16 border border-gray-300 rounded-md px-2 py-2" />
            <span>to</span>
            <input type="number" min={1} max={30} value={themeMax} aria-label="Most themes"
              onChange={e => setThemeMax(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="w-16 border border-gray-300 rounded-md px-2 py-2" />
          </div>
        </div>
        <div className="min-w-48">
          <label className="block text-xs font-medium text-gray-700 mb-1">AI model</label>
          <select value={modelId} onChange={e => setModelId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white">
            <option value="">Default</option>
            {models.map(m => <option key={m.model_id} value={m.model_id}>{m.model_name}{m.default === 1 ? ' (default)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Transcripts to analyze</label>
          <div className="flex items-center gap-3 text-sm py-2">
            <label className="flex items-center gap-1">
              <input type="radio" name="ia-sample" checked={!sampleOn} onChange={() => setSampleOn(false)} />
              All
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="ia-sample" checked={sampleOn} onChange={() => setSampleOn(true)} />
              Sample of
            </label>
            {/* Disabled under All: focusing the field must not switch the mode (and so
                invalidate the estimate) just because someone tabbed in to read the number. */}
            <input type="number" min={1} max={9999} value={sampleN} aria-label="Number of transcripts to sample"
              disabled={!sampleOn}
              onChange={e => setSampleN(Math.max(1, Math.min(9999, Math.floor(Number(e.target.value)) || 1)))}
              className="w-20 border border-gray-300 rounded-md px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400" />
          </div>
        </div>
        <button type="button" onClick={() => getEstimate()}
          disabled={!selectedCase || (needsScenario && selectedScenario == null) || themeMin > themeMax || estimating}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50">
          {estimating ? 'Estimating…' : 'Estimate new analysis'}
        </button>
        <div className="pb-1 ml-auto">
          <HelpTooltip title="Issue Analytics"><IssueAnalyticsHelp /></HelpTooltip>
        </div>
      </div>
      {themeMin > themeMax && <p className="text-sm text-red-700">The fewest themes must not exceed the most.</p>}
      <div>
        <button type="button" onClick={togglePromptPreview} className="text-xs text-gray-600 hover:underline">
          {promptPreview !== null ? '▾ Hide' : '▸ Show'} the instructions the AI gets for each transcript
        </button>
        {promptPreview !== null && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded p-3">{promptPreview}</pre>
        )}
      </div>
      {estimate && renderEstimate(estimate)}
    </div>
  );

  const renderEstimate = (e: Estimate) => {
    const nothing = e.chats_total - e.chats_skipped === 0;
    const skipReasons = Object.entries(e.skip_reasons);
    const sampled = e.sample_size != null;
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm space-y-2">
        {sampled ? (
          <p className="text-gray-900">
            <strong>{e.chats_completed}</strong> completed chat{e.chats_completed === 1 ? '' : 's'} in {e.section_ids.length} section{e.section_ids.length === 1 ? '' : 's'},{' '}
            {e.sample_pool} with a usable transcript. <strong>Sample of {e.sample_size}</strong>:{' '}
            {e.chats_to_process} to analyze, {e.chats_cached} already analyzed (free).
          </p>
        ) : (
          <p className="text-gray-900">
            <strong>{e.chats_completed}</strong> completed chat{e.chats_completed === 1 ? '' : 's'} in {e.section_ids.length} section{e.section_ids.length === 1 ? '' : 's'}:{' '}
            {e.chats_to_process} to analyze, {e.chats_cached} already analyzed (free), {e.chats_skipped} skipped.
          </p>
        )}
        {sampled && e.sample_by_section && (
          <p className="text-xs text-gray-600">
            Drawn in proportion to each section:{' '}
            {Object.entries(e.sample_by_section).map(([id, c]) => `${id} ${c.drawn} of ${c.usable}`).join(' · ')}.{' '}
            <button type="button" onClick={redrawSample} disabled={estimating} className="text-blue-700 hover:underline">
              Draw a different sample
            </button>
          </p>
        )}
        {!sampled && e.sample_requested != null && (
          <p className="text-xs text-gray-600">
            A sample of {e.sample_requested} would cover every usable transcript here ({e.sample_pool}), so all of them are analyzed.
          </p>
        )}
        {skipReasons.length > 0 && (
          <p className="text-xs text-gray-600">
            {sampled ? 'Not eligible for the sample' : 'Skipped'}: {skipReasons.map(([k, n]) => `${k} (${n})`).join('; ')}
          </p>
        )}
        <p className="text-gray-900">
          Estimated cost: <strong>{money(e.est_cost_usd)}</strong> with {e.model_name}.{' '}
          Billed to <strong>{e.billed_instructor_name || 'the system key (no instructor budget applies)'}</strong>
          {e.cap_active && <> — {money(e.cap_remaining_usd)} left of this week’s {money(e.cap_usd)} budget</>}.
        </p>
        {sampled && (
          <p className="text-xs text-gray-600">
            Analyzing all {e.sample_pool} would take {e.full_chats_to_process} AI call{e.full_chats_to_process === 1 ? '' : 's'} and cost about {money(e.full_est_cost_usd)}.
          </p>
        )}
        {!e.model_priced && <p className="text-amber-800">This model has no price set, so the cost cannot be estimated.</p>}
        {e.exceeds_cap && <p className="text-red-700 font-medium">The estimate is more than is left of this week’s budget. Pick fewer sections, a smaller sample, or a cheaper model.</p>}
        {nothing && <p className="text-red-700">No completed chat here has a usable transcript.</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={startRun} disabled={starting || e.exceeds_cap || nothing}
            className="px-4 py-2 rounded-md bg-green-600 text-white font-medium disabled:opacity-50">
            {starting ? 'Starting…' : `Start analysis (${money(e.est_cost_usd)})`}
          </button>
          <button type="button" onClick={() => setEstimate(null)} className="px-4 py-2 rounded-md border border-gray-300 bg-white">Cancel</button>
        </div>
      </div>
    );
  };

  const renderHistory = () => runs.length > 0 && (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm ia-no-print">
      <details open={runs.length > 1 || !view}>
        <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-700">
          Saved analyses for this case ({runs.length})
        </summary>
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 text-left">
            <tr><th className="px-4 py-1">Started</th><th className="px-2">Semester</th><th className="px-2">Sections</th><th className="px-2">Analyzed</th><th className="px-2">Themes</th><th className="px-2">Status</th><th /></tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id} className={`border-t border-gray-100 ${r.id === activeRunId ? 'bg-blue-50' : ''}`}>
                <td className="px-4 py-1.5">
                  <button type="button" onClick={() => setActiveRunId(r.id)} className="text-blue-700 hover:underline">
                    {new Date(r.created_at).toLocaleString()}
                  </button>
                </td>
                <td className="px-2">{r.semester_label || '—'}</td>
                <td className="px-2 text-xs text-gray-600" title={r.section_ids.join(', ')}>{r.section_ids.length}</td>
                <td className="px-2">
                  {r.chats_done} of {r.chats_completed_in_scope}
                  {isSampled(r) && <span className="ml-1 text-xs text-gray-500">(sample)</span>}
                </td>
                <td className="px-2">{r.theme_count}</td>
                <td className="px-2">
                  {STATUS_LABEL[r.status] || r.status}
                  {r.stale_reason && <span className="ml-1 text-amber-700" title="Transcripts changed since this analysis">⚠</span>}
                </td>
                <td className="px-2 text-right whitespace-nowrap">
                  {r.id !== activeRunId && view && (
                    <button type="button" onClick={() => setCompareRunId(compareRunId === r.id ? null : r.id)}
                      className="text-xs text-gray-700 hover:underline mr-3">
                      {compareRunId === r.id ? 'Stop comparing' : 'Compare'}
                    </button>
                  )}
                  {!ACTIVE_STATUSES.includes(r.status) && (
                    <button type="button" onClick={() => deleteRun(r)} disabled={busy} className="text-xs text-red-700 hover:underline">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );

  const renderProgress = () => {
    if (!currentRun || !progress) return null;
    const status = progress.status;
    if (!ACTIVE_STATUSES.includes(status)) return null;
    const handled = progress.chats_done + progress.chats_skipped + progress.chats_failed;
    const pct = progress.chats_total ? Math.round((handled / progress.chats_total) * 100) : 0;
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 ia-no-print">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-900">
            {status === 'clustering' ? 'Grouping what students said into themes…' : `Reading transcripts… ${handled} of ${progress.chats_total}`}
          </span>
          <button type="button" disabled={busy} onClick={() => act(`${base}/stop`, 'post')}
            className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50">Stop (keeps progress)</button>
        </div>
        <div className="mt-2 h-2 rounded bg-gray-100 overflow-hidden">
          <div className={`h-full bg-blue-500 transition-all ${status === 'clustering' ? 'animate-pulse' : ''}`}
            style={{ width: `${status === 'clustering' ? 100 : pct}%` }} />
        </div>
        {progress.chats_failed > 0 && <p className="mt-1 text-xs text-amber-700">{progress.chats_failed} transcript(s) failed; Resume retries them.</p>}
      </div>
    );
  };

  const renderRunHeader = (v: RunView) => {
    const r = v.run;
    const canResume = ['stopped', 'interrupted', 'failed'].includes(r.status);
    return (
      <div className="space-y-2 ia-no-print">
        {canResume && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
            <span className="text-amber-900">
              <strong>{STATUS_LABEL[r.status]}</strong> after {r.chats_done} of {r.chats_total} transcripts
              {r.stop_reason ? `: ${r.stop_reason}` : ''}. Finished transcripts are kept, so resuming only pays for the rest.
            </span>
            <button type="button" disabled={busy} onClick={() => act(`${base}/resume`, 'post', {}, async () => { await loadView(r.id); loadRuns(); })}
              className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium">Resume</button>
          </div>
        )}
        {r.stale_reason && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {r.stale_reason === 'chat_removed'
              ? 'Some chats in this analysis have since been deleted, so its counts no longer match the data.'
              : 'Some transcripts have changed since this analysis ran, so quotes and counts may be out of date. Run a new analysis to refresh them (unchanged transcripts cost nothing).'}
          </div>
        )}
        {r.theme_note && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
            <span className="font-medium text-gray-900">AI note when the themes were grouped: </span>{r.theme_note}
          </div>
        )}
      </div>
    );
  };

  const renderThemes = (v: RunView) => {
    const r = v.run;
    const skipped = v.skipped.reduce((n, s) => n + s.count, 0);
    // A sampled run has no skipped rows (undrawn chats are not written), so the transcripts
    // that could not be read are invisible unless they are derived from the pool.
    const unusable = unusableInScope(r);
    return (
      <div className="ia-print-region bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{r.case_title}{r.scenario_name ? ` — ${r.scenario_name}` : ''}</h3>
            <p className="text-sm text-gray-600">
              {coverageText(r)}
              {skipped > 0 && <> · {skipped} not analyzed</>}
              {skipped === 0 && unusable > 0 && <> · {unusable} could not be read</>}
              {r.semester_label && <> · {r.semester_label}</>} · {r.section_ids.join(', ')}
            </p>
            <p className="text-xs text-gray-500 ia-no-print">
              {r.model_id} · billed to {r.billed_instructor_name || 'system key'} · estimated {money(r.est_cost_usd)}
            </p>
            {skipped > 0 && (
              <p className="text-xs text-gray-500 ia-no-print">
                Not analyzed: {v.skipped.map(s => `${s.reason || s.state} (${s.count})`).join('; ')}
              </p>
            )}
            {skipped === 0 && unusable > 0 && (
              <p className="text-xs text-gray-500 ia-no-print">
                {unusable} completed chat{unusable === 1 ? '' : 's'} had no readable transcript, so
                {unusable === 1 ? ' it was' : ' they were'} left out of the {r.sample_pool} the sample was drawn from.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 ia-no-print">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 mr-2">
              <input type="checkbox" checked={showNames} onChange={e => toggleNames(e.target.checked)} className="w-4 h-4" />
              Show names
            </label>
            <button type="button" onClick={() => setPresenting(true)} className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50">Present</button>
            <button type="button" onClick={copyMarkdown} className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50">Copy as Markdown</button>
            <button type="button" onClick={() => run(() => downloadQuotesCsv(r.id, showNames))}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50"
              title={showNames ? 'Includes student names and ids' : 'No names or student ids'}>
              Download quotes (CSV{showNames ? ', with names' : ''})
            </button>
            <button type="button" onClick={() => window.print()} className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50">Print handout</button>
          </div>
        </div>

        {v.themes.length === 0 && r.status === 'completed' && (
          <p className="text-sm text-gray-600">No themes were found.</p>
        )}

        {(['topic', 'argument', 'friction'] as ThemeType[]).map(type => {
          const list = v.themes.filter(t => t.theme_type === type);
          if (list.length === 0) return null;
          return (
            <section key={type}>
              <h4 className="text-sm font-semibold text-gray-800">
                <span className={`px-2 py-0.5 rounded ${TYPE_META[type].badge}`}>{TYPE_META[type].label}</span>
                <span className="ml-2 font-normal text-gray-500">{TYPE_META[type].hint}</span>
              </h4>
              <div className="mt-2 space-y-3">
                {list.map(t => (
                  <ThemeCard key={t.id} theme={t} run={r} axis={v.axis} editable={!!editable} busy={busy}
                    otherThemes={v.themes.filter(o => o.id !== t.id)}
                    rescanEstimate={rescanEstimates[t.id]}
                    onPatch={patch => act(`${base}/themes/${t.id}`, 'patch', patch)}
                    onMergeInto={targetId => {
                      const target = v.themes.find(o => o.id === targetId);
                      if (!window.confirm(`Merge ${quote(t.label)} into ${quote(target?.label)}? Its students and quotes move to ${quote(target?.label)}.`)) return;
                      act(`${base}/themes/merge`, 'post', { target_id: targetId, source_ids: [t.id] });
                    }}
                    onDelete={() => {
                      if (!window.confirm(`Remove the theme ${quote(t.label)}? Its student counts and quotes are removed from this analysis.`)) return;
                      act(`${base}/themes/${t.id}`, 'delete');
                    }}
                    onRescan={() => act(`${base}/themes/${t.id}/rescan`, 'post', { confirmed: true })}
                    onOpenQuote={setOpenQuote}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {editable && (
          <div className="border-t border-gray-200 pt-4 ia-no-print">
            <h4 className="text-sm font-semibold text-gray-800">Add a theme the AI missed</h4>
            <p className="text-xs text-gray-500">The transcripts are then checked for it, which costs one AI call per analyzed transcript. You see the cost before it runs.</p>
            <div className="mt-2 flex flex-wrap gap-2 items-start">
              <input value={newTheme.label} onChange={e => setNewTheme({ ...newTheme, label: e.target.value })} maxLength={200}
                placeholder="Theme name" className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-56" />
              <input value={newTheme.description} onChange={e => setNewTheme({ ...newTheme, description: e.target.value })} maxLength={2000}
                placeholder="What counts as raising it (optional)" className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1 min-w-64" />
              <select value={newTheme.theme_type} onChange={e => setNewTheme({ ...newTheme, theme_type: e.target.value as ThemeType })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm" aria-label="Theme type">
                <option value="topic">Topic</option>
                <option value="argument">Argument</option>
                <option value="friction">Friction</option>
              </select>
              <button type="button" onClick={addTheme} disabled={busy || !newTheme.label.trim()}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50">Add theme</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCompare = (a: RunView, b: RunView) => {
    const col = (v: RunView) => (
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{v.run.semester_label || 'No semester'} · {new Date(v.run.created_at).toLocaleDateString()}</p>
        <p className="text-xs text-gray-500">
          {v.run.chats_done} {isSampled(v.run) ? `sampled of ${v.run.sample_pool}` : 'analyzed'} · {v.run.section_ids.join(', ')}
        </p>
        <ul className="mt-2 space-y-2">
          {[...v.themes].filter(t => t.selected).sort((x, y) => (y.prevalence_pct ?? 0) - (x.prevalence_pct ?? 0)).map((t: ThemeView) => (
            <li key={t.id} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate"><span className={`text-[10px] px-1 rounded mr-1 ${TYPE_META[t.theme_type].badge}`}>{t.theme_type}</span>{t.label}</span>
                <span className="text-gray-600 whitespace-nowrap">{t.prevalence_pct == null ? '—' : `${Math.round(t.prevalence_pct)}%`}</span>
              </div>
              <LeanBar theme={t} axis={v.axis} compact />
            </li>
          ))}
        </ul>
      </div>
    );
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 ia-no-print">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">Compare analyses (share of analyzed students)</h4>
          <button type="button" onClick={() => setCompareRunId(null)} className="text-xs text-gray-600 hover:underline">Close</button>
        </div>
        <p className="text-xs text-gray-500">
          Themes are named separately in each analysis, so match them by meaning rather than by exact name.
          {(isSampled(a.run) || isSampled(b.run)) && ' Percentages from a sample are approximate, so treat small differences as noise.'}
        </p>
        <div className="mt-3 flex gap-6">{col(a)}{col(b)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      {renderFilters()}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 ia-no-print">{error}</div>}
      {notice && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 ia-no-print">{notice}</div>}
      {filtersLoaded && casesForPicks.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
          No cases are assigned to the sections in view. Change the semester in the header or pick other sections.
        </div>
      )}
      {renderHistory()}
      {selectedCase && runs.length === 0 && !estimate && filtersLoaded && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600 ia-no-print">
          No analyses yet for this case. Choose the sections and press <strong>Estimate new analysis</strong> to see what a run would cover and cost.
        </div>
      )}
      {renderProgress()}
      {view && renderRunHeader(view)}
      {view && compareView && renderCompare(view, compareView)}
      {view && (view.themes.length > 0 || view.run.status === 'completed') && renderThemes(view)}
      {openQuote && activeRunId != null && (
        <TranscriptModal runId={activeRunId} caseChatId={openQuote.case_chat_id}
          start={openQuote.quote_start} end={openQuote.quote_end} names={showNames}
          onClose={() => setOpenQuote(null)} />
      )}
      {presenting && view && <PresentMode view={view} onClose={() => setPresenting(false)} />}
    </div>
  );
};

export default IssueAnalytics;
