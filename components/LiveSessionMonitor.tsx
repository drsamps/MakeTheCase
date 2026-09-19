import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import { SemesterScopeNote, useSemesterFilter } from './courses/semesterFilter';
import { formatAgo } from '../utils/timeAgo';

// Live Session Monitor (Monitor → Live). One case across one or more sections: calls the
// per-section GET /sections/:id/cases/:caseId/live-session for each selected section that has
// the case assigned and merges the rows, so each call keeps its own section access checks.

export interface LiveMonitorSection {
  section_id: string;
  section_title: string;
  semester_id?: number | null;
}

interface LiveStudent {
  student_id: string;
  student_name: string;
  email: string | null;
  status: 'not_started' | 'in_progress' | 'completed' | 'abandoned';
  chat_id: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  chat_topic: string | null;
  position: string | null;
  position_changed: boolean | null;
  final_position: string | null;
  evaluation_score: number | null;
  section_id: string;
}

interface LiveSummary {
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  abandoned: number;
}

type SortKey = 'student_name' | 'section_id' | 'status' | 'position' | 'start_time';
type StatusFilter = 'all' | LiveStudent['status'];

interface LiveSessionMonitorProps {
  sections: LiveMonitorSection[];
  // Deep link from Home ("monitor this case"); `nonce` changes on every navigation so
  // repeating the same link re-applies it.
  initial?: { section_id?: string; case_id?: string; nonce: number } | null;
}

const EMPTY_SUMMARY: LiveSummary = { total: 0, completed: 0, in_progress: 0, not_started: 0, abandoned: 0 };
const STATUS_ORDER: Record<LiveStudent['status'], number> = { not_started: 0, in_progress: 1, abandoned: 2, completed: 3 };
const STATUS_LABEL: Record<LiveStudent['status'], string> = {
  not_started: 'Not Started', in_progress: 'In Progress', abandoned: 'Abandoned', completed: 'Completed'
};
// Resolving "ALL" to more sections than this would fire one request per section every 30 s.
const MAX_SECTIONS = 20;
const PREFS_KEY = 'mtc_live_monitor_prefs';
const SELECTION_KEY = 'mtc_live_monitor_selection';
const DEEP_LINK_KEY = 'mtc_live_monitor_deep_link';

interface Prefs { limit: string; status: StatusFilter; sortKey: SortKey; sortDir: 'asc' | 'desc' }
const DEFAULT_PREFS: Prefs = { limit: 'all', status: 'all', sortKey: 'student_name', sortDir: 'asc' };

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeSession(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const LiveSessionMonitor: React.FC<LiveSessionMonitorProps> = ({ sections, initial }) => {
  const { inScope } = useSemesterFilter();

  // Section and case picks survive tab switches (this component unmounts when hidden).
  const [stored] = useState(() => readSession<{ sections: string[]; caseId: string }>(SELECTION_KEY, { sections: ['all'], caseId: '' }));
  const [selectedSections, setSelectedSections] = useState<string[]>(
    Array.isArray(stored.sections) && stored.sections.length ? stored.sections : ['all']
  );
  const [caseId, setCaseId] = useState<string>(typeof stored.caseId === 'string' ? stored.caseId : '');
  const [prefs, setPrefs] = useState<Prefs>(() => readSession(PREFS_KEY, DEFAULT_PREFS));

  // caseId → section_ids that have it assigned, plus titles for the picker.
  const [caseSections, setCaseSections] = useState<Map<string, { title: string; sectionIds: string[] }>>(new Map());
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [students, setStudents] = useState<LiveStudent[]>([]);
  const [summary, setSummary] = useState<LiveSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { writeSession(PREFS_KEY, prefs); }, [prefs]);
  useEffect(() => { writeSession(SELECTION_KEY, { sections: selectedSections, caseId }); }, [selectedSections, caseId]);

  // Keep the "ago" text current between refreshes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const scopedSections = useMemo(() => sections.filter(s => inScope(s)), [sections, inScope]);
  const sectionOptions: MultiSelectOption[] = useMemo(
    () => scopedSections.map(s => ({ value: s.section_id, label: s.section_title, subtitle: s.section_id })),
    [scopedSections]
  );

  // Deep link: pick that one section (and case, once the case list has loaded). Applied once
  // per nonce: Dashboard keeps `initial` after this component unmounts, and re-applying it on
  // remount would discard picks made since.
  useEffect(() => {
    if (!initial?.section_id) return;
    if (readSession<{ nonce: number | null }>(DEEP_LINK_KEY, { nonce: null }).nonce === initial.nonce) return;
    writeSession(DEEP_LINK_KEY, { nonce: initial.nonce });
    setSelectedSections([initial.section_id]);
    setCaseId(initial.case_id || '');
  }, [initial?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the selection ('all' = every in-scope section) and drop ids that left scope.
  const resolvedSectionIds = useMemo(() => {
    const scopedIds = scopedSections.map(s => s.section_id);
    if (selectedSections.includes('all')) return scopedIds;
    const allowed = new Set(scopedIds);
    return selectedSections.filter(id => allowed.has(id));
  }, [selectedSections, scopedSections]);
  const tooManySections = resolvedSectionIds.length > MAX_SECTIONS;
  const sectionKey = resolvedSectionIds.join(',');

  // Load the union of cases assigned to the selected sections.
  useEffect(() => {
    if (!sectionKey || tooManySections) {
      setCaseSections(new Map());
      return;
    }
    let cancelled = false;
    setIsLoadingCases(true);
    (async () => {
      const ids = sectionKey.split(',');
      const results = await Promise.all(ids.map(id => api.get<any[]>(`/sections/${encodeURIComponent(id)}/cases`).catch(() => ({ data: null, error: null }))));
      if (cancelled) return;
      const map = new Map<string, { title: string; sectionIds: string[] }>();
      results.forEach((r, i) => {
        (r.data || []).forEach((sc: any) => {
          const entry = map.get(sc.case_id) || { title: sc.case_title || sc.case_id, sectionIds: [] };
          entry.sectionIds.push(ids[i]);
          map.set(sc.case_id, entry);
        });
      });
      setCaseSections(map);
      setIsLoadingCases(false);
    })();
    return () => { cancelled = true; };
  }, [sectionKey, tooManySections]);

  const caseOptions = useMemo(
    () => [...caseSections.entries()]
      .map(([id, v]) => ({ id, title: v.title, count: v.sectionIds.length }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [caseSections]
  );
  const caseSectionIds = caseSections.get(caseId)?.sectionIds || [];
  const caseSectionKey = caseSectionIds.join(',');
  const caseReady = Boolean(caseId) && caseSectionIds.length > 0;

  // Only the latest request may write results: a slow response for a previous case or
  // section set must not overwrite the current one.
  const requestSeq = useRef(0);

  const fetchLive = useCallback(async () => {
    if (!caseId || !caseSectionKey) return;
    const ids = caseSectionKey.split(',');
    const seq = ++requestSeq.current;
    setIsLoading(true);
    try {
      const results = await Promise.all(ids.map(id =>
        api.get<{ students: any[]; summary: LiveSummary }>(
          `/sections/${encodeURIComponent(id)}/cases/${encodeURIComponent(caseId)}/live-session`
        ).catch((err: any) => ({ data: null, error: { message: err?.message || 'Request failed' } }))
      ));
      if (seq !== requestSeq.current) return;
      const merged: LiveStudent[] = [];
      const total: LiveSummary = { ...EMPTY_SUMMARY };
      const errs: string[] = [];
      results.forEach((r, i) => {
        if (!r.data) {
          errs.push(`${ids[i]}: ${r.error?.message || 'no data'}`);
          return;
        }
        (r.data.students || []).forEach((s: any) => merged.push({ ...s, section_id: ids[i] }));
        const sm = r.data.summary || EMPTY_SUMMARY;
        total.total += sm.total || 0;
        total.completed += sm.completed || 0;
        total.in_progress += sm.in_progress || 0;
        total.not_started += sm.not_started || 0;
        total.abandoned += sm.abandoned || 0;
      });
      setStudents(merged);
      setSummary(total);
      setErrors(errs);
      setLastRefresh(new Date());
      setNow(Date.now());
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [caseId, caseSectionKey]);

  // Clear stale rows when the case/sections change, then fetch.
  useEffect(() => {
    requestSeq.current++; // invalidate any request still in flight for the old selection
    setStudents([]);
    setSummary(EMPTY_SUMMARY);
    setErrors([]);
    setIsLoading(false);
    if (caseReady) fetchLive();
  }, [caseReady, fetchLive]);

  useEffect(() => {
    if (!autoRefresh || !caseReady) return;
    const t = setInterval(fetchLive, 30000);
    return () => clearInterval(t);
  }, [autoRefresh, caseReady, fetchLive]);

  const sectionTitle = useMemo(() => {
    const m = new Map(sections.map(s => [s.section_id, s.section_title]));
    return (id: string) => m.get(id) || id;
  }, [sections]);

  const visibleRows = useMemo(() => {
    const filtered = prefs.status === 'all' ? students : students.filter(s => s.status === prefs.status);
    const dir = prefs.sortDir === 'asc' ? 1 : -1;
    const keyOf = (s: LiveStudent): string | number | null => {
      switch (prefs.sortKey) {
        case 'status': return STATUS_ORDER[s.status];
        case 'position': return s.position ? s.position.toLowerCase() : null;
        case 'start_time': return s.start_time ? new Date(s.start_time).getTime() : null;
        case 'section_id': return s.section_id.toLowerCase();
        default: return (s.student_name || '').toLowerCase();
      }
    };
    const sorted = [...filtered].sort((a, b) => {
      const va = keyOf(a);
      const vb = keyOf(b);
      // Missing values (no chat yet) sort last in both directions.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return (a.student_name || '').localeCompare(b.student_name || '');
    });
    if (prefs.limit === 'all') return sorted;
    return sorted.slice(0, Number(prefs.limit));
  }, [students, prefs]);
  const filteredCount = prefs.status === 'all' ? students.length : students.filter(s => s.status === prefs.status).length;

  const handleSort = (key: SortKey) => {
    setPrefs(p => p.sortKey === key
      ? { ...p, sortDir: p.sortDir === 'asc' ? 'desc' : 'asc' }
      // Newest start first is the useful default for Started.
      : { ...p, sortKey: key, sortDir: key === 'start_time' ? 'desc' : 'asc' });
  };

  const multiSection = caseSectionIds.length > 1;

  const SortHeader: React.FC<{ label: string; sortKey: SortKey }> = ({ label, sortKey }) => (
    <th
      onClick={() => handleSort(sortKey)}
      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {prefs.sortKey === sortKey && (
          <svg className={`w-4 h-4 transition-transform ${prefs.sortDir === 'asc' ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M5.22 9.22a.75.75 0 011.06 0L10 12.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 10.28a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </th>
  );
  const plainTh = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider';

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live Session Monitor</h2>
          <p className="text-sm text-gray-500">Real-time view of student progress during an active case session</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchLive}
            disabled={isLoading || !caseReady}
            aria-label="Refresh results"
            title="Refresh results"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sections, case, and list controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <MultiSelect
          options={sectionOptions}
          selected={selectedSections}
          onChange={setSelectedSections}
          allLabel="All sections"
          countLabel="sections"
          className="min-w-[240px]"
        />
        <select
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          disabled={!sectionKey || tooManySections || isLoadingCases}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-green-500 focus:border-green-500 disabled:opacity-50"
        >
          <option value="">{isLoadingCases ? 'Loading cases...' : 'Select Case...'}</option>
          {caseId && !caseSections.has(caseId) && !isLoadingCases && (
            <option value={caseId} disabled>{caseId} (not assigned to these sections)</option>
          )}
          {caseOptions.map(c => (
            <option key={c.id} value={c.id}>
              {c.title}{resolvedSectionIds.length > 1 ? ` (${c.count} of ${resolvedSectionIds.length} sections)` : ''}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Show:</label>
          <select
            value={prefs.limit}
            onChange={(e) => setPrefs(p => ({ ...p, limit: e.target.value }))}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-green-500 focus:border-green-500"
          >
            <option value="0">None</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="all">All</option>
          </select>
        </div>
        <select
          value={prefs.status}
          onChange={(e) => setPrefs(p => ({ ...p, status: e.target.value as StatusFilter }))}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-green-500 focus:border-green-500"
        >
          <option value="all">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="abandoned">Abandoned</option>
        </select>
        <SemesterScopeNote className="self-center" />
        {lastRefresh && (
          <span className="text-xs text-gray-500 self-center">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {tooManySections && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          "All sections" covers {resolvedSectionIds.length} sections. Pick up to {MAX_SECTIONS} sections, or choose a semester in the header.
        </div>
      )}
      {errors.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Could not load {errors.length === 1 ? 'one section' : `${errors.length} sections`}: {errors.join('; ')}
        </div>
      )}

      {/* Summary Stats Bar */}
      {caseReady && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gray-800">{summary.total}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Students</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{summary.completed}</div>
            <div className="text-xs text-green-600 uppercase tracking-wide">Completed</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{summary.in_progress}</div>
            <div className="text-xs text-blue-600 uppercase tracking-wide">In Progress</div>
          </div>
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gray-500">{summary.not_started}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Not Started</div>
          </div>
        </div>
      )}

      {/* Student List */}
      {!caseReady ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Select sections and a case to view live session data.</p>
        </div>
      ) : isLoading && students.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-green-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading session data...</p>
        </div>
      ) : students.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No students enrolled in {multiSection ? 'these sections' : 'this section'}.</p>
        </div>
      ) : prefs.limit === '0' ? (
        <p className="text-sm text-gray-500">Student list hidden (Show: None).</p>
      ) : (
        <>
          {visibleRows.length < students.length && (
            <p className="text-xs text-gray-500 mb-2">
              Showing {visibleRows.length} of {filteredCount === students.length ? students.length : `${filteredCount} matching (${students.length} total)`} students
            </p>
          )}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <SortHeader label="Student" sortKey="student_name" />
                  {multiSection && <SortHeader label="Section" sortKey="section_id" />}
                  <SortHeader label="Status" sortKey="status" />
                  <th className={plainTh}>Chat Topic</th>
                  <SortHeader label="Position" sortKey="position" />
                  <SortHeader label="Started" sortKey="start_time" />
                  <th className={plainTh}>Duration</th>
                  <th className={plainTh}>Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleRows.length === 0 ? (
                  <tr><td colSpan={multiSection ? 8 : 7} className="px-4 py-6 text-center text-sm text-gray-500">No students with this status.</td></tr>
                ) : visibleRows.map(student => (
                  <tr
                    key={`${student.section_id}:${student.student_id}`}
                    className={`${
                      student.status === 'completed' ? 'bg-green-50' :
                      student.status === 'in_progress' ? 'bg-blue-50' :
                      student.status === 'abandoned' ? 'bg-orange-50' :
                      'bg-white'
                    } hover:bg-gray-100`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{student.student_name}</div>
                      <div className="text-xs text-gray-500">{student.email}</div>
                    </td>
                    {multiSection && (
                      <td className="px-4 py-3 text-sm text-gray-600" title={sectionTitle(student.section_id)}>
                        {student.section_id}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        student.status === 'completed' ? 'bg-green-100 text-green-700' :
                        student.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                        student.status === 'abandoned' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {STATUS_LABEL[student.status] || student.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {student.chat_topic ? <span>{student.chat_topic}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {student.position ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-700">{student.position}</span>
                          {student.position_changed && student.final_position && (
                            <span className="text-xs text-amber-600">Changed to: {student.final_position}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {student.start_time ? (
                        <>
                          <div>{new Date(student.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                          <div className="text-xs text-gray-400">{formatAgo(student.start_time, now)} ago</div>
                        </>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {student.duration_minutes !== null ? <span>{student.duration_minutes} min</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {student.evaluation_score !== null ? (
                        <span className="font-medium text-gray-700">{student.evaluation_score}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default LiveSessionMonitor;
