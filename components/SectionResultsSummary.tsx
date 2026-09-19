import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/apiClient';
import { SemesterScopeNote, useSemesterFilter } from './courses/semesterFilter';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';

interface SectionOption {
  section_id: string;
  section_title: string;
  year_term?: string;
  enabled: boolean;
  semester_id?: number | null;
}

interface CaseBreakdownRow {
  case_id: string;
  case_title: string;
  started_students: number;
  completions: number;
  avg_score: number | null;
}

interface SectionBreakdownRow {
  section_id: string;
  section_title: string;
  year_term?: string;
  total_students: number;
  completions: number;
  avg_score: number | null;
}

interface SectionResultsSummaryProps {
  initialSectionId?: string;
  onNavigate?: (
    section: string,
    subTab?: string,
    options?: { section_id?: string; case_id?: string }
  ) => void;
}

// Per-section sub-rows cost one extra request per section; beyond this the combined
// table plus "Performance by Section" is shown without them.
const MAX_SECTIONS_FOR_SUBROWS = 12;

const fetchResults = (sectionIds: string[]) => {
  const params = new URLSearchParams();
  params.set('section_ids', sectionIds.join(','));
  params.set('case_ids', 'all');
  params.set('statuses', 'all');
  params.set('limit', '1');
  return api.get<any>(`/analytics/results?${params.toString()}`);
};

const SectionResultsSummary: React.FC<SectionResultsSummaryProps> = ({
  initialSectionId,
  onNavigate
}) => {
  // Header Semester selector limits the section picker.
  const { inScope } = useSemesterFilter();
  const [sections, setSections] = useState<SectionOption[]>([]);
  // MultiSelect convention: ['all'] = every section in the picker.
  const [selected, setSelected] = useState<string[]>(
    initialSectionId ? initialSectionId.split(',').filter(Boolean) : ['all']
  );
  const [caseBreakdown, setCaseBreakdown] = useState<CaseBreakdownRow[]>([]);
  const [sectionBreakdown, setSectionBreakdown] = useState<SectionBreakdownRow[]>([]);
  // case_id → section_id → that section's row for the case
  const [perSection, setPerSection] = useState<Map<string, Map<string, CaseBreakdownRow>>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllSections, setShowAllSections] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load section list for the picker — fetch all, filter client-side via the Enabled / All Sections toggle
  useEffect(() => {
    const fetchSections = async () => {
      try {
        const response = await api.get<any[]>('/sections');
        if (response.data) {
          const opts: SectionOption[] = response.data.map((s: any) => ({
            section_id: s.section_id,
            section_title: s.section_title,
            year_term: s.year_term,
            enabled: !!s.enabled,
            semester_id: s.semester_id ?? null
          }));
          setSections(opts);
        }
      } catch (err: any) {
        console.error('Failed to load sections:', err);
      }
    };
    fetchSections();
  }, []);

  const visibleSections = useMemo(
    () => sections.filter(s => inScope(s) && (showAllSections || s.enabled)),
    [sections, showAllSections, inScope]
  );
  const sectionOptions: MultiSelectOption[] = useMemo(
    () => visibleSections.map(s => ({
      value: s.section_id,
      label: `${s.section_title}${!s.enabled ? ' (Disabled)' : ''}`,
      subtitle: s.section_id
    })),
    [visibleSections]
  );

  // Sync incoming initialSectionId
  useEffect(() => {
    if (initialSectionId) setSelected(initialSectionId.split(',').filter(Boolean));
  }, [initialSectionId]);

  // Resolve 'all', and drop picks outside the header semester / current toggle.
  const selectedIds = useMemo(() => {
    const visibleIds = visibleSections.map(s => s.section_id);
    if (selected.includes('all')) return visibleIds;
    const allowed = new Set(visibleIds);
    return selected.filter(id => allowed.has(id));
  }, [selected, visibleSections]);
  const selectedKey = selectedIds.join(',');
  const multi = selectedIds.length > 1;

  useEffect(() => {
    if (!selectedKey) {
      setCaseBreakdown([]);
      setSectionBreakdown([]);
      setPerSection(new Map());
      return;
    }
    let cancelled = false;
    const ids = selectedKey.split(',');
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchResults(ids);
        if (cancelled) return;
        if (response.error) {
          setError(response.error.message);
          setCaseBreakdown([]);
          setSectionBreakdown([]);
          setPerSection(new Map());
          return;
        }
        setCaseBreakdown(response.data?.summary?.caseBreakdown || []);
        setSectionBreakdown(response.data?.summary?.sectionBreakdown || []);

        if (ids.length > 1 && ids.length <= MAX_SECTIONS_FOR_SUBROWS) {
          const each = await Promise.all(ids.map(id => fetchResults([id]).catch(() => ({ data: null, error: null }))));
          if (cancelled) return;
          const map = new Map<string, Map<string, CaseBreakdownRow>>();
          each.forEach((r: any, i) => {
            (r?.data?.summary?.caseBreakdown || []).forEach((row: CaseBreakdownRow) => {
              if (!map.has(row.case_id)) map.set(row.case_id, new Map());
              map.get(row.case_id)!.set(ids[i], row);
            });
          });
          setPerSection(map);
        } else {
          setPerSection(new Map());
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load case breakdown');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedKey, refreshKey]);

  const sectionTitle = useMemo(() => {
    const m = new Map(sections.map(s => [s.section_id, s.section_title]));
    return (id: string) => m.get(id) || id;
  }, [sections]);

  const handleViewResponses = (caseId: string, sectionIds: string[] = selectedIds) => {
    if (sectionIds.length === 0 || !onNavigate) return;
    onNavigate('results', 'responses', {
      section_id: sectionIds.join(','),
      case_id: caseId
    });
  };

  const toggleExpanded = (caseId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId); else next.add(caseId);
      return next;
    });
  };

  const hasSubRows = multi && perSection.size > 0;
  const numCell = 'px-4 py-3 whitespace-nowrap text-right text-sm';

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Section Results</h2>
          <p className="text-sm text-gray-500 mt-1">
            Per-case Started, Completed, and average score for one or more sections.
          </p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          disabled={isLoading || selectedIds.length === 0}
          aria-label="Refresh results"
          title="Refresh results"
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Sections:</label>
        <MultiSelect
          options={sectionOptions}
          selected={selected}
          onChange={setSelected}
          allLabel="All sections"
          countLabel="sections"
          className="min-w-[280px]"
        />

        <div className="flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setShowAllSections(false)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              !showAllSections
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Enabled
          </button>
          <button
            onClick={() => setShowAllSections(true)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showAllSections
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All Sections
          </button>
        </div>
        <SemesterScopeNote />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {selectedIds.length === 0 ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          <p className="text-lg font-medium">Pick one or more sections to see their results.</p>
        </div>
      ) : isLoading && caseBreakdown.length === 0 ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          Loading…
        </div>
      ) : caseBreakdown.length === 0 ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          <p className="text-lg font-medium">No case activity yet for {multi ? 'these sections' : 'this section'}.</p>
        </div>
      ) : (
        <>
          {multi && (
            <p className="text-xs text-gray-500 mb-2">
              Totals across {selectedIds.length} sections.
              {hasSubRows ? ' Click a case to see each section.' : ''}
            </p>
          )}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Completed</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">In Progress</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Score</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {caseBreakdown.map(row => {
                  const inProgress = Math.max(row.started_students - row.completions, 0);
                  const bySection = perSection.get(row.case_id);
                  const canExpand = hasSubRows && !!bySection;
                  const isOpen = canExpand && expanded.has(row.case_id);
                  return (
                    <React.Fragment key={row.case_id}>
                      <tr
                        className={`hover:bg-gray-50 ${canExpand ? 'cursor-pointer' : ''}`}
                        onClick={canExpand ? () => toggleExpanded(row.case_id) : undefined}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                          {canExpand && (
                            <span className={`inline-block mr-2 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                          )}
                          {row.case_title}
                          <span className="ml-2 text-xs text-gray-400">({row.case_id})</span>
                        </td>
                        <td className={`${numCell} text-gray-700`}>{row.started_students}</td>
                        <td className={`${numCell} text-gray-900 font-semibold`}>{row.completions}</td>
                        <td className={`${numCell} text-gray-600`}>{inProgress}</td>
                        <td className={`${numCell} text-gray-700`}>
                          {row.avg_score != null ? row.avg_score.toFixed(2) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewResponses(row.case_id); }}
                            className="px-3 py-1 text-xs font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                            title={multi ? 'View student responses for these sections and case' : 'View student responses for this section and case'}
                          >
                            View student responses →
                          </button>
                        </td>
                      </tr>
                      {isOpen && selectedIds.filter(id => bySection!.has(id)).map(id => {
                        const sub = bySection!.get(id)!;
                        return (
                          <tr key={`${row.case_id}:${id}`} className="bg-gray-50">
                            <td className="pl-10 pr-4 py-2 whitespace-nowrap text-sm text-gray-700" title={sectionTitle(id)}>
                              {id}
                            </td>
                            <td className={`${numCell} py-2 text-gray-600`}>{sub.started_students}</td>
                            <td className={`${numCell} py-2 text-gray-700`}>{sub.completions}</td>
                            <td className={`${numCell} py-2 text-gray-500`}>{Math.max(sub.started_students - sub.completions, 0)}</td>
                            <td className={`${numCell} py-2 text-gray-600`}>
                              {sub.avg_score != null ? sub.avg_score.toFixed(2) : '—'}
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap text-right">
                              <button
                                onClick={() => handleViewResponses(row.case_id, [id])}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                This section →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {multi && sectionBreakdown.length > 0 && (
            <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Performance by Section</h3>
                <p className="text-xs text-gray-500">All cases combined.</p>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Students</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Completions</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Score</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sectionBreakdown.map(s => (
                    <tr key={s.section_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900" title={s.section_title}>
                        {s.section_id}
                        <span className="ml-2 text-xs text-gray-400">{s.section_title}</span>
                      </td>
                      <td className={`${numCell} text-gray-700`}>{s.total_students}</td>
                      <td className={`${numCell} text-gray-900 font-semibold`}>{s.completions}</td>
                      <td className={`${numCell} text-gray-700`}>{s.avg_score != null ? s.avg_score.toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SectionResultsSummary;
