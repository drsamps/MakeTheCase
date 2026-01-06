import React, { useState, useEffect, useCallback } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';
import { AdminUser } from '../types';

interface DashboardHomeProps {
  user: AdminUser | null | undefined;
  onNavigate: (section: string, subTab?: string) => void;
}

interface Alert {
  id: string;
  type: 'warning' | 'info' | 'action';
  message: string;
  action?: string;
  actionLabel?: string;
  data?: any;
}

interface SectionOverview {
  section_id: string;
  section_title: string;
  year_term: string;
  enabled: boolean;
  active_case_id: string | null;
  active_case_title: string | null;
  total_students: number;
  completed_students: number;
  in_progress_students: number;
  active_chats: number;
  avg_score: number | null;
}

interface RecentActivity {
  id: string;
  type: 'completion' | 'start' | 'rechat_request' | 'abandoned';
  student_name: string;
  section_title: string;
  case_title: string;
  timestamp: string;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({ user, onNavigate }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [sections, setSections] = useState<SectionOverview[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [stats, setStats] = useState({
    activeSections: 0,
    totalStudents: 0,
    completedThisWeek: 0,
    activeChats: 0,
    abandonedChats: 0
  });

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch sections with stats
      const { data: sectionsData } = await api
        .from('sections')
        .select('section_id, section_title, year_term, enabled, active_case_id, active_case_title')
        .order('year_term', { ascending: false });

      // Fetch all students
      const { data: studentsData } = await api
        .from('students')
        .select('id, section_id, finished_at');

      // Fetch evaluations for completion stats
      const { data: evaluationsData } = await api
        .from('evaluations')
        .select('id, student_id, score, created_at');

      // Fetch active chats
      const { data: chatsData } = await api
        .from('case-chats')
        .select('id, student_id, section_id, status, case_id, start_time, last_activity');

      // Process sections with stats
      const completedStudentIds = new Set((evaluationsData as any[] || []).map(e => e.student_id));
      const activeChatsMap = new Map<string, number>();
      const abandonedChatsCount = (chatsData as any[] || []).filter(c => c.status === 'abandoned').length;
      const totalActiveChats = (chatsData as any[] || []).filter(c => ['started', 'in_progress'].includes(c.status)).length;

      (chatsData as any[] || []).forEach(chat => {
        if (['started', 'in_progress'].includes(chat.status) && chat.section_id) {
          activeChatsMap.set(chat.section_id, (activeChatsMap.get(chat.section_id) || 0) + 1);
        }
      });

      // Calculate section overviews
      const sectionOverviews: SectionOverview[] = (sectionsData as any[] || [])
        .filter(s => s.enabled)
        .map(section => {
          const sectionStudents = (studentsData as any[] || []).filter(s => s.section_id === section.section_id);
          const completed = sectionStudents.filter(s => completedStudentIds.has(s.id)).length;
          const inProgress = sectionStudents.filter(s => !completedStudentIds.has(s.id) && s.finished_at === null).length;

          // Calculate avg score for this section
          const sectionEvals = (evaluationsData as any[] || []).filter(e =>
            sectionStudents.some(s => s.id === e.student_id)
          );
          const avgScore = sectionEvals.length > 0
            ? sectionEvals.reduce((sum, e) => sum + (e.score || 0), 0) / sectionEvals.length
            : null;

          return {
            section_id: section.section_id,
            section_title: section.section_title,
            year_term: section.year_term,
            enabled: section.enabled,
            active_case_id: section.active_case_id,
            active_case_title: section.active_case_title,
            total_students: sectionStudents.length,
            completed_students: completed,
            in_progress_students: inProgress,
            active_chats: activeChatsMap.get(section.section_id) || 0,
            avg_score: avgScore
          };
        });

      setSections(sectionOverviews);

      // Calculate overall stats
      const enabledSections = sectionOverviews.length;
      const totalStudents = sectionOverviews.reduce((sum, s) => sum + s.total_students, 0);

      // Completions this week
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const completedThisWeek = (evaluationsData as any[] || []).filter(e =>
        new Date(e.created_at) >= weekAgo
      ).length;

      setStats({
        activeSections: enabledSections,
        totalStudents,
        completedThisWeek,
        activeChats: totalActiveChats,
        abandonedChats: abandonedChatsCount
      });

      // Generate alerts
      const newAlerts: Alert[] = [];

      // Abandoned chats alert
      if (abandonedChatsCount > 0) {
        newAlerts.push({
          id: 'abandoned-chats',
          type: 'warning',
          message: `${abandonedChatsCount} chat${abandonedChatsCount > 1 ? 's' : ''} abandoned`,
          action: 'monitor',
          actionLabel: 'View'
        });
      }

      // Rechat requests (evaluations with allow_rechat pending)
      const { data: rechatRequests } = await api
        .from('evaluations')
        .select('id, student_id')
        .eq('allow_rechat', false);

      // Check for sections with upcoming deadlines (would need scheduling data)
      // For now, we'll add a placeholder if there are active cases

      setAlerts(newAlerts);

      // Generate recent activity from evaluations and chats
      const activities: RecentActivity[] = [];

      // Recent completions
      const recentEvals = (evaluationsData as any[] || [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);

      for (const evalRecord of recentEvals) {
        const student = (studentsData as any[] || []).find(s => s.id === evalRecord.student_id);
        if (student) {
          const section = (sectionsData as any[] || []).find(s => s.section_id === student.section_id);
          activities.push({
            id: `eval-${evalRecord.id}`,
            type: 'completion',
            student_name: student.full_name || 'Unknown Student',
            section_title: section?.section_title || 'Unknown Section',
            case_title: section?.active_case_title || 'Unknown Case',
            timestamp: evalRecord.created_at
          });
        }
      }

      setRecentActivity(activities.slice(0, 8));

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const getProgressPercent = (completed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          {/* Skeleton for stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl p-5 border border-gray-200">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div className="h-8 bg-gray-200 rounded w-1/3"></div>
              </div>
            ))}
          </div>
          {/* Skeleton for sections */}
          <div className="bg-white rounded-xl p-5 border border-gray-200">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-gray-100 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back{user?.who ? `, ${user.who.split(' ')[0]}` : ''}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Here's what's happening with your courses
          </p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Active Sections</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{stats.activeSections}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Students</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{stats.totalStudents}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Completed This Week</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{stats.completedThisWeek}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Active Chats</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{stats.activeChats}</p>
          {stats.abandonedChats > 0 && (
            <p className="text-xs text-amber-600 mt-1">{stats.abandonedChats} abandoned</p>
          )}
        </div>
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Alerts ({alerts.length})
          </h3>
          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-amber-200">
                <span className="text-sm text-gray-700">{alert.message}</span>
                {alert.actionLabel && (
                  <button
                    onClick={() => onNavigate(alert.action || 'monitor')}
                    className="text-sm font-medium text-amber-700 hover:text-amber-900"
                  >
                    {alert.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Courses Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">My Courses</h3>
          <button
            onClick={() => onNavigate('courses')}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            View All
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {sections.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No active sections found.</p>
              <button
                onClick={() => onNavigate('courses', 'sections')}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800"
              >
                Create a section
              </button>
            </div>
          ) : (
            sections.slice(0, 5).map(section => (
              <div
                key={section.section_id}
                className="px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => onNavigate('courses', section.section_id)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-medium text-gray-900">{section.section_title}</h4>
                    <p className="text-xs text-gray-500">{section.year_term}</p>
                  </div>
                  <div className="text-right">
                    {section.active_chats > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {section.active_chats} active
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-600">
                    {section.active_case_title || 'No active case'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Progress: {section.completed_students}/{section.total_students} completed</span>
                    <span>{getProgressPercent(section.completed_students, section.total_students)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${getProgressPercent(section.completed_students, section.total_students)}%` }}
                    ></div>
                  </div>
                </div>
                {section.avg_score !== null && (
                  <p className="text-xs text-gray-500 mt-2">
                    Avg Score: {section.avg_score.toFixed(1)}/15
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onNavigate('content', 'new-case')}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-700">New Case</span>
            </button>
            <button
              onClick={() => onNavigate('courses', 'new-section')}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838l-2.727 1.17 1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-700">New Section</span>
            </button>
            <button
              onClick={() => onNavigate('monitor')}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                  <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-700">Monitor Chats</span>
            </button>
            <button
              onClick={() => onNavigate('analytics')}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-700">View Analytics</span>
            </button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map(activity => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 ${
                    activity.type === 'completion' ? 'bg-green-500' :
                    activity.type === 'start' ? 'bg-blue-500' :
                    activity.type === 'abandoned' ? 'bg-amber-500' :
                    'bg-gray-400'
                  }`}></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{activity.student_name}</span>
                      {activity.type === 'completion' && ' completed '}
                      {activity.type === 'start' && ' started '}
                      {activity.type === 'abandoned' && "'s chat was abandoned for "}
                      <span className="text-gray-600">{activity.case_title}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {activity.section_title} • {formatTimeAgo(activity.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardHome;
