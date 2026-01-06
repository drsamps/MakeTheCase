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

const Analytics: React.FC<AnalyticsProps> = ({ onNavigate }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'overview' | 'sections' | 'cases' | 'trends'>('overview');
  const [sectionPerformance, setSectionPerformance] = useState<SectionPerformance[]>([]);
  const [casePerformance, setCasePerformance] = useState<CasePerformance[]>([]);
  const [overallStats, setOverallStats] = useState<OverallStats | null>(null);
  const [scoreDistribution, setScoreDistribution] = useState<ScoreDistribution[]>([]);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

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
        {(['overview', 'sections', 'cases'] as const).map(view => (
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
            <h3 className="text-lg font-semibold text-gray-900">Case Performance</h3>
            <p className="text-sm text-gray-500 mt-1">Performance metrics by case</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Case</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Attempts</th>
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

                  return (
                    <tr key={caseItem.case_id} className="hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-900">{caseItem.case_title}</p>
                        <p className="text-xs text-gray-500">{caseItem.case_id}</p>
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-gray-900">{caseItem.total_attempts}</td>
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
                    <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                      No case data available for the selected time period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
