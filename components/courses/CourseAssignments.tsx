import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import { caseLabel } from '../../utils/confirmLabels';
import type { Course, CourseSection } from '../../types';
import HelpTooltip from '../ui/HelpTooltip';
import { CourseAssignmentsHelp } from '../../help/dashboard';
import CaseVersionEditor, { type FollowerSection, type VersionEditorPart } from './CaseVersionEditor';
import ScheduleCasesModal from './ScheduleCasesModal';
import {
  AddCaseModal,
  FollowersModal,
  SemesterCopyModal,
  groupSections,
  type CourseCaseRow,
  type CourseCaseSectionRow,
  type UnlistedCaseRow,
  type VersionRow,
} from './CourseCaseModals';
import { SemesterScopeNote, useSemesterFilter } from './semesterFilter';

/**
 * Assignments > By course: a course's cases for every section at once (migration 078).
 *
 * Settings (chat options, rubric, scenarios, positions) live on a course version -- Main or a
 * semester copy -- and are written through to the sections that follow it. Scheduling and
 * Active always belong to each section, so they are shown and changed per section row, with
 * "on all" shortcuts. Assignments > By section is the per-section view of the same rows.
 *
 * Server rules are unchanged: course case list and versions = admin or course owner
 * (courseCases.js); activate/scheduling = section case managers (sectionCases.js).
 */

interface Props {
  isAdmin: boolean;
  /** Logged-in instructor id (course owners manage the course's settings). */
  userId: string | null;
  /**
   * The selected course, kept by the Dashboard so it survives switching views and can be set
   * from elsewhere (a "Follows: …" chip on By section, Courses → Courses). Reported back through
   * onCourseChange; a reload falls back to sessionStorage.
   */
  selectedCourseId?: number | null;
  onCourseChange?: (courseId: number | null) => void;
  /** Show one section in Assignments > By section. */
  onOpenSection: (sectionId: string) => void;
  onSwitchToSections: () => void;
  /** Section case counts changed. */
  onChanged?: () => void;
}

const COURSE_STORAGE_KEY = 'mtc_assignments_course';
/** Case sort choice, per browser (localStorage). */
const SORT_STORAGE_KEY = 'mtc_course_cases_sort';
/** Expanded case ids for one course, per browser session (sessionStorage); suffixed with the course id. */
const EXPANDED_STORAGE_PREFIX = 'mtc_course_cases_expanded:';

/**
 * date   = earliest opening date among the sections in view; undated cases last
 * title  = case title
 * custom = the course owner's order (course_cases.sort_order, PATCH /courses/:id/cases/reorder)
 */
type CaseSort = 'date' | 'title' | 'custom';
const SORT_LABELS: Record<CaseSort, string> = { date: 'Opening date', title: 'Title', custom: 'Custom' };

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDay = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
const byTitle = (a: CourseCaseRow, b: CourseCaseRow) => a.case_title.localeCompare(b.case_title, undefined, { sensitivity: 'base' });

/** ISO/DATETIME string -> value for <input type="datetime-local"> in local time. */
function toLocalInput(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABELS: Record<string, string> = { manually_opened: 'Open now', manually_closed: 'Closed' };

const btn = 'px-2.5 py-1 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-200 hover:bg-gray-50 disabled:opacity-50';

const CourseAssignments: React.FC<Props> = ({ isAdmin, userId, selectedCourseId, onCourseChange, onOpenSection, onSwitchToSections, onChanged }) => {
  const { semesterId: headerSemesterId, selectedSemester, inScope } = useSemesterFilter();

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [courseId, setCourseId] = useState<number | null>(() => {
    if (selectedCourseId) return selectedCourseId;
    try {
      const stored = Number(sessionStorage.getItem(COURSE_STORAGE_KEY));
      return Number.isInteger(stored) && stored > 0 ? stored : null;
    } catch {
      return null;
    }
  });
  const [sections, setSections] = useState<CourseSection[]>([]);
  /** The course's cases in custom order (as the server returns them). */
  const [rows, setRows] = useState<CourseCaseRow[]>([]);
  /** Which course `sections`/`rows` belong to (they lag `courseId` while loading). */
  const [loadedCourseId, setLoadedCourseId] = useState<number | null>(null);
  const [sort, setSortState] = useState<CaseSort>(() => {
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY);
      return stored === 'title' || stored === 'custom' ? stored : 'date';
    } catch {
      return 'date';
    }
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedForCourse = useRef<number | null>(null);
  const latestCourseId = useRef(courseId);
  const [unlisted, setUnlisted] = useState<UnlistedCaseRow[]>([]);
  const [rubrics, setRubrics] = useState<any[]>([]);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<{ versionId: number; followers: FollowerSection[]; part: VersionEditorPart } | null>(null);
  const [adding, setAdding] = useState<{ initialCaseId?: string; fromSectionId?: string } | null>(null);
  const [copying, setCopying] = useState<{ row: CourseCaseRow; from: VersionRow } | null>(null);
  const [followers, setFollowers] = useState<CourseCaseRow | null>(null);
  const [scheduling, setScheduling] = useState<{ semesterId: number; semesterName: string; sections: CourseSection[]; caseId: string } | null>(null);
  const [editingDates, setEditingDates] = useState<{ row: CourseCaseSectionRow; caseTitle: string } | null>(null);

  useEffect(() => {
    if (selectedCourseId) setCourseId(selectedCourseId);
  }, [selectedCourseId]);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 5000);
  };

  useEffect(() => {
    api.get<Course[]>('/courses').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      setCourses(data || []);
    });
    api.get<any[]>('/rubrics').then(({ data }) => setRubrics(data || []));
  }, []);

  /** Courses with sections in the header semester (all courses under "All semesters"). */
  const coursesInScope = useMemo(
    () => (courses || []).filter((c) => headerSemesterId == null || (c.semesters || []).some((s) => s.semester_id === headerSemesterId)),
    [courses, headerSemesterId]
  );

  // Keep the selection valid for the semester; pick the only course when there is just one.
  useEffect(() => {
    if (!courses) return;
    if (courseId && coursesInScope.some((c) => c.id === courseId)) return;
    setCourseId(coursesInScope.length === 1 ? coursesInScope[0].id : null);
  }, [courses, coursesInScope, courseId]);

  useEffect(() => {
    onCourseChange?.(courseId);
    try {
      if (courseId) sessionStorage.setItem(COURSE_STORAGE_KEY, String(courseId));
    } catch {
      /* the choice just won't survive a reload */
    }
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const course = coursesInScope.find((c) => c.id === courseId) || null;
  const canManage = Boolean(course && (isAdmin || (userId && course.primary_instructor_id === userId)));

  const loadCourse = useCallback(async () => {
    latestCourseId.current = courseId;
    if (!courseId) { setSections([]); setRows([]); setUnlisted([]); setLoadedCourseId(null); return; }
    setLoadingCourse(true);
    const [courseRes, casesRes] = await Promise.all([
      api.get<Course>(`/courses/${courseId}`),
      api.get<CourseCaseRow[]>(`/courses/${courseId}/cases`),
    ]);
    if (latestCourseId.current !== courseId) return; // another course was picked meanwhile
    setLoadingCourse(false);
    if (courseRes.error || casesRes.error) { setError((courseRes.error || casesRes.error)!.message); return; }
    setSections(courseRes.data?.sections || []);
    setRows(casesRes.data || []);
    setUnlisted((casesRes as any).unlisted || []);
    setLoadedCourseId(courseId);
  }, [courseId]);

  useEffect(() => { loadCourse(); }, [loadCourse]);

  const setSort = (next: CaseSort) => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      /* the choice just won't survive a reload */
    }
  };

  const saveExpanded = (next: Set<string>) => {
    setExpanded(next);
    try {
      if (courseId) sessionStorage.setItem(EXPANDED_STORAGE_PREFIX + courseId, JSON.stringify([...next]));
    } catch {
      /* expansion just won't survive switching views */
    }
  };

  // When a course's cases first load: restore which were expanded, else open a course's only case.
  useEffect(() => {
    if (!courseId || loadedCourseId !== courseId || expandedForCourse.current === courseId) return;
    expandedForCourse.current = courseId;
    let stored: string[] | null = null;
    try {
      const raw = sessionStorage.getItem(EXPANDED_STORAGE_PREFIX + courseId);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    setExpanded(new Set(Array.isArray(stored) ? stored : rows.length === 1 ? [rows[0].case_id] : []));
  }, [courseId, loadedCourseId, rows]);

  const toggleExpanded = (caseId: string) => {
    const next = new Set(expanded);
    if (next.has(caseId)) next.delete(caseId); else next.add(caseId);
    saveExpanded(next);
  };

  const refresh = async () => {
    await loadCourse();
    onChanged?.();
  };

  const scopedSections = useMemo(() => sections.filter((s) => inScope(s)), [sections, inScope]);
  const semesterGroups = useMemo(() => groupSections(scopedSections), [scopedSections]);

  /** The course's row for this case on a section, and the version it follows. */
  const sectionState = (row: CourseCaseRow, sectionId: string) => {
    for (const v of row.versions) {
      const r = v.sections.find((s) => s.section_id === sectionId);
      if (r) return { row: r, version: v as VersionRow | null };
    }
    const r = row.customized_sections.find((s) => s.section_id === sectionId);
    return r ? { row: r, version: null } : null;
  };

  /** Main always; a semester copy only when it belongs to the semester in view. */
  const versionsInView = (row: CourseCaseRow) =>
    row.versions.filter((v) => v.is_main || headerSemesterId == null || v.semester_id === headerSemesterId);

  /** One case's section rows in view, and what the collapsed summary line shows. */
  const caseStats = (row: CourseCaseRow) => {
    const assigned = [...row.versions.flatMap((v) => v.sections), ...row.customized_sections].filter((s) => inScope(s));
    const opens = assigned.map((s) => s.open_date).filter((d): d is string => Boolean(d)).sort();
    return {
      assigned,
      activeCount: assigned.filter((s) => s.active).length,
      datedCount: opens.length,
      earliestOpen: opens[0] ?? null,
      copies: versionsInView(row).filter((v) => !v.is_main && v.sections.some((s) => inScope(s))).length,
      customized: row.customized_sections.filter((s) => inScope(s)).length,
    };
  };

  const sortedRows = useMemo(() => {
    if (sort === 'custom') return rows;
    if (sort === 'title') return [...rows].sort(byTitle);
    // Opening date: earliest open among sections in view (ISO strings sort chronologically); undated last.
    const earliest = new Map(rows.map((r) => [r.case_id, caseStats(r).earliestOpen]));
    return [...rows].sort((a, b) => {
      const da = earliest.get(a.case_id);
      const db = earliest.get(b.case_id);
      if (da && db && da !== db) return da < db ? -1 : 1;
      if (Boolean(da) !== Boolean(db)) return da ? -1 : 1;
      return byTitle(a, b);
    });
  }, [rows, sort, inScope]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Custom order: move a case one place and save the whole order. */
  const moveCase = async (caseId: string, delta: -1 | 1) => {
    const order = rows.map((r) => r.case_id);
    const i = order.indexOf(caseId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setRows(order.map((id) => rows.find((r) => r.case_id === id)!)); // show it now; the save follows
    const { error: saveError } = await api.patch(`/courses/${courseId}/cases/reorder`, { order });
    if (saveError) {
      setError(saveError.message);
      await loadCourse();
    }
  };

  const setActive = async (targets: CourseCaseSectionRow[], active: boolean) => {
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);
    const verb = active ? 'activate' : 'deactivate';
    const results = await Promise.all(targets.map((t) =>
      api.patch(`/sections/${encodeURIComponent(t.section_id)}/cases/${encodeURIComponent(t.case_id)}/${verb}`)
        .then((r) => ({ section_id: t.section_id, error: r.error }))
    ));
    await refresh();
    setBusy(false);
    const failed = results.filter((r) => r.error);
    const done = results.length - failed.length;
    if (failed.length > 0) {
      setError(`${done} ${active ? 'activated' : 'deactivated'}; refused on ${failed.map((f) => `${f.section_id} (${f.error!.message})`).join(', ')}`);
    } else if (targets.length > 1) {
      flash(`${active ? 'Activated' : 'Deactivated'} on ${done} section${done === 1 ? '' : 's'}`);
    }
  };

  const giveToSections = async (row: CourseCaseRow, main: VersionRow, sectionIds: string[]) => {
    setBusy(true);
    setError(null);
    for (const sectionId of sectionIds) {
      const { error: linkError } = await api.put(
        `/sections/${encodeURIComponent(sectionId)}/cases/${encodeURIComponent(row.case_id)}/version`,
        { version_id: main.version_id }
      );
      if (linkError) { setError(`${sectionId}: ${linkError.message}`); break; }
    }
    setBusy(false);
    await refresh();
  };

  const saveRubric = async (version: VersionRow, rubricId: number | null) => {
    setBusy(true);
    setError(null);
    const result: any = await api.patch(`/case-versions/${version.version_id}/rubric`, { rubric_id: rubricId });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    const n = result.sections_updated ?? 0;
    flash(`Rubric saved. ${n} following section${n === 1 ? '' : 's'} updated.`);
    await refresh();
  };

  const removeCase = async (row: CourseCaseRow) => {
    if (!confirm(`Remove ${caseLabel(row.case_title, row.case_id)} from this course?\n\nSections keep the case with their current settings, but stop following the course's versions.`)) return;
    const { error: delError } = await api.delete(`/courses/${courseId}/cases/${encodeURIComponent(row.case_id)}`);
    if (delError) { setError(delError.message); return; }
    await refresh();
  };

  const deleteCopy = async (version: VersionRow) => {
    if (!confirm(`Delete the semester copy "${version.label}"?\n\nIts ${version.sections.length} section(s) keep their current settings as Customized.`)) return;
    const { error: delError } = await api.delete(`/case-versions/${version.version_id}`);
    if (delError) { setError(delError.message); return; }
    await refresh();
  };

  const semesterLabel = selectedSemester?.semester_name || 'this semester';

  // ---------------------------------------------------------------------------

  const renderSectionTable = (row: CourseCaseRow, groupSectionsList: CourseSection[]) => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase">
            <th className="py-1 pr-3">Section</th>
            <th className="py-1 pr-3">Settings</th>
            <th className="py-1 pr-3">Opens</th>
            <th className="py-1 pr-3">Closes</th>
            <th className="py-1 pr-3"></th>
            <th className="py-1 text-right">Students see it</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groupSectionsList.map((s) => {
            const state = sectionState(row, s.section_id);
            return (
              <tr key={s.section_id} className={s.enabled ? '' : 'text-gray-400'}>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {s.enabled ? (
                    <button onClick={() => onOpenSection(s.section_id)} className="font-mono text-xs text-indigo-700 hover:underline"
                      title="Open this section in By section">
                      {s.section_id}
                    </button>
                  ) : (
                    // By section lists enabled sections only.
                    <span className="font-mono text-xs">{s.section_id} <span className="font-sans">(section disabled)</span></span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-xs">
                  {!state ? (
                    <span className="text-gray-400">not assigned</span>
                  ) : state.version ? (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                      {state.version.is_main ? 'Main' : state.version.label}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title="This section has its own settings for this case (edit them in By section)">
                      Customized
                    </span>
                  )}
                </td>
                {state ? (
                  <>
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmt(state.row.open_date)}</td>
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
                      {fmt(state.row.close_date)}
                      {state.row.manual_status && STATUS_LABELS[state.row.manual_status] && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{STATUS_LABELS[state.row.manual_status]}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      <button onClick={() => setEditingDates({ row: state.row, caseTitle: row.case_title })} className="text-xs text-blue-700 hover:underline">
                        Edit dates
                      </button>
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => setActive([state.row], !state.row.active)}
                        disabled={busy}
                        className={`px-3 py-1 text-xs font-medium rounded-lg disabled:opacity-50 ${state.row.active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        title={state.row.active ? 'Click to make inactive (students cannot select)' : 'Click to make active (students can select)'}
                      >
                        {state.row.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-1.5 text-xs text-gray-400">—</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderCaseSummary = (stats: ReturnType<typeof caseStats>) => {
    const n = stats.assigned.length;
    const settings = [
      'Main',
      stats.copies > 0 ? `${stats.copies} cop${stats.copies === 1 ? 'y' : 'ies'}` : null,
      stats.customized > 0 ? `${stats.customized} customized` : null,
    ].filter(Boolean).join(' + ');
    const activeTone = n > 0 && stats.activeCount === n
      ? 'bg-emerald-100 text-emerald-800'
      : stats.activeCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600';
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span>{settings}</span>
        <span aria-hidden>·</span>
        <span>
          {n === scopedSections.length ? `${n} section${n === 1 ? '' : 's'}` : `on ${n} of ${scopedSections.length} sections`}
        </span>
        <span aria-hidden>·</span>
        <span className={`px-1.5 py-0.5 rounded ${activeTone}`}>{stats.activeCount} of {n} active</span>
        <span aria-hidden>·</span>
        <span>
          {stats.earliestOpen ? `opens ${fmtDay(stats.earliestOpen)}` : 'no dates'}
          {stats.datedCount > 0 && stats.datedCount < n && ` (dates on ${stats.datedCount} of ${n})`}
        </span>
      </span>
    );
  };

  const renderCaseCard = (row: CourseCaseRow) => {
    const main = row.versions.find((v) => v.is_main);
    const stats = caseStats(row);
    const inactive = stats.assigned.filter((s) => !s.active);
    const active = stats.assigned.filter((s) => s.active);
    const unassigned = scopedSections.filter((s) => !sectionState(row, s.section_id));
    const isOpen = expanded.has(row.case_id);
    const customIndex = rows.findIndex((r) => r.case_id === row.case_id);
    const bodyId = `course-case-${row.course_case_id}`;

    return (
      <div key={row.course_case_id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gray-50 ${isOpen ? 'border-b border-gray-200' : ''}`}>
          <button
            type="button"
            onClick={() => toggleExpanded(row.case_id)}
            aria-expanded={isOpen}
            aria-controls={bodyId}
            className="flex items-start gap-2 text-left min-w-0 flex-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="min-w-0">
              <span className="font-medium text-gray-900">{row.case_title}</span>
              <span className="ml-2 text-sm text-gray-500">({row.case_id})</span>
              <span className="block mt-0.5">{renderCaseSummary(stats)}</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            {sort === 'custom' && canManage && rows.length > 1 && (
              <span className="inline-flex">
                <button type="button" onClick={() => moveCase(row.case_id, -1)} disabled={customIndex <= 0}
                  aria-label={`Move ${row.case_title} up`} title="Move up"
                  className="px-1.5 py-1 text-gray-500 hover:text-gray-800 disabled:opacity-30">▲</button>
                <button type="button" onClick={() => moveCase(row.case_id, 1)} disabled={customIndex >= rows.length - 1}
                  aria-label={`Move ${row.case_title} down`} title="Move down"
                  className="px-1.5 py-1 text-gray-500 hover:text-gray-800 disabled:opacity-30">▼</button>
              </span>
            )}
            <button onClick={() => setActive(inactive, true)} disabled={busy || inactive.length === 0} className={btn}
              title="Let students in every section shown here select this case">
              Activate on all{inactive.length > 0 ? ` (${inactive.length})` : ''}
            </button>
          </div>
        </div>

        {isOpen && (
        <div id={bodyId} className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => setActive(active, false)} disabled={busy || active.length === 0} className={btn}>
              Deactivate on all
            </button>
            <button onClick={() => setFollowers(row)} className="text-xs font-medium text-indigo-700 hover:underline">
              Who follows what{canManage ? '…' : ''}
            </button>
            {canManage && (
              <button onClick={() => removeCase(row)} className="text-xs text-red-600 hover:underline">Remove from course</button>
            )}
          </div>

          {/* Settings: one row per version in view */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase">Settings</div>
            {versionsInView(row).map((v) => {
              const followersInView = v.sections.filter((s) => inScope(s));
              const otherFollowers = v.sections.length - followersInView.length;
              const rubricId = v.rubric_id ?? null;
              return (
                <div key={v.version_id} className="flex flex-wrap items-center gap-2 text-sm border border-gray-100 rounded-lg px-3 py-2">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${v.is_main ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'}`}>
                    {v.is_main ? 'Main' : `${v.semester_code} copy`}
                  </span>
                  {!v.is_main && <span className="text-gray-700">{v.label}</span>}
                  <span className="text-xs text-gray-500">
                    {followersInView.length === 0 ? 'no sections here follow this' : `${followersInView.length} section${followersInView.length === 1 ? '' : 's'}`}
                    {otherFollowers > 0 && ` · +${otherFollowers} in other semesters`}
                  </span>
                  <span className="flex-1" />
                  <select
                    value={rubricId ?? ''}
                    disabled={!canManage || busy}
                    onChange={(e) => saveRubric(v, e.target.value ? Number(e.target.value) : null)}
                    className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white disabled:bg-gray-50"
                    title="Evaluation rubric"
                  >
                    <option value="">Default Rubric</option>
                    {rubrics.map((r) => <option key={r.rubric_id} value={r.rubric_id}>{r.rubric_name}{r.total_points ? ` (${r.total_points}pts)` : ''}</option>)}
                  </select>
                  <button onClick={() => setEditing({ versionId: v.version_id, followers: v.sections, part: 'options' })} className={btn}>
                    Options
                  </button>
                  <button onClick={() => setEditing({ versionId: v.version_id, followers: v.sections, part: 'scenarios' })} className={btn}>
                    Scenarios and Positions
                  </button>
                  {canManage && (
                    <button onClick={() => setCopying({ row, from: v })} className="text-xs text-gray-600 hover:underline px-1">Make semester copy</button>
                  )}
                  {canManage && !v.is_main && (
                    <button onClick={() => deleteCopy(v)} className="text-xs text-red-600 hover:underline px-1">Delete copy</button>
                  )}
                </div>
              );
            })}
            {mainSharedNote(headerSemesterId, main)}
          </div>

          {/* Sections: scheduling and Active are per section */}
          {semesterGroups.length === 0 ? (
            <p className="text-sm text-gray-500">This course has no sections{headerSemesterId ? ` in ${semesterLabel}` : ''}.</p>
          ) : semesterGroups.map((g) => (
            <div key={String(g.semesterId)} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-500 uppercase">
                  Sections{semesterGroups.length > 1 || headerSemesterId == null ? ` · ${g.label}` : ''}
                </div>
                <div className="flex items-center gap-3">
                  {canManage && main && unassigned.some((s) => s.semester_id === g.semesterId) && (
                    <button
                      onClick={() => giveToSections(row, main, unassigned.filter((s) => s.semester_id === g.semesterId).map((s) => s.section_id))}
                      disabled={busy}
                      className="text-xs font-medium text-indigo-700 hover:underline disabled:opacity-50"
                    >
                      Give to unassigned sections ({unassigned.filter((s) => s.semester_id === g.semesterId).length})
                    </button>
                  )}
                  {g.semesterId != null && (
                    <button
                      onClick={() => setScheduling({ semesterId: g.semesterId as number, semesterName: g.label, sections: g.sections, caseId: row.case_id })}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Schedule all…
                    </button>
                  )}
                </div>
              </div>
              {renderSectionTable(row, g.sections)}
            </div>
          ))}
        </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label htmlFor="course-assignments-course" className="block text-sm font-medium text-gray-700">Course</label>
          <HelpTooltip title="Assignments by course">
            <CourseAssignmentsHelp />
          </HelpTooltip>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            id="course-assignments-course"
            value={courseId ?? ''}
            onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)}
            className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select a course...</option>
            {coursesInScope.map((c) => (
              <option key={c.id} value={c.id}>{c.course_name} ({c.course_code})</option>
            ))}
          </select>
          {course && canManage && (
            <button onClick={() => setAdding({})} className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
              + Add case to course
            </button>
          )}
        </div>
        <SemesterScopeNote className="mt-1" />
      </div>

      {error && (
        <div className="bg-red-100 border border-red-200 text-red-700 p-3 rounded-lg flex items-start justify-between gap-2 text-sm">
          <span className="min-w-0 break-words">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800" aria-label="Dismiss">✕</button>
        </div>
      )}
      {message && <div className="bg-green-100 border border-green-200 text-green-700 p-3 rounded-lg text-sm">{message}</div>}

      {courses === null ? (
        <div className="text-center py-8 text-gray-500">Loading courses…</div>
      ) : coursesInScope.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          No courses have sections{headerSemesterId ? ` in ${semesterLabel}` : ''}.{' '}
          <button onClick={onSwitchToSections} className="text-indigo-700 hover:underline">Assign cases by section</button>
        </div>
      ) : !course ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          Select a course to manage its cases for all of its sections.
        </div>
      ) : (
        <>
          {!canManage && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-lg text-sm">
              {course.primary_instructor_name || 'The course owner'} manages the settings for this course. You can still schedule and activate cases on your
              own sections, or{' '}
              <button onClick={onSwitchToSections} className="font-medium underline">use By section</button> to customize them.
            </div>
          )}

          {loadingCourse && rows.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
              No cases on this course yet.{canManage ? ' Use "+ Add case to course" to give a case to all of its sections.' : ''}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2 text-gray-600">
                  Sort:
                  <select value={sort} onChange={(e) => setSort(e.target.value as CaseSort)}
                    className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-sm">
                    {(Object.keys(SORT_LABELS) as CaseSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
                  </select>
                  {sort === 'custom' && (
                    <span className="text-xs text-gray-500">
                      {canManage ? 'Use ▲▼ to arrange; the order is saved for the course.' : "The course owner's order."}
                    </span>
                  )}
                </label>
                {rows.length > 1 && (
                  <span className="flex items-center gap-3 text-xs">
                    <button onClick={() => saveExpanded(new Set(rows.map((r) => r.case_id)))} className="font-medium text-indigo-700 hover:underline">Expand all</button>
                    <button onClick={() => saveExpanded(new Set())} className="font-medium text-indigo-700 hover:underline">Collapse all</button>
                  </span>
                )}
              </div>
              {sortedRows.map(renderCaseCard)}
            </div>
          )}

          {unlisted.some((u) => u.sections.some((s) => inScope(s))) && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-700">Assigned to some sections, but not to the course</h4>
              <p className="text-xs text-gray-500 mb-2">These sections have their own settings. Make a case course-wide to manage it here for every section.</p>
              <div className="space-y-2">
                {unlisted.filter((u) => u.sections.some((s) => inScope(s))).map((u) => {
                  const here = u.sections.filter((s) => inScope(s));
                  return (
                    <div key={u.case_id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">{u.case_title}</span>
                      <span className="text-gray-500">({u.case_id})</span>
                      {here.map((s) => (
                        <button key={s.section_id} onClick={() => onOpenSection(s.section_id)}
                          className="px-2 py-0.5 text-xs font-mono rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                          title="Open this section in By section">
                          {s.section_id}{s.active ? ' · active' : ''}
                        </button>
                      ))}
                      <span className="flex-1" />
                      {canManage && (
                        <button onClick={() => setAdding({ initialCaseId: u.case_id, fromSectionId: here[0]?.section_id })}
                          className="text-xs font-medium text-indigo-700 hover:underline">
                          Make course-wide…
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {editing && (
        <CaseVersionEditor
          versionId={editing.versionId}
          canEdit={canManage}
          followers={editing.followers}
          initialPart={editing.part}
          onClose={() => { setEditing(null); refresh(); }}
          onChanged={() => onChanged?.()}
        />
      )}
      {adding && course && (
        <AddCaseModal
          courseId={course.id}
          existingCaseIds={rows.map((r) => r.case_id)}
          sections={scopedSections}
          initialCaseId={adding.initialCaseId}
          fromSectionId={adding.fromSectionId}
          onClose={() => setAdding(null)}
          onSaved={(addedCaseId) => { setAdding(null); saveExpanded(new Set(expanded).add(addedCaseId)); refresh(); }}
        />
      )}
      {copying && (
        <SemesterCopyModal
          row={copying.row}
          from={copying.from}
          sections={scopedSections}
          onClose={() => setCopying(null)}
          onSaved={() => { setCopying(null); refresh(); }}
        />
      )}
      {followers && course && (
        <FollowersModal
          courseId={course.id}
          row={followers}
          sections={scopedSections}
          canManage={canManage}
          onClose={() => { setFollowers(null); refresh(); }}
        />
      )}
      {scheduling && course && (
        <ScheduleCasesModal
          courseId={course.id}
          semesterId={scheduling.semesterId}
          semesterName={scheduling.semesterName}
          sections={scheduling.sections}
          initialCaseId={scheduling.caseId}
          onClose={() => setScheduling(null)}
          onSaved={(text) => { setScheduling(null); flash(text); refresh(); }}
        />
      )}
      {editingDates && (
        <SectionDatesModal
          row={editingDates.row}
          caseTitle={editingDates.caseTitle}
          onClose={() => setEditingDates(null)}
          onSaved={(text) => { setEditingDates(null); flash(text); refresh(); }}
        />
      )}
    </div>
  );
};

/** Main is shared by every semester; say so when only one semester is in view. */
function mainSharedNote(headerSemesterId: number | null, main: VersionRow | undefined) {
  if (!main || headerSemesterId == null) return null;
  const elsewhere = main.sections.filter((s) => s.semester_id !== headerSemesterId).length;
  if (elsewhere === 0) return null;
  return (
    <p className="text-xs text-gray-500">
      Main is shared across semesters: editing it also changes {elsewhere} section{elsewhere === 1 ? '' : 's'} in other semesters.
      Use <strong>Make semester copy</strong> to change only this semester.
    </p>
  );
}

const SectionDatesModal: React.FC<{
  row: CourseCaseSectionRow;
  caseTitle: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ row, caseTitle, onClose, onSaved }) => {
  const [openAt, setOpenAt] = useState(toLocalInput(row.open_date));
  const [closeAt, setCloseAt] = useState(toLocalInput(row.close_date));
  const [manualStatus, setManualStatus] = useState(row.manual_status || 'auto');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const open = openAt ? new Date(openAt) : null;
    const close = closeAt ? new Date(closeAt) : null;
    if (open && close && close <= open) { setError('Close must be after open.'); return; }
    setSaving(true);
    const { error: saveError } = await api.patch(
      `/sections/${encodeURIComponent(row.section_id)}/cases/${encodeURIComponent(row.case_id)}/scheduling`,
      { open_date: open ? open.toISOString() : null, close_date: close ? close.toISOString() : null, manual_status: manualStatus }
    );
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved(`Dates saved for ${row.section_id}`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex justify-between items-start p-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Dates</h3>
            <p className="text-sm text-gray-500">{caseTitle} · <span className="font-mono">{row.section_id}</span></p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close">✕</button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="font-medium text-gray-700">Opens</span>
            <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="font-medium text-gray-700">Closes</span>
            <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="font-medium text-gray-700">Status</span>
            <select value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg bg-white">
              <option value="auto">Follow dates</option>
              <option value="manually_opened">Open now</option>
              <option value="manually_closed">Closed</option>
            </select>
          </label>
          <p className="text-xs text-gray-500">Leave a date empty for no limit. Students only see the case while it is Active.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
};

export default CourseAssignments;
