import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import { getApiBaseUrl } from '../services/apiClient';

interface PositionAnalyticsProps {
  sectionId?: string;
  caseId?: string;
  scenarioId?: number;
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

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'not_started', label: 'Not Started' },
];

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

const PositionAnalytics: React.FC<PositionAnalyticsProps> = ({
  sectionId,
  caseId,
  scenarioId
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [correlationData, setCorrelationData] = useState<CorrelationData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'scoreByPosition' | 'positionChanges'>('overview');
  const [scoreDistributionData, setScoreDistributionData] = useState<ScoreDistributionData | null>(null);
  const [maxScore, setMaxScore] = useState<number>(15);
  const [summaryExpanded, setSummaryExpanded] = useState<boolean>(false);
  const [excludedScores, setExcludedScores] = useState<Record<string, Set<number>>>({});

  // Filter options (populated from API)
  const [sectionOptions, setSectionOptions] = useState<FilterOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);

  // Selected filters
  const [selectedSections, setSelectedSections] = useState<string[]>(['all']);
  const [selectedCases, setSelectedCases] = useState<string[]>(['all']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['completed']);

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

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      
      // Use filter selections if available, otherwise use props
      if (!selectedSections.includes('all') && selectedSections.length > 0) {
        // For now, the API only supports single section_id
        params.append('section_id', selectedSections[0]);
      } else if (sectionId) {
        params.append('section_id', sectionId);
      }

      if (!selectedCases.includes('all') && selectedCases.length > 0) {
        // For now, the API only supports single case_id
        params.append('case_id', selectedCases[0]);
      } else if (caseId) {
        params.append('case_id', caseId);
      }

      if (scenarioId) params.append('scenario_id', String(scenarioId));

      const queryString = params.toString();

      const [analyticsRes, correlationRes] = await Promise.all([
        api.get(`/analytics/positions${queryString ? `?${queryString}` : ''}`),
        api.get(`/analytics/positions/correlation${queryString ? `?${queryString}` : ''}`)
      ]);

      if (analyticsRes.data) {
        setAnalyticsData(analyticsRes.data);
      }
      if (correlationRes.data) {
        setCorrelationData(correlationRes.data);
        // Update max score from correlation data if available
        if (correlationRes.data.max_score) {
          setMaxScore(correlationRes.data.max_score);
        }
      }
    } catch (err) {
      console.error('Error fetching position analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  }, [sectionId, caseId, scenarioId, selectedSections, selectedCases]);

  const fetchScoreDistribution = useCallback(async () => {
    try {
      const params = new URLSearchParams();

      // Use filter selections if available, otherwise use props
      if (!selectedSections.includes('all') && selectedSections.length > 0) {
        params.append('section_id', selectedSections[0]);
      } else if (sectionId) {
        params.append('section_id', sectionId);
      }

      if (!selectedCases.includes('all') && selectedCases.length > 0) {
        params.append('case_id', selectedCases[0]);
      } else if (caseId) {
        params.append('case_id', caseId);
      }

      if (scenarioId) params.append('scenario_id', String(scenarioId));

      const queryString = params.toString();
      const token = localStorage.getItem('admin_auth_token');

      const response = await fetch(
        `${getApiBaseUrl()}/analytics/positions/score-distribution${queryString ? `?${queryString}` : ''}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const result = await response.json();
      if (result.data) {
        setScoreDistributionData(result.data);
        if (result.data.max_score) {
          setMaxScore(result.data.max_score);
        }
      }
    } catch (error) {
      console.error('Error fetching score distribution:', error);
    }
  }, [sectionId, caseId, scenarioId, selectedSections, selectedCases]);

  useEffect(() => {
    if (sectionOptions.length > 0 || caseOptions.length > 0) {
      fetchData();
    }
  }, [fetchData, sectionOptions.length, caseOptions.length]);

  useEffect(() => {
    if (activeTab === 'scoreByPosition') {
      fetchScoreDistribution();
    }
  }, [activeTab, fetchScoreDistribution]);

  // Convert options for MultiSelect - MUST be before any conditional returns (Rules of Hooks)
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
        <span className="ml-3 text-gray-600">Loading position analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!analyticsData || analyticsData.summary.total_chats_with_positions === 0) {
    return (
      <div className="space-y-6">
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
        </div>

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-600">No position tracking data available.</p>
          <p className="text-sm text-gray-500 mt-2">
            Position tracking must be enabled for assignments and students must have selected positions.
          </p>
        </div>
      </div>
    );
  }

  const { summary, by_position, change_matrix, by_student } = analyticsData;

  return (
    <div className="space-y-6">
      {/* Filters */}
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
        </div>
      </div>

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
            { id: 'positionChanges', label: 'Position Changes' }
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
    </div>
  );
};

export default PositionAnalytics;
