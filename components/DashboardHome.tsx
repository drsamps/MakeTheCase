import React, { useState, useEffect, useCallback } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient';
import { AdminUser } from '../types';

interface DashboardHomeProps {
  user: AdminUser | null | undefined;
  onNavigate: (section: string, subTab?: string, options?: { section_id?: string; case_id?: string }) => void;
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
  score?: number;
}

interface ActiveSession {
  section_id: string;
  section_title: string;
  year_term: string;
  case_id: string;
  case_title: string;
  open_date: string | null;
  close_date: string | null;
  manual_status: 'auto' | 'manually_opened' | 'manually_closed';
  is_open: boolean;
  time_remaining_minutes: number | null;
  opens_in_minutes: number | null;
  students: {
    total: number;
    completed: number;
    in_progress: number;
    not_started: number;
    abandoned: number;
  };
}

const DashboardHome: React.FC<DashboardHomeProps> = ({ user, onNavigate }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sections, setSections] = useState<SectionOverview[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [stats, setStats] = useState({
    activeSections: 0,
    totalStudents: 0,
    completedToday: 0,
    activeChats: 0,
    abandonedChats: 0,
    casesOpenNow: 0
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

      // Fetch section_cases for each enabled section (the API is per-section)
      const enabledSectionsList = (sectionsData as any[] || []).filter(s => s.enabled);
      const sectionCasesPromises = enabledSectionsList.map(async (section) => {
        const { data } = await api.from(`sections/${section.section_id}/cases`).select('*');
        return (data as any[] || []).map(sc => ({
          ...sc,
          section_id: section.section_id  // Ensure section_id is included
        }));
      });
      const sectionCasesArrays = await Promise.all(sectionCasesPromises);
      const sectionCasesData = sectionCasesArrays.flat();

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

      // Build active sessions from section_cases
      const now = new Date();
      const sessions: ActiveSession[] = [];
      const enabledSectionIds = new Set(sectionOverviews.map(s => s.section_id));

      for (const sc of (sectionCasesData as any[] || [])) {
        // Only include active assignments from enabled sections
        if (!sc.active || !enabledSectionIds.has(sc.section_id)) continue;

        const section = sectionOverviews.find(s => s.section_id === sc.section_id);
        if (!section) continue;

        // Calculate availability status
        const openDate = sc.open_date ? new Date(sc.open_date) : null;
        const closeDate = sc.close_date ? new Date(sc.close_date) : null;

        let isOpen = false;
        let timeRemainingMinutes: number | null = null;
        let opensInMinutes: number | null = null;

        if (sc.manual_status === 'manually_closed') {
          isOpen = false;
        } else if (sc.manual_status === 'manually_opened') {
          isOpen = true;
          if (closeDate && closeDate > now) {
            timeRemainingMinutes = Math.round((closeDate.getTime() - now.getTime()) / 60000);
          }
        } else {
          // auto mode - check dates
          const afterOpen = !openDate || openDate <= now;
          const beforeClose = !closeDate || closeDate > now;
          isOpen = afterOpen && beforeClose;

          if (!afterOpen && openDate) {
            opensInMinutes = Math.round((openDate.getTime() - now.getTime()) / 60000);
          }
          if (isOpen && closeDate) {
            timeRemainingMinutes = Math.round((closeDate.getTime() - now.getTime()) / 60000);
          }
        }

        // Count students by status for this specific case
        const sectionStudentIds = (studentsData as any[] || [])
          .filter(s => s.section_id === sc.section_id)
          .map(s => s.id);

        const caseChats = (chatsData as any[] || []).filter(c =>
          c.case_id === sc.case_id && sectionStudentIds.includes(c.student_id)
        );

        const completedForCase = caseChats.filter(c => c.status === 'completed').length;
        const inProgressForCase = caseChats.filter(c => ['started', 'in_progress'].includes(c.status)).length;
        const abandonedForCase = caseChats.filter(c => c.status === 'abandoned').length;
        const totalStudentsInSection = sectionStudentIds.length;
        const notStartedForCase = totalStudentsInSection - completedForCase - inProgressForCase - abandonedForCase;

        sessions.push({
          section_id: sc.section_id,
          section_title: section.section_title,
          year_term: section.year_term,
          case_id: sc.case_id,
          case_title: sc.case_title || 'Unknown Case',
          open_date: sc.open_date,
          close_date: sc.close_date,
          manual_status: sc.manual_status || 'auto',
          is_open: isOpen,
          time_remaining_minutes: timeRemainingMinutes,
          opens_in_minutes: opensInMinutes,
          students: {
            total: totalStudentsInSection,
            completed: completedForCase,
            in_progress: inProgressForCase,
            not_started: Math.max(0, notStartedForCase),
            abandoned: abandonedForCase
          }
        });
      }

      // Sort by year_term (descending), then section_title, then by closing time
      sessions.sort((a, b) => {
        // First by year_term (descending - most recent first)
        if (a.year_term !== b.year_term) {
          return b.year_term.localeCompare(a.year_term);
        }
        // Then by section title
        if (a.section_title !== b.section_title) {
          return a.section_title.localeCompare(b.section_title);
        }
        // Then open sessions before closed
        if (a.is_open && !b.is_open) return -1;
        if (!a.is_open && b.is_open) return 1;
        // Then by closing time (sooner first)
        return (a.time_remaining_minutes || Infinity) - (b.time_remaining_minutes || Infinity);
      });

      setActiveSessions(sessions);

      // Calculate overall stats
      const enabledSections = sectionOverviews.length;
      const totalStudents = sectionOverviews.reduce((sum, s) => sum + s.total_students, 0);
      const casesOpenNow = sessions.filter(s => s.is_open).length;

      // Completions today (changed from week)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const completedToday = (evaluationsData as any[] || []).filter(e =>
        new Date(e.created_at) >= todayStart
      ).length;

      setStats({
        activeSections: enabledSections,
        totalStudents,
        completedToday,
        activeChats: totalActiveChats,
        abandonedChats: abandonedChatsCount,
        casesOpenNow
      });

      // Generate alerts
      const newAlerts: Alert[] = [];

      // Cases closing soon (within 2 hours)
      const closingSoonSessions = sessions.filter(s =>
        s.is_open && s.time_remaining_minutes !== null && s.time_remaining_minutes <= 120
      );
      for (const session of closingSoonSessions) {
        const timeText = session.time_remaining_minutes! < 60
          ? `${session.time_remaining_minutes}m`
          : `${Math.floor(session.time_remaining_minutes! / 60)}h ${session.time_remaining_minutes! % 60}m`;
        newAlerts.push({
          id: `closing-soon-${session.section_id}-${session.case_id}`,
          type: 'warning',
          message: `${session.case_title} for ${session.section_title} closes in ${timeText}`,
          action: 'monitor',
          actionLabel: 'Monitor',
          data: { section_id: session.section_id, case_id: session.case_id }
        });
      }

      // Students not started warning (>50% not started, case closes in < 4 hours)
      const notStartedAlerts = sessions.filter(s =>
        s.is_open &&
        s.time_remaining_minutes !== null &&
        s.time_remaining_minutes <= 240 &&
        s.students.total > 0 &&
        (s.students.not_started / s.students.total) > 0.5
      );
      for (const session of notStartedAlerts) {
        // Don't duplicate if already in closing soon
        if (!closingSoonSessions.some(cs => cs.section_id === session.section_id && cs.case_id === session.case_id)) {
          newAlerts.push({
            id: `not-started-${session.section_id}-${session.case_id}`,
            type: 'info',
            message: `${session.students.not_started}/${session.students.total} students haven't started ${session.case_title}`,
            action: 'monitor',
            actionLabel: 'View',
            data: { section_id: session.section_id, case_id: session.case_id }
          });
        }
      }

      // Stuck students (in_progress with no activity for 30+ min)
      const stuckChats = (chatsData as any[] || []).filter(c => {
        if (!['started', 'in_progress'].includes(c.status)) return false;
        const lastActivity = c.last_activity ? new Date(c.last_activity) : new Date(c.start_time);
        const minutesInactive = (now.getTime() - lastActivity.getTime()) / 60000;
        return minutesInactive >= 30;
      });
      if (stuckChats.length > 0) {
        newAlerts.push({
          id: 'stuck-students',
          type: 'info',
          message: `${stuckChats.length} student${stuckChats.length > 1 ? 's' : ''} inactive for 30+ minutes`,
          action: 'monitor',
          actionLabel: 'View'
        });
      }

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

      setAlerts(newAlerts);

      // Generate recent activity from evaluations and chats
      const activities: RecentActivity[] = [];

      // Recent completions (with scores)
      const recentEvals = (evaluationsData as any[] || [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);

      for (const evalRecord of recentEvals) {
        const student = (studentsData as any[] || []).find(s => s.id === evalRecord.student_id);
        if (student) {
          const section = (sectionsData as any[] || []).find(s => s.section_id === student.section_id);
          // Find the case from the chat record if available
          const chatRecord = (chatsData as any[] || []).find(c => c.student_id === evalRecord.student_id);
          const sectionCase = (sectionCasesData as any[] || []).find(sc =>
            sc.section_id === student.section_id && sc.case_id === chatRecord?.case_id
          );
          activities.push({
            id: `eval-${evalRecord.id}`,
            type: 'completion',
            student_name: student.full_name || 'Unknown Student',
            section_title: section?.section_title || 'Unknown Section',
            case_title: sectionCase?.case_title || section?.active_case_title || 'Unknown Case',
            timestamp: evalRecord.created_at,
            score: evalRecord.score
          });
        }
      }

      // Recent chat starts
      const recentStarts = (chatsData as any[] || [])
        .filter(c => ['started', 'in_progress'].includes(c.status))
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
        .slice(0, 5);

      for (const chat of recentStarts) {
        const student = (studentsData as any[] || []).find(s => s.id === chat.student_id);
        if (student) {
          const section = (sectionsData as any[] || []).find(s => s.section_id === chat.section_id);
          const sectionCase = (sectionCasesData as any[] || []).find(sc =>
            sc.section_id === chat.section_id && sc.case_id === chat.case_id
          );
          activities.push({
            id: `chat-${chat.id}`,
            type: 'start',
            student_name: student.full_name || 'Unknown Student',
            section_title: section?.section_title || 'Unknown Section',
            case_title: sectionCase?.case_title || 'Unknown Case',
            timestamp: chat.start_time
          });
        }
      }

      // Sort all activities by timestamp and take the most recent 8
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setRecentActivity(activities.slice(0, 8));

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch initial data on mount
  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Optional auto-refresh every 30 seconds when enabled
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchDashboardData, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchDashboardData]);

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
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {stats.casesOpenNow > 0 && ` • ${stats.casesOpenNow} case${stats.casesOpenNow > 1 ? 's' : ''} open now`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh (30s)
          </label>
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
      </div>

      {/* Open Chat Assignments */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Open Chat Assignments</h3>
          <button
            onClick={() => onNavigate('assignments')}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            View All
          </button>
        </div>
        {(() => {
          const openSessions = activeSessions.filter(s => s.is_open);
          if (openSessions.length === 0) {
            return (
              <div className="p-6 text-center text-gray-500">
                <p>No open case assignments.</p>
                <button
                  onClick={() => onNavigate('assignments')}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                >
                  Assign a case to a section
                </button>
              </div>
            );
          }

          // Group by year_term
          const groupedByTerm: Record<string, ActiveSession[]> = {};
          for (const session of openSessions) {
            if (!groupedByTerm[session.year_term]) {
              groupedByTerm[session.year_term] = [];
            }
            groupedByTerm[session.year_term].push(session);
          }

          // Sort terms descending (most recent first)
          const sortedTerms = Object.keys(groupedByTerm).sort((a, b) => b.localeCompare(a));

          return (
            <div className="divide-y divide-gray-200">
              {sortedTerms.map(term => (
                <div key={term}>
                  <div className="bg-gray-50 px-5 py-2">
                    <h4 className="text-sm font-semibold text-gray-700">{term}</h4>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {groupedByTerm[term].map(session => {
                      const total = session.students.total;
                      const completedPct = total > 0 ? (session.students.completed / total) * 100 : 0;
                      const inProgressPct = total > 0 ? (session.students.in_progress / total) * 100 : 0;
                      const abandonedPct = total > 0 ? (session.students.abandoned / total) * 100 : 0;

                      let scheduleText = '';
                      if (session.time_remaining_minutes !== null) {
                        const hours = Math.floor(session.time_remaining_minutes / 60);
                        const mins = session.time_remaining_minutes % 60;
                        scheduleText = hours > 0 ? `Closes in ${hours}h ${mins}m` : `Closes in ${mins}m`;
                      }

                      return (
                        <div key={`${session.section_id}-${session.case_id}`} className="px-5 py-3 hover:bg-gray-50">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h5 className="font-medium text-gray-900">{session.section_title}</h5>
                                <span className="text-gray-400">-</span>
                                <span className="text-gray-600">{session.case_title}</span>
                                {scheduleText && (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    session.time_remaining_minutes !== null && session.time_remaining_minutes <= 60
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-green-100 text-green-700'
                                  }`}>
                                    {scheduleText}
                                  </span>
                                )}
                                {!scheduleText && (
                                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                    Open
                                  </span>
                                )}
                              </div>
                              {/* Progress stats */}
                              <div className="mt-2 flex items-center gap-4">
                                <div className="flex-1 max-w-md">
                                  <div className="w-full bg-gray-200 rounded-full h-2 flex overflow-hidden">
                                    <div className="bg-green-500 h-2" style={{ width: `${completedPct}%` }}></div>
                                    <div className="bg-blue-500 h-2" style={{ width: `${inProgressPct}%` }}></div>
                                    {abandonedPct > 0 && (
                                      <div className="bg-amber-500 h-2" style={{ width: `${abandonedPct}%` }}></div>
                                    )}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500 whitespace-nowrap">
                                  <span className="text-green-600">{session.students.completed} done</span>
                                  <span className="mx-1">·</span>
                                  <span className="text-blue-600">{session.students.in_progress} active</span>
                                  <span className="mx-1">·</span>
                                  <span>{session.students.not_started} waiting</span>
                                  {session.students.abandoned > 0 && (
                                    <>
                                      <span className="mx-1">·</span>
                                      <span className="text-amber-600">{session.students.abandoned} abandoned</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => onNavigate('monitor', 'live', { section_id: session.section_id, case_id: session.case_id })}
                              className="ml-4 text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-1 rounded border border-blue-200 hover:border-blue-400"
                            >
                              Monitor
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Active Chats</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{stats.activeChats}</p>
          {stats.abandonedChats > 0 && (
            <p className="text-xs text-amber-600 mt-1">{stats.abandonedChats} abandoned</p>
          )}
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Completed Today</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{stats.completedToday}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Cases Open</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.casesOpenNow}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Students</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalStudents}</p>
        </div>
      </div>

      {/* Needs Attention Section */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Needs Attention ({alerts.length})
          </h3>
          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-amber-200">
                <span className="text-sm text-gray-700">{alert.message}</span>
                {alert.actionLabel && (
                  <button
                    onClick={() => {
                      if (alert.data?.section_id && alert.data?.case_id) {
                        onNavigate('monitor', 'live', { section_id: alert.data.section_id, case_id: alert.data.case_id });
                      } else {
                        onNavigate(alert.action || 'monitor');
                      }
                    }}
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

      {/* Case Assignments Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Case Assignments</h3>
          <button
            onClick={() => onNavigate('assignments')}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            View All
          </button>
        </div>
        {activeSessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No active case assignments.</p>
            <button
              onClick={() => onNavigate('assignments')}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Assign a case to a section
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Section</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Case</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Schedule</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Progress</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSessions.slice(0, 5).map(session => {
                  const total = session.students.total;
                  const completedPct = total > 0 ? Math.round((session.students.completed / total) * 100) : 0;

                  // Status badge
                  let statusText = '';
                  let statusClass = '';
                  if (session.is_open) {
                    statusText = 'Open';
                    statusClass = 'bg-green-100 text-green-700';
                  } else if (session.opens_in_minutes !== null && session.opens_in_minutes > 0) {
                    statusText = 'Scheduled';
                    statusClass = 'bg-blue-100 text-blue-700';
                  } else if (session.manual_status === 'manually_closed') {
                    statusText = 'Closed';
                    statusClass = 'bg-gray-100 text-gray-600';
                  } else {
                    statusText = 'Closed';
                    statusClass = 'bg-gray-100 text-gray-600';
                  }

                  // Schedule text
                  let scheduleText = '';
                  if (session.is_open && session.time_remaining_minutes !== null) {
                    const hours = Math.floor(session.time_remaining_minutes / 60);
                    const mins = session.time_remaining_minutes % 60;
                    scheduleText = hours > 0 ? `Closes in ${hours}h ${mins}m` : `Closes in ${mins}m`;
                  } else if (session.opens_in_minutes !== null && session.opens_in_minutes > 0) {
                    const hours = Math.floor(session.opens_in_minutes / 60);
                    const mins = session.opens_in_minutes % 60;
                    scheduleText = hours > 0 ? `Opens in ${hours}h ${mins}m` : `Opens in ${mins}m`;
                  } else if (session.close_date) {
                    scheduleText = `Ended ${new Date(session.close_date).toLocaleDateString()}`;
                  } else {
                    scheduleText = 'No schedule';
                  }

                  return (
                    <tr key={`${session.section_id}-${session.case_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{session.section_title}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{session.case_title}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusClass}`}>
                          {statusText}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{scheduleText}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${completedPct}%` }}></div>
                          </div>
                          <span className="text-xs text-gray-500">{session.students.completed}/{total}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => session.is_open
                            ? onNavigate('monitor', 'live', { section_id: session.section_id, case_id: session.case_id })
                            : onNavigate('results', session.section_id)
                          }
                          className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                          {session.is_open ? 'Monitor' : 'Results'}
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
                      {activity.type === 'completion' && activity.score !== undefined && (
                        <span className="text-green-600 ml-1">({activity.score}/15)</span>
                      )}
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
