import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import type { Semester } from '../../types';

/**
 * The dashboard's one Semester selector (header dropdown).
 *
 * Dashboard calls useSemesterFilterState() once and puts the value in SemesterFilterContext;
 * screens that follow it (Sections, Students, Assignments, Chat Options, Monitor, Results, Home)
 * read it with useSemesterFilter() and filter with inScope(section).
 *
 * PERSISTENCE. The choice lives in sessionStorage for the browser session. The default -- the
 * current semester, or All when none is set -- applies ONLY while nothing is stored, so an
 * explicit "All semesters" survives tab changes and reloads instead of snapping back to the
 * current semester. A stored id that no longer exists falls back to All.
 *
 * Semesters come from GET /api/semesters, already newest first by start_date.
 */

const STORAGE_KEY = 'mtc_semester_filter';
export const SEMESTER_SELECT_ID = 'dashboard-semester-select';

export type SemesterSelection = number | 'all';

export interface SemesterFilterValue {
  semesters: Semester[];
  currentSemester: Semester | null;
  selection: SemesterSelection;
  /** The chosen semester, or null for All semesters. */
  selectedSemester: Semester | null;
  /** selection as a query-param value: the id, or null for All. */
  semesterId: number | null;
  loaded: boolean;
  setSelection: (selection: SemesterSelection) => void;
  /** Reload the semester list (after create/edit/delete/set-current). */
  refresh: () => Promise<void>;
  /** True when All is selected or the section belongs to the chosen semester. */
  inScope: (section: { semester_id?: number | null } | null | undefined) => boolean;
}

function readStored(): SemesterSelection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === 'all') return 'all';
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStored(selection: SemesterSelection) {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(selection));
  } catch {
    /* private window / blocked storage: the choice just won't survive a reload */
  }
}

export function useSemesterFilterState(enabled = true): SemesterFilterValue {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState<SemesterSelection | null>(() => readStored());

  const refresh = useCallback(async () => {
    const { data, error } = await api.get<Semester[]>('/semesters');
    if (!error) setSemesters(Array.isArray(data) ? data : []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const currentSemester = useMemo(() => semesters.find((s) => s.is_current) || null, [semesters]);

  const selection: SemesterSelection = useMemo(() => {
    if (stored === 'all') return 'all';
    if (stored != null) {
      // Until the list loads we cannot tell whether the id still exists; trust it meanwhile.
      if (!loaded || semesters.some((s) => s.id === stored)) return stored;
      return 'all';
    }
    return currentSemester ? currentSemester.id : 'all';
  }, [stored, loaded, semesters, currentSemester]);

  const setSelection = useCallback((next: SemesterSelection) => {
    writeStored(next);
    setStored(next);
  }, []);

  const selectedSemester = useMemo(
    () => (selection === 'all' ? null : semesters.find((s) => s.id === selection) || null),
    [selection, semesters]
  );

  const inScope = useCallback(
    (section: { semester_id?: number | null } | null | undefined) =>
      selection === 'all' || (section != null && Number(section.semester_id) === selection),
    [selection]
  );

  return useMemo(() => ({
    semesters,
    currentSemester,
    selection,
    selectedSemester,
    semesterId: selection === 'all' ? null : selection,
    loaded,
    setSelection,
    refresh,
    inScope,
  }), [semesters, currentSemester, selection, selectedSemester, loaded, setSelection, refresh, inScope]);
}

const ALL_IN_SCOPE: SemesterFilterValue = {
  semesters: [],
  currentSemester: null,
  selection: 'all',
  selectedSemester: null,
  semesterId: null,
  loaded: true,
  setSelection: () => {},
  refresh: async () => {},
  inScope: () => true,
};

export const SemesterFilterContext = createContext<SemesterFilterValue>(ALL_IN_SCOPE);

/** Outside the Dashboard provider this reports "All semesters", so components still work standalone. */
export function useSemesterFilter(): SemesterFilterValue {
  return useContext(SemesterFilterContext);
}

export function semesterOptionLabel(s: Semester): string {
  return `${s.semester_name} (${s.semester_code})${s.is_current ? ' — Current' : ''}`;
}

/**
 * Split sections into semester groups in `semesters` order (newest first), for <optgroup> lists
 * that deliberately span semesters (e.g. "Copy case assignments from"). Sections whose semester
 * is not in the list go last under "No semester".
 */
export function groupBySemester<T extends { semester_id?: number | null }>(
  semesters: Semester[],
  sections: T[]
): { key: string; label: string; sections: T[] }[] {
  const groups: { key: string; label: string; sections: T[] }[] = [];
  for (const sem of semesters) {
    const inSem = sections.filter((s) => Number(s.semester_id) === sem.id);
    if (inSem.length > 0) groups.push({ key: String(sem.id), label: semesterOptionLabel(sem), sections: inSem });
  }
  const known = new Set(semesters.map((s) => s.id));
  const rest = sections.filter((s) => !known.has(Number(s.semester_id)));
  if (rest.length > 0) groups.push({ key: 'none', label: 'No semester', sections: rest });
  return groups;
}

/** "Showing Fall 2026 · change in header" -- so a short or empty list is never a mystery. */
export const SemesterScopeNote: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { selectedSemester, selection } = useSemesterFilter();
  const focusHeader = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(SEMESTER_SELECT_ID) as HTMLSelectElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      el.focus();
    }
  };
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      Showing{' '}
      <strong className="font-semibold text-gray-700">
        {selection === 'all' ? 'all semesters' : selectedSemester?.semester_name || 'selected semester'}
      </strong>
      {' · '}
      <a href="#" onClick={focusHeader} className="text-indigo-600 hover:text-indigo-800 hover:underline">
        change in header
      </a>
    </p>
  );
};
