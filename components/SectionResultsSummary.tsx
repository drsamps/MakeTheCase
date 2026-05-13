import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/apiClient';

interface SectionOption {
  section_id: string;
  section_title: string;
  year_term?: string;
  enabled: boolean;
}

interface CaseBreakdownRow {
  case_id: string;
  case_title: string;
  started_students: number;
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

const SectionResultsSummary: React.FC<SectionResultsSummaryProps> = ({
  initialSectionId,
  onNavigate
}) => {
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | undefined>(initialSectionId);
  const [caseBreakdown, setCaseBreakdown] = useState<CaseBreakdownRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllSections, setShowAllSections] = useState(false);

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
            enabled: !!s.enabled
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
    () => (showAllSections ? sections : sections.filter(s => s.enabled)),
    [sections, showAllSections]
  );

  // Sync incoming initialSectionId
  useEffect(() => {
    if (initialSectionId) setSelectedSectionId(initialSectionId);
  }, [initialSectionId]);

  // Fetch case breakdown for the chosen section
  useEffect(() => {
    if (!selectedSectionId) {
      setCaseBreakdown([]);
      return;
    }
    let cancelled = false;
    const fetchBreakdown = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('section_ids', selectedSectionId);
        params.set('case_ids', 'all');
        params.set('statuses', 'all');
        params.set('limit', '1');
        const response = await api.get<any>(`/analytics/results?${params.toString()}`);
        if (cancelled) return;
        if (response.error) {
          setError(response.error.message);
          setCaseBreakdown([]);
        } else {
          setCaseBreakdown(response.data?.summary?.caseBreakdown || []);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load case breakdown');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchBreakdown();
    return () => {
      cancelled = true;
    };
  }, [selectedSectionId]);

  const handleViewResponses = (caseId: string) => {
    if (!selectedSectionId || !onNavigate) return;
    onNavigate('results', 'responses', {
      section_id: selectedSectionId,
      case_id: caseId
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Section Results</h2>
        <p className="text-sm text-gray-500 mt-1">
          Per-case Started, Completed, and average score for a section.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Section:</label>
        <select
          value={selectedSectionId || ''}
          onChange={(e) => setSelectedSectionId(e.target.value || undefined)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[280px]"
        >
          <option value="">— Select a section —</option>
          {visibleSections.map(s => (
            <option key={s.section_id} value={s.section_id}>
              {s.section_title}{s.year_term ? ` (${s.year_term})` : ''}{!s.enabled ? ' (Disabled)' : ''}
            </option>
          ))}
        </select>

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
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {!selectedSectionId ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          <p className="text-lg font-medium">Pick a section to see its results.</p>
        </div>
      ) : isLoading ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          Loading…
        </div>
      ) : caseBreakdown.length === 0 ? (
        <div className="text-center p-12 text-gray-500 bg-white rounded-xl border border-gray-200">
          <p className="text-lg font-medium">No case activity yet for this section.</p>
        </div>
      ) : (
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
                return (
                  <tr key={row.case_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {row.case_title}
                      <span className="ml-2 text-xs text-gray-400">({row.case_id})</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-700">
                      {row.started_students}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-900 font-semibold">
                      {row.completions}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-600">
                      {inProgress}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-700">
                      {row.avg_score != null ? row.avg_score.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleViewResponses(row.case_id)}
                        className="px-3 py-1 text-xs font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        title="View student responses for this section and case"
                      >
                        View student responses →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SectionResultsSummary;
