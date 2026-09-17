import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import { getApiBaseUrl } from '../services/apiClient';
import { SemesterScopeNote, useSemesterFilter } from './courses/semesterFilter';
import HelpTooltip from './ui/HelpTooltip';
import { PositionAnalyticsHelp } from '../help/dashboard';

interface FilterOption {
  section_id: string;
  section_title: string;
  year_term?: string;
  semester_id?: number | null;
}

interface ScenarioOption {
  scenario_id: number;
  scenario_name: string;
  protagonist: string | null;
  protagonist_role: string | null;
  chat_question: string | null;
  chat_count: number;
}

interface CaseOption {
  case_id: string;
  case_title: string;
  is_open_now: boolean;
  latest_open_date: string | null;
  latest_close_date: string | null;
  has_position_data: boolean;
  scenarios: ScenarioOption[];
}

// Results are drawn from completed chats. "Include incomplete chats" adds everything
// else case_chats.status can hold; 'not_started' is deliberately absent because it is a
// computed "no chat row" bucket elsewhere and cannot carry a position.
const INCOMPLETE_STATUSES = ['started', 'in_progress', 'abandoned', 'canceled', 'killed'];

const LS_INCLUDE_UNTRACKED = 'mtc_pa_include_untracked';
const LS_SCENARIO_PANEL = 'mtc_pa_scenario_panel_open';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode / blocked storage — the control still works for this session */
  }
}

interface PositionSummary {
  total_chats: number;
  total_chats_with_positions: number;
  total_position_changes: number;
  change_rate: number;
}

interface PositionDistribution {
  position_id: number | null;
  position_name: string;
  initial_count: number;
  initial_percentage: string;
  final_count: number;
  final_percentage: string;
  net_change: number;
}

interface StudentPosition {
  student_id: string;
  student_name: string;
  initial_position: string | null;
  final_position: string | null;
  changed: boolean;
  evaluation_score: number | null;
  completion_time: string | null;
}

interface PositionScoreCorrelation {
  position_name: string;
  avg_score: number;
  count: number;
}

interface ChangeScoreCorrelation {
  changed_avg_score: number | null;
  changed_count: number;
  unchanged_avg_score: number | null;
  unchanged_count: number;
  unspecified_avg_score: number | null;
  unspecified_count: number;
}

interface AnalyticsData {
  summary: PositionSummary;
  by_position: PositionDistribution[];
  change_matrix: Record<string, Record<string, number>>;
  by_student: StudentPosition[];
}

interface CorrelationData {
  position_score_correlation: PositionScoreCorrelation[];
  change_score_correlation: ChangeScoreCorrelation;
  max_score?: number;
}

interface ScoreDistributionData {
  by_position: Record<string, {
    scores: number[];
    counts: number[];
  }>;
  max_score: number;
}

// One row per section for the pinned case+scenario. `state` distinguishes the three
// reasons a row can be empty — never collapse them into a zero.
type SectionState = 'ok' | 'tracking_off' | 'scenario_not_offered' | 'no_chats';

interface SectionRow {
  section_id: string;
  section_title: string;
  year_term?: string;
  state: SectionState;
  position_tracking_enabled: boolean;
  track_position_change: boolean;
  position_capture_method: string | null;
  n: number;
  n_with_positions: number;
  change_rate: number | null;
  distribution: Record<string, number>;
}

interface ScenarioPosition {
  position_id: number;
  position_name: string;
  position: string;
}

interface BySectionData {
  scenario_id: number | null;
  positions: ScenarioPosition[];
  position_section_disabled: Record<string, string[]>;
  rows: SectionRow[];
}

interface CompareCaseRow {
  case_id: string;
  case_title: string;
  n: number;
  n_with_positions: number;
  position_tracking_enabled: boolean;
  track_position_change: boolean;
  change_rate: number | null;
  avg_score: number | null;
  avg_score_changed: number | null;
  avg_score_unchanged: number | null;
  latest_open_date: string | null;
}

// Full position detail for the "About this scenario" panel, including the arguments
// that never appear anywhere else in Results.
interface ScenarioPositionDetail extends ScenarioPosition {
  position_order: number;
  position_enabled: number | boolean;
  arguments_for: string | null;
  arguments_against: string | null;
}

const STATE_LABELS: Record<Exclude<SectionState, 'ok'>, string> = {
  tracking_off: 'Tracking off',
  scenario_not_offered: 'Scenario not offered',
  no_chats: 'No chats yet',
};

const STATE_HINTS: Record<Exclude<SectionState, 'ok'>, string> = {
  tracking_off: 'Position tracking is disabled for this section’s copy of the assignment, so no positions were recorded.',
  scenario_not_offered: 'This section runs a different scenario of this case.',
  no_chats: 'Tracking is on and the scenario is offered, but no chats match the current filters.',
};

const PositionAnalytics: React.FC = () => {
  // Header Semester selector: limits the section picker, and "ALL Sections" means that semester's.
  const { inScope, semesterId } = useSemesterFilter();

  const [isLoading, setIsLoading] = useState(true);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [correlationData, setCorrelationData] = useState<CorrelationData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'scoreByPosition' | 'positionChanges' | 'bySection' | 'byCase'>('overview');
  const [scoreDistributionData, setScoreDistributionData] = useState<ScoreDistributionData | null>(null);
  const [maxScore, setMaxScore] = useState<number>(15);
  const [summaryExpanded, setSummaryExpanded] = useState<boolean>(false);
  const [excludedScores, setExcludedScores] = useState<Record<string, Set<number>>>({});

  // Filter options (populated from API)
  const [sectionOptions, setSectionOptions] = useState<FilterOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [caseSections, setCaseSections] = useState<Record<string, string[]>>({});

  // Selected filters. Case and scenario are single-select: positions are defined per
  // scenario, so pooling across either produces meaningless axes.
  const [selectedSections, setSelectedSections] = useState<string[]>(['all']);
  const [selectedCase, setSelectedCase] = useState<string>('');
  const [selectedScenario, setSelectedScenario] = useState<number | null>(null);
  const [includeIncomplete, setIncludeIncomplete] = useState<boolean>(false);
  const [includeUntracked, setIncludeUntracked] = useState<boolean>(() => readFlag(LS_INCLUDE_UNTRACKED, false));

  // Per-section metadata for the pinned case+scenario. Powers both the By Section tab
  // and the mixed-tracking banner shown above every tab.
  const [sectionMeta, setSectionMeta] = useState<BySectionData | null>(null);
  const [compareCases, setCompareCases] = useState<CompareCaseRow[] | null>(null);

  // "About this scenario" panel
  // Monotonic id for the main analytics fetch. Every entry into fetchData bumps it, so a
  // response whose id is stale (superseded by a newer fetch, or by a guard that cleared
  // the screen) is dropped instead of overwriting fresher state.
  const fetchSeq = useRef(0);

  const [scenarioPanelOpen, setScenarioPanelOpen] = useState<boolean>(() => readFlag(LS_SCENARIO_PANEL, false));
  const [scenarioPositions, setScenarioPositions] = useState<ScenarioPositionDetail[] | null>(null);

  const statusesParam = useMemo(
    () => (includeIncomplete ? ['completed', ...INCOMPLETE_STATUSES].join(',') : 'completed'),
    [includeIncomplete]
  );

  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const response = await api.get('/analytics/filters');
        // api.get RESOLVES on an HTTP error with { data: null, error } — it does not
        // throw — so the catch below never sees a 4xx/5xx. Read .error or a failed
        // request silently renders as "no sections, no cases".
        if (response.error) {
          setError(response.error.message || 'Failed to load filters');
        } else if (response.data) {
          setSectionOptions(response.data.sections || []);
          setCaseOptions(response.data.cases || []);
          setCaseSections(response.data.case_sections || {});
        }
      } catch (err) {
        console.error('Failed to fetch filter options:', err);
        setError(err instanceof Error ? err.message : 'Failed to load filters');
      } finally {
        // Resolve loading even when the caller has no sections and no cases, otherwise
        // the screen sits on a spinner forever.
        setFiltersLoaded(true);
        setIsLoading(false);
      }
    };
    fetchFilters();
  }, []);

  const sectionsInScope = useMemo(
    () => sectionOptions.filter(s => inScope(s)),
    [sectionOptions, inScope]
  );

  // Explicit section picks, or null for "ALL Sections" (the server applies the caller's
  // own access scope, narrowed by semester_id).
  const pickedSectionIds = useMemo(
    () => (selectedSections.includes('all') ? null : selectedSections),
    [selectedSections]
  );

  // Cases available for the current section picks. Narrowing here is what stops the
  // picker offering a case that none of the chosen sections were assigned.
  const casesForPicks = useMemo(() => {
    const visible = caseOptions.filter(c => {
      const sections = caseSections[c.case_id] || [];
      // Keep cases whose sections are within the header semester scope. A section missing
      // from sectionOptions is disabled (/filters lists only enabled ones); inScope(undefined)
      // keeps it only under "All semesters", so it can't leak a case into another semester.
      return sections.some(id => inScope(sectionOptions.find(s => s.section_id === id)));
    });
    if (!pickedSectionIds) return visible;
    return visible.filter(c => {
      const sections = caseSections[c.case_id] || [];
      return pickedSectionIds.some(id => sections.includes(id));
    });
  }, [caseOptions, caseSections, pickedSectionIds, sectionOptions, inScope]);

  const selectedCaseOption = useMemo(
    () => casesForPicks.find(c => c.case_id === selectedCase) || null,
    [casesForPicks, selectedCase]
  );

  const scenariosForCase = selectedCaseOption?.scenarios ?? [];
  const needsScenarioPick = scenariosForCase.length > 1;

  const selectedScenarioOption = useMemo(
    () => scenariosForCase.find(s => s.scenario_id === selectedScenario) || null,
    [scenariosForCase, selectedScenario]
  );

  // Auto-pick a case on arrival: prefer one that actually has position data, then one
  // that is currently open, then the most recent by date. Landing on a case with no
  // position data would show an empty screen that looks broken.
  useEffect(() => {
    if (!filtersLoaded || casesForPicks.length === 0) return;
    if (selectedCase && casesForPicks.some(c => c.case_id === selectedCase)) return;

    const recency = (c: CaseOption) => {
      const dates = [c.latest_open_date, c.latest_close_date]
        .filter(Boolean)
        .map(d => new Date(d as string).getTime());
      return dates.length ? Math.max(...dates) : 0;
    };
    const ranked = [...casesForPicks].sort((a, b) =>
      (Number(b.has_position_data) - Number(a.has_position_data)) ||
      (Number(b.is_open_now) - Number(a.is_open_now)) ||
      (recency(b) - recency(a)) ||
      a.case_title.localeCompare(b.case_title)
    );
    setSelectedCase(ranked[0].case_id);
  }, [filtersLoaded, casesForPicks, selectedCase]);

  // Auto-pick the scenario students actually ran, and keep it valid when the case changes.
  useEffect(() => {
    if (scenariosForCase.length === 0) {
      if (selectedScenario !== null) setSelectedScenario(null);
      return;
    }
    if (selectedScenario !== null && scenariosForCase.some(s => s.scenario_id === selectedScenario)) return;
    const best = [...scenariosForCase].sort((a, b) => b.chat_count - a.chat_count)[0];
    setSelectedScenario(best.scenario_id);
  }, [scenariosForCase, selectedScenario]);

  // Drop picked sections that are outside the header semester.
  useEffect(() => {
    if (selectedSections.includes('all') || sectionOptions.length === 0) return;
    const kept = selectedSections.filter(id => {
      const option = sectionOptions.find(s => s.section_id === id);
      return !option || inScope(option);
    });
    if (kept.length !== selectedSections.length) {
      setSelectedSections(kept.length > 0 ? kept : ['all']);
    }
  }, [inScope, selectedSections, sectionOptions]);

  // --- Mixed tracking -------------------------------------------------------------
  // Sections where the assignment never recorded positions. Pooling them into the
  // change rate puts it over the wrong denominator, so they are excluded by default.
  const untrackedSectionIds = useMemo(
    () => new Set((sectionMeta?.rows ?? []).filter(r => r.state === 'tracking_off').map(r => r.section_id)),
    [sectionMeta]
  );
  const trackedSectionIds = useMemo(
    () => (sectionMeta?.rows ?? []).filter(r => r.state !== 'tracking_off').map(r => r.section_id),
    [sectionMeta]
  );
  const hasMixedTracking = untrackedSectionIds.size > 0 && trackedSectionIds.length > 0;
  const allUntracked = (sectionMeta?.rows.length ?? 0) > 0 && trackedSectionIds.length === 0;

  // The section list actually sent to the analytics endpoints.
  const effectiveSectionIds = useMemo<string[] | null>(() => {
    if (includeUntracked || !sectionMeta) return pickedSectionIds;
    const base = pickedSectionIds ?? sectionMeta.rows.map(r => r.section_id);
    const kept = base.filter(id => !untrackedSectionIds.has(id));
    // Every section is untracked: return an empty list so the caller can show the
    // explanatory empty state instead of silently falling back to "all sections".
    return kept;
  }, [includeUntracked, sectionMeta, pickedSectionIds, untrackedSectionIds]);

  const noTrackedSections = !includeUntracked && effectiveSectionIds !== null && effectiveSectionIds.length === 0 && !!sectionMeta;
  // Same empty result, different cause: /positions/by-section returns no rows at all when the
  // case has no section in scope (it filters s.enabled = TRUE, which the client's caseSections
  // map does not), and telling the instructor to switch on tracking for sections that do not
  // exist is a dead end. Message only — the control flow above is unchanged.
  const noSectionsForCase = noTrackedSections && (sectionMeta?.rows.length ?? 0) === 0;

  const buildParams = useCallback((opts?: { sections?: string[] | null; includeScenario?: boolean }) => {
    const params = new URLSearchParams();
    const sections = opts?.sections !== undefined ? opts.sections : effectiveSectionIds;

    if (sections && sections.length > 0) {
      params.append('section_ids', sections.join(','));
    } else if (semesterId != null) {
      // A named section already pins the semester; only "ALL Sections" needs it.
      params.append('semester_id', String(semesterId));
    }

    if (selectedCase) params.append('case_id', selectedCase);
    if ((opts?.includeScenario ?? true) && selectedScenario != null) {
      params.append('scenario_id', String(selectedScenario));
    }
    params.append('statuses', statusesParam);
    return params;
  }, [effectiveSectionIds, semesterId, selectedCase, selectedScenario, statusesParam]);

  // Per-section metadata drives the banner and the By Section tab, and determines which
  // sections the main fetch may use, so it runs first and on its own section list.
  useEffect(() => {
    if (!selectedCase) { setSectionMeta(null); return; }
    if (needsScenarioPick && selectedScenario == null) return;

    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (pickedSectionIds && pickedSectionIds.length > 0) {
          params.append('section_ids', pickedSectionIds.join(','));
        } else if (semesterId != null) {
          params.append('semester_id', String(semesterId));
        }
        params.append('case_id', selectedCase);
        if (selectedScenario != null) params.append('scenario_id', String(selectedScenario));
        params.append('statuses', statusesParam);

        const res = await api.get(`/analytics/positions/by-section?${params.toString()}`);
        if (cancelled) return;
        if (res.error) {
          // This endpoint 400s on a missing/ambiguous scenario_id. Swallowing that left
          // the previous case's section metadata driving the banner and the section list.
          setSectionMeta(null);
          setError(res.error.message || 'Failed to load section details');
          return;
        }
        setSectionMeta(res.data || null);
      } catch (err) {
        console.error('Error fetching section metadata:', err);
        if (!cancelled) setSectionMeta(null);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedCase, selectedScenario, needsScenarioPick, pickedSectionIds, semesterId, statusesParam]);

  const fetchData = useCallback(async () => {
    // Filters can change while a request is in flight; without this the slower response
    // for case A can land after case B's and render A's numbers under B's heading. Bumped
    // before the guards below so they also invalidate anything already in flight.
    const seq = ++fetchSeq.current;

    if (!selectedCase) { setAnalyticsData(null); setCorrelationData(null); setIsLoading(false); return; }
    if (needsScenarioPick && selectedScenario == null) { setIsLoading(false); return; }
    if (noTrackedSections) { setAnalyticsData(null); setCorrelationData(null); setIsLoading(false); return; }

    setIsLoading(true);
    setError(null);

    try {
      const queryString = buildParams().toString();
      const [analyticsRes, correlationRes] = await Promise.all([
        api.get(`/analytics/positions?${queryString}`),
        api.get(`/analytics/positions/correlation?${queryString}`)
      ]);
      if (seq !== fetchSeq.current) return;

      // api.get RESOLVES on an HTTP error with { data: null, error } — it does not throw.
      // Testing only `.data` left a 400 (e.g. "scenario_id is required") showing the
      // PREVIOUS case's charts under the new case's title, with no error and no spinner.
      const failure = analyticsRes.error || correlationRes.error;
      if (failure) {
        setAnalyticsData(null);
        setCorrelationData(null);
        setError(failure.message || 'Failed to load analytics');
        return;
      }

      setAnalyticsData(analyticsRes.data);
      setCorrelationData(correlationRes.data);
      if (correlationRes.data?.max_score) setMaxScore(correlationRes.data.max_score);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      console.error('Error fetching position analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false);
    }
  }, [buildParams, selectedCase, selectedScenario, needsScenarioPick, noTrackedSections]);

  const fetchScoreDistribution = useCallback(async () => {
    if (!selectedCase) return;
    if (needsScenarioPick && selectedScenario == null) return;
    try {
      const queryString = buildParams().toString();
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(
        `${getApiBaseUrl()}/analytics/positions/score-distribution?${queryString}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const result = await response.json();
      if (!response.ok || result?.error) {
        setScoreDistributionData(null);
        setError(result?.error?.message || 'Failed to load score distribution');
        return;
      }
      if (result.data) {
        setScoreDistributionData(result.data);
        if (result.data.max_score) setMaxScore(result.data.max_score);
      }
    } catch (err) {
      console.error('Error fetching score distribution:', err);
      setError(err instanceof Error ? err.message : 'Failed to load score distribution');
    }
  }, [buildParams, selectedCase, selectedScenario, needsScenarioPick]);

  // Deliberately uses the instructor's own section picks, NOT effectiveSectionIds.
  // effectiveSectionIds is derived from the pinned case's section metadata, so using it
  // here would silently hide every case that isn't assigned to the pinned case's
  // sections — exactly the cases you opened this tab to compare against. Untracked
  // sections aren't excluded either: tracking is per section-case, and the endpoint
  // already returns per-case flags and nulls the change rate where it doesn't apply.
  const fetchCompareCases = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (pickedSectionIds && pickedSectionIds.length > 0) {
        params.append('section_ids', pickedSectionIds.join(','));
      } else if (semesterId != null) {
        params.append('semester_id', String(semesterId));
      }
      params.append('statuses', statusesParam);

      const res = await api.get(`/analytics/positions/compare-cases?${params.toString()}`);
      if (res.error) {
        // Without this a failed request is indistinguishable from "no other cases".
        setCompareCases(null);
        setError(res.error.message || 'Failed to compare cases');
        return;
      }
      setCompareCases(res.data?.rows || []);
    } catch (err) {
      console.error('Error comparing cases:', err);
      setCompareCases([]);
    }
  }, [pickedSectionIds, semesterId, statusesParam]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'scoreByPosition') fetchScoreDistribution();
  }, [activeTab, fetchScoreDistribution]);

  useEffect(() => {
    if (activeTab === 'byCase') fetchCompareCases();
  }, [activeTab, fetchCompareCases]);

  // Full position text for the "About this scenario" panel. Chart axes show the short
  // position_name; this is the only place the student-facing wording appears.
  useEffect(() => {
    if (!scenarioPanelOpen || !selectedCase || selectedScenario == null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/cases/${encodeURIComponent(selectedCase)}/scenarios/${selectedScenario}/positions`);
        const rows = res.data ?? res;
        if (!cancelled) setScenarioPositions(Array.isArray(rows) ? rows : (rows?.positions ?? []));
      } catch (err) {
        console.error('Error loading scenario positions:', err);
        if (!cancelled) setScenarioPositions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [scenarioPanelOpen, selectedCase, selectedScenario]);

  const sectionSelectOptions: MultiSelectOption[] = useMemo(() =>
    sectionsInScope.map(s => ({
      value: s.section_id,
      label: s.section_title,
      subtitle: s.year_term
    })), [sectionsInScope]
  );

  const toggleIncludeUntracked = (next: boolean) => {
    setIncludeUntracked(next);
    writeFlag(LS_INCLUDE_UNTRACKED, next);
  };

  const toggleScenarioPanel = (next: boolean) => {
    setScenarioPanelOpen(next);
    writeFlag(LS_SCENARIO_PANEL, next);
  };

  // Scores always come from completed chats: an incomplete chat has no evaluation, so
  // including it would raise the count without raising the score sum and drag every
  // average down. Say so whenever the two scopes differ.
  const renderScoreScopeNote = () => {
    if (!includeIncomplete) return null;
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-900">
        Score figures below cover <strong>completed chats only</strong>, even though
        “Include incomplete chats” is ticked — incomplete chats have no evaluation to score.
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Filters — rendered once and reused by every state below, so a new control can
  // never be added to one copy and forgotten in the other.
  // ---------------------------------------------------------------------------
  const renderFilters = () => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="min-w-56">
          <label className="block text-xs font-medium text-gray-700 mb-1">Course Sections</label>
          <MultiSelect
            options={sectionSelectOptions}
            selected={selectedSections}
            onChange={setSelectedSections}
            placeholder="Select sections..."
            allLabel="ALL Sections"
          />
          <SemesterScopeNote className="mt-1" />
        </div>

        <div className="min-w-56">
          <label className="block text-xs font-medium text-gray-700 mb-1">Case</label>
          <select
            value={selectedCase}
            onChange={(e) => { setSelectedCase(e.target.value); setSelectedScenario(null); }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select a case…</option>
            {casesForPicks.map(c => (
              <option key={c.case_id} value={c.case_id}>
                {c.case_title}{c.has_position_data ? '' : ' (no position data)'}
              </option>
            ))}
          </select>
        </div>

        {needsScenarioPick && (
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Scenario <span className="text-amber-600">*</span>
            </label>
            <select
              value={selectedScenario ?? ''}
              onChange={(e) => setSelectedScenario(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a scenario…</option>
              {scenariosForCase.map(s => (
                <option key={s.scenario_id} value={s.scenario_id}>
                  {s.scenario_name} ({s.chat_count} chats)
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">This case has {scenariosForCase.length} scenarios, each with its own positions.</p>
          </div>
        )}

        <div className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            id="includeIncomplete"
            checked={includeIncomplete}
            onChange={(e) => setIncludeIncomplete(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="includeIncomplete" className="text-sm text-gray-700 cursor-pointer">
            Include incomplete chats
          </label>
        </div>

        <div className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            id="showSummary"
            checked={summaryExpanded}
            onChange={(e) => setSummaryExpanded(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="showSummary" className="text-sm text-gray-700 cursor-pointer">
            Show Summary Statistics
          </label>
        </div>

        <div className="pb-1 ml-auto">
          <HelpTooltip title="Position Analytics">
            <PositionAnalyticsHelp />
          </HelpTooltip>
        </div>
      </div>

      {renderScenarioPanel()}
    </div>
  );

  // Chart axes label positions with the short position_name. This panel is the only
  // place the wording students actually saw is visible.
  const renderScenarioPanel = () => {
    if (!selectedCaseOption || selectedScenario == null) return null;
    const disabledMap = sectionMeta?.position_section_disabled ?? {};

    return (
      <details
        open={scenarioPanelOpen}
        onToggle={(e) => toggleScenarioPanel((e.currentTarget as HTMLDetailsElement).open)}
        className="border border-gray-200 rounded-lg bg-gray-50"
      >
        <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
          About this scenario — what the position labels mean
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-4 text-sm">
          <div>
            <p className="font-semibold text-gray-900">
              {selectedScenarioOption?.scenario_name || selectedCaseOption.case_title}
            </p>
            {selectedScenarioOption?.protagonist && (
              <p className="text-gray-600">
                Protagonist: {selectedScenarioOption.protagonist}
                {selectedScenarioOption.protagonist_role ? `, ${selectedScenarioOption.protagonist_role}` : ''}
              </p>
            )}
            {selectedScenarioOption?.chat_question && (
              <p className="mt-2 text-gray-700 italic">“{selectedScenarioOption.chat_question}”</p>
            )}
          </div>

          {scenarioPositions === null ? (
            <p className="text-gray-500">Loading positions…</p>
          ) : scenarioPositions.length === 0 ? (
            <p className="text-gray-500">
              No positions are defined for this scenario, which is why the charts are empty.
              Add positions under Content → Scenarios to enable position tracking.
            </p>
          ) : (
            <div className="space-y-3">
              {scenarioPositions.map(p => {
                const disabledIn = disabledMap[String(p.position_id)] || [];
                const retired = Number(p.position_enabled) === 0;
                return (
                  <div key={p.position_id} className="bg-white border border-gray-200 rounded-md p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{p.position_name}</code>
                      {retired && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">retired</span>
                      )}
                      {disabledIn.length > 0 && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                          title={`Disabled in: ${disabledIn.join(', ')}`}
                        >
                          not offered in {disabledIn.length} selected section{disabledIn.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-gray-800">{p.position}</p>
                    {(p.arguments_for || p.arguments_against) && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                          Arguments for / against
                        </summary>
                        <div className="mt-2 space-y-2 text-xs text-gray-700">
                          {p.arguments_for && (
                            <div><span className="font-semibold">For:</span> {p.arguments_for}</div>
                          )}
                          {p.arguments_against && (
                            <div><span className="font-semibold">Against:</span> {p.arguments_against}</div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    );
  };

  // Shown above every tab: pooling tracked and untracked sections puts the change rate
  // over the wrong denominator, so say so and let the instructor choose.
  const renderTrackingBanner = () => {
    if (!hasMixedTracking) return null;
    const untrackedTitles = (sectionMeta?.rows ?? [])
      .filter(r => r.state === 'tracking_off')
      .map(r => r.section_title);

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-64 text-sm text-amber-900">
          <span className="font-medium">Mixed position tracking.</span>{' '}
          {trackedSectionIds.length} of {sectionMeta?.rows.length} selected sections track positions.
          {untrackedTitles.length > 0 && (
            <> Not tracked: {untrackedTitles.join(', ')}.</>
          )}{' '}
          {includeUntracked
            ? 'Untracked sections are included, so the change rate is computed over students who were never asked for a position.'
            : 'Untracked sections are excluded from these numbers.'}
        </div>
        <label className="flex items-center gap-2 text-sm text-amber-900 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => toggleIncludeUntracked(e.target.checked)}
            className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
          />
          Include untracked sections
        </label>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // States before the tabs are worth rendering
  // ---------------------------------------------------------------------------
  if (isLoading && !analyticsData) {
    return (
      <div className="space-y-6">
        {filtersLoaded && renderFilters()}
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
          <span className="ml-3 text-gray-600">Loading position analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
          <button onClick={fetchData} className="mt-2 text-sm text-red-600 hover:text-red-800 underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!selectedCase) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-700 font-medium">Pick a case to see position analytics.</p>
          <p className="text-sm text-gray-500 mt-2">
            Positions are defined per scenario, so results are shown one case at a time —
            adding them across cases would merge answers to different questions.
          </p>
        </div>
      </div>
    );
  }

  if (needsScenarioPick && selectedScenario == null) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-700 font-medium">Pick a scenario.</p>
          <p className="text-sm text-gray-500 mt-2">
            “{selectedCaseOption?.case_title}” has {scenariosForCase.length} scenarios, each with
            its own question and its own set of positions.
          </p>
        </div>
      </div>
    );
  }

  // No section in scope is assigned this case at all — nothing to switch on.
  if (noSectionsForCase) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-700 font-medium">No active section in this semester is assigned this case.</p>
          <p className="text-sm text-gray-500 mt-2">
            Pick another semester, or assign the case to a section under <strong>Assignments</strong>.
            Sections that have been disabled are not counted here.
          </p>
        </div>
      </div>
    );
  }

  // Every selected section has tracking switched off. Say which setting to change
  // rather than showing a screen of zeros.
  if (noTrackedSections || (allUntracked && !includeUntracked)) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-700 font-medium">Position tracking is off for every selected section.</p>
          <p className="text-sm text-gray-500 mt-2">
            Turn it on under <strong>Assignments</strong> → the section’s copy of this case →
            <strong> Enable position tracking</strong>, or tick “Include untracked sections” to see
            the chats anyway (they will have no positions).
          </p>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(e) => toggleIncludeUntracked(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            Include untracked sections
          </label>
        </div>
      </div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="space-y-6">
        {renderFilters()}
        {renderTrackingBanner()}
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-600">No chats match these filters yet.</p>
        </div>
      </div>
    );
  }

  const { summary, by_position, change_matrix, by_student } = analyticsData;
  const noPositionData = summary.total_chats_with_positions === 0;

  return (
    <div className="space-y-6">
      {renderFilters()}
      {renderTrackingBanner()}

      {noPositionData && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-700">
            {summary.total_chats} chat{summary.total_chats === 1 ? '' : 's'} match these filters, but
            none recorded a position.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Either the scenario has no positions defined, or students were never asked for one.
            Expand “About this scenario” above to check which positions exist.
          </p>
        </div>
      )}

      {/* Summary Cards */}
      {summaryExpanded && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-500">Total Chats</p>
              <p className="text-2xl font-bold text-gray-900">{summary.total_chats}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-500">With Positions</p>
              <p className="text-2xl font-bold text-blue-600">{summary.total_chats_with_positions}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-500">Position Changes</p>
              <p className="text-2xl font-bold text-green-600">{summary.total_position_changes}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-500">Change Rate</p>
              <p className="text-2xl font-bold text-purple-600">{summary.change_rate}%</p>
              <p className="text-xs text-gray-500 mt-1">of {summary.total_chats_with_positions} chats with positions</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-4">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'students', label: 'Students' },
            { id: 'scoreByPosition', label: 'Score by Position' },
            { id: 'positionChanges', label: 'Position Changes' },
            { id: 'bySection', label: 'By Section' },
            { id: 'byCase', label: 'By Case' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Position Distribution */}
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Position Distribution</h3>
            {by_position.length === 0 ? (
              <p className="text-gray-500 text-sm">No position data available</p>
            ) : (
              <div className="space-y-3">
                {by_position.map((pos, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium capitalize">{pos.position_name}</span>
                      <span className="text-gray-500">
                        {pos.initial_count} → {pos.final_count}
                        {pos.net_change !== 0 && (
                          <span className={pos.net_change > 0 ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                            ({pos.net_change > 0 ? '+' : ''}{pos.net_change})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex gap-1 h-4">
                      <div
                        className="bg-blue-400 rounded-l"
                        style={{ width: `${pos.initial_percentage}%` }}
                        title={`Initial: ${pos.initial_percentage}%`}
                      />
                      <div
                        className="bg-green-400 rounded-r"
                        style={{ width: `${pos.final_percentage}%` }}
                        title={`Final: ${pos.final_percentage}%`}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Initial: {pos.initial_percentage}%</span>
                      <span>Final: {pos.final_percentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-blue-400 rounded"></span> Initial
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-green-400 rounded"></span> Final
              </span>
            </div>
          </div>

          {/* Change Matrix */}
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Position Change Matrix</h3>
            {Object.keys(change_matrix).length === 0 ? (
              <p className="text-gray-500 text-sm">No change data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left p-2 bg-gray-50 border">From / To</th>
                      {Object.keys(change_matrix).map(pos => (
                        <th key={pos} className="p-2 bg-gray-50 border capitalize">{pos}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(change_matrix).map(([fromPos, toPositions]) => (
                      <tr key={fromPos}>
                        <td className="p-2 border font-medium capitalize bg-gray-50">{fromPos}</td>
                        {Object.keys(change_matrix).map(toPos => {
                          const count = toPositions[toPos] || 0;
                          const isUnchanged = fromPos === toPos;
                          return (
                            <td
                              key={toPos}
                              className={`p-2 border text-center ${
                                isUnchanged ? 'bg-gray-100' : count > 0 ? 'bg-green-50' : ''
                              }`}
                            >
                              {count || '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'students' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Initial Position
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Final Position
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Changed
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {by_student.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No student data available
                    </td>
                  </tr>
                ) : (
                  by_student.map((student, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {student.student_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 capitalize">
                        {student.initial_position || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 capitalize">
                        {student.final_position || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {student.changed ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center text-sm">
                        {student.evaluation_score !== null ? (
                          <span className="font-medium">{student.evaluation_score}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'scoreByPosition' && (
        <div className="space-y-6">
          {renderScoreScopeNote()}
          {scoreDistributionData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {Object.keys(scoreDistributionData.by_position).filter(name => name && name.toLowerCase() !== 'null').length === 0 ? (
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200 col-span-full">
                  <p className="text-gray-500 text-sm">No score distribution data available</p>
                </div>
              ) : (
                Object.entries(scoreDistributionData.by_position)
                  .filter(([positionName]) => positionName && positionName.toLowerCase() !== 'null')
                  .map(([positionName, data]) => {
                  // Get excluded scores for this position
                  const positionExcluded = excludedScores[positionName] || new Set<number>();

                  // Toggle function
                  const toggleScore = (score: number) => {
                    setExcludedScores(prev => {
                      const newExcluded = { ...prev };
                      if (!newExcluded[positionName]) {
                        newExcluded[positionName] = new Set<number>();
                      } else {
                        newExcluded[positionName] = new Set(newExcluded[positionName]);
                      }

                      if (newExcluded[positionName].has(score)) {
                        newExcluded[positionName].delete(score);
                      } else {
                        newExcluded[positionName].add(score);
                      }

                      return newExcluded;
                    });
                  };

                  // Calculate statistics excluding toggled scores
                  const allScores = data.scores.flatMap((score: number, idx: number) =>
                    Array(data.counts[idx]).fill(score)
                  );
                  const includedScores = allScores.filter(s => !positionExcluded.has(s));
                  const totalCount = allScores.length;
                  const includedCount = includedScores.length;
                  const avgScore = includedCount > 0
                    ? includedScores.reduce((sum: number, s: number) => sum + s, 0) / includedCount
                    : 0;

                  // Calculate standard deviation (if 3+ included students)
                  let stdDev = 'N/A';
                  if (includedCount >= 3) {
                    const variance = includedScores.reduce((sum: number, s: number) => sum + Math.pow(s - avgScore, 2), 0) / includedCount;
                    stdDev = Math.sqrt(variance).toFixed(2);
                  }

                  // Build histogram array (0 to maxScore)
                  const histogram = Array(maxScore + 1).fill(0);
                  data.scores.forEach((score: number, idx: number) => {
                    histogram[score] = data.counts[idx];
                  });

                  const maxCount = Math.max(...histogram);

                  return (
                    <div key={positionName} className="bg-white p-4 rounded-lg shadow border border-gray-200">
                      <h4 className="font-semibold text-lg mb-2 capitalize">{positionName}</h4>
                      <div className="text-sm text-gray-600 mb-3">
                        <span className="mr-4"><span className="font-bold">{includedCount}</span> students{includedCount !== totalCount && ` (`}<span className="font-bold">{includedCount !== totalCount && (totalCount - includedCount)}</span>{includedCount !== totalCount && ` excluded)`}</span>
                        <span className="mr-4">Avg: <span className="font-bold">{avgScore.toFixed(1)}</span></span>
                        <span>StdDev: <span className="font-bold">{stdDev}</span></span>
                      </div>

                      <div className="space-y-1 font-mono text-xs">
                        {histogram.map((count, score) => {
                          const isExcluded = positionExcluded.has(score);
                          return (
                            <div key={score} className="flex items-center">
                              <span className="w-8 text-right mr-2">{score}</span>
                              <span className="mr-2">|</span>
                              <div className="flex-1 flex items-center">
                                {count > 0 && (
                                  <>
                                    <div
                                      onClick={() => toggleScore(score)}
                                      className={`h-4 mr-2 cursor-pointer transition-opacity ${
                                        isExcluded ? 'bg-blue-300 opacity-30' : 'bg-blue-600'
                                      }`}
                                      style={{ width: `${(count / maxCount) * 100}%` }}
                                      title={isExcluded ? 'Click to include in statistics' : 'Click to exclude from statistics'}
                                    />
                                    <span className={isExcluded ? 'text-gray-400' : ''}>{count}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {scoreDistributionData && Object.keys(scoreDistributionData.by_position).filter(name => name && name.toLowerCase() !== 'null').length > 0 && (
            <p className="text-xs text-gray-500 italic">Click a bar to exclude from statistics</p>
          )}

        </div>
      )}

      {activeTab === 'positionChanges' && (
        <div className="space-y-6">
          {renderScoreScopeNote()}
          {/* Score Changed vs Unchanged cards and Transition Matrix */}
          {correlationData && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-4">Score: Changed vs Unchanged Position</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2"></th>
                        <th className="text-center py-2">Students</th>
                        <th className="text-center py-2">Average Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 font-medium">Position Changed</td>
                        <td className="py-2 text-center">{correlationData.change_score_correlation.changed_count}</td>
                        <td className="py-2 text-center font-semibold">{correlationData.change_score_correlation.changed_avg_score ?? '-'}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 font-medium">Position Unchanged</td>
                        <td className="py-2 text-center">{correlationData.change_score_correlation.unchanged_count}</td>
                        <td className="py-2 text-center font-semibold">{correlationData.change_score_correlation.unchanged_avg_score ?? '-'}</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">Final Position Unspecified</td>
                        <td className="py-2 text-center">{correlationData.change_score_correlation.unspecified_count}</td>
                        <td className="py-2 text-center font-semibold">{correlationData.change_score_correlation.unspecified_avg_score ?? '-'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Average Score by Final Position (kept for reference) */}
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-1">Average Score by Final Position</h3>
                  <p className="text-xs text-gray-500 mb-4">(or by Initial Position if Final Position unspecified)</p>
                  {correlationData.position_score_correlation.length === 0 ? (
                    <p className="text-gray-500 text-sm">No score data available</p>
                  ) : (
                    <div className="space-y-3">
                      {correlationData.position_score_correlation.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium capitalize">{item.position_name}</span>
                            <span className="text-xs text-gray-500">({item.count} students)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-32 bg-gray-200 rounded-full h-2.5">
                              <div
                                className="bg-blue-600 h-2.5 rounded-full"
                                style={{ width: `${(item.avg_score / maxScore) * 100}%` }}
                              />
                            </div>
                            <span className="font-semibold text-sm w-10 text-right">{item.avg_score}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          )}

          {/* Transition Matrix */}
          {change_matrix && Object.keys(change_matrix).length > 0 ? (
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
              <h3 className="font-semibold text-lg mb-3">Position Transition Matrix</h3>
              <p className="text-sm text-gray-600 mb-3">
                Shows how students moved from initial to final positions
              </p>

              <div className="overflow-x-auto">
                <table className="table-auto border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border p-2 bg-gray-50"></th>
                      <th colSpan={(() => {
                        // Get all position names from by_position and add "Unspecified"
                        const allPositions = by_position.map(p => p.position_name);
                        allPositions.push('Unspecified');
                        return allPositions.length;
                      })()} className="border p-2 bg-gray-100 font-semibold underline">
                        Final Position
                      </th>
                    </tr>
                    <tr>
                      <th className="border p-2 bg-gray-100 font-semibold underline">Initial Position</th>
                      {(() => {
                        // Get all position names from by_position and add "Unspecified"
                        const allPositions = by_position.map(p => p.position_name);
                        allPositions.push('Unspecified');

                        return allPositions.map(name => {
                          // Calculate final position counts
                          const finalCount = Object.values(change_matrix).reduce(
                            (sum, finalPositions) => sum + ((finalPositions as Record<string, number>)[name] || 0),
                            0
                          );
                          return (
                            <th key={name} className="border p-2 bg-gray-100 text-center capitalize">
                              {name}<br />
                              <span className="text-xs font-normal text-gray-600">
                                ({finalCount} students)
                              </span>
                            </th>
                          );
                        });
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(change_matrix).map(([initialPos, toPositions]) => {
                      const initialCount = Object.values(toPositions).reduce((sum, count) => sum + count, 0);
                      // Get all position names from by_position and add "Unspecified"
                      const allPositions = by_position.map(p => p.position_name);
                      allPositions.push('Unspecified');

                      return (
                        <tr key={initialPos}>
                          <th className="border p-2 bg-gray-50 text-left capitalize">
                            {initialPos}
                            <span className="ml-2 text-xs font-normal text-gray-600">
                              ({initialCount} std)
                            </span>
                          </th>
                          {allPositions.map(finalPos => {
                            const count = toPositions[finalPos] || 0;
                            const isUnchanged = initialPos === finalPos;

                            return (
                              <td
                                key={finalPos}
                                className={`border p-2 text-center ${
                                  isUnchanged ? 'bg-gray-100 font-semibold' : ''
                                }`}
                              >
                                {count}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <p className="text-yellow-700 text-sm">
                Debug: change_matrix exists: {change_matrix ? 'yes' : 'no'},
                keys: {change_matrix ? Object.keys(change_matrix).length : 0}
              </p>
            </div>
          )}
        </div>
      )}

      {/* By Section — one case+scenario compared across sections. Valid because the
          case and scenario are pinned, so every row shares one position set. */}
      {activeTab === 'bySection' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-1">
              {selectedCaseOption?.case_title}
              {selectedScenarioOption ? ` — ${selectedScenarioOption.scenario_name}` : ''}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Final-position distribution per section. Sections that never recorded positions are
              labeled rather than counted as zeros, and are excluded from any comparison.
            </p>

            {!sectionMeta || sectionMeta.rows.length === 0 ? (
              <p className="text-gray-500 text-sm">No sections are assigned this case.</p>
            ) : sectionMeta.positions.length === 0 ? (
              <p className="text-gray-500 text-sm">
                This scenario has no positions defined, so there is nothing to distribute.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Chats matching the current filters">n</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Chats that recorded a position">With positions</th>
                      {sectionMeta.positions.map(p => (
                        <th key={p.position_id} className="px-3 py-3 text-center text-xs font-medium text-gray-500 tracking-wider" title={p.position}>
                          {p.position_name}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Change rate</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sectionMeta.rows.map(row => {
                      const isNonData = row.state !== 'ok';
                      return (
                        <tr key={row.section_id} className={isNonData ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="font-medium text-gray-900">{row.section_title}</div>
                            {row.year_term && <div className="text-xs text-gray-500">{row.year_term}</div>}
                          </td>
                          {isNonData ? (
                            <td
                              colSpan={3 + sectionMeta.positions.length}
                              className="px-3 py-3 text-center text-gray-500 italic"
                              title={STATE_HINTS[row.state as Exclude<SectionState, 'ok'>]}
                            >
                              {STATE_LABELS[row.state as Exclude<SectionState, 'ok'>]}
                              {row.state === 'no_chats' ? '' : ` — ${STATE_HINTS[row.state as Exclude<SectionState, 'ok'>]}`}
                            </td>
                          ) : (
                            <>
                              <td className="px-3 py-3 text-center text-gray-900">{row.n}</td>
                              <td className="px-3 py-3 text-center text-gray-600">{row.n_with_positions}</td>
                              {sectionMeta.positions.map(p => {
                                const count = row.distribution[p.position_name] ?? 0;
                                const pct = row.n_with_positions > 0
                                  ? Math.round((count / row.n_with_positions) * 100)
                                  : null;
                                return (
                                  <td key={p.position_id} className="px-3 py-3 text-center">
                                    <span className="font-medium text-gray-900">{count}</span>
                                    {pct !== null && <span className="text-xs text-gray-500 ml-1">({pct}%)</span>}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-3 text-center">
                                {row.change_rate === null ? (
                                  <span className="text-gray-400" title="This assignment does not track position change">—</span>
                                ) : (
                                  <span className="font-medium text-gray-900">{row.change_rate}%</span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 italic">
            Each row shows its own n. When students choose among several scenarios within a
            section, pinning one scenario legitimately reduces n — that is selection, not attrition.
          </p>
        </div>
      )}

      {/* By Case — case-agnostic measures only. Positions are never merged across cases:
          two cases sharing a position label are answering different questions. */}
      {activeTab === 'byCase' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-1">Compare cases</h3>
            <p className="text-xs text-gray-500 mb-4">
              Only measures that mean the same thing across cases are shown — no position
              distributions, because each case asks a different question. Sorted by assignment date.
              Score columns cover completed chats only.
            </p>

            {compareCases === null ? (
              <p className="text-gray-500 text-sm">Loading…</p>
            ) : compareCases.length === 0 ? (
              <p className="text-gray-500 text-sm">No chats match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Chats</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">With positions</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Change rate</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Avg score</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Average score of students who changed position">Changed</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Average score of students who kept their position">Unchanged</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {compareCases.map(row => (
                      <tr
                        key={row.case_id}
                        className={`hover:bg-gray-50 ${row.case_id === selectedCase ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => { setSelectedCase(row.case_id); setSelectedScenario(null); setActiveTab('overview'); }}
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left"
                            title="Open this case in Position Analytics"
                          >
                            {row.case_title}
                          </button>
                          {!row.position_tracking_enabled && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">tracking off</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center text-gray-900">{row.n}</td>
                        <td className="px-3 py-3 text-center text-gray-600">{row.n_with_positions}</td>
                        <td className="px-3 py-3 text-center">
                          {row.change_rate === null ? (
                            <span className="text-gray-400" title="This case does not track position change — not the same as nobody changing">—</span>
                          ) : (
                            <span className="font-medium text-gray-900">{row.change_rate}%</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center font-medium text-gray-900">{row.avg_score ?? '—'}</td>
                        <td className="px-3 py-3 text-center text-gray-700">{row.avg_score_changed ?? '—'}</td>
                        <td className="px-3 py-3 text-center text-gray-700">{row.avg_score_unchanged ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 italic">
            An em dash in Change rate means the assignment does not track position change — which is
            not the same as nobody changing their mind.
          </p>
        </div>
      )}
    </div>
  );
};

export default PositionAnalytics;
