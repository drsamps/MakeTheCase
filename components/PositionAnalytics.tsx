import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/apiClient';

interface PositionAnalyticsProps {
  sectionId?: string;
  caseId?: string;
  scenarioId?: number;
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
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'correlation'>('overview');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (sectionId) params.append('section_id', sectionId);
      if (caseId) params.append('case_id', caseId);
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
      }
    } catch (err) {
      console.error('Error fetching position analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  }, [sectionId, caseId, scenarioId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
        <p className="text-gray-600">No position tracking data available.</p>
        <p className="text-sm text-gray-500 mt-2">
          Position tracking must be enabled for assignments and students must have selected positions.
        </p>
      </div>
    );
  }

  const { summary, by_position, change_matrix, by_student } = analyticsData;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Total Chats</p>
          <p className="text-2xl font-bold text-gray-900">{summary.total_chats}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">With Positions</p>
          <p className="text-2xl font-bold text-blue-600">{summary.total_chats_with_positions}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Position Changes</p>
          <p className="text-2xl font-bold text-green-600">{summary.total_position_changes}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Change Rate</p>
          <p className="text-2xl font-bold text-purple-600">{summary.change_rate}%</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-4">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'students', label: 'Students' },
            { id: 'correlation', label: 'Score Correlation' }
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

      {activeTab === 'correlation' && correlationData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Score by Position */}
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Average Score by Final Position</h3>
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
                          style={{ width: `${(item.avg_score / 15) * 100}%` }}
                        />
                      </div>
                      <span className="font-semibold text-sm w-10 text-right">{item.avg_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Changed vs Unchanged */}
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Score: Changed vs Unchanged Position</h3>
            <div className="space-y-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-green-800">Position Changed</p>
                    <p className="text-sm text-green-600">
                      {correlationData.change_score_correlation.changed_count} students
                    </p>
                  </div>
                  <p className="text-3xl font-bold text-green-700">
                    {correlationData.change_score_correlation.changed_avg_score ?? '-'}
                  </p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-800">Position Unchanged</p>
                    <p className="text-sm text-gray-600">
                      {correlationData.change_score_correlation.unchanged_count} students
                    </p>
                  </div>
                  <p className="text-3xl font-bold text-gray-700">
                    {correlationData.change_score_correlation.unchanged_avg_score ?? '-'}
                  </p>
                </div>
              </div>
              {correlationData.change_score_correlation.changed_avg_score !== null &&
               correlationData.change_score_correlation.unchanged_avg_score !== null && (
                <p className="text-sm text-gray-600 italic">
                  Students who changed their position scored{' '}
                  {correlationData.change_score_correlation.changed_avg_score >
                   correlationData.change_score_correlation.unchanged_avg_score
                    ? 'higher'
                    : correlationData.change_score_correlation.changed_avg_score <
                      correlationData.change_score_correlation.unchanged_avg_score
                    ? 'lower'
                    : 'the same'}{' '}
                  on average.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PositionAnalytics;
