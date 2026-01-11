import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import Pagination from './ui/Pagination';
import SortableHeader from './ui/SortableHeader';
import StatusBadge, { StatusType } from './ui/StatusBadge';
import ScoreChart from './ui/ScoreChart';

interface AnalyticsProps {
  onNavigate?: (section: string, subTab?: string) => void;
  initialSectionId?: string;
}

interface SummaryData {
  totalStudents: number;
  completedStudents: number;
  totalCompletions: number;
  avgScore: number | null;
  avgHints: number | null;
  avgHelpful: number | null;
  completionRate: number;
  scoreDistribution: Array<{ score: number; count: number }>;
  sectionBreakdown: Array<{
    section_id: string;
    section_title: string;
    year_term: string;
    total_students: number;
    completions: number;
    avg_score: number | null;
  }> | null;
  caseBreakdown: Array<{
    case_id: string;
    case_title: string;
    completions: number;
    avg_score: number | null;
  }> | null;
}

interface StudentResult {
  student_id: string;
  student_name: string;
  section_id: string;
  section_title: string;
  case_id: string;
  case_title: string;
  status: StatusType;
  initial_position: string | null;
  final_position: string | null;
  persona: string | null;
  score: number | null;
  hints: number | null;
  helpful: number | null;
  time_minutes: number | null;
  evaluation_id: string | null;
  case_chat_id: string | null;
  completion_time: string | null;
  allow_rechat: boolean;
}

interface FilterOption {
  section_id: string;
  section_title: string;
  year_term?: string;
}

interface CaseOption {
  case_id: string;
  case_title: string;
}

type SortKey = 'student_name' | 'section_title' | 'case_title' | 'status' | 'initial_position' | 'final_position' | 'persona' | 'score' | 'hints' | 'helpful' | 'completion_time';

const COLUMN_OPTIONS = [
  { key: 'section_title', label: 'Section' },
  { key: 'case_title', label: 'Case' },
  { key: 'status', label: 'Status' },
  { key: 'initial_position', label: 'Initial Position' },
  { key: 'final_position', label: 'Final Position' },
  { key: 'persona', label: 'Persona' },
  { key: 'score', label: 'Score' },
  { key: 'hints', label: 'Hints' },
  { key: 'helpful', label: 'Helpful' },
  { key: 'completion_time', label: 'Time' },
];

const DEFAULT_COLUMNS = ['section_title', 'case_title', 'status', 'score'];
const DEFAULT_VISIBLE_COLUMNS = new Set(DEFAULT_COLUMNS);

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'not_started', label: 'Not Started' },
];

const Analytics: React.FC<AnalyticsProps> = ({ onNavigate, initialSectionId }) => {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Filter options (populated from API)
  const [sectionOptions, setSectionOptions] = useState<FilterOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);

  // Selected filters
  const [selectedSections, setSelectedSections] = useState<string[]>(['all']);
  const [selectedCases, setSelectedCases] = useState<string[]>(['all']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['all']);

  // Display toggles
  const [showSummaryStats, setShowSummaryStats] = useState(true);
  const [showStudentDetails, setShowStudentDetails] = useState(true);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(DEFAULT_VISIBLE_COLUMNS);

  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('completion_time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Data
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [students, setStudents] = useState<StudentResult[]>([]);

  // Modal state
  const [selectedStudent, setSelectedStudent] = useState<StudentResult | null>(null);
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  const [evaluationData, setEvaluationData] = useState<any>(null);

  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const response = await api.get('/analytics/filters');
        if (response.data) {
          setSectionOptions(response.data.sections || []);
          setCaseOptions(response.data.cases || []);
        }
      } catch (error) {
        console.error('Failed to fetch filter options:', error);
      }
    };
    fetchFilters();
  }, []);

  // Handle initial section selection from navigation
  useEffect(() => {
    if (initialSectionId && sectionOptions.length > 0) {
      setSelectedSections([initialSectionId]);
    }
  }, [initialSectionId, sectionOptions]);

  // Fetch results data
  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('section_ids', selectedSections.includes('all') ? 'all' : selectedSections.join(','));
      params.set('case_ids', selectedCases.includes('all') ? 'all' : selectedCases.join(','));
      params.set('statuses', selectedStatuses.includes('all') ? 'all' : selectedStatuses.join(','));
      params.set('limit', pageSize.toString());
      params.set('offset', ((currentPage - 1) * pageSize).toString());
      params.set('sort_by', sortKey);
      params.set('sort_dir', sortDirection);

      const response = await api.get(`/analytics/results?${params.toString()}`);
      if (response.data) {
        setSummary(response.data.summary);
        setStudents(response.data.students);
        setTotalRecords(response.data.total);
      }
    } catch (error) {
      console.error('Failed to fetch results:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSections, selectedCases, selectedStatuses, pageSize, currentPage, sortKey, sortDirection]);

  useEffect(() => {
    if (sectionOptions.length > 0 || caseOptions.length > 0) {
      fetchResults();
    }
  }, [fetchResults, sectionOptions.length, caseOptions.length]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSections, selectedCases, selectedStatuses, pageSize]);

  // Handle sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Toggle column visibility
  const toggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  };

  // Score color helper
  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-400';
    if (score >= 12) return 'text-green-600';
    if (score >= 9) return 'text-blue-600';
    if (score >= 6) return 'text-amber-600';
    return 'text-red-600';
  };

  // View transcript
  const handleViewTranscript = async (student: StudentResult) => {
    if (!student.case_chat_id) return;
    setSelectedStudent(student);
    try {
      const response = await api.get(`/case-chats/${student.case_chat_id}`);
      if (response.data) {
        setTranscriptContent(response.data.transcript || 'No transcript available');
        setShowTranscriptModal(true);
      }
    } catch (error) {
      console.error('Failed to fetch transcript:', error);
    }
  };

  // View evaluation
  const handleViewEvaluation = async (student: StudentResult) => {
    if (!student.evaluation_id) return;
    setSelectedStudent(student);
    try {
      const response = await api.get(`/evaluations?student_ids=${student.student_id}&case_id=${student.case_id}`);
      if (response.data && response.data.length > 0) {
        setEvaluationData(response.data[0]);
        setShowEvaluationModal(true);
      }
    } catch (error) {
      console.error('Failed to fetch evaluation:', error);
    }
  };

  // Toggle re-chat
  const handleToggleRechat = async (student: StudentResult) => {
    if (!student.evaluation_id) return;
    try {
      await api.patch(`/evaluations/${student.evaluation_id}`, {
        allow_rechat: !student.allow_rechat
      });
      fetchResults();
    } catch (error) {
      console.error('Failed to toggle rechat:', error);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Student'];
    if (visibleColumns.has('section_title')) headers.push('Section');
    if (visibleColumns.has('case_title')) headers.push('Case');
    if (visibleColumns.has('status')) headers.push('Status');
    if (visibleColumns.has('initial_position')) headers.push('Initial Position');
    if (visibleColumns.has('final_position')) headers.push('Final Position');
    if (visibleColumns.has('persona')) headers.push('Persona');
    if (visibleColumns.has('score')) headers.push('Score');
    if (visibleColumns.has('hints')) headers.push('Hints');
    if (visibleColumns.has('helpful')) headers.push('Helpful');
    if (visibleColumns.has('completion_time')) headers.push('Time');

    const rows = [headers.join(',')];
    students.forEach(s => {
      const row = [`"${s.student_name}"`];
      if (visibleColumns.has('section_title')) row.push(`"${s.section_title}"`);
      if (visibleColumns.has('case_title')) row.push(`"${s.case_title}"`);
      if (visibleColumns.has('status')) row.push(s.status);
      if (visibleColumns.has('initial_position')) row.push(s.initial_position || '');
      if (visibleColumns.has('final_position')) row.push(s.final_position || '');
      if (visibleColumns.has('persona')) row.push(s.persona || '');
      if (visibleColumns.has('score')) row.push(s.score !== null ? `${s.score}/15` : '');
      if (visibleColumns.has('hints')) row.push(s.hints?.toString() || '');
      if (visibleColumns.has('helpful')) row.push(s.helpful !== null ? s.helpful.toFixed(1) : '');
      if (visibleColumns.has('completion_time')) row.push(s.completion_time ? new Date(s.completion_time).toLocaleString() : '');
      rows.push(row.join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Convert options for MultiSelect
  const sectionSelectOptions: MultiSelectOption[] = useMemo(() =>
    sectionOptions.map(s => ({
      value: s.section_id,
      label: s.section_title,
      subtitle: s.year_term
    })), [sectionOptions]
  );

  const caseSelectOptions: MultiSelectOption[] = useMemo(() =>
    caseOptions.map(c => ({
      value: c.case_id,
      label: c.case_title
    })), [caseOptions]
  );

  const statusSelectOptions: MultiSelectOption[] = useMemo(() =>
    STATUS_OPTIONS.map(s => ({
      value: s.value,
      label: s.label
    })), []
  );

  // Score distribution as array
  const scoreDistributionArray = useMemo(() => {
    if (!summary?.scoreDistribution) return Array(16).fill(0);
    const arr = Array(16).fill(0);
    summary.scoreDistribution.forEach(({ score, count }) => {
      if (score >= 0 && score <= 15) {
        arr[score] = count;
      }
    });
    return arr;
  }, [summary]);

  // Column options for MultiSelect
  const columnSelectOptions: MultiSelectOption[] = useMemo(() =>
    COLUMN_OPTIONS.map(col => ({
      value: col.key,
      label: col.label
    })), []
  );

  // Convert visible columns Set to array for MultiSelect
  const selectedColumns = useMemo(() =>
    Array.from(visibleColumns), [visibleColumns]
  );

  // Handle column selection change
  const handleColumnsChange = (selected: string[]) => {
    if (selected.includes('all') || selected.length === 0) {
      setVisibleColumns(new Set(COLUMN_OPTIONS.map(c => c.key)));
    } else {
      setVisibleColumns(new Set(selected));
    }
  };

  // Generate filter description for headings
  const getFilterDescription = useMemo(() => {
    let sectionText = 'all sections';
    let caseText = 'all cases';

    if (!selectedSections.includes('all') && selectedSections.length > 0) {
      if (selectedSections.length === 1) {
        const section = sectionOptions.find(s => s.section_id === selectedSections[0]);
        sectionText = section ? section.section_title : selectedSections[0];
      } else {
        sectionText = `${selectedSections.length} sections`;
      }
    }

    if (!selectedCases.includes('all') && selectedCases.length > 0) {
      if (selectedCases.length === 1) {
        const caseItem = caseOptions.find(c => c.case_id === selectedCases[0]);
        caseText = caseItem ? caseItem.case_title : selectedCases[0];
      } else {
        caseText = `${selectedCases.length} cases`;
      }
    }

    return { sectionText, caseText };
  }, [selectedSections, selectedCases, sectionOptions, caseOptions]);

  if (isLoading && students.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl p-5 border border-gray-200">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div className="h-8 bg-gray-200 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Results (Analytics & Reports)</h2>
        <p className="text-sm text-gray-500 mt-1">Performance insights from completed case chats</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Course Sections</label>
            <MultiSelect
              options={sectionSelectOptions}
              selected={selectedSections}
              onChange={setSelectedSections}
              placeholder="Select sections..."
              allLabel="ALL Sections"
            />
          </div>
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Cases</label>
            <MultiSelect
              options={caseSelectOptions}
              selected={selectedCases}
              onChange={setSelectedCases}
              placeholder="Select cases..."
              allLabel="ALL Cases"
            />
          </div>
          <div className="min-w-44">
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <MultiSelect
              options={statusSelectOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
              placeholder="Select statuses..."
              allLabel="All Statuses"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-gray-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSummaryStats}
              onChange={(e) => setShowSummaryStats(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Show summary statistics</span>
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showStudentDetails}
                onChange={(e) => setShowStudentDetails(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Show student details</span>
            </label>
            {showStudentDetails && (
              <>
                <div className="min-w-48">
                  <MultiSelect
                    options={columnSelectOptions}
                    selected={selectedColumns}
                    onChange={handleColumnsChange}
                    placeholder="Columns..."
                    allLabel="All Columns"
                    countLabel="columns showing"
                    defaultLabel="Default Columns"
                    defaultValues={DEFAULT_COLUMNS}
                  />
                </div>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Export CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      {showSummaryStats && summary && (
        <div className="space-y-4">
          {/* Section Heading */}
          <h3 className="text-lg font-semibold text-gray-900">
            Summary Statistics for {getFilterDescription.sectionText}, {getFilterDescription.caseText}
          </h3>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Completions</p>
              <p className="text-3xl font-bold text-gray-900">{summary.totalCompletions}</p>
              <p className="text-xs text-gray-400">{summary.completedStudents} of {summary.totalStudents} students</p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Score</p>
              <p className={`text-3xl font-bold ${getScoreColor(summary.avgScore)}`}>
                {summary.avgScore?.toFixed(1) || '-'}
                <span className="text-lg text-gray-400">/15</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Hints</p>
              <p className="text-3xl font-bold text-gray-900">
                {summary.avgHints?.toFixed(1) || '-'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Completion Rate</p>
              <p className="text-3xl font-bold text-blue-600">
                {summary.completionRate.toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h3>
            <ScoreChart distribution={scoreDistributionArray} />
          </div>

          {/* Section Breakdown */}
          {summary.sectionBreakdown && summary.sectionBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Performance by Section</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Section</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Students</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Completions</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.sectionBreakdown.map(section => (
                      <tr key={section.section_id} className="hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{section.section_title}</p>
                          <p className="text-xs text-gray-500">{section.year_term}</p>
                        </td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{section.total_students}</td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{section.completions}</td>
                        <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(section.avg_score)}`}>
                          {section.avg_score?.toFixed(1) || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Case Breakdown */}
          {summary.caseBreakdown && summary.caseBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Performance by Case</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Case</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Completions</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.caseBreakdown.map(caseItem => (
                      <tr key={caseItem.case_id} className="hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{caseItem.case_title}</p>
                        </td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{caseItem.completions}</td>
                        <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(caseItem.avg_score)}`}>
                          {caseItem.avg_score?.toFixed(1) || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Student Details */}
      {showStudentDetails && (
        <div className="space-y-4">
          {/* Section Heading */}
          <h3 className="text-lg font-semibold text-gray-900">
            Student Details for {getFilterDescription.sectionText}, {getFilterDescription.caseText}
          </h3>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <SortableHeader
                    label="Student"
                    sortKey="student_name"
                    currentSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  {visibleColumns.has('section_title') && (
                    <SortableHeader
                      label="Section"
                      sortKey="section_title"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('case_title') && (
                    <SortableHeader
                      label="Case"
                      sortKey="case_title"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('status') && (
                    <SortableHeader
                      label="Status"
                      sortKey="status"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('initial_position') && (
                    <SortableHeader
                      label="Initial Pos"
                      sortKey="initial_position"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('final_position') && (
                    <SortableHeader
                      label="Final Pos"
                      sortKey="final_position"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('persona') && (
                    <SortableHeader
                      label="Persona"
                      sortKey="persona"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('score') && (
                    <SortableHeader
                      label="Score"
                      sortKey="score"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('hints') && (
                    <SortableHeader
                      label="Hints"
                      sortKey="hints"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('helpful') && (
                    <SortableHeader
                      label="Helpful"
                      sortKey="helpful"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('completion_time') && (
                    <SortableHeader
                      label="Time"
                      sortKey="completion_time"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student, idx) => (
                  <tr
                    key={`${student.student_id}-${student.case_id}-${idx}`}
                    className={`hover:bg-gray-50 ${student.status === 'in_progress' ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="p-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{student.student_name}</div>
                    </td>
                    {visibleColumns.has('section_title') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">{student.section_title}</td>
                    )}
                    {visibleColumns.has('case_title') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">{student.case_title}</td>
                    )}
                    {visibleColumns.has('status') && (
                      <td className="p-3 whitespace-nowrap">
                        <StatusBadge status={student.status} />
                        {student.allow_rechat && student.status === 'completed' && (
                          <span className="ml-1 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Re-chat</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('initial_position') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.initial_position ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            {student.initial_position}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('final_position') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.final_position ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                            {student.final_position}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('persona') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.persona ? student.persona.charAt(0).toUpperCase() + student.persona.slice(1) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('score') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.score !== null ? (
                          <span className={`font-medium ${getScoreColor(student.score)}`}>
                            {student.score}/15
                          </span>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('hints') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.hints !== null ? student.hints : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('helpful') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.helpful !== null ? `${student.helpful.toFixed(1)}/5` : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('completion_time') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.completion_time ? new Date(student.completion_time).toLocaleString() : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    <td className="p-3 whitespace-nowrap text-sm">
                      <div className="flex gap-1">
                        {student.case_chat_id && (
                          <button
                            onClick={() => handleViewTranscript(student)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="View transcript"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {student.evaluation_id && (
                          <button
                            onClick={() => handleViewEvaluation(student)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                            title="View evaluation"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {student.status === 'completed' && student.evaluation_id && (
                          <button
                            onClick={() => handleToggleRechat(student)}
                            className={`p-1.5 rounded ${student.allow_rechat
                              ? 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                              : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50'}`}
                            title={student.allow_rechat ? 'Disable re-chat' : 'Allow re-chat'}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={20} className="p-8 text-center text-gray-500">
                      No results found for the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalRecords > 0 && (
            <Pagination
              currentPage={currentPage}
              totalItems={totalRecords}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
            />
          )}
          </div>
        </div>
      )}

      {/* Transcript Modal */}
      {showTranscriptModal && selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Chat Transcript</h3>
                <p className="text-sm text-gray-500">{selectedStudent.student_name} - {selectedStudent.case_title}</p>
              </div>
              <button
                onClick={() => setShowTranscriptModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded-lg">
                {transcriptContent}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Evaluation Modal */}
      {showEvaluationModal && selectedStudent && evaluationData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Evaluation</h3>
                <p className="text-sm text-gray-500">{selectedStudent.student_name} - {selectedStudent.case_title}</p>
              </div>
              <button
                onClick={() => setShowEvaluationModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className={`text-3xl font-bold ${getScoreColor(evaluationData.score)}`}>
                  {evaluationData.score}/15
                </div>
                <div className="text-sm text-gray-500">
                  Hints: {evaluationData.hints} | Helpful: {evaluationData.helpful?.toFixed(1)}/5
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Summary</h4>
                <p className="text-sm text-gray-600">{evaluationData.summary}</p>
              </div>
              {evaluationData.liked && (
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-green-700 mb-2">Student Feedback - Liked</h4>
                  <p className="text-sm text-gray-600">{evaluationData.liked}</p>
                </div>
              )}
              {evaluationData.improve && (
                <div className="bg-amber-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Student Feedback - Improve</h4>
                  <p className="text-sm text-gray-600">{evaluationData.improve}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
