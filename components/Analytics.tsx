import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/apiClient';

interface AnalyticsProps {
  onNavigate?: (section: string, subTab?: string) => void;
}

interface SectionPerformance {
  section_id: string;
  section_title: string;
  year_term: string;
  total_students: number;
  completed: number;
  avg_score: number | null;
  avg_hints: number | null;
  avg_helpful: number | null;
  completion_rate: number;
}

interface CasePerformance {
  case_id: string;
  case_title: string;
  total_attempts: number;
  avg_score: number | null;
  avg_hints: number | null;
  completion_rate: number;
  position_summary?: string; // e.g., "5 for, 3 against, 2 no position" or "no positions tracked"
}

interface OverallStats {
  totalSections: number;
  totalStudents: number;
  totalCompletions: number;
  overallAvgScore: number | null;
  overallAvgHints: number | null;
  overallAvgHelpful: number | null;
  completionRate: number;
  completionsThisWeek: number;
  completionsLastWeek: number;
}

interface ScoreDistribution {
  score: number;
  count: number;
}

interface PositionData {
  total_with_positions: number;
  initial_distribution: Array<{ position: string; count: number; percentage: number }>;
  final_distribution: Array<{ position: string; count: number; percentage: number }>;
  position_changes: { changed: number; unchanged: number; change_rate: number };
  students_by_position: Record<string, Array<{ id: string; name: string; changed: boolean; final_position: string | null }>>;
}

interface CaseChatResponse {
  id: string;
  student_id: string;
  student_name: string;
  section_id: string;
  section_title: string;
  initial_position: string | null;
  final_position: string | null;
  transcript: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
}

const Analytics: React.FC<AnalyticsProps> = ({ onNavigate }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'overview' | 'sections' | 'cases' | 'positions' | 'responses'>('overview');
  const [sectionPerformance, setSectionPerformance] = useState<SectionPerformance[]>([]);
  const [casePerformance, setCasePerformance] = useState<CasePerformance[]>([]);
  const [overallStats, setOverallStats] = useState<OverallStats | null>(null);
  const [scoreDistribution, setScoreDistribution] = useState<ScoreDistribution[]>([]);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  // Position tracking state
  const [positionSections, setPositionSections] = useState<Array<{ section_id: string; section_title: string }>>([]);
  const [positionCases, setPositionCases] = useState<Array<{ case_id: string; case_title: string }>>([]);
  const [selectedPositionSection, setSelectedPositionSection] = useState<string>('');
  const [selectedPositionCase, setSelectedPositionCase] = useState<string>('');
  const [positionData, setPositionData] = useState<PositionData | null>(null);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [showStudentList, setShowStudentList] = useState(false);

  // Case Performance position summary state
  const [showPositionSummary, setShowPositionSummary] = useState(false);

  // Responses tab state
  const [selectedCaseForResponses, setSelectedCaseForResponses] = useState<string | null>(null);
  const [responsesSection, setResponsesSection] = useState<string>('');
  const [responsesCase, setResponsesCase] = useState<string>('');
  const [caseResponses, setCaseResponses] = useState<CaseChatResponse[]>([]);
  const [isLoadingResponses, setIsLoadingResponses] = useState(false);

  // Transcript viewer modal state
  const [selectedTranscript, setSelectedTranscript] = useState<CaseChatResponse | null>(null);
  const [editingPosition, setEditingPosition] = useState<string>('');
  const [isInferringPosition, setIsInferringPosition] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all required data
      const [sectionsRes, studentsRes, evaluationsRes, casesRes] = await Promise.all([
        api.from('sections').select('section_id, section_title, year_term, enabled'),
        api.from('students').select('id, section_id, finished_at'),
        api.from('evaluations').select('id, student_id, case_id, score, hints, helpful, created_at'),
        api.from('cases').select('case_id, case_title, enabled')
      ]);

      const sections = (sectionsRes.data as any[]) || [];
      const students = (studentsRes.data as any[]) || [];
      const evaluations = (evaluationsRes.data as any[]) || [];
      const cases = (casesRes.data as any[]) || [];

      // Filter evaluations by date range
      const now = new Date();
      let filteredEvaluations = evaluations;
      if (dateRange !== 'all') {
        const daysAgo = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        filteredEvaluations = evaluations.filter(e => new Date(e.created_at) >= cutoffDate);
      }

      // Calculate section performance
      const sectionPerf: SectionPerformance[] = sections
        .filter(s => s.enabled)
        .map(section => {
          const sectionStudents = students.filter(s => s.section_id === section.section_id);
          const studentIds = new Set(sectionStudents.map(s => s.id));
          const sectionEvals = filteredEvaluations.filter(e => studentIds.has(e.student_id));

          const scores = sectionEvals.filter(e => e.score !== null).map(e => e.score);
          const hints = sectionEvals.filter(e => e.hints !== null).map(e => e.hints);
          const helpful = sectionEvals.filter(e => e.helpful !== null).map(e => e.helpful);

          return {
            section_id: section.section_id,
            section_title: section.section_title,
            year_term: section.year_term,
            total_students: sectionStudents.length,
            completed: sectionEvals.length,
            avg_score: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            avg_hints: hints.length > 0 ? hints.reduce((a, b) => a + b, 0) / hints.length : null,
            avg_helpful: helpful.length > 0 ? helpful.reduce((a, b) => a + b, 0) / helpful.length : null,
            completion_rate: sectionStudents.length > 0 ? (sectionEvals.length / sectionStudents.length) * 100 : 0
          };
        })
        .sort((a, b) => b.completion_rate - a.completion_rate);

      setSectionPerformance(sectionPerf);

      // Calculate case performance
      const casePerf: CasePerformance[] = cases
        .filter(c => c.enabled)
        .map(caseItem => {
          const caseEvals = filteredEvaluations.filter(e => e.case_id === caseItem.case_id);
          const scores = caseEvals.filter(e => e.score !== null).map(e => e.score);
          const hints = caseEvals.filter(e => e.hints !== null).map(e => e.hints);
          const uniqueStudents = new Set(caseEvals.map(e => e.student_id)).size;

          return {
            case_id: caseItem.case_id,
            case_title: caseItem.case_title,
            total_attempts: caseEvals.length,
            avg_score: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            avg_hints: hints.length > 0 ? hints.reduce((a, b) => a + b, 0) / hints.length : null,
            completion_rate: uniqueStudents > 0 ? 100 : 0
          };
        })
        .filter(c => c.total_attempts > 0)
        .sort((a, b) => b.total_attempts - a.total_attempts);

      setCasePerformance(casePerf);

      // Calculate overall stats
      const allScores = filteredEvaluations.filter(e => e.score !== null).map(e => e.score);
      const allHints = filteredEvaluations.filter(e => e.hints !== null).map(e => e.hints);
      const allHelpful = filteredEvaluations.filter(e => e.helpful !== null).map(e => e.helpful);

      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const completionsThisWeek = evaluations.filter(e => new Date(e.created_at) >= weekAgo).length;
      const completionsLastWeek = evaluations.filter(e => {
        const date = new Date(e.created_at);
        return date >= twoWeeksAgo && date < weekAgo;
      }).length;

      setOverallStats({
        totalSections: sections.filter(s => s.enabled).length,
        totalStudents: students.length,
        totalCompletions: filteredEvaluations.length,
        overallAvgScore: allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null,
        overallAvgHints: allHints.length > 0 ? allHints.reduce((a, b) => a + b, 0) / allHints.length : null,
        overallAvgHelpful: allHelpful.length > 0 ? allHelpful.reduce((a, b) => a + b, 0) / allHelpful.length : null,
        completionRate: students.length > 0 ? (new Set(evaluations.map(e => e.student_id)).size / students.length) * 100 : 0,
        completionsThisWeek,
        completionsLastWeek
      });

      // Calculate score distribution
      const scoreCounts = new Map<number, number>();
      for (let i = 0; i <= 15; i++) {
        scoreCounts.set(i, 0);
      }
      filteredEvaluations.forEach(e => {
        if (e.score !== null) {
          const score = Math.round(e.score);
          scoreCounts.set(score, (scoreCounts.get(score) || 0) + 1);
        }
      });
      setScoreDistribution(
        Array.from(scoreCounts.entries())
          .map(([score, count]) => ({ score, count }))
          .sort((a, b) => a.score - b.score)
      );

    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Fetch sections and cases for position filters when switching to positions or responses tab
  useEffect(() => {
    if ((activeView === 'positions' || activeView === 'responses') && positionSections.length === 0) {
      const fetchPositionFilters = async () => {
        try {
          const [sectionsRes, casesRes] = await Promise.all([
            api.from('sections').select('section_id, section_title, enabled'),
            api.from('cases').select('case_id, case_title, enabled')
          ]);
          setPositionSections(((sectionsRes.data as any[]) || []).filter(s => s.enabled));
          setPositionCases(((casesRes.data as any[]) || []).filter(c => c.enabled));
        } catch (error) {
          console.error('Failed to fetch position filters:', error);
        }
      };
      fetchPositionFilters();
    }
  }, [activeView, positionSections.length]);

  // Fetch position data when section and case are selected
  const fetchPositionData = useCallback(async () => {
    if (!selectedPositionSection || !selectedPositionCase) {
      setPositionData(null);
      return;
    }
    setIsLoadingPositions(true);
    try {
      const response = await api.get(`/case-chats/analytics/positions?section_id=${selectedPositionSection}&case_id=${selectedPositionCase}`);
      if (response.data) {
        setPositionData(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch position data:', error);
      setPositionData(null);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [selectedPositionSection, selectedPositionCase]);

  useEffect(() => {
    if (activeView === 'positions' && selectedPositionSection && selectedPositionCase) {
      fetchPositionData();
    }
  }, [activeView, selectedPositionSection, selectedPositionCase, fetchPositionData]);

  // Fetch position summaries when showPositionSummary is enabled
  useEffect(() => {
    if (showPositionSummary && casePerformance.length > 0) {
      const fetchPositionSummaries = async () => {
        try {
          const response = await api.get('/case-chats/position-summaries');
          if (response.data) {
            // Update casePerformance with position summaries
            setCasePerformance(prev =>
              prev.map(c => ({
                ...c,
                position_summary: response.data[c.case_id] || 'no positions tracked'
              }))
            );
          }
        } catch (error) {
          console.error('Failed to fetch position summaries:', error);
        }
      };
      fetchPositionSummaries();
    }
  }, [showPositionSummary, casePerformance.length]);

  // Fetch case responses for Responses tab
  useEffect(() => {
    if (activeView === 'responses' && responsesCase) {
      const fetchResponses = async () => {
        console.log(`[Analytics] Fetching responses for case_id="${responsesCase}", section_id="${responsesSection || 'all'}"`);
        setIsLoadingResponses(true);
        try {
          const params = new URLSearchParams({ case_id: responsesCase });
          if (responsesSection) {
            params.append('section_id', responsesSection);
          }
          console.log(`[Analytics] API call: /case-chats/responses?${params.toString()}`);
          const response = await api.get(`/case-chats/responses?${params.toString()}`);
          console.log(`[Analytics] API response:`, response);
          console.log(`[Analytics] Response data:`, response.data);
          console.log(`[Analytics] Response data length:`, response.data?.length);
          if (response.data) {
            setCaseResponses(response.data);
            console.log(`[Analytics] Set caseResponses to ${response.data.length} items`);
          }
        } catch (error) {
          console.error('[Analytics] Failed to fetch case responses:', error);
          setCaseResponses([]);
        } finally {
          setIsLoadingResponses(false);
        }
      };
      fetchResponses();
    }
  }, [activeView, responsesCase, responsesSection]);

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-400';
    if (score >= 12) return 'text-green-600';
    if (score >= 9) return 'text-blue-600';
    if (score >= 6) return 'text-amber-600';
    return 'text-red-600';
  };

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) {
      return (
        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      );
    } else if (current < previous) {
      return (
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    }
    return <span className="w-4 h-4 text-gray-400">-</span>;
  };

  const maxScoreCount = Math.max(...scoreDistribution.map(s => s.count), 1);

  const handleExportCSV = () => {
    const rows = [
      ['Section', 'Year/Term', 'Students', 'Completed', 'Avg Score', 'Avg Hints', 'Completion Rate'].join(',')
    ];
    sectionPerformance.forEach(s => {
      rows.push([
        `"${s.section_title}"`,
        s.year_term,
        s.total_students,
        s.completed,
        s.avg_score?.toFixed(1) || '',
        s.avg_hints?.toFixed(1) || '',
        `${s.completion_rate.toFixed(1)}%`
      ].join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
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
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics & Reports</h2>
          <p className="text-sm text-gray-500 mt-1">Performance insights across your courses</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Range Selector */}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {(['overview', 'sections', 'cases', 'positions', 'responses'] as const).map(view => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeView === view
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {view.charAt(0).toUpperCase() + view.slice(1)}
          </button>
        ))}
      </div>

      {activeView === 'overview' && overallStats && (
        <>
          {/* Overall Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Total Completions</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold text-gray-900">{overallStats.totalCompletions}</p>
                <div className="flex items-center">
                  {getTrendIcon(overallStats.completionsThisWeek, overallStats.completionsLastWeek)}
                  <span className="text-xs text-gray-500 ml-1">
                    {overallStats.completionsThisWeek} this week
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Score</p>
              <p className={`text-3xl font-bold ${getScoreColor(overallStats.overallAvgScore)}`}>
                {overallStats.overallAvgScore?.toFixed(1) || '-'}
                <span className="text-lg text-gray-400">/15</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Hints Used</p>
              <p className="text-3xl font-bold text-gray-900">
                {overallStats.overallAvgHints?.toFixed(1) || '-'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Completion Rate</p>
              <p className="text-3xl font-bold text-blue-600">
                {overallStats.completionRate.toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h3>
            <div className="flex items-end gap-1 h-40">
              {scoreDistribution.map(({ score, count }) => (
                <div key={score} className="flex-1 flex flex-col items-center">
                  <div
                    className={`w-full rounded-t transition-all ${
                      score >= 12 ? 'bg-green-500' :
                      score >= 9 ? 'bg-blue-500' :
                      score >= 6 ? 'bg-amber-500' :
                      'bg-red-500'
                    }`}
                    style={{ height: `${(count / maxScoreCount) * 100}%`, minHeight: count > 0 ? '4px' : '0' }}
                    title={`Score ${score}: ${count} students`}
                  ></div>
                  <span className="text-xs text-gray-500 mt-1">{score}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>Low</span>
              <span>Score (out of 15)</span>
              <span>High</span>
            </div>
          </div>

          {/* Top Performing Sections */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Section Performance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Section</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Students</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Completed</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Score</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Hints</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Completion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sectionPerformance.slice(0, 10).map(section => (
                    <tr key={section.section_id} className="hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{section.section_title}</p>
                          <p className="text-xs text-gray-500">{section.year_term}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">{section.total_students}</td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">{section.completed}</td>
                      <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(section.avg_score)}`}>
                        {section.avg_score?.toFixed(1) || '-'}
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">
                        {section.avg_hints?.toFixed(1) || '-'}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-20">
                            <div
                              className="bg-green-500 h-2 rounded-full"
                              style={{ width: `${section.completion_rate}%` }}
                            ></div>
                          </div>
                          <span className="text-sm text-gray-600">{section.completion_rate.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeView === 'sections' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">All Sections Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Section</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Students</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Completed</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Score</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Hints</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Helpful</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sectionPerformance.map(section => (
                  <tr
                    key={section.section_id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onNavigate?.('courses', section.section_id)}
                  >
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{section.section_title}</p>
                        <p className="text-xs text-gray-500">{section.year_term}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center text-sm text-gray-900">{section.total_students}</td>
                    <td className="px-5 py-4 text-center text-sm text-gray-900">{section.completed}</td>
                    <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(section.avg_score)}`}>
                      {section.avg_score?.toFixed(1) || '-'}
                    </td>
                    <td className="px-5 py-4 text-center text-sm text-gray-900">
                      {section.avg_hints?.toFixed(1) || '-'}
                    </td>
                    <td className="px-5 py-4 text-center text-sm text-gray-900">
                      {section.avg_helpful?.toFixed(1) || '-'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-20">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{ width: `${section.completion_rate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm text-gray-600">{section.completion_rate.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === 'cases' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Case Performance</h3>
                <p className="text-sm text-gray-500 mt-1">Performance metrics by case</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPositionSummary}
                  onChange={(e) => setShowPositionSummary(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Display position summary</span>
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Case</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Attempts</th>
                  {showPositionSummary && (
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Positions</th>
                  )}
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Score</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Avg Hints</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Difficulty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {casePerformance.map(caseItem => {
                  // Calculate difficulty based on avg score (inverse)
                  const difficulty = caseItem.avg_score !== null
                    ? caseItem.avg_score >= 12 ? 'Easy' : caseItem.avg_score >= 9 ? 'Medium' : 'Hard'
                    : '-';
                  const difficultyColor = difficulty === 'Easy' ? 'text-green-600 bg-green-50' :
                    difficulty === 'Medium' ? 'text-amber-600 bg-amber-50' :
                    difficulty === 'Hard' ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50';

                  const handleCaseClick = () => {
                    setSelectedCaseForResponses(caseItem.case_id);
                    setResponsesCase(caseItem.case_id);
                    setActiveView('responses');
                  };

                  return (
                    <tr
                      key={caseItem.case_id}
                      onClick={handleCaseClick}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-900">{caseItem.case_title}</p>
                        <p className="text-xs text-gray-500">{caseItem.case_id}</p>
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">{caseItem.total_attempts}</td>
                      {showPositionSummary && (
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {caseItem.position_summary || 'Loading...'}
                        </td>
                      )}
                      <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(caseItem.avg_score)}`}>
                        {caseItem.avg_score?.toFixed(1) || '-'}
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">
                        {caseItem.avg_hints?.toFixed(1) || '-'}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${difficultyColor}`}>
                          {difficulty}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {casePerformance.length === 0 && (
                  <tr>
                    <td colSpan={showPositionSummary ? 6 : 5} className="px-5 py-8 text-center text-gray-500">
                      No case data available for the selected time period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === 'positions' && (
        <div className="space-y-6">
          {/* Section/Case Filters */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Position Distribution</h3>
            <p className="text-sm text-gray-500 mb-4">View student positions (for/against) on case proposals</p>

            <div className="flex flex-wrap gap-4">
              <div className="min-w-48">
                <label className="block text-xs font-medium text-gray-700 mb-1">Section</label>
                <select
                  value={selectedPositionSection}
                  onChange={(e) => setSelectedPositionSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a section...</option>
                  {positionSections.map(s => (
                    <option key={s.section_id} value={s.section_id}>{s.section_title}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-48">
                <label className="block text-xs font-medium text-gray-700 mb-1">Case</label>
                <select
                  value={selectedPositionCase}
                  onChange={(e) => setSelectedPositionCase(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a case...</option>
                  {positionCases.map(c => (
                    <option key={c.case_id} value={c.case_id}>{c.case_title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Position Data Display */}
          {!selectedPositionSection || !selectedPositionCase ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-gray-500">Select a section and case to view position data</p>
            </div>
          ) : isLoadingPositions ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
              <p className="text-gray-500">Loading position data...</p>
            </div>
          ) : positionData && positionData.total_with_positions > 0 ? (
            <>
              {/* Distribution Chart */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h4 className="text-md font-semibold text-gray-800 mb-4">Initial Position Distribution</h4>
                <div className="flex items-end gap-4 h-48">
                  {positionData.initial_distribution.map(({ position, count, percentage }) => (
                    <div key={position} className="flex-1 flex flex-col items-center max-w-32">
                      <div
                        className={`w-full rounded-t transition-all ${
                          position === 'for' ? 'bg-green-500' :
                          position === 'against' ? 'bg-red-500' :
                          'bg-blue-500'
                        }`}
                        style={{ height: `${percentage}%`, minHeight: count > 0 ? '8px' : '0' }}
                      ></div>
                      <div className="text-center mt-2">
                        <span className="text-sm font-medium text-gray-900 capitalize">{position}</span>
                        <p className="text-xs text-gray-500">{count} ({percentage}%)</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-4 text-center">
                  Total: {positionData.total_with_positions} students with position data
                </p>
              </div>

              {/* Position Changes Card */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h4 className="text-md font-semibold text-gray-800 mb-4">Position Changes</h4>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-3xl font-bold text-green-600">{positionData.position_changes.unchanged}</p>
                    <p className="text-sm text-gray-600">Unchanged</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-lg">
                    <p className="text-3xl font-bold text-amber-600">{positionData.position_changes.changed}</p>
                    <p className="text-sm text-gray-600">Changed Position</p>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-3xl font-bold text-blue-600">{positionData.position_changes.change_rate}%</p>
                    <p className="text-sm text-gray-600">Change Rate</p>
                  </div>
                </div>
              </div>

              {/* Students by Position (collapsible) */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => setShowStudentList(!showStudentList)}
                  className="w-full p-4 flex justify-between items-center hover:bg-gray-50"
                >
                  <h4 className="text-md font-semibold text-gray-800">Students by Position</h4>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${showStudentList ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showStudentList && (
                  <div className="border-t border-gray-200">
                    {Object.entries(positionData.students_by_position).map(([position, students]) => (
                      <div key={position} className="p-4 border-b last:border-b-0">
                        <h5 className={`font-medium mb-2 capitalize ${
                          position === 'for' ? 'text-green-700' :
                          position === 'against' ? 'text-red-700' :
                          'text-blue-700'
                        }`}>
                          {position} ({students.length})
                        </h5>
                        <div className="flex flex-wrap gap-2">
                          {students.map((s) => (
                            <span
                              key={s.id}
                              className={`px-2 py-1 text-sm rounded ${
                                s.changed ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {s.name || 'Unknown'}
                              {s.changed && s.final_position && (
                                <span className="text-amber-600 ml-1">→ {s.final_position}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-gray-500">No position data available for this section and case</p>
              <p className="text-xs text-gray-400 mt-2">Position tracking may not be enabled for this assignment</p>
            </div>
          )}
        </div>
      )}

      {/* Responses Tab */}
      {activeView === 'responses' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Case Chat Responses</h3>
            <p className="text-sm text-gray-500 mb-4">View student responses and positions for a specific case</p>

            <div className="flex flex-wrap gap-4">
              <div className="min-w-48">
                <label className="block text-xs font-medium text-gray-700 mb-1">Section (optional)</label>
                <select
                  value={responsesSection}
                  onChange={(e) => setResponsesSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All sections</option>
                  {positionSections.map(s => (
                    <option key={s.section_id} value={s.section_id}>{s.section_title}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-48">
                <label className="block text-xs font-medium text-gray-700 mb-1">Case</label>
                <select
                  value={responsesCase}
                  onChange={(e) => setResponsesCase(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a case...</option>
                  {positionCases.map(c => (
                    <option key={c.case_id} value={c.case_id}>{c.case_title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Responses Table */}
          {!responsesCase ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-gray-500">Select a case to view student responses</p>
            </div>
          ) : isLoadingResponses ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
              <p className="text-gray-500">Loading responses...</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Student</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Section</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Position</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Transcript</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {caseResponses.map(response => (
                      <tr key={response.id} className="hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{response.student_name || 'Unknown'}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600">
                          {response.section_title || '-'}
                        </td>
                        <td className="px-5 py-4">
                          {response.final_position || response.initial_position ? (
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                              {response.final_position || response.initial_position}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">no position recorded</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {response.transcript ? (
                            <button
                              onClick={() => {
                                setSelectedTranscript(response);
                                setEditingPosition(response.final_position || response.initial_position || '');
                              }}
                              className="px-3 py-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                            >
                              View Transcript
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">no transcript</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {caseResponses.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-gray-500">
                          No completed chats found for this case
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transcript Viewer Modal */}
      {selectedTranscript && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Chat Transcript</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedTranscript.student_name} - {selectedTranscript.section_title}
                </p>
              </div>
              <button
                onClick={() => setSelectedTranscript(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Position Selection */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                <input
                  type="text"
                  value={editingPosition}
                  onChange={(e) => setEditingPosition(e.target.value)}
                  placeholder="Enter position (e.g., for, against)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={async () => {
                      if (!editingPosition.trim()) {
                        alert('Please enter a position');
                        return;
                      }
                      try {
                        await api.patch(`/case-chats/${selectedTranscript.id}/update-position`, {
                          position: editingPosition.trim()
                        });
                        alert('Position updated successfully');
                        // Refresh responses
                        const params = new URLSearchParams({ case_id: responsesCase });
                        if (responsesSection) {
                          params.append('section_id', responsesSection);
                        }
                        const response = await api.get(`/case-chats/responses?${params.toString()}`);
                        if (response.data) {
                          setCaseResponses(response.data);
                        }
                        setSelectedTranscript(null);
                      } catch (error) {
                        console.error('Failed to update position:', error);
                        alert('Failed to update position');
                      }
                    }}
                    disabled={isInferringPosition}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                  >
                    Record
                  </button>
                  <button
                    onClick={async () => {
                      setIsInferringPosition(true);
                      try {
                        const response = await api.post(`/case-chats/${selectedTranscript.id}/infer-position`);
                        if (response.data && response.data.position) {
                          setEditingPosition(response.data.position);
                          alert(`AI inferred position: ${response.data.position} (confidence: ${response.data.confidence.toFixed(2)})\n\nReasoning: ${response.data.reasoning}`);
                        }
                      } catch (error: any) {
                        console.error('Failed to infer position:', error);
                        alert(error.response?.data?.error?.message || 'Failed to infer position');
                      } finally {
                        setIsInferringPosition(false);
                      }
                    }}
                    disabled={isInferringPosition}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg disabled:opacity-50"
                  >
                    {isInferringPosition ? 'Analyzing...' : 'AI Set Position'}
                  </button>
                  <button
                    onClick={() => setSelectedTranscript(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Transcript Content */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Transcript</h4>
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
                    {selectedTranscript.transcript || 'No transcript available'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
