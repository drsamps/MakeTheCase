


import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, getApiBaseUrl, getImpersonationId, setImpersonationId } from '../services/apiClient'; // Dashboard with tiles/list view toggle
import { detectProvider } from '../services/llmService';
import { PromptManager } from './PromptManager';
import { SettingsManager } from './SettingsManager';
import { LoggingManager } from './LoggingManager';
import { CasePrepManager } from './CasePrepManager';
import { CaseFilesManager } from './CaseFilesManager';
import { CacheMetrics } from './CacheMetrics';
import AiUsagePanel from './AiUsagePanel';
import AiUsageWarningBanner from './AiUsageWarningBanner';
import { ScenarioManager } from './ScenarioManager';
import InstructorManager from './InstructorManager';
import ShadowOwnershipManager from './ShadowOwnershipManager';
import ApiKeysManager from './ApiKeysManager';
import TeamsManager from './TeamsManager';
import FeedbackMine from './feedback/FeedbackMine';
import FeedbackInbox from './feedback/FeedbackInbox';
import FeedbackSummary from './feedback/FeedbackSummary';
import { useFeedbackEligibility } from '../hooks/useFeedbackEligibility';
import { setCurrentScreen } from '../services/screenContext';
import VisibilityPicker from './ui/VisibilityPicker';
import StudentManager from './StudentManager';
import DashboardHome from './DashboardHome';
import WelcomeScreen from './WelcomeScreen';
import Analytics from './Analytics';
import PositionAnalytics from './PositionAnalytics';
import SectionResultsSummary from './SectionResultsSummary';
import HelpTooltip from './ui/HelpTooltip';
import { ChatOptionsHelp, PersonasHelp } from '../help/dashboard';
import { hasAccess } from '../utils/permissions';
import {
  canDeletePersona,
  canEditPersona,
  canTogglePersonaEnabled,
  formatAllowedPersonas,
  isSystemPersona,
  ownerLabel,
  personaApiErrorMessage,
  personasForDefaultDropdown,
  resolveAllowedPersonasForForm,
  sortPersonasList,
  visibilityLabel,
  type PersonaAccessContext,
  type PersonaRow,
} from '../utils/personas';
import { AdminUser } from '../types';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// New workflow-centric navigation types
type PrimaryTab = 'home' | 'assignments' | 'monitor' | 'results' | 'courses' | 'content' | 'setup' | 'feedback' | 'admin';
type HomeSubTab = 'welcome' | 'dashboard';
type AssignmentsSubTab = 'assignments' | 'chat-options';
type CoursesSubTab = 'semesters' | 'course-setup' | 'sections' | 'students';
type ContentSubTab = 'cases' | 'casefiles' | 'caseprep';
type MonitorSubTab = 'chats' | 'cache' | 'live' | 'ai-usage';
type ResultsSubTab = 'responses' | 'positions' | 'section-results';
type SetupSubTab = 'personas' | 'apikeys' | 'teams' | 'rubrics';
type AdminSubTab = 'instructors' | 'settings' | 'models' | 'prompts' | 'admins' | 'logging' | 'shadow';
type RubricsSubTab = 'criteria' | 'rubrics';
type FeedbackSubTab = 'mine' | 'inbox' | 'summary';

const isEnabledFlag = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

const isDisabledFlag = (value: unknown): boolean =>
  value === false || value === 0 || value === '0' || value === 'false';

interface DashboardProps {
  onLogout: () => void;
  user?: AdminUser | null;
}

interface SectionStat {
  section_id: string;
  section_title: string;
  year_term: string;
  starts: number;
  completions: number;
  inProgress: number;
  chat_model: string | null;
  super_model: string | null;
  enabled?: boolean;
  accept_new_students?: boolean;
  enrollment_key?: string | null;
  active_case_count?: number;
  active_case_titles?: string | null;
  primary_instructor_id?: string | null;
  primary_instructor_name?: string | null;
  course_id?: number | null;
  course_id_num?: number | null;
  course_name?: string | null;
  semester_id?: number | null;
  semester_name?: string | null;
  semester_is_current?: boolean;
  student_count?: number;
}

interface StudentDetail {
  id: string;
  full_name: string;
  persona: string | null;
  completion_time: string | null;
  score: number | null;
  hints: number | null;
  helpful: number | null;
  chat_model: string | null;
  super_model: string | null;
  summary: string | null;
  criteria: any[] | null;
  // transcript removed from evaluation data - now fetched separately from transcripts table
  liked: string | null;
  improve: string | null;
  created_at: string | null;
  status: 'completed' | 'in_progress' | 'not_started';
  case_id: string | null;
  case_title: string | null;
  evaluation_id: string | null;
  case_chat_id: string | null;
  allow_rechat: boolean;
}

interface EvaluationData {
  id: string;
  student_id: string;
  case_id: string | null;
  score: number | null;
  hints: number | null;
  helpful: number | null;
  created_at: string;
  chat_model: string | null;
  super_model: string | null;
  summary: string | null;
  criteria: any[] | null;
  transcript: string | null;
  liked: string | null;
  improve: string | null;
  allow_rechat: boolean;
}

interface Model {
  model_id: string;
  model_name: string;
  vendor?: string;
  enabled: boolean;
  default?: boolean;
  cpm_input?: number | null;
  cpm_input_cache?: number | null;
  cpm_output?: number | null;
  temperature?: number | null;
  reasoning_effort?: string | null;
  release_date?: string | null;
  type?: string | null;
  supported_parameters?: string[] | null;
  default_parameters?: Record<string, unknown> | null;
  parameter_settings?: Record<string, unknown> | null;
  test_date?: string | null;
  test_status?: 'pass' | 'fail' | null;
  test_result?: string | null;
  test_results?: Record<string, unknown> | null;
}

interface Case {
  case_id: string;
  case_title: string;
  case_version?: string | null;
  base_scenario_id?: number | null;
  protagonist?: string | null;
  protagonist_initials?: string | null;
  chat_topic?: string | null;
  chat_question?: string | null;
  enabled: boolean;
  created_at?: string;
  files?: { id: number; filename: string; file_type: string }[];
  scenarios_count?: number;
  scenarios?: { id: number; scenario_name: string; enabled: boolean; sort_order: number }[];
  visibility?: 'private' | 'team' | 'public';
  team_shares?: { team_id: number; access_level?: 'view' | 'edit' }[];
}

interface SectionStats {
  avgScore: number | null;
  avgHints: number | null;
  avgHelpful: number | null;
  completionRate: number;
  totalStudents: number;
  completedStudents: number;
  inProgressStudents: number;
}

type SortKey = 'full_name' | 'persona' | 'score' | 'hints' | 'helpful' | 'completion_time' | 'chat_model' | 'super_model' | 'status';
type SortDirection = 'asc' | 'desc';
type FilterMode = 'all' | 'completed' | 'in_progress' | 'not_started';

// Sortable Position Item for drag-and-drop reordering
interface SortablePositionItemProps {
  position: any;
  sectionId: string;
  caseId: string;
  onToggle: (sectionId: string, caseId: string, positionId: number) => void;
}

const SortablePositionItem: React.FC<SortablePositionItemProps> = ({ position, sectionId, caseId, onToggle }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: position.position_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  const handleToggleClick = () => {
    onToggle(sectionId, caseId, position.position_id);
  };

  const isEnabled = Boolean(position.enabled);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-2 rounded border border-l-4 ${
        isEnabled
          ? 'bg-white border-gray-200 border-l-teal-400'
          : 'bg-gray-100 border-gray-200 border-l-gray-300 opacity-70'
      } ${isDragging ? 'shadow-lg z-10' : ''}`}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600 mr-2"
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm">{position.position_name}</div>
        <p className="text-xs text-gray-500">{position.position}</p>
      </div>
      <button
        type="button"
        onClick={handleToggleClick}
        className={`px-2 py-1 text-xs rounded ${
          isEnabled
            ? 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
            : 'bg-gray-200 text-gray-600 border border-gray-300 hover:bg-gray-300'
        }`}
        title={isEnabled
          ? 'This position is available for student selection, click to disable'
          : 'Not available for this assignment, click to make available'}
      >
        {isEnabled ? 'Available' : 'Disabled ⓘ'}
      </button>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  // New workflow-centric navigation state
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('home');
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>('welcome');
  const [assignmentsSubTab, setAssignmentsSubTab] = useState<AssignmentsSubTab>('assignments');
  const [coursesSubTab, setCoursesSubTab] = useState<CoursesSubTab>('sections');
  const [contentSubTab, setContentSubTab] = useState<ContentSubTab>('cases');
  const [monitorSubTab, setMonitorSubTab] = useState<MonitorSubTab>('chats');
  const [resultsSubTab, setResultsSubTab] = useState<ResultsSubTab>('responses');
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('instructors');
  const [setupSubTab, setSetupSubTab] = useState<SetupSubTab>('personas');
  const [rubricsSubTab, setRubricsSubTab] = useState<RubricsSubTab>('rubrics');
  const [feedbackSubTab, setFeedbackSubTab] = useState<FeedbackSubTab>('mine');
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState<number>(0);
  const { eligibility: feedbackEligibility } = useFeedbackEligibility(user?.id || null);

  const refreshFeedbackUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const token = localStorage.getItem('admin_auth_token') || localStorage.getItem('student_auth_token');
      if (!token) return;
      const response = await fetch(`${getApiBaseUrl()}/feedback/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      setFeedbackUnreadCount(typeof data?.count === 'number' ? data.count : 0);
    } catch {
      /* no-op */
    }
  }, [user?.id]);

  useEffect(() => {
    refreshFeedbackUnreadCount();
  }, [refreshFeedbackUnreadCount, primaryTab]);

  useEffect(() => {
    const PRIMARY_LABELS: Record<PrimaryTab, string> = {
      home: 'Home',
      assignments: 'Assignments',
      monitor: 'Monitor',
      results: 'Results',
      courses: 'Courses',
      content: 'Content',
      setup: 'Setup',
      feedback: 'Feedback',
      admin: 'Admin',
    };
    const HOME: Record<HomeSubTab, string> = {
      welcome: 'Welcome', dashboard: 'Dashboard',
    };
    const ASSIGNMENTS: Record<AssignmentsSubTab, string> = {
      assignments: 'Assignments', 'chat-options': 'Chat Options',
    };
    const MONITOR: Record<MonitorSubTab, string> = { chats: 'Chats', cache: 'Cache', live: 'Live', 'ai-usage': 'AI Usage' };
    const RESULTS: Record<ResultsSubTab, string> = {
      responses: 'Student Results', positions: 'Position Analytics', 'section-results': 'Section Results',
    };
    const COURSES: Record<CoursesSubTab, string> = {
      semesters: 'Semesters', 'course-setup': 'Course Setup', sections: 'Sections', students: 'Students',
    };
    const CONTENT: Record<ContentSubTab, string> = {
      cases: 'Cases', casefiles: 'Case Files', caseprep: 'Case Prep',
    };
    const SETUP: Record<SetupSubTab, string> = {
      personas: 'Personas', apikeys: 'API Keys', teams: 'Teams', rubrics: 'Rubrics',
    };
    const RUBRICS_SUB: Record<RubricsSubTab, string> = { rubrics: 'Rubrics', criteria: 'Criteria Library' };
    const FEEDBACK: Record<FeedbackSubTab, string> = {
      mine: 'My Feedback', inbox: 'Inbox', summary: 'Summary',
    };
    const ADMIN: Record<AdminSubTab, string> = {
      instructors: 'Instructors', settings: 'Settings', models: 'Models', prompts: 'Prompts',
      admins: 'Admins', logging: 'Logging', shadow: 'Shadow-Owned',
    };

    const parts: string[] = ['Instructor Dashboard', PRIMARY_LABELS[primaryTab]];
    if (primaryTab === 'home') parts.push(HOME[homeSubTab]);
    else if (primaryTab === 'assignments') parts.push(ASSIGNMENTS[assignmentsSubTab]);
    else if (primaryTab === 'monitor') parts.push(MONITOR[monitorSubTab]);
    else if (primaryTab === 'results') parts.push(RESULTS[resultsSubTab]);
    else if (primaryTab === 'courses') parts.push(COURSES[coursesSubTab]);
    else if (primaryTab === 'content') parts.push(CONTENT[contentSubTab]);
    else if (primaryTab === 'setup') {
      parts.push(SETUP[setupSubTab]);
      if (setupSubTab === 'rubrics') parts.push(RUBRICS_SUB[rubricsSubTab]);
    } else if (primaryTab === 'feedback') parts.push(FEEDBACK[feedbackSubTab]);
    else if (primaryTab === 'admin') parts.push(ADMIN[adminSubTab]);

    setCurrentScreen(parts.join(' > '));
    return () => setCurrentScreen(null);
  }, [
    primaryTab, homeSubTab, assignmentsSubTab, monitorSubTab, resultsSubTab, coursesSubTab,
    contentSubTab, setupSubTab, rubricsSubTab, feedbackSubTab, adminSubTab,
  ]);

  // Rubrics state
  const [rubricsList, setRubricsList] = useState<any[]>([]);
  const [criteriaList, setCriteriaList] = useState<any[]>([]);
  const [isLoadingRubrics, setIsLoadingRubrics] = useState(false);

  // Criteria modal state
  const [showCriterionModal, setShowCriterionModal] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState<any>(null);
  const [criterionForm, setCriterionForm] = useState({
    criteria_id: '',
    name: '',
    question_text: '',
    max_points: 5,
    scoring_guide: {} as Record<string, string>,
  });
  const [isSavingCriterion, setIsSavingCriterion] = useState(false);

  // Rubric modal state
  const [showRubricModal, setShowRubricModal] = useState(false);
  const [editingRubric, setEditingRubric] = useState<any>(null);
  const [rubricForm, setRubricForm] = useState<{
    rubric_name: string;
    description: string;
    criteria_ids: string[];
    additional_prompt: string;
    visibility: 'private' | 'team' | 'public';
    team_shares: { team_id: number; access_level?: 'view' | 'edit' }[];
  }>({
    rubric_name: '',
    description: '',
    criteria_ids: [],
    additional_prompt: '',
    visibility: 'private',
    team_shares: [],
  });
  const [isSavingRubric, setIsSavingRubric] = useState(false);

  // Rubric usage modal state
  const [showRubricUsageModal, setShowRubricUsageModal] = useState(false);
  const [rubricUsageData, setRubricUsageData] = useState<{ rubric: any; assignments: any[] } | null>(null);
  const [isLoadingRubricUsage, setIsLoadingRubricUsage] = useState(false);

  // Check if user has access to any admin functions
  const hasAdminAccess = useCallback(() => {
    return hasAccess(user, 'instructors') || hasAccess(user, 'prompts') ||
           hasAccess(user, 'models') || hasAccess(user, 'settings');
  }, [user]);

  const hasSetupAccess = useCallback(() => {
    return hasAccess(user, 'personas') || hasAccess(user, 'apikeys') ||
           hasAccess(user, 'teams') || hasAccess(user, 'rubrics');
  }, [user]);

  // Semesters and Courses state
  const [semesters, setSemesters] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [allCourses, setAllCourses] = useState<any[]>([]); // All courses for Sections tab dropdown
  const [selectedSemesterId, setSelectedSemesterId] = useState<number | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [orphanedSections, setOrphanedSections] = useState<any[]>([]);
  const [isLoadingSemesters, setIsLoadingSemesters] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [showSemesterModal, setShowSemesterModal] = useState(false);
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showCloneSemesterModal, setShowCloneSemesterModal] = useState(false);
  const [editingSemester, setEditingSemester] = useState<any | null>(null);
  const [editingCourse, setEditingCourse] = useState<any | null>(null);

  // Instructor assignment state
  const [semesterInstructors, setSemesterInstructors] = useState<Map<number, any[]>>(new Map());
  const [showSemesterInstructorsModal, setShowSemesterInstructorsModal] = useState(false);
  const [selectedSemesterForInstructors, setSelectedSemesterForInstructors] = useState<any | null>(null);
  const [allInstructors, setAllInstructors] = useState<any[]>([]);
  // Admin impersonation: which instructor (if any) is the admin currently
  // "viewing as". null = no impersonation (full admin vision). Persisted via
  // localStorage by setImpersonationId so it survives reloads.
  const [impersonateId, setImpersonateIdState] = useState<string | null>(getImpersonationId());
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(false);

  const [sectionStats, setSectionStats] = useState<SectionStat[]>([]);
  const [sectionReadiness, setSectionReadiness] = useState<Record<string, { ready: boolean; missing: string[] }>>({});
  const [selectedSection, setSelectedSection] = useState<SectionStat | null>(null);
  const [resultsInitialSectionId, setResultsInitialSectionId] = useState<string | undefined>(undefined);
  const [resultsInitialCaseId, setResultsInitialCaseId] = useState<string | undefined>(undefined);
  const [studentsInitialSectionId, setStudentsInitialSectionId] = useState<string | undefined>(undefined);
  const [studentDetails, setStudentDetails] = useState<StudentDetail[]>([]);

  // Stats for navigation badges
  const [stats, setStats] = useState({ activeChats: 0, abandonedChats: 0 });
  const [modelsMap, setModelsMap] = useState<Map<string, string>>(new Map());
  const [modelsList, setModelsList] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [modelForm, setModelForm] = useState<{
    model_id: string;
    model_name: string;
    vendor: string;
    enabled: boolean;
    default: boolean;
    cpm_input: string;
    cpm_input_cache: string;
    cpm_output: string;
    temperature: string;
    reasoning_effort: string;
    release_date: string;
    type: string;
    supported_parameters: string;
    default_parameters: string;
    parameter_settings: string;
  }>({
    model_id: '',
    model_name: '',
    vendor: 'openai',
    enabled: true,
    default: false,
    cpm_input: '',
    cpm_input_cache: '',
    cpm_output: '',
    temperature: '',
    reasoning_effort: '',
    release_date: '',
    type: 'regular',
    supported_parameters: '',
    default_parameters: '',
    parameter_settings: '',
  });
  const [isOpenRouterImport, setIsOpenRouterImport] = useState(false);
  const [isFetchingOpenRouter, setIsFetchingOpenRouter] = useState(false);
  const [openRouterContext, setOpenRouterContext] = useState<{ context_length?: number | null; description?: string } | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [isLoadingSections, setIsLoadingSections] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('completion_time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterCaseId, setFilterCaseId] = useState<string>('all');
  const [sectionCasesForFilter, setSectionCasesForFilter] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Bulk selection state
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  
  // Section list filter: show only enabled sections by default
  const [showAllSections, setShowAllSections] = useState(false);
  
  // Section list view mode: tiles (cards) or list (table)
  const [sectionViewMode, setSectionViewMode] = useState<'tiles' | 'list' | 'grouped'>('grouped');
  const [collapsedSemesters, setCollapsedSemesters] = useState<Set<string>>(new Set());
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());
  
  // Modal states
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentDetail | null>(null);
  const [transcriptContent, setTranscriptContent] = useState<string>('Loading...');
  
  // Section management
  const [editingSection, setEditingSection] = useState<SectionStat | null>(null);
  const [sectionForm, setSectionForm] = useState<{
    section_id: string;
    section_title: string;
    year_term: string;
    chat_model: string;
    super_model: string;
    enabled: boolean;
    accept_new_students: boolean;
    enrollment_key: string;
    semester_id: number | null;
    course_id: number | null;
  }>({
    section_id: '',
    section_title: '',
    year_term: '',
    chat_model: '',
    super_model: '',
    enabled: true,
    accept_new_students: false,
    enrollment_key: '',
    semester_id: null,
    course_id: null
  });

  // Toggle for showing models column in section list
  const [showModelsColumn, setShowModelsColumn] = useState(false);

  // Cases management
  const [casesList, setCasesList] = useState<Case[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [editingCase, setEditingCase] = useState<Case | null>(null);
  const [caseForm, setCaseForm] = useState({
    case_id: '',
    case_title: '',
    case_version: '',
    protagonist: '',
    protagonist_initials: '',
    chat_topic: '',
    chat_question: '',
    enabled: true,
    visibility: 'private' as 'private' | 'team' | 'public',
    team_shares: [] as { team_id: number; access_level?: 'view' | 'edit' }[]
  });
  const [isSavingCase, setIsSavingCase] = useState(false);
  const [goToScenariosAfterCreate, setGoToScenariosAfterCreate] = useState(false);
  const [caseFileUpload, setCaseFileUpload] = useState<{ type: 'case' | 'teaching_note'; file: File | null }>({ type: 'case', file: null });
  const [isUploadingCaseFile, setIsUploadingCaseFile] = useState(false);

  // Scenario management
  const [showScenarioManager, setShowScenarioManager] = useState(false);
  const [managingScenarioCase, setManagingScenarioCase] = useState<Case | null>(null);

  // Section-Case management
  const [showSectionCasesModal, setShowSectionCasesModal] = useState(false);
  const [managingSectionCases, setManagingSectionCases] = useState<SectionStat | null>(null);
  const [sectionCasesList, setSectionCasesList] = useState<any[]>([]);
  const [isLoadingSectionCases, setIsLoadingSectionCases] = useState(false);

  // Case Chats management (Latest Chats tab)
  const [caseChatsList, setCaseChatsList] = useState<any[]>([]);
  const [isLoadingCaseChats, setIsLoadingCaseChats] = useState(false);
  const [caseChatsFilter, setCaseChatsFilter] = useState<{ status: string; section_id: string; search: string }>({
    status: 'all',
    section_id: 'all',
    search: ''
  });
  const [chatsSortKey, setChatsSortKey] = useState<string>('start_time');
  const [chatsSortDirection, setChatsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [chatsLimit, setChatsLimit] = useState<number>(50);
  const [showChatTranscriptModal, setShowChatTranscriptModal] = useState(false);
  const [selectedCaseChat, setSelectedCaseChat] = useState<any | null>(null);

  // Live Session Monitor state
  const [liveSessionSection, setLiveSessionSection] = useState<string>('');
  const [liveSessionCase, setLiveSessionCase] = useState<string>('');
  const [liveSessionCases, setLiveSessionCases] = useState<any[]>([]);
  const [isLoadingLiveSessionCases, setIsLoadingLiveSessionCases] = useState(false);
  const [liveSessionData, setLiveSessionData] = useState<any[]>([]);
  const [liveSessionSummary, setLiveSessionSummary] = useState<{ total: number; completed: number; in_progress: number; not_started: number }>({ total: 0, completed: 0, in_progress: 0, not_started: 0 });
  const [isLoadingLiveSession, setIsLoadingLiveSession] = useState(false);
  const [liveAutoRefresh, setLiveAutoRefresh] = useState(true);
  const [lastLiveRefresh, setLastLiveRefresh] = useState<Date | null>(null);
  const [chatsAutoRefresh, setChatsAutoRefresh] = useState(false);

  // Chat options editing (Phase 2)
  const [expandedCaseOptions, setExpandedCaseOptions] = useState<string | null>(null);
  const [editingChatOptions, setEditingChatOptions] = useState<any>(null);
  const [isSavingChatOptions, setIsSavingChatOptions] = useState(false);

  // Scheduling options editing
  const [expandedScheduling, setExpandedScheduling] = useState<string | null>(null);
  const [editingScheduling, setEditingScheduling] = useState<any>(null);
  // Scenario assignment state
  const [expandedScenarios, setExpandedScenarios] = useState<string | null>(null);
  const [availableScenariosForCase, setAvailableScenariosForCase] = useState<any[]>([]);
  const [assignedScenarios, setAssignedScenarios] = useState<any[]>([]);
  const [scenarioSettings, setScenarioSettings] = useState<{ use_scenarios: boolean; selection_mode: string; require_order: boolean }>({
    use_scenarios: false,
    selection_mode: 'student_choice',
    require_order: false
  });
  const [isLoadingScenarioAssignment, setIsLoadingScenarioAssignment] = useState(false);
  const [isSavingScenarioAssignment, setIsSavingScenarioAssignment] = useState(false);
  const [isSavingScheduling, setIsSavingScheduling] = useState(false);

  // View scenario details modal state
  const [viewingScenario, setViewingScenario] = useState<any | null>(null);
  const [viewingScenarioPositions, setViewingScenarioPositions] = useState<any[]>([]);
  const [isLoadingViewScenarioPositions, setIsLoadingViewScenarioPositions] = useState(false);

  // Position settings state (for section-case assignments)
  const [expandedPositionSettings, setExpandedPositionSettings] = useState<string | null>(null);
  const [positionSettings, setPositionSettings] = useState<{
    position_tracking_enabled: boolean;
    position_capture_method: string;
    track_position_change: boolean;
  }>({
    position_tracking_enabled: false,
    position_capture_method: 'explicit',
    track_position_change: true
  });
  const [assignmentPositions, setAssignmentPositions] = useState<any[]>([]);
  const [isLoadingPositionSettings, setIsLoadingPositionSettings] = useState(false);
  const [isSavingPositionSettings, setIsSavingPositionSettings] = useState(false);

  // Drag-and-drop sensors for position reordering
  const positionSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts (allows clicks to work)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Default chat options
  const defaultChatOptions = {
    hints_allowed: 3,
    free_hints: 1,
    ask_for_feedback: false,
    ask_save_transcript: false,
    always_save_transcript: false,
    auto_save_transcript: true,
    allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
    default_persona: 'moderate',
    show_case: true,
    show_timer: true,
    do_evaluation: true,
    show_evaluation_details: true,
    chatbot_personality: '',
    chat_repeats: 0,
    save_dead_transcripts: false,
    allow_repeat: false,
    timeout_chat: false,
    allow_finish_button: false,
    restart_chat: false,
    allow_exit: false,
    require_minimum_exchanges: 0,
    max_message_length: 0,
    disable_position_tracking: false
  };

  // Helper to check if a chat option value differs from the applicable default
  const isOptionModified = (optionKey: string, currentValue: any, applicableDefault: any): boolean => {
    if (!applicableDefault) return false;
    const defaultValue = applicableDefault[optionKey];
    // Handle undefined/null cases
    if (defaultValue === undefined || defaultValue === null) return currentValue !== undefined && currentValue !== null && currentValue !== '';
    return currentValue !== defaultValue;
  };

  // Get inheritance source label
  const getInheritanceSource = (isEditingDefault: 'global' | 'section' | null, chatOptionsSection: string | null, isSectionSpecific: boolean): string => {
    if (isEditingDefault === 'global') return 'Global default';
    if (isEditingDefault === 'section') return 'Section default';
    // For assignment-level, show where defaults actually come from
    return isSectionSpecific ? 'Section default' : 'Global default';
  };

  // Chat options category collapse state (start collapsed)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [bulkActionsExpanded, setBulkActionsExpanded] = useState(false);

  // Personas management
  const [personasList, setPersonasList] = useState<any[]>([]);
  const [isLoadingPersonas, setIsLoadingPersonas] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<any | null>(null);
  const [personaForm, setPersonaForm] = useState<{
    persona_id: string;
    persona_name: string;
    description: string;
    instructions: string;
    enabled: boolean;
    sort_order: number;
    visibility: 'private' | 'team' | 'public';
    team_shares: { team_id: number; access_level?: 'view' | 'edit' }[];
  }>({
    persona_id: '',
    persona_name: '',
    description: '',
    instructions: '',
    enabled: true,
    sort_order: 0,
    visibility: 'private',
    team_shares: []
  });
  const [isSavingPersona, setIsSavingPersona] = useState(false);
  const [personaModalError, setPersonaModalError] = useState<string | null>(null);
  const [personaListError, setPersonaListError] = useState<string | null>(null);
  const [personaViewOnly, setPersonaViewOnly] = useState(false);
  const [isCloningPersona, setIsCloningPersona] = useState(false);

  const personaAccessContext = useMemo((): PersonaAccessContext => ({
    superuser: Boolean(user?.superuser),
    role: user?.role,
    effectiveInstructorId: user?.role === 'admin' ? getImpersonationId() : (user?.id ?? null),
  }), [user]);

  // Assignments view state
  const [assignmentsSectionsList, setAssignmentsSectionsList] = useState<any[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [expandedAssignmentSection, setExpandedAssignmentSection] = useState<string | null>(null);
  const [assignmentCasesList, setAssignmentCasesList] = useState<any[]>([]);
  const [selectedAssignmentSection, setSelectedAssignmentSection] = useState<string | null>(null);

  // Chat Options tab state - pre-selected section/case when navigating from Assignments
  const [chatOptionsSection, setChatOptionsSection] = useState<string | null>(null);
  const [chatOptionsCase, setChatOptionsCase] = useState<string | null>(null);

  // Defaults management state
  const [isEditingDefault, setIsEditingDefault] = useState<'global' | 'section' | null>(null);
  const [useDefaultOptions, setUseDefaultOptions] = useState(true);
  const [applicableDefault, setApplicableDefault] = useState<any>(null);
  const [isDefaultSectionSpecific, setIsDefaultSectionSpecific] = useState<boolean>(false);

  // Copy assignments state
  const [copyFromSection, setCopyFromSection] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState({ options: true, scenarios: true, scheduling: true });
  const [sourceSectionCases, setSourceSectionCases] = useState<any[]>([]);
  const [isCopying, setIsCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Bulk copy chat options state
  const [isBulkCopying, setIsBulkCopying] = useState(false);
  const [bulkCopyResult, setBulkCopyResult] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Navigation handler for DashboardHome - simplified to just navigate
  // options parameter allows passing additional context like section_id and case_id for monitor
  const handleNavigate = useCallback((section: string, subTab?: string, options?: { section_id?: string; case_id?: string }) => {
    switch (section) {
      case 'courses':
        setPrimaryTab('courses');
        if (subTab === 'new-section') {
          setCoursesSubTab('sections');
          setShowSectionModal(true);
          setEditingSection(null);
          setSectionForm({
            section_id: '',
            section_title: '',
            year_term: '',
            chat_model: '',
            super_model: '',
            enabled: true,
            accept_new_students: false,
            enrollment_key: '',
            semester_id: null,
            course_id: null
          });
        } else if (subTab && ['sections', 'students', 'semesters', 'course-setup'].includes(subTab)) {
          setCoursesSubTab(subTab as CoursesSubTab);
          if (subTab === 'students') {
            setStudentsInitialSectionId(options?.section_id);
          }
        } else if (subTab) {
          // If subTab is a section_id, select that section
          setCoursesSubTab('sections');
          // Will select the section when sectionStats are available
          const foundSection = sectionStats.find(s => s.section_id === subTab);
          if (foundSection) {
            setSelectedSection(foundSection);
          }
        }
        break;
      case 'content':
        setPrimaryTab('content');
        if (subTab === 'new-case') {
          setContentSubTab('cases');
          setShowCaseModal(true);
          setEditingCase(null);
          setCaseForm({
            case_id: '',
            case_title: '',
            protagonist: '',
            protagonist_initials: '',
            chat_topic: '',
            chat_question: '',
            enabled: true
          });
        } else if (subTab && ['cases', 'caseprep'].includes(subTab)) {
          setContentSubTab(subTab as ContentSubTab);
        }
        break;
      case 'monitor':
        setPrimaryTab('monitor');
        if (subTab === 'live') {
          setMonitorSubTab('live');
          // Pre-select section and case if provided
          if (options?.section_id) {
            setLiveSessionSection(options.section_id);
            // Case will be set after section's cases are fetched
            if (options?.case_id) {
              // Store case_id to set after cases load
              setTimeout(() => setLiveSessionCase(options.case_id!), 500);
            }
          }
        } else if (subTab === 'chats') {
          setMonitorSubTab('chats');
        }
        break;
      case 'analytics':
        setPrimaryTab('results');
        break;
      case 'results':
        setPrimaryTab('results');
        // Recognized sub-tab names switch the active sub-tab; section_id / case_id
        // pre-filter the destination view. Anything else is treated as a legacy
        // section_id (DashboardHome uses this form).
        if (subTab && ['responses', 'positions', 'section-results'].includes(subTab)) {
          setResultsSubTab(subTab as ResultsSubTab);
          setResultsInitialSectionId(options?.section_id);
          setResultsInitialCaseId(options?.case_id);
        } else if (subTab) {
          setResultsInitialSectionId(subTab);
          setResultsInitialCaseId(undefined);
        } else {
          setResultsInitialSectionId(options?.section_id);
          setResultsInitialCaseId(options?.case_id);
        }
        break;
      case 'admin':
        if (subTab && ['personas', 'apikeys', 'teams'].includes(subTab)) {
          setPrimaryTab('setup');
          setSetupSubTab(subTab as SetupSubTab);
        } else {
          setPrimaryTab('admin');
          if (subTab && ['prompts', 'models', 'settings', 'instructors', 'admins', 'logging', 'shadow'].includes(subTab)) {
            setAdminSubTab(subTab as AdminSubTab);
          }
        }
        break;
      case 'setup':
        setPrimaryTab('setup');
        if (subTab && ['personas', 'apikeys', 'teams'].includes(subTab)) {
          setSetupSubTab(subTab as SetupSubTab);
        }
        break;
      case 'assignments':
        setPrimaryTab('assignments');
        if (subTab && ['assignments', 'chat-options'].includes(subTab)) {
          setAssignmentsSubTab(subTab as AssignmentsSubTab);
        } else {
          setAssignmentsSubTab('assignments');
        }
        fetchAssignmentsSections();
        break;
      default:
        setPrimaryTab('home');
    }
  }, [sectionStats]);

  // Navigate to Chat Options tab with pre-selected section and case
  const navigateToChatOptions = useCallback(async (sectionId: string, caseId: string) => {
    setChatOptionsSection(sectionId);
    setChatOptionsCase(caseId);
    // Fetch section cases if not already loaded for this section
    await fetchSectionCases(sectionId);
    // Find and load the chat options for the selected case
    const cases = await api.from(`sections/${sectionId}/cases`).select('*');
    if (cases.data) {
      const sc = (cases.data as any[]).find((c: any) => c.case_id === caseId);
      if (sc) {
        setEditingChatOptions(sc.chat_options ? { ...sc.chat_options } : { ...defaultChatOptions });
      }
    }
    setPrimaryTab('assignments');
    setAssignmentsSubTab('chat-options');
  }, [defaultChatOptions]);

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    const { data, error } = await api
      .from('models')
      .select('model_id, model_name, vendor, enabled, default, cpm_input, cpm_input_cache, cpm_output, temperature, reasoning_effort, release_date, type, supported_parameters, default_parameters, parameter_settings, test_date, test_result, test_status, test_results');
    
    if (error) {
      console.error('Failed to fetch models', error);
    } else if (data) {
      setModelsMap(new Map((data as any[]).map(m => [m.model_id, m.model_name])));
      setModelsList(data as Model[]);
    }
    setIsLoadingModels(false);
  }, []);

  const formatSqlDateTime = () => {
    const dt = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  };
  const MAX_TEST_RESULTS_LENGTH = 200;
  const sanitizeTextForDisplay = (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  const persistModelTestResult = async (modelId: string, testResult: string) => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          test_date: formatSqlDateTime(),
          test_result: testResult ? String(testResult).slice(0, MAX_TEST_RESULTS_LENGTH) : null,
        }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      await fetchModels();
    } catch (err) {
      console.error('Failed to persist model test result:', err);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Fetch semesters
  const fetchSemesters = useCallback(async () => {
    setIsLoadingSemesters(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/semesters`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSemesters(result.data || []);
        // Auto-select current semester
        const currentSemester = (result.data || []).find((s: any) => s.is_current);
        if (currentSemester && !selectedSemesterId) {
          setSelectedSemesterId(currentSemester.id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch semesters');
    } finally {
      setIsLoadingSemesters(false);
    }
  }, [selectedSemesterId]);

  // Fetch courses for selected semester
  const fetchCourses = useCallback(async (semesterId: number) => {
    setIsLoadingCourses(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/semesters/${semesterId}/courses`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setCourses(result.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch courses');
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  // Fetch orphaned sections (not assigned to any course)
  const fetchOrphanedSections = useCallback(async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/sections/orphaned`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (!result.error) {
        setOrphanedSections(result.data || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch orphaned sections:', err);
    }
  }, []);

  // Fetch all courses (for Sections tab dropdown)
  const fetchAllCourses = useCallback(async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/courses`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (!result.error) {
        setAllCourses(result.data || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch all courses:', err);
    }
  }, []);

  // Fetch all instructors (for assignment dropdowns)
  const fetchAllInstructors = useCallback(async () => {
    setIsLoadingInstructors(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/instructors`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (!result.error) {
        setAllInstructors(result.data || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch instructors:', err);
    } finally {
      setIsLoadingInstructors(false);
    }
  }, []);

  // Fetch instructors for a specific semester
  const fetchSemesterInstructors = useCallback(async (semesterId: number) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/semesters/${semesterId}/instructors`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (!result.error) {
        setSemesterInstructors(prev => new Map(prev).set(semesterId, result.data || []));
      }
    } catch (err: any) {
      console.error('Failed to fetch semester instructors:', err);
    }
  }, []);

  // Assign instructor to semester
  const handleAssignInstructorToSemester = async (instructorId: string, semesterId: number) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/instructors/${instructorId}/semesters`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ semester_id: semesterId })
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message || result.error);
      } else {
        // Refresh the instructors for this semester
        fetchSemesterInstructors(semesterId);
        setSuccessMessage('Instructor assigned successfully');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to assign instructor');
    }
  };

  // Remove instructor from semester
  const handleRemoveInstructorFromSemester = async (instructorId: string, semesterId: number) => {
    if (!confirm('Remove this instructor from the semester?')) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/instructors/${instructorId}/semesters/${semesterId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message || result.error);
      } else {
        fetchSemesterInstructors(semesterId);
        setSuccessMessage('Instructor removed from semester');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to remove instructor');
    }
  };

  // Fetch courses when semester changes
  useEffect(() => {
    if (selectedSemesterId) {
      fetchCourses(selectedSemesterId);
    }
  }, [selectedSemesterId, fetchCourses]);

  const fetchSectionStats = useCallback(async () => {
    setIsLoadingSections(true);
    setError(null);

    const { data: sections, error: sectionsError } = await api
      .from('sections')
      .select('section_id, section_title, year_term, chat_model, super_model, enabled, active_case_count, active_case_titles')
      .order('year_term', { ascending: false })
      .order('section_title', { ascending: true });

    if (sectionsError) {
      console.error(sectionsError);
      setError('Failed to fetch sections. Check database connection.');
      setIsLoadingSections(false);
      return;
    }

    const { data: students, error: studentsError } = await api
      .from('students')
      .select('id, section_id, finished_at');

    if (studentsError) {
      console.error(studentsError);
      setError('Failed to fetch student data. Check database connection.');
      setIsLoadingSections(false);
      return;
    }

    const { data: evaluations, error: evaluationsError } = await api
      .from('evaluations')
      .select('student_id');

    if (evaluationsError) {
      console.error(evaluationsError);
      setError('Failed to fetch evaluation data. Check database connection.');
      setIsLoadingSections(false);
      return;
    }
    
    const completedStudentIds = new Set((evaluations as any[] || []).map(e => e.student_id));

    // Include ALL sections (enabled and disabled) - disabled sections will be flagged in the UI
    const stats: SectionStat[] = (sections as any[] || [])
      .map(section => {
        const sectionStudents = (students as any[] || []).filter(s => s.section_id === section.section_id);
        const completions = sectionStudents.filter(s => completedStudentIds.has(s.id)).length;
        const inProgress = sectionStudents.filter(s => !completedStudentIds.has(s.id) && s.finished_at === null).length;
        return {
          ...section,
          starts: sectionStudents.length,
          completions: completions,
          inProgress: inProgress,
        };
      });

    // Separate students into: truly unassigned, "other:" course students, and those in disabled sections
    const allSectionIds = new Set((sections as any[] || []).map(s => s.section_id));
    const otherCourseStudents = (students as any[] || []).filter(s => s.section_id && s.section_id.startsWith('other:'));
    const unassignedStudents = (students as any[] || []).filter(s => !s.section_id || (!allSectionIds.has(s.section_id) && !s.section_id.startsWith('other:')));

    // Add "Other course sections" entry for students with section_id starting with "other:"
    if (otherCourseStudents.length > 0) {
      const otherCompletions = otherCourseStudents.filter(s => completedStudentIds.has(s.id)).length;
      const otherInProgress = otherCourseStudents.filter(s => !completedStudentIds.has(s.id) && s.finished_at === null).length;
      const otherSectionStat: SectionStat = {
        section_id: 'other_courses',
        section_title: 'Other course sections',
        year_term: 'other',
        starts: otherCourseStudents.length,
        completions: otherCompletions,
        inProgress: otherInProgress,
        chat_model: null,
        super_model: null,
        enabled: false,
      };
      stats.unshift(otherSectionStat);
    }

    // Add "Not in a course" entry for truly unassigned students
    if (unassignedStudents.length > 0) {
      const unassignedCompletions = unassignedStudents.filter(s => completedStudentIds.has(s.id)).length;
      const unassignedInProgress = unassignedStudents.filter(s => !completedStudentIds.has(s.id) && s.finished_at === null).length;
      const unassignedSectionStat: SectionStat = {
        section_id: 'unassigned',
        section_title: 'Not in a course',
        year_term: 'unassigned',
        starts: unassignedStudents.length,
        completions: unassignedCompletions,
        inProgress: unassignedInProgress,
        chat_model: null,
        super_model: null,
        enabled: false,
      };
      stats.unshift(unassignedSectionStat);
    }

    setSectionStats(stats);
    setIsLoadingSections(false);

    // Fire-and-forget readiness probe so the section list can show a green/red
    // dot indicating whether each section's instructor has the required API keys.
    (async () => {
      try {
        const token = localStorage.getItem('admin_auth_token');
        const res = await fetch(`${getApiBaseUrl()}/sections/readiness/bulk`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.data) setSectionReadiness(json.data);
      } catch { /* non-fatal — dot just won't render */ }
    })();
  }, []);

  const fetchStudentDetails = useCallback(async (sectionId: string, caseIdFilter: string | null = null) => {
    setIsLoadingDetails(true);
    setError(null);
    setStudentDetails([]);
  
    let studentsData: { id: string, full_name: string, persona: string | null, finished_at: string | null, section_id: string | null, created_at: string | null }[] | null = null;
    let studentsError: any = null;

    if (sectionId === 'other_courses') {
      // Fetch all students and filter for those with section_id starting with "other:"
      const { data: allStudents, error: allStudentsError } = await api
        .from('students')
        .select('id, full_name, persona, finished_at, section_id, created_at');
      
      if (allStudentsError) {
        studentsData = null;
        studentsError = allStudentsError;
      } else {
        // Filter for students with section_id starting with "other:"
        studentsData = (allStudents as any[] || []).filter(s => s.section_id && s.section_id.startsWith('other:'));
        studentsError = null;
      }
    } else if (sectionId === 'unassigned') {
      const { data: allStudents, error: allStudentsError } = await api
        .from('students')
        .select('id, full_name, persona, finished_at, section_id, created_at');
      
      if (allStudentsError) {
        studentsData = null;
        studentsError = allStudentsError;
      } else {
        // Get ALL sections (not just enabled) to find truly unassigned students
        const { data: sections, error: sectionsError } = await api
          .from('sections')
          .select('section_id');
        
        if (sectionsError) {
          setError('Failed to get sections to filter unassigned students.');
          setIsLoadingDetails(false);
          return;
        }

        // Only students with NO section_id or a section_id that doesn't exist (and not "other:") are truly unassigned
        const allSectionIds = new Set((sections as any[] || []).map(s => s.section_id));
        studentsData = (allStudents as any[] || []).filter(s => !s.section_id || (!allSectionIds.has(s.section_id) && !s.section_id.startsWith('other:')));
        studentsError = null;
      }
    } else {
      const { data, error } = await api
        .from('students')
        .select('id, full_name, persona, finished_at, section_id, created_at')
        .eq('section_id', sectionId);
      studentsData = data as any;
      studentsError = error;
    }
  
    if (studentsError) {
      console.error(studentsError);
      setError('Failed to load students. This may be a database permission issue.');
      setIsLoadingDetails(false);
      return;
    }
  
    if (!studentsData || studentsData.length === 0) {
      setStudentDetails([]);
      setIsLoadingDetails(false);
      return;
    }
  
    const studentIds = studentsData.map(s => s.id);
    
    // If filtering by case, only fetch evaluations for that specific case
    let evaluationsQuery = api
      .from('evaluations')
      .select('id, student_id, case_id, score, hints, helpful, created_at, chat_model, super_model, summary, criteria, transcript, liked, improve, allow_rechat, persona')
      .in('student_id', studentIds);
    
    if (caseIdFilter && caseIdFilter !== 'all') {
      evaluationsQuery = evaluationsQuery.eq('case_id', caseIdFilter);
    }
    
    const { data: evaluationsData, error: evaluationsError } = await evaluationsQuery;
    
    // Also fetch cases for this section for the filter dropdown
    try {
      const casesResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases`);
      const casesResult = await casesResponse.json();
      if (casesResult.data) {
        setSectionCasesForFilter(casesResult.data);
      }
    } catch (e) {
      console.error('Error fetching section cases for filter:', e);
    }
  
    if (evaluationsError) {
      console.error("MySQL error fetching evaluations:", evaluationsError);
      const detailsWithoutScores = studentsData.map(student => ({
        id: student.id,
        full_name: student.full_name,
        persona: student.favorite_persona,
        completion_time: student.finished_at,
        score: null,
        hints: null,
        helpful: null,
        chat_model: null,
        super_model: null,
        summary: null,
        criteria: null,
        transcript: null,
        liked: null,
        improve: null,
        created_at: student.created_at,
        status: 'not_started' as const,
        case_id: null,
        case_title: null,
        evaluation_id: null,
        allow_rechat: false,
      }));
      setStudentDetails(detailsWithoutScores);
      setIsLoadingDetails(false);
      return;
    }
    
    // Build a map of case_id -> case_title for display
    const caseIdToTitle = new Map<string, string>();
    for (const sc of sectionCasesForFilter) {
      caseIdToTitle.set(sc.case_id, sc.case_title);
    }
    
    // Build a map of student_id -> student data for quick lookup
    const studentsMap = new Map<string, typeof studentsData[0]>();
    for (const student of studentsData) {
      studentsMap.set(student.id, student);
    }
    
    // Create rows for all evaluations (one row per evaluation)
    const evaluationRows: StudentDetail[] = [];
    if (Array.isArray(evaluationsData)) {
      for (const evaluation of evaluationsData) {
        if (evaluation && evaluation.student_id) {
          const student = studentsMap.get(evaluation.student_id);
          if (student) {
            evaluationRows.push({
              id: student.id,
              full_name: student.full_name,
              persona: evaluation.persona || student.favorite_persona,
              completion_time: evaluation.created_at,
              score: evaluation.score ?? null,
              hints: evaluation.hints ?? null,
              helpful: evaluation.helpful ?? null,
              chat_model: evaluation.chat_model ?? null,
              super_model: evaluation.super_model ?? null,
              summary: evaluation.summary ?? null,
              criteria: evaluation.criteria ?? null,
              transcript: evaluation.transcript ?? null,
              liked: evaluation.liked ?? null,
              improve: evaluation.improve ?? null,
              created_at: evaluation.created_at,
              status: 'completed' as const,
              case_id: evaluation.case_id ?? null,
              case_title: evaluation.case_id ? (caseIdToTitle.get(evaluation.case_id) || evaluation.case_id) : null,
              evaluation_id: evaluation.id ?? null,
              allow_rechat: evaluation.allow_rechat ?? false,
            });
          }
        }
      }
    }
    
    // Find students who have no evaluations and add them as "not_started" rows
    const studentsWithEvaluations = new Set(evaluationsData?.map(e => e.student_id) || []);
    const studentsWithoutEvaluations = studentsData.filter(student => !studentsWithEvaluations.has(student.id));
    
    const notStartedRows: StudentDetail[] = studentsWithoutEvaluations.map(student => ({
      id: student.id,
      full_name: student.full_name,
      persona: student.favorite_persona,
      completion_time: student.finished_at,
      score: null,
      hints: null,
      helpful: null,
      chat_model: null,
      super_model: null,
      summary: null,
      criteria: null,
      transcript: null,
      liked: null,
      improve: null,
      created_at: student.created_at,
      status: student.finished_at ? 'in_progress' as const : 'not_started' as const,
      case_id: null,
      case_title: null,
      evaluation_id: null,
      allow_rechat: false,
    }));
    
    // Sort evaluation rows by date (most recent first)
    evaluationRows.sort((a, b) => {
      const dateA = a.completion_time ? new Date(a.completion_time).getTime() : 0;
      const dateB = b.completion_time ? new Date(b.completion_time).getTime() : 0;
      return dateB - dateA; // Most recent first
    });
    
    // Combine all rows: evaluations first (sorted by date), then students without evaluations
    const combinedDetails = [...evaluationRows, ...notStartedRows];
  
    setStudentDetails(combinedDetails);
    setIsLoadingDetails(false);
  }, []);

  useEffect(() => {
    fetchSectionStats();
    fetchAllCourses(); // Load all courses for Sections tab dropdown
  }, [fetchSectionStats, fetchAllCourses]);

  // Load instructor data when on semesters tab and semesters are loaded
  useEffect(() => {
    if (coursesSubTab === 'semesters' && semesters.length > 0) {
      // Load instructors for each semester
      semesters.forEach(sem => {
        if (!semesterInstructors.has(sem.id)) {
          fetchSemesterInstructors(sem.id);
        }
      });
      // Also load all instructors for assignment dropdown
      if (allInstructors.length === 0) {
        fetchAllInstructors();
      }
    }
  }, [coursesSubTab, semesters, semesterInstructors, allInstructors, fetchSemesterInstructors, fetchAllInstructors]);

  useEffect(() => {
    if (selectedSection) {
      fetchStudentDetails(selectedSection.section_id, filterCaseId !== 'all' ? filterCaseId : null);
    }
  }, [selectedSection, fetchStudentDetails, filterCaseId]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh && selectedSection) {
      autoRefreshIntervalRef.current = setInterval(() => {
        fetchStudentDetails(selectedSection.section_id, filterCaseId !== 'all' ? filterCaseId : null);
        fetchSectionStats();
      }, 30000); // 30 seconds
    } else {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
    }
    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    };
  }, [autoRefresh, selectedSection, fetchStudentDetails, fetchSectionStats, filterCaseId]);

  const handleSectionClick = (section: SectionStat) => {
    // Navigate to Results tab with this section pre-filtered
    setResultsInitialSectionId(section.section_id);
    setPrimaryTab('results');
  };

  // Rubrics management functions
  const fetchRubrics = async () => {
    setIsLoadingRubrics(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      // enabled=false fetches all rubrics including disabled ones for admin management
      const response = await fetch(`${getApiBaseUrl()}/rubrics?include_criteria=true&enabled=false`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        console.error('Error fetching rubrics:', result.error);
      } else {
        setRubricsList(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching rubrics:', err);
    } finally {
      setIsLoadingRubrics(false);
    }
  };

  const fetchCriteria = async () => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      // enabled=false fetches all criteria including disabled ones for admin management
      const response = await fetch(`${getApiBaseUrl()}/rubric-criteria?enabled=false`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        console.error('Error fetching criteria:', result.error);
      } else {
        setCriteriaList(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching criteria:', err);
    }
  };

  // Criterion modal handlers
  const handleOpenCriterionModal = (criterion?: any) => {
    if (criterion) {
      setEditingCriterion(criterion);
      const guide = typeof criterion.scoring_guide === 'string'
        ? JSON.parse(criterion.scoring_guide || '{}')
        : (criterion.scoring_guide || {});
      setCriterionForm({
        criteria_id: criterion.criteria_id,
        name: criterion.name,
        question_text: criterion.question_text,
        max_points: criterion.max_points,
        scoring_guide: guide,
      });
    } else {
      setEditingCriterion(null);
      setCriterionForm({
        criteria_id: '',
        name: '',
        question_text: '',
        max_points: 5,
        scoring_guide: {},
      });
    }
    setShowCriterionModal(true);
  };

  const handleSaveCriterion = async () => {
    if (!criterionForm.criteria_id || !criterionForm.name || !criterionForm.question_text) {
      alert('Please fill in all required fields');
      return;
    }
    setIsSavingCriterion(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const url = editingCriterion
        ? `${getApiBaseUrl()}/rubric-criteria/${editingCriterion.criteria_id}`
        : `${getApiBaseUrl()}/rubric-criteria`;
      const method = editingCriterion ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(criterionForm),
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        setShowCriterionModal(false);
        fetchCriteria();
        if (result.affectedRubrics > 0) {
          alert(`Criterion saved. ${result.affectedRubrics} rubric(s) marked as needing regeneration.`);
          fetchRubrics();
        }
      }
    } catch (err) {
      console.error('Error saving criterion:', err);
      alert('Error saving criterion');
    } finally {
      setIsSavingCriterion(false);
    }
  };

  const handleDeleteCriterion = async (criteriaId: string) => {
    if (!confirm('Are you sure you want to delete this criterion?')) return;
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubric-criteria/${criteriaId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchCriteria();
      }
    } catch (err) {
      console.error('Error deleting criterion:', err);
      alert('Error deleting criterion');
    }
  };

  // Rubric modal handlers
  const handleOpenRubricModal = (rubric?: any) => {
    // Ensure criteria list is loaded for the selector
    if (criteriaList.length === 0) fetchCriteria();

    if (rubric) {
      setEditingRubric(rubric);
      setRubricForm({
        rubric_name: rubric.rubric_name,
        description: rubric.description || '',
        criteria_ids: Array.isArray(rubric.criteria_ids) ? rubric.criteria_ids : [],
        additional_prompt: rubric.additional_prompt || '',
        visibility: (rubric.visibility || 'private') as 'private' | 'team' | 'public',
        team_shares: Array.isArray(rubric.team_shares) ? rubric.team_shares : [],
      });
    } else {
      setEditingRubric(null);
      setRubricForm({
        rubric_name: '',
        description: '',
        criteria_ids: [],
        additional_prompt: '',
        visibility: 'private',
        team_shares: [],
      });
    }
    setShowRubricModal(true);
  };

  const handleSaveRubric = async () => {
    if (!rubricForm.rubric_name || rubricForm.criteria_ids.length === 0) {
      alert('Please provide a name and select at least one criterion');
      return;
    }
    setIsSavingRubric(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const url = editingRubric
        ? `${getApiBaseUrl()}/rubrics/${editingRubric.rubric_id}`
        : `${getApiBaseUrl()}/rubrics`;
      const method = editingRubric ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(rubricForm),
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        const savedId = result.data?.rubric_id || editingRubric?.rubric_id;
        if (savedId) {
          await fetch(`${getApiBaseUrl()}/rubrics/${savedId}/visibility`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              visibility: rubricForm.visibility,
              team_ids: rubricForm.team_shares
            })
          });
        }
        setShowRubricModal(false);
        fetchRubrics();
      }
    } catch (err) {
      console.error('Error saving rubric:', err);
      alert('Error saving rubric');
    } finally {
      setIsSavingRubric(false);
    }
  };

  const handleDeleteRubric = async (rubricId: number) => {
    if (!confirm('Are you sure you want to delete this rubric?')) return;
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubrics/${rubricId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchRubrics();
      }
    } catch (err) {
      console.error('Error deleting rubric:', err);
      alert('Error deleting rubric');
    }
  };

  const handleRegenerateRubric = async (rubricId: number) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubrics/${rubricId}/regenerate`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchRubrics();
        alert('Rubric prompt regenerated successfully');
      }
    } catch (err) {
      console.error('Error regenerating rubric:', err);
      alert('Error regenerating rubric');
    }
  };

  const handleToggleRubricEnabled = async (rubricId: number, currentEnabled: boolean) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubrics/${rubricId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchRubrics();
      }
    } catch (err) {
      console.error('Error toggling rubric enabled:', err);
      alert('Error toggling rubric');
    }
  };

  const handleSetRubricDefault = async (rubricId: number) => {
    if (!confirm('Set this rubric as the system default? This will replace the current default.')) return;
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubrics/${rubricId}/set-default`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchRubrics();
        alert('Default rubric updated');
      }
    } catch (err) {
      console.error('Error setting default rubric:', err);
      alert('Error setting default rubric');
    }
  };

  const handleToggleCriterionEnabled = async (criteriaId: string, currentEnabled: boolean) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubric-criteria/${criteriaId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      const result = await response.json();
      if (result.error) {
        alert(`Error: ${result.error.message}`);
      } else {
        fetchCriteria();
        if (result.affectedRubrics > 0) {
          alert(`Criterion ${!currentEnabled ? 'enabled' : 'disabled'}. ${result.affectedRubrics} rubric(s) may need regeneration.`);
          fetchRubrics();
        }
      }
    } catch (err) {
      console.error('Error toggling criterion enabled:', err);
      alert('Error toggling criterion');
    }
  };

  const handleShowRubricUsage = async (rubric: any) => {
    setIsLoadingRubricUsage(true);
    setRubricUsageData({ rubric, assignments: [] });
    setShowRubricUsageModal(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/rubrics/${rubric.rubric_id}/usage`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        console.error('Error fetching rubric usage:', result.error);
      } else {
        setRubricUsageData({ rubric, assignments: result.data || [] });
      }
    } catch (err) {
      console.error('Error fetching rubric usage:', err);
    } finally {
      setIsLoadingRubricUsage(false);
    }
  };

  const handleCriteriaOrderChange = (dragIndex: number, dropIndex: number) => {
    const newOrder = [...rubricForm.criteria_ids];
    const [removed] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setRubricForm({ ...rubricForm, criteria_ids: newOrder });
  };

  const toggleCriterionInRubric = (criteriaId: string) => {
    const current = rubricForm.criteria_ids;
    if (current.includes(criteriaId)) {
      setRubricForm({ ...rubricForm, criteria_ids: current.filter(id => id !== criteriaId) });
    } else {
      setRubricForm({ ...rubricForm, criteria_ids: [...current, criteriaId] });
    }
  };

  // Personas management functions
  const fetchPersonas = async () => {
    setIsLoadingPersonas(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/personas`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (result.error) {
        console.error('Error fetching personas:', result.error);
      } else {
        setPersonasList(sortPersonasList(result.data || []));
      }
    } catch (err) {
      console.error('Error fetching personas:', err);
    } finally {
      setIsLoadingPersonas(false);
    }
  };

  const fillPersonaForm = (persona: PersonaRow) => {
    setPersonaForm({
      persona_id: persona.persona_id,
      persona_name: persona.persona_name,
      description: persona.description || '',
      instructions: persona.instructions || '',
      enabled: Boolean(persona.enabled),
      sort_order: persona.sort_order || 0,
      visibility: (persona.visibility || 'private') as 'private' | 'team' | 'public',
      team_shares: Array.isArray((persona as any).team_shares) ? (persona as any).team_shares : []
    });
  };

  const handleOpenPersonaModal = (persona?: PersonaRow, viewOnly = false) => {
    setPersonaModalError(null);
    if (persona) {
      setEditingPersona(persona);
      fillPersonaForm(persona);
      const readOnly = viewOnly || (isSystemPersona(persona) && !personaAccessContext.superuser);
      setPersonaViewOnly(readOnly);
    } else {
      setEditingPersona(null);
      setPersonaViewOnly(false);
      setPersonaForm({
        persona_id: '',
        persona_name: '',
        description: '',
        instructions: '',
        enabled: true,
        sort_order: personasList.length,
        visibility: 'private',
        team_shares: []
      });
    }
    setShowPersonaModal(true);
  };

  const handleSavePersona = async () => {
    if (personaViewOnly) return;
    if (!personaForm.persona_id || !personaForm.persona_name || !personaForm.instructions) {
      setPersonaModalError('Please fill in persona ID, name, and instructions');
      return;
    }
    setIsSavingPersona(true);
    setPersonaModalError(null);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const url = editingPersona
        ? `${getApiBaseUrl()}/personas/${editingPersona.persona_id}`
        : `${getApiBaseUrl()}/personas`;

      const response = await fetch(url, {
        method: editingPersona ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(personaForm)
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(personaApiErrorMessage(result.error?.code, result.error?.message));
      }

      const savedId = editingPersona?.persona_id || personaForm.persona_id;
      if (savedId && personaForm.visibility) {
        const visResponse = await fetch(`${getApiBaseUrl()}/personas/${savedId}/visibility`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            visibility: personaForm.visibility,
            team_ids: personaForm.team_shares
          })
        });
        const visResult = await visResponse.json();
        if (!visResponse.ok || visResult.error) {
          throw new Error(personaApiErrorMessage(visResult.error?.code, visResult.error?.message));
        }
      }

      setShowPersonaModal(false);
      setPersonaViewOnly(false);
      fetchPersonas();
    } catch (err: any) {
      setPersonaModalError(err.message || 'Failed to save persona');
    } finally {
      setIsSavingPersona(false);
    }
  };

  const handleClonePersona = async (persona: PersonaRow) => {
    setIsCloningPersona(true);
    setPersonaListError(null);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/personas/${persona.persona_id}/clone`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(personaApiErrorMessage(result.error?.code, result.error?.message));
      }
      await fetchPersonas();
      if (result.data) {
        handleOpenPersonaModal(result.data, false);
      }
      setSuccessMessage(`Cloned "${persona.persona_name}" to your library. Set it under Assignments → Chat Options if needed.`);
      setTimeout(() => setSuccessMessage(null), 8000);
    } catch (err: any) {
      setPersonaListError(err.message || 'Failed to clone persona');
    } finally {
      setIsCloningPersona(false);
    }
  };

  const handleDeletePersona = async (personaId: string) => {
    if (!confirm(`Are you sure you want to delete persona "${personaId}"? This cannot be undone.`)) return;
    setPersonaListError(null);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/personas/${personaId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(personaApiErrorMessage(result.error?.code, result.error?.message));
      }

      fetchPersonas();
    } catch (err: any) {
      setPersonaListError(err.message || 'Failed to delete persona');
    }
  };

  const handleTogglePersonaEnabled = async (persona: PersonaRow) => {
    setPersonaListError(null);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/personas/${persona.persona_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ enabled: !persona.enabled })
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(personaApiErrorMessage(result.error?.code, result.error?.message));
      }

      fetchPersonas();
    } catch (err: any) {
      setPersonaListError(err.message || 'Failed to update persona');
    }
  };

  const renderPersonaChatOptionsFields = (disabled = false) => {
    if (!editingChatOptions) return null;
    const enabledPersonas = personasList.filter((p) => p.enabled);
    const { allowAll, selectedIds } = resolveAllowedPersonasForForm(
      editingChatOptions.allowed_personas,
      enabledPersonas
    );
    const defaultOptions = personasForDefaultDropdown(enabledPersonas, editingChatOptions.allowed_personas);

    const updateAllowed = (nextAllowAll: boolean, nextSelected: string[]) => {
      const allowed_personas = nextAllowAll ? '' : formatAllowedPersonas(nextSelected);
      let default_persona = editingChatOptions.default_persona;
      const allowedSet = nextAllowAll ? enabledPersonas.map((p) => p.persona_id) : nextSelected;
      if (!allowedSet.includes(default_persona)) {
        default_persona = allowedSet[0] || default_persona;
      }
      setEditingChatOptions({ ...editingChatOptions, allowed_personas, default_persona });
    };

    return (
      <>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">Allowed Personas</label>
          <label className={`flex items-center gap-2 text-sm mb-2 ${disabled ? 'text-gray-400' : ''}`}>
            <input
              type="checkbox"
              checked={allowAll}
              disabled={disabled}
              onChange={(e) => {
                if (e.target.checked) {
                  updateAllowed(true, enabledPersonas.map((p) => p.persona_id));
                } else {
                  updateAllowed(false, selectedIds.length ? selectedIds : enabledPersonas.map((p) => p.persona_id));
                }
              }}
              className="rounded border-gray-300"
            />
            All enabled personas
          </label>
          {!allowAll && (
            <div className={`space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 ${disabled ? 'opacity-60' : ''}`}>
              {enabledPersonas.map((p) => (
                <label key={p.persona_id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.persona_id)}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selectedIds, p.persona_id]
                        : selectedIds.filter((id) => id !== p.persona_id);
                      updateAllowed(false, next.length ? next : []);
                    }}
                    className="rounded border-gray-300"
                  />
                  <span>{p.persona_name}</span>
                  <span className="text-xs text-gray-400 font-mono">({p.persona_id})</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500 mt-1">Leave &quot;All enabled&quot; checked to allow every enabled persona, including new clones.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Default Persona</label>
          <select
            value={editingChatOptions.default_persona ?? defaultOptions[0]?.persona_id ?? 'moderate'}
            onChange={(e) => setEditingChatOptions({ ...editingChatOptions, default_persona: e.target.value })}
            disabled={disabled || defaultOptions.length === 0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100"
          >
            {defaultOptions.length > 0 ? (
              defaultOptions.map((p) => (
                <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>
              ))
            ) : (
              <option value="moderate">Moderate</option>
            )}
          </select>
        </div>
      </>
    );
  };

  // Assignments tab functions
  const fetchAssignmentsSections = async () => {
    setIsLoadingAssignments(true);
    try {
      const { data, error } = await api
        .from('sections')
        .select('section_id, section_title, year_term, enabled')
        .order('year_term', { ascending: false })
        .order('section_title', { ascending: true });

      if (error) {
        console.error('Error fetching sections for assignments:', error);
      } else {
        setAssignmentsSectionsList(data || []);
      }
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const handleExpandAssignmentSection = async (sectionId: string) => {
    if (expandedAssignmentSection === sectionId) {
      setExpandedAssignmentSection(null);
      return;
    }
    setExpandedAssignmentSection(sectionId);
    await fetchSectionCases(sectionId);
  };

  const fetchCases = async () => {
    setIsLoadingCases(true);
    try {
      const { data, error } = await api.from('cases?include_scenarios=true').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching cases:', error);
      } else {
        setCasesList(data as Case[]);
      }
    } finally {
      setIsLoadingCases(false);
    }
  };

  const handleOpenCaseModal = (caseItem?: Case) => {
    if (caseItem) {
      setEditingCase(caseItem);
      setCaseForm({
        case_id: caseItem.case_id,
        case_title: caseItem.case_title,
        case_version: caseItem.case_version || '',
        protagonist: caseItem.protagonist || '',
        protagonist_initials: caseItem.protagonist_initials || '',
        chat_topic: caseItem.chat_topic || '',
        chat_question: caseItem.chat_question || '',
        enabled: caseItem.enabled,
        visibility: (caseItem.visibility as any) || 'private',
        team_shares: caseItem.team_shares || []
      });
    } else {
      setEditingCase(null);
      setCaseForm({
        case_id: '',
        case_title: '',
        case_version: '',
        protagonist: '',
        protagonist_initials: '',
        chat_topic: '',
        chat_question: '',
        enabled: true,
        visibility: 'private',
        team_shares: []
      });
    }
    setGoToScenariosAfterCreate(false);
    setShowCaseModal(true);
  };

  const handleSaveCase = async (openScenariosAfter: boolean = false) => {
    // Only case_id and case_title are required - other fields are optional and moved to scenarios
    if (!caseForm.case_id || !caseForm.case_title) {
      setError('Please fill in Case ID and Case Title');
      return;
    }
    setIsSavingCase(true);
    const createdCaseId = caseForm.case_id;
    try {
      if (editingCase) {
        const { error } = await api.from('cases').update({
          case_title: caseForm.case_title,
          case_version: caseForm.case_version || null,
          protagonist: caseForm.protagonist || null,
          protagonist_initials: caseForm.protagonist_initials || null,
          chat_topic: caseForm.chat_topic || null,
          chat_question: caseForm.chat_question || null,
          enabled: caseForm.enabled
        }).eq('case_id', editingCase.case_id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await api.from('cases').insert({
          case_id: caseForm.case_id,
          case_title: caseForm.case_title,
          case_version: caseForm.case_version || null,
          protagonist: caseForm.protagonist || null,
          protagonist_initials: caseForm.protagonist_initials || null,
          chat_topic: caseForm.chat_topic || null,
          chat_question: caseForm.chat_question || null,
          enabled: caseForm.enabled
        });
        if (error) throw new Error(error.message);
      }
      const savedCaseId = editingCase?.case_id || caseForm.case_id;
      if (savedCaseId && caseForm.visibility) {
        try {
          const token = localStorage.getItem('admin_auth_token');
          await fetch(`${getApiBaseUrl()}/cases/${encodeURIComponent(savedCaseId)}/visibility`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            body: JSON.stringify({ visibility: caseForm.visibility, team_ids: caseForm.team_shares })
          });
        } catch { /* ignore — visibility is optional */ }
      }

      setShowCaseModal(false);
      fetchCases();

      // If user clicked "Create and go to Scenarios", open ScenarioManager for the new case
      if (openScenariosAfter && !editingCase) {
        // Fetch the newly created case directly (casesList state won't be updated yet)
        const { data: newCaseData } = await api.from('cases').select('*').eq('case_id', createdCaseId).single();
        if (newCaseData) {
          setManagingScenarioCase(newCaseData);
          setShowScenarioManager(true);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save case');
    } finally {
      setIsSavingCase(false);
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    if (!confirm(`Are you sure you want to delete case "${caseId}"? This cannot be undone.`)) return;
    try {
      const { error } = await api.from('cases').delete().eq('case_id', caseId);
      if (error) throw new Error(error.message);
      fetchCases();
    } catch (err: any) {
      setError(err.message || 'Failed to delete case');
    }
  };

  const handleToggleCaseEnabled = async (caseItem: Case) => {
    try {
      const { error } = await api.from('cases').update({ enabled: !caseItem.enabled }).eq('case_id', caseItem.case_id);
      if (error) throw new Error(error.message);
      fetchCases();
    } catch (err: any) {
      setError(err.message || 'Failed to update case');
    }
  };

  const handleUploadCaseFile = async (caseId: string, fileType: 'case' | 'teaching_note', file: File) => {
    setIsUploadingCaseFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('file_type', fileType);
      
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/cases/${caseId}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Upload failed');
      }
      
      alert(`${fileType === 'case' ? 'Case document' : 'Teaching note'} uploaded successfully!`);
      fetchCases();
    } catch (err: any) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setIsUploadingCaseFile(false);
    }
  };

  // Section-Case management functions
  const handleOpenSectionCasesModal = async (section: SectionStat) => {
    setManagingSectionCases(section);
    setShowSectionCasesModal(true);
    await fetchSectionCases(section.section_id);
    // Also ensure cases list is loaded
    if (casesList.length === 0) {
      fetchCases();
    }
  };

  const fetchSectionCases = async (sectionId: string) => {
    setIsLoadingSectionCases(true);
    try {
      const { data, error } = await api.from(`sections/${sectionId}/cases`).select('*');
      if (error) throw new Error(error.message);
      setSectionCasesList(data || []);
    } catch (err: any) {
      console.error('Error fetching section cases:', err);
      setSectionCasesList([]);
    } finally {
      setIsLoadingSectionCases(false);
    }
  };

  const handleAssignCaseToSection = async (sectionId: string, caseId: string) => {
    try {
      const { error } = await api.from(`sections/${sectionId}/cases`).insert({ case_id: caseId, active: false });
      if (error) throw new Error(error.message);
      fetchSectionCases(sectionId);
    } catch (err: any) {
      setError(err.message || 'Failed to assign case');
    }
  };

  const handleRemoveCaseFromSection = async (sectionId: string, caseId: string) => {
    if (!confirm('Remove this case from the section?')) return;
    try {
      const { error } = await api.from(`sections/${sectionId}/cases/${caseId}`).delete();
      if (error) throw new Error(error.message);
      fetchSectionCases(sectionId);
      fetchSectionStats(); // Refresh section list to update active case display
    } catch (err: any) {
      setError(err.message || 'Failed to remove case');
    }
  };

  const handleActivateSectionCase = async (sectionId: string, caseId: string) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/activate`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to activate case');
      }
      fetchSectionCases(sectionId);
      fetchSectionStats(); // Refresh section list to update active case display
    } catch (err: any) {
      setError(err.message || 'Failed to activate case');
    }
  };

  const handleDeactivateSectionCase = async (sectionId: string, caseId: string) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/deactivate`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to deactivate case');
      }
      fetchSectionCases(sectionId);
      fetchSectionStats(); // Refresh section list to update active case display
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate case');
    }
  };

  // Chat options functions (Phase 2)
  const handleExpandChatOptions = (caseId: string, currentOptions: any) => {
    if (expandedCaseOptions === caseId) {
      setExpandedCaseOptions(null);
      setEditingChatOptions(null);
    } else {
      setExpandedCaseOptions(caseId);
      setEditingChatOptions(currentOptions ? { ...currentOptions } : { ...defaultChatOptions });
    }
  };

  const handleSaveChatOptions = async (sectionId: string, caseId: string) => {
    setIsSavingChatOptions(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/options`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ chat_options: editingChatOptions })
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to save options');
      }
      await fetchSectionCases(sectionId);
      setUseDefaultOptions(false);
      setSuccessMessage('Chat options saved successfully');
      setTimeout(() => setSuccessMessage(null), 8000);
    } catch (err: any) {
      setError(err.message || 'Failed to save chat options');
    } finally {
      setIsSavingChatOptions(false);
    }
  };

  const handleResetChatOptions = () => {
    setEditingChatOptions({ ...defaultChatOptions });
  };

  // Chat options category toggle functions
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const expandAllCategories = () => {
    setExpandedCategories(new Set(['hints', 'display', 'persona', 'instructions', 'controls', 'advanced']));
  };

  const collapseAllCategories = () => {
    setExpandedCategories(new Set());
  };

  // Scheduling functions
  const handleExpandScheduling = (caseId: string, currentScheduling: any) => {
    if (expandedScheduling === caseId) {
      setExpandedScheduling(null);
      setEditingScheduling(null);
    } else {
      setExpandedScheduling(caseId);
      // Format dates for datetime-local input
      const formatDateForInput = (dateStr: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - offset * 60 * 1000);
        return localDate.toISOString().slice(0, 16);
      };

      setEditingScheduling({
        open_date: formatDateForInput(currentScheduling?.open_date),
        close_date: formatDateForInput(currentScheduling?.close_date),
        manual_status: currentScheduling?.manual_status || 'auto'
      });
    }
  };

  const handleSaveScheduling = async (sectionId: string, caseId: string) => {
    setIsSavingScheduling(true);
    try {
      const token = localStorage.getItem('admin_auth_token');

      // Convert datetime-local values back to ISO strings or null
      const schedulingData = {
        open_date: editingScheduling.open_date ? new Date(editingScheduling.open_date).toISOString() : null,
        close_date: editingScheduling.close_date ? new Date(editingScheduling.close_date).toISOString() : null,
        manual_status: editingScheduling.manual_status
      };

      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/scheduling`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(schedulingData)
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to update scheduling');
      }
      setExpandedScheduling(null);
      setEditingScheduling(null);
      // Refresh the section cases list
      if (expandedAssignmentSection) {
        fetchSectionCases(expandedAssignmentSection);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update scheduling');
    } finally {
      setIsSavingScheduling(false);
    }
  };

  // Expand/collapse position settings panel
  const handleExpandPositionSettings = async (sectionId: string, caseId: string, sectionCase: any) => {
    if (expandedPositionSettings === caseId) {
      setExpandedPositionSettings(null);
      setAssignmentPositions([]);
      return;
    }

    setExpandedPositionSettings(caseId);
    setIsLoadingPositionSettings(true);

    try {
      const token = localStorage.getItem('admin_auth_token');

      // Load position settings from section_cases
      const settingsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/position-settings`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const settingsResult = await settingsResponse.json();
      if (settingsResult.data) {
        setPositionSettings({
          position_tracking_enabled: isEnabledFlag(settingsResult.data.position_tracking_enabled),
          position_capture_method: settingsResult.data.position_capture_method || 'explicit',
          track_position_change: !isDisabledFlag(settingsResult.data.track_position_change)
        });
      }

      // Load positions for this assignment (from all assigned scenarios)
      const positionsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const positionsResult = await positionsResponse.json();
      if (positionsResult.data) {
        setAssignmentPositions(positionsResult.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load position settings');
    } finally {
      setIsLoadingPositionSettings(false);
    }
  };

  // Save position settings for section-case
  const handleSavePositionSettings = async (sectionId: string, caseId: string) => {
    setIsSavingPositionSettings(true);
    try {
      const token = localStorage.getItem('admin_auth_token');

      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/position-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(positionSettings)
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to update position settings');
      }
      setExpandedPositionSettings(null);
      // Refresh the section cases list
      if (selectedAssignmentSection) {
        fetchSectionCases(selectedAssignmentSection);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update position settings');
    } finally {
      setIsSavingPositionSettings(false);
    }
  };

  // Toggle position enabled for an assignment
  const handleToggleAssignmentPosition = async (sectionId: string, caseId: string, positionId: number) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions/${positionId}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to toggle position');
      }
      // Refresh positions
      const positionsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const positionsResult = await positionsResponse.json();
      if (positionsResult.data) {
        setAssignmentPositions(positionsResult.data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle position');
    }
  };

  // Handle drag end for position reordering
  const handlePositionDragEnd = async (event: DragEndEvent, sectionId: string, caseId: string) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = assignmentPositions.findIndex(p => p.position_id === active.id);
    const newIndex = assignmentPositions.findIndex(p => p.position_id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder locally first for immediate feedback
    const reordered = arrayMove(assignmentPositions, oldIndex, newIndex);
    setAssignmentPositions(reordered);

    // Save to API
    try {
      const token = localStorage.getItem('admin_auth_token');
      const positions = reordered.map((p, idx) => ({
        position_id: p.position_id,
        sort_order: idx
      }));

      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions/reorder`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ positions })
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to reorder positions');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reorder positions');
      // Revert on error - refetch positions
      const token = localStorage.getItem('admin_auth_token');
      const positionsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const positionsResult = await positionsResponse.json();
      if (positionsResult.data) {
        setAssignmentPositions(positionsResult.data);
      }
    }
  };

  // Expand/collapse scenario assignment panel
  const handleExpandScenarios = async (sectionId: string, caseId: string, sectionCase: any) => {
    if (expandedScenarios === caseId) {
      setExpandedScenarios(null);
      setAvailableScenariosForCase([]);
      setAssignedScenarios([]);
      setAssignmentPositions([]);
      return;
    }

    setExpandedScenarios(caseId);
    setIsLoadingScenarioAssignment(true);
    setAssignmentPositions([]);
    setAssignedScenarios([]);

    try {
      const token = localStorage.getItem('admin_auth_token');

      // Fetch all scenarios for this case
      const scenariosResponse = await fetch(`${getApiBaseUrl()}/cases/${caseId}/scenarios`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const scenariosResult = await scenariosResponse.json();
      const allScenarios = scenariosResult.data || [];
      setAvailableScenariosForCase(allScenarios);

      // Fetch assigned scenarios for this section-case
      const assignedResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/scenarios`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const assignedResult = await assignedResponse.json();
      // API returns { data: { scenarios: [...], selection_mode, ... } }
      const assignedData = assignedResult.data || {};
      setAssignedScenarios(assignedData.scenarios || []);

      // Set current settings from API response (more reliable than sectionCase object)
      setScenarioSettings({
        use_scenarios: assignedData.use_scenarios ?? sectionCase.use_scenarios ?? false,
        selection_mode: assignedData.selection_mode || sectionCase.selection_mode || 'student_choice',
        require_order: assignedData.require_order ?? sectionCase.require_order ?? false
      });

      // Also load positions for this assignment (needed for displaying under scenarios)
      const positionsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/positions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const positionsResult = await positionsResponse.json();
      const loadedPositions = positionsResult.data || [];
      setAssignmentPositions(loadedPositions);

      // Load position settings from section_cases
      const settingsResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/position-settings`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const settingsResult = await settingsResponse.json();
      if (settingsResult.data) {
        setPositionSettings({
          // Reflect persisted DB value; do not auto-enable when positions exist.
          position_tracking_enabled: isEnabledFlag(settingsResult.data.position_tracking_enabled),
          position_capture_method: settingsResult.data.position_capture_method || 'explicit',
          track_position_change: !isDisabledFlag(settingsResult.data.track_position_change)
        });
      }
    } catch (err) {
      console.error('Failed to load scenario assignments:', err);
      setAvailableScenariosForCase([]);
      setAssignedScenarios([]);
      setAssignmentPositions([]);
    } finally {
      setIsLoadingScenarioAssignment(false);
    }
  };

  // Toggle scenario assignment
  const handleToggleScenarioAssignment = async (sectionId: string, caseId: string, scenarioId: number, isAssigned: boolean) => {
    const token = localStorage.getItem('admin_auth_token');
    try {
      if (isAssigned) {
        // Remove assignment
        await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/scenarios/${scenarioId}`, {
          method: 'DELETE',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        setAssignedScenarios(prev => prev.filter(s => s.scenario_id !== scenarioId));
      } else {
        // Add assignment
        const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/scenarios`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ scenario_ids: [scenarioId] })
        });
        const result = await response.json();
        if (result.data) {
          // Refresh assigned scenarios
          const assignedResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/scenarios`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });
          const assignedResult = await assignedResponse.json();
          setAssignedScenarios(assignedResult.data?.scenarios || []);
        }
      }
    } catch (err) {
      console.error('Failed to toggle scenario assignment:', err);
    }
  };

  // View scenario details in modal
  const handleViewScenario = async (scenario: any, caseId: string, caseTitle: string) => {
    setViewingScenario({ ...scenario, case_id: caseId, case_title: caseTitle });
    setViewingScenarioPositions([]);
    setIsLoadingViewScenarioPositions(true);

    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/cases/${caseId}/scenarios/${scenario.id}/positions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const result = await response.json();
      setViewingScenarioPositions(result.data || []);
    } catch (err) {
      console.error('Failed to fetch scenario positions:', err);
    } finally {
      setIsLoadingViewScenarioPositions(false);
    }
  };

  // Save scenario selection mode settings
  const handleSaveScenarioSettings = async (sectionId: string, caseId: string) => {
    setIsSavingScenarioAssignment(true);
    try {
      const token = localStorage.getItem('admin_auth_token');

      // Save scenario selection settings
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/selection-mode`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(scenarioSettings)
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to update scenario settings');
      }

      // Also save position tracking settings if there are positions defined
      if (assignmentPositions.length > 0) {
        const positionResponse = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/position-settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(positionSettings)
        });
        const positionResult = await positionResponse.json();
        if (!positionResponse.ok || positionResult.error) {
          throw new Error(positionResult.error?.message || 'Failed to update position settings');
        }
      }

      // Refresh section cases
      if (expandedAssignmentSection) {
        fetchSectionCases(expandedAssignmentSection);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update scenario settings');
    } finally {
      setIsSavingScenarioAssignment(false);
    }
  };

  // Toggle allow_rechat for a student's evaluation
  const handleToggleRechat = async (evaluationId: string, currentAllowRechat: boolean) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/evaluations/${evaluationId}/allow-rechat`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ allow_rechat: !currentAllowRechat })
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to update re-chat status');
      }
      // Refresh student details
      if (selectedSection) {
        fetchStudentDetails(selectedSection.section_id, filterCaseId !== 'all' ? filterCaseId : null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update re-chat status');
    }
  };

  const handleBackToSections = () => {
    setSelectedSection(null);
    setStudentDetails([]);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'full_name' || key === 'persona' || key === 'status' ? 'asc' : 'desc');
    }
  };

  // Filter sections based on showAllSections toggle
  const filteredSections = useMemo(() => {
    if (showAllSections) {
      return sectionStats;
    }
    // Show only enabled sections (plus always show unassigned and other_courses if they have students)
    return sectionStats.filter(s => s.enabled || s.section_id === 'unassigned' || s.section_id === 'other_courses');
  }, [sectionStats, showAllSections]);

  // Unique semesters derived from allCourses, sorted current first then by name desc.
  // Used by the Edit/Create Section modal.
  const allSemesters = useMemo(() => {
    const map = new Map<number, { id: number; name: string; is_current: boolean }>();
    for (const c of allCourses) {
      if (c.semester_id != null && !map.has(c.semester_id)) {
        map.set(c.semester_id, {
          id: c.semester_id,
          name: c.semester_name || 'Unknown',
          is_current: !!c.is_current
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.is_current && !b.is_current) return -1;
      if (!a.is_current && b.is_current) return 1;
      return b.name.localeCompare(a.name);
    });
  }, [allCourses]);

  // Group sections by semester and course for hierarchical view
  const groupedSections = useMemo(() => {
    const groups: {
      semesterId: number | null;
      semesterName: string;
      semesterIsCurrent: boolean;
      courses: {
        courseId: number | null;
        courseName: string;
        sections: typeof filteredSections;
      }[];
    }[] = [];

    // Group by semester first
    const semesterMap = new Map<number | null, typeof filteredSections>();
    filteredSections.forEach(section => {
      const semId = (section as any).semester_id || null;
      if (!semesterMap.has(semId)) {
        semesterMap.set(semId, []);
      }
      semesterMap.get(semId)!.push(section);
    });

    // Then group by course within each semester
    semesterMap.forEach((sections, semId) => {
      const semesterName = semId ? (sections[0] as any).semester_name || 'Unknown' : 'Unassigned';
      const semesterIsCurrent = semId ? (sections[0] as any).semester_is_current : false;

      const courseMap = new Map<number | null, typeof filteredSections>();
      sections.forEach(section => {
        const courseId = (section as any).course_id_num || null;
        if (!courseMap.has(courseId)) {
          courseMap.set(courseId, []);
        }
        courseMap.get(courseId)!.push(section);
      });

      const courses: typeof groups[0]['courses'] = [];
      courseMap.forEach((courseSections, courseId) => {
        courses.push({
          courseId,
          courseName: courseId ? (courseSections[0] as any).course_name || 'Unknown' : 'No Course',
          sections: courseSections
        });
      });

      // Sort courses alphabetically
      courses.sort((a, b) => a.courseName.localeCompare(b.courseName));

      groups.push({
        semesterId: semId,
        semesterName,
        semesterIsCurrent,
        courses
      });
    });

    // Sort semesters: current first, then by name descending
    groups.sort((a, b) => {
      if (a.semesterIsCurrent && !b.semesterIsCurrent) return -1;
      if (!a.semesterIsCurrent && b.semesterIsCurrent) return 1;
      if (a.semesterId === null) return 1;
      if (b.semesterId === null) return -1;
      return b.semesterName.localeCompare(a.semesterName);
    });

    return groups;
  }, [filteredSections]);

  // Toggle collapse for semester/course
  const toggleSemesterCollapse = (semesterId: number | null) => {
    const key = String(semesterId);
    setCollapsedSemesters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCourseCollapse = (semesterId: number | null, courseId: number | null) => {
    const key = `${semesterId}-${courseId}`;
    setCollapsedCourses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Shared table header for List and Grouped section views
  const renderSectionTableHeader = (opts: { hideTermColumn?: boolean } = {}) => (
    <thead className="bg-gray-50">
      <tr>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
        {!opts.hideTermColumn && (
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Term</th>
        )}
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active Cases</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Students</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">New Students</th>
        {showModelsColumn && (
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chat Model</th>
        )}
        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
          <label className="text-xs text-gray-500 flex items-center gap-1 cursor-pointer justify-end">
            <input
              type="checkbox"
              checked={showModelsColumn}
              onChange={(e) => setShowModelsColumn(e.target.checked)}
              className="h-3 w-3 rounded border-gray-300"
            />
            Models
          </label>
        </th>
      </tr>
    </thead>
  );

  // Shared row renderer for List and Grouped section views
  const renderSectionRow = (section: SectionStat, opts: { hideTermColumn?: boolean } = {}) => {
    const isSynthetic = section.section_id === 'unassigned' || section.section_id === 'other_courses';
    const enrollmentCount = section.student_count ?? 0;
    return (
      <tr
        key={section.section_id}
        className={`hover:bg-gray-50 transition-colors ${
          !section.enabled ? 'opacity-70' : ''
        }`}
      >
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {!isSynthetic && (() => {
              const r = sectionReadiness[section.section_id];
              if (!r) return null;
              return r.ready ? (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"
                  title="Ready: instructor API keys configured for all required providers."
                />
              ) : (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"
                  title={`Setup incomplete: missing API key for ${r.missing.join(', ')}. Students cannot chat until the instructor configures keys (or an admin grants use_system_key).`}
                />
              );
            })()}
            <span className={`font-medium ${!section.enabled ? 'text-gray-500' : 'text-gray-900'}`}>
              {section.section_title}
            </span>
          </div>
        </td>
        {!opts.hideTermColumn && (
          <td className="px-4 py-3 whitespace-nowrap">
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
              {section.year_term}
            </span>
            {section.primary_instructor_name && (
              <span className="ml-1 text-xs text-purple-600" title="Primary Instructor">
                {section.primary_instructor_name}
              </span>
            )}
          </td>
        )}
        <td className="px-4 py-3 whitespace-nowrap">
          {!isSynthetic ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleOpenSectionCasesModal(section); }}
              className={`px-2 py-1 text-xs font-medium rounded-lg border transition-colors ${
                section.active_case_count && section.active_case_count > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
              title={section.active_case_titles || 'Manage case assignments'}
            >
              {section.active_case_count && section.active_case_count > 0
                ? `${section.active_case_count} active`
                : 'No case'}
            </button>
          ) : (
            <span className="text-xs text-gray-400">-</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {!isSynthetic ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNavigate('courses', 'students', { section_id: section.section_id });
              }}
              className="px-2 py-1 text-xs font-medium rounded-lg border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
              title="View students enrolled in this section"
            >
              {enrollmentCount} {enrollmentCount === 1 ? 'student' : 'students'}
            </button>
          ) : (
            <span className="text-sm text-gray-600">{enrollmentCount}</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {!isSynthetic ? (
            <button
              onClick={(e) => handleToggleStatus(section, e)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                section.enabled
                  ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-200'
                  : 'bg-pink-100 text-pink-800 hover:bg-pink-200 border border-pink-200'
              }`}
              title={`Click to ${section.enabled ? 'disable' : 'enable'}`}
            >
              {section.enabled ? 'Enabled' : 'Disabled'}
            </button>
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {!isSynthetic ? (() => {
            const hasKey = !!(section.enrollment_key && String(section.enrollment_key).trim() !== '');
            const accepting = !!section.accept_new_students;
            const label = !accepting ? 'Locked' : (hasKey ? 'Accept w/key' : 'Accept NO key');
            const tooltip = !accepting
              ? 'Locked — click to accept new students'
              : hasKey
                ? `Accepting new students. Enrollment key: ${section.enrollment_key} — share via syllabus. Click Edit to change.`
                : 'Accepting new students with no enrollment key — any BYU CAS user can join. Click Edit to set an enrollment key (recommended).';
            const cls = !accepting
              ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              : hasKey
                ? 'bg-pink-500 text-white hover:bg-pink-600'
                : 'bg-pink-200 text-pink-900 hover:bg-pink-300';
            return (
              <button
                onClick={(e) => handleToggleAcceptNewStudents(section, e)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${cls}`}
                title={tooltip}
              >
                {label}
              </button>
            );
          })() : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </td>
        {showModelsColumn && (
          <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
            {formatModelDisplay(section.chat_model)}
          </td>
        )}
        <td className="px-4 py-3 whitespace-nowrap text-right">
          <div className="flex justify-end gap-1">
            {section.section_id !== 'unassigned' && (
              <>
                <button
                  onClick={(e) => handleEditSection(section, e)}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title="Edit section"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => handleDuplicateSection(section, e)}
                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                  title="Duplicate section"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                    <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
                  </svg>
                </button>
              </>
            )}
            <button
              onClick={() => handleSectionClick(section)}
              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
              title="View results"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // Calculate section statistics
  const sectionSummaryStats = useMemo((): SectionStats | null => {
    if (!studentDetails.length) return null;
    
    const completed = studentDetails.filter(s => s.status === 'completed');
    const inProgress = studentDetails.filter(s => s.status === 'in_progress');
    
    const scores = completed.map(s => s.score).filter((s): s is number => s !== null);
    const hints = completed.map(s => s.hints).filter((h): h is number => h !== null);
    const helpfuls = completed.map(s => s.helpful).filter((h): h is number => h !== null);
    
    return {
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      avgHints: hints.length ? hints.reduce((a, b) => a + b, 0) / hints.length : null,
      avgHelpful: helpfuls.length ? helpfuls.reduce((a, b) => a + b, 0) / helpfuls.length : null,
      completionRate: studentDetails.length ? (completed.length / studentDetails.length) * 100 : 0,
      totalStudents: studentDetails.length,
      completedStudents: completed.length,
      inProgressStudents: inProgress.length,
    };
  }, [studentDetails]);

  // Score distribution for chart
  const scoreDistribution = useMemo(() => {
    const distribution = new Array(16).fill(0); // 0-15 scores
    studentDetails.forEach(s => {
      if (s.score !== null && s.score >= 0 && s.score <= 15) {
        distribution[s.score]++;
      }
    });
    return distribution;
  }, [studentDetails]);

  const sortedStudentDetails = useMemo(() => {
    let filtered = studentDetails;
    
    // Apply filter mode
    if (filterMode !== 'all') {
      filtered = filtered.filter(student => student.status === filterMode);
    }
    
    // Note: Case filter is applied at the database level in fetchStudentDetails
    
    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(student => 
        student.full_name.toLowerCase().includes(query)
      );
    }

    return [...filtered].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];

      if (valA === null) return 1;
      if (valB === null) return -1;
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [studentDetails, sortKey, sortDirection, filterMode, filterCaseId, searchQuery]);

  // Export to MySQL helpers
  const [isExporting, setIsExporting] = useState(false);

  const sqlEscapeString = (value: string): string => {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/\u0000/g, "")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\u001a/g, "")
      .replace(/'/g, "\\'");
  };

  const sqlValue = (val: any): string => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (val instanceof Date) return `'${sqlEscapeString(val.toISOString().slice(0, 19).replace('T', ' '))}'`;
    if (typeof val === 'string') {
      const d = new Date(val);
      if (!isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
        const ts = d.toISOString().slice(0, 19).replace('T', ' ');
        return `'${sqlEscapeString(ts)}'`;
      }
      return `'${sqlEscapeString(val)}'`;
    }
    try {
      const json = JSON.stringify(val);
      return json === undefined ? 'NULL' : `'${sqlEscapeString(json)}'`;
    } catch {
      return 'NULL';
    }
  };

  const handleDownloadToMySQL = useCallback(async () => {
    if (isExporting) return;
    const confirmed = window.confirm('Download SQL to upsert data into MySQL (models, sections, students, evaluations)?');
    if (!confirmed) return;
    setIsExporting(true);
    try {
      const [modelsRes, sectionsRes, studentsRes, evalsRes] = await Promise.all([
        api.from('models').select('*'),
        api.from('sections').select('*'),
        api.from('students').select('*'),
        api.from('evaluations').select('*'),
      ]);

      const errors: string[] = [];
      if (modelsRes.error) errors.push(`models: ${modelsRes.error.message}`);
      if (sectionsRes.error) errors.push(`sections: ${sectionsRes.error.message}`);
      if (studentsRes.error) errors.push(`students: ${studentsRes.error.message}`);
      if (evalsRes.error) errors.push(`evaluations: ${evalsRes.error.message}`);
      if (errors.length) {
        alert('Failed to fetch some data from database:\n' + errors.join('\n'));
        setIsExporting(false);
        return;
      }

      const models = modelsRes.data || [];
      const sections = sectionsRes.data || [];
      const students = studentsRes.data || [];
      const evaluations = evalsRes.data || [];

      const lines: string[] = [];
      lines.push('-- Upsert script for ceochat (MySQL)');
      lines.push('USE ceochat;');
      lines.push('SET FOREIGN_KEY_CHECKS=0;');

      for (const m of models) {
        const cols = ['model_id','model_name','vendor','enabled','default_model','cpm_input','cpm_input_cache','cpm_output'];
        const vals = [
          sqlValue(m.model_id),
          sqlValue(m.model_name),
          sqlValue((m as any).vendor),
          sqlValue(m.enabled),
          sqlValue((m as any).default),
          sqlValue((m as any).cpm_input),
          sqlValue((m as any).cpm_input_cache),
          sqlValue((m as any).cpm_output),
        ];
        const updates = ['model_name=VALUES(model_name)','vendor=VALUES(vendor)','enabled=VALUES(enabled)','default_model=VALUES(default_model)','cpm_input=VALUES(cpm_input)','cpm_input_cache=VALUES(cpm_input_cache)','cpm_output=VALUES(cpm_output)'];
        lines.push(`INSERT INTO models (${cols.join(',')}) VALUES (${vals.join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',')};`);
      }

      for (const s of sections) {
        const cols = ['section_id','created_at','section_title','year_term','enabled','chat_model','super_model'];
        const vals = [
          sqlValue(s.section_id),
          sqlValue(s.created_at),
          sqlValue(s.section_title),
          sqlValue(s.year_term),
          sqlValue(s.enabled),
          sqlValue(s.chat_model),
          sqlValue(s.super_model),
        ];
        const updates = ['created_at=VALUES(created_at)','section_title=VALUES(section_title)','year_term=VALUES(year_term)','enabled=VALUES(enabled)','chat_model=VALUES(chat_model)','super_model=VALUES(super_model)'];
        lines.push(`INSERT INTO sections (${cols.join(',')}) VALUES (${vals.join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',')};`);
      }

      for (const st of students) {
        const cols = ['id','created_at','first_name','last_name','full_name','favorite_persona','section_id','finished_at'];
        const vals = [
          sqlValue(st.id),
          sqlValue(st.created_at),
          sqlValue(st.first_name),
          sqlValue(st.last_name),
          sqlValue(st.full_name),
          sqlValue(st.favorite_persona),
          sqlValue(st.section_id),
          sqlValue(st.finished_at),
        ];
        const updates = ['created_at=VALUES(created_at)','first_name=VALUES(first_name)','last_name=VALUES(last_name)','full_name=VALUES(full_name)','favorite_persona=VALUES(favorite_persona)','section_id=VALUES(section_id)','finished_at=VALUES(finished_at)'];
        lines.push(`INSERT INTO students (${cols.join(',')}) VALUES (${vals.join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',')};`);
      }

      for (const e of evaluations) {
        const cols = ['id','created_at','student_id','score','summary','criteria','persona','hints','helpful','liked','improve','chat_model','super_model','transcript'];
        const vals = [
          sqlValue(e.id),
          sqlValue(e.created_at),
          sqlValue(e.student_id),
          sqlValue(e.score),
          sqlValue(e.summary),
          sqlValue(e.criteria),
          sqlValue(e.persona),
          sqlValue(e.hints),
          sqlValue(e.helpful),
          sqlValue(e.liked),
          sqlValue(e.improve),
          sqlValue(e.chat_model),
          sqlValue(e.super_model),
          sqlValue(e.transcript),
        ];
        const updates = ['created_at=VALUES(created_at)','student_id=VALUES(student_id)','score=VALUES(score)','summary=VALUES(summary)','criteria=VALUES(criteria)','persona=VALUES(persona)','hints=VALUES(hints)','helpful=VALUES(helpful)','liked=VALUES(liked)','improve=VALUES(improve)','chat_model=VALUES(chat_model)','super_model=VALUES(super_model)','transcript=VALUES(transcript)'];
        lines.push(`INSERT INTO evaluations (${cols.join(',')}) VALUES (${vals.join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',')};`);
      }

      lines.push('SET FOREIGN_KEY_CHECKS=1;');

      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'text/sql;charset=utf-8' });
      const a = document.createElement('a');
      const ts = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const fname = `ceochat-upsert-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.sql`;
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      console.error('Export to MySQL failed', err);
      alert('Export failed. See console for details.');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  // CSV Export
  const handleDownloadCSV = useCallback(() => {
    if (!selectedSection || !sortedStudentDetails.length) {
      alert('No data to export. Select a section with students first.');
      return;
    }
    
    const headers = ['Student Name', 'CEO Persona', 'Status', 'Score', 'Hints', 'Helpful Rating', 'Chat Model', 'Super Model', 'Completion Time', 'Liked Feedback', 'Improve Feedback'];
    const rows = sortedStudentDetails.map(s => [
      s.full_name,
      s.persona || '',
      s.status,
      s.score !== null ? s.score.toString() : '',
      s.hints !== null ? s.hints.toString() : '',
      s.helpful !== null ? s.helpful.toFixed(1) : '',
      s.chat_model ? (modelsMap.get(s.chat_model) || s.chat_model) : '',
      s.super_model ? (modelsMap.get(s.super_model) || s.super_model) : '',
      s.completion_time ? new Date(s.completion_time).toLocaleString() : '',
      s.liked || '',
      s.improve || '',
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fname = `${selectedSection.section_title.replace(/[^a-z0-9]/gi, '_')}-students-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}.csv`;
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [selectedSection, sortedStudentDetails, modelsMap]);

  // Bulk selection handlers
  const handleToggleSelectStudent = useCallback((studentId: string) => {
    setSelectedStudentIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAllStudents = useCallback(() => {
    if (selectedStudentIds.size === sortedStudentDetails.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(sortedStudentDetails.map(s => s.id)));
    }
  }, [sortedStudentDetails, selectedStudentIds.size]);

  const handleBulkExportCSV = useCallback(() => {
    if (!selectedSection || selectedStudentIds.size === 0) {
      alert('No students selected. Select students using checkboxes first.');
      return;
    }

    const selectedStudents = sortedStudentDetails.filter(s => selectedStudentIds.has(s.id));
    const headers = ['Student Name', 'CEO Persona', 'Status', 'Score', 'Hints', 'Helpful Rating', 'Chat Model', 'Super Model', 'Completion Time'];
    const rows = selectedStudents.map(s => [
      s.full_name,
      s.persona || '',
      s.status,
      s.score !== null ? s.score.toString() : '',
      s.hints !== null ? s.hints.toString() : '',
      s.helpful !== null ? s.helpful.toFixed(1) : '',
      s.chat_model ? (modelsMap.get(s.chat_model) || s.chat_model) : '',
      s.super_model ? (modelsMap.get(s.super_model) || s.super_model) : '',
      s.completion_time ? new Date(s.completion_time).toLocaleString() : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fname = `selected-students-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}.csv`;
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    setSelectedStudentIds(new Set()); // Clear selection after export
  }, [selectedSection, sortedStudentDetails, selectedStudentIds, modelsMap]);

  const handleClearSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  // Section CRUD operations
  const handleCreateSection = () => {
    setEditingSection(null);
    setSectionForm({
      section_id: '',
      section_title: '',
      year_term: '',
      chat_model: '',
      super_model: '',
      enabled: true,
      accept_new_students: false,
      enrollment_key: '',
      semester_id: null,
      course_id: null
    });
    setShowSectionModal(true);
  };

  const handleEditSection = (section: SectionStat, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (section.section_id === 'unassigned') return;
    setEditingSection(section);
    setSectionForm({
      section_id: section.section_id,
      section_title: section.section_title,
      year_term: section.year_term,
      chat_model: section.chat_model || '',
      super_model: section.super_model || '',
      enabled: !!section.enabled,
      accept_new_students: !!section.accept_new_students,
      enrollment_key: section.enrollment_key || '',
      semester_id: section.semester_id ?? null,
      course_id: section.course_id_num ?? section.course_id ?? null
    });
    setShowSectionModal(true);
  };

  const handleSaveSection = async () => {
    if (!sectionForm.section_id.trim() || !sectionForm.section_title.trim()) {
      alert('Section ID and Title are required.');
      return;
    }
    if (sectionForm.semester_id == null) {
      alert('Please select a Semester.');
      return;
    }

    // Verify the chosen course (if any) belongs to the chosen semester.
    if (sectionForm.course_id != null) {
      const chosenCourse = allCourses.find(c => c.id === sectionForm.course_id);
      if (!chosenCourse || chosenCourse.semester_id !== sectionForm.semester_id) {
        alert('The selected course does not belong to the selected semester.');
        return;
      }
    }

    // Derive year_term from the selected semester's name so existing UI that
    // still reads year_term keeps working without a data migration.
    const semesterCourse = allCourses.find(c => c.semester_id === sectionForm.semester_id);
    const derivedYearTerm = semesterCourse?.semester_name || sectionForm.year_term || '';

    try {
      if (editingSection) {
        const { error } = await api
          .from('sections')
          .update({
            section_title: sectionForm.section_title,
            year_term: derivedYearTerm,
            chat_model: sectionForm.chat_model || null,
            super_model: sectionForm.super_model || null,
            enabled: sectionForm.enabled,
            accept_new_students: sectionForm.accept_new_students,
            enrollment_key: sectionForm.enrollment_key.trim() || null,
            course_id: sectionForm.course_id
          })
          .eq('section_id', sectionForm.section_id);

        if (error) throw error;
      } else {
        const { error } = await api
          .from('sections')
          .insert({
            section_id: sectionForm.section_id,
            section_title: sectionForm.section_title,
            year_term: derivedYearTerm,
            chat_model: sectionForm.chat_model || null,
            super_model: sectionForm.super_model || null,
            enabled: sectionForm.enabled,
            accept_new_students: sectionForm.accept_new_students,
            enrollment_key: sectionForm.enrollment_key.trim() || null,
            course_id: sectionForm.course_id
          });

        if (error) throw error;
      }

      setShowSectionModal(false);
      fetchSectionStats();
    } catch (err: any) {
      console.error('Failed to save section:', err);
      alert(`Failed to save section: ${err.message}`);
    }
  };

  const handleDuplicateSection = async (section: SectionStat, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (section.section_id === 'unassigned') return;
    
    const newId = prompt('Enter new Section ID:', `${section.section_id}-copy`);
    if (!newId) return;
    
    const newTitle = prompt('Enter new Section Title:', `${section.section_title} (Copy)`);
    if (!newTitle) return;

    try {
      const { error } = await api
        .from('sections')
        .insert({
          section_id: newId,
          section_title: newTitle,
          year_term: section.year_term,
          chat_model: section.chat_model,
          super_model: section.super_model,
          enabled: true
        });
      
      if (error) throw error;
      fetchSectionStats();
    } catch (err: any) {
      console.error('Failed to duplicate section:', err);
      alert(`Failed to duplicate section: ${err.message}`);
    }
  };

  const handleToggleStatus = async (section: SectionStat, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (section.section_id === 'unassigned' || section.section_id === 'other_courses') return;
    
    // MySQL returns 0/1 as numbers, not booleans, so we need to convert
    const newStatus = !section.enabled;
    
    try {
      const authToken = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${section.section_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ enabled: newStatus }),
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.error('Response error:', response.status, text);
        throw new Error(`Server returned ${response.status}: ${text.substring(0, 100)}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error.message || 'Update failed');
      }
      
      fetchSectionStats();
    } catch (err: any) {
      console.error('Failed to toggle section status:', err);
      alert(`Failed to toggle section status: ${err.message}`);
    }
  };

  // Toggle accept_new_students status for a section
  const handleToggleAcceptNewStudents = async (section: SectionStat, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (section.section_id === 'unassigned' || section.section_id === 'other_courses') return;

    const newStatus = !section.accept_new_students;

    try {
      const authToken = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${section.section_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ accept_new_students: newStatus }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Response error:', response.status, text);
        throw new Error(`Server returned ${response.status}: ${text.substring(0, 100)}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error.message || 'Update failed');
      }

      fetchSectionStats();
    } catch (err: any) {
      console.error('Failed to toggle accept new students:', err);
      alert(`Failed to toggle accept new students: ${err.message}`);
    }
  };

  const emptyModelForm = (vendor: string = 'openai') => ({
    model_id: '',
    model_name: '',
    vendor,
    enabled: true,
    default: false,
    cpm_input: '',
    cpm_input_cache: '',
    cpm_output: '',
    temperature: '',
    reasoning_effort: '',
    release_date: '',
    type: 'regular',
    supported_parameters: '',
    default_parameters: '',
    parameter_settings: '',
  });

  const openCreateModelModal = () => {
    setEditingModel(null);
    setIsOpenRouterImport(false);
    setOpenRouterContext(null);
    setModelForm(emptyModelForm('openai'));
    setShowModelModal(true);
  };

  const openOpenRouterImportModal = () => {
    setEditingModel(null);
    setIsOpenRouterImport(true);
    setOpenRouterContext(null);
    setModelForm(emptyModelForm('openrouter'));
    setShowModelModal(true);
  };

  const stringifyJsonField = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  };

  const openEditModelModal = (model: Model) => {
    setEditingModel(model);
    setIsOpenRouterImport(false);
    setOpenRouterContext(null);
    setModelForm({
      model_id: model.model_id,
      model_name: model.model_name,
      vendor: model.vendor || 'openai',
      enabled: !!model.enabled,
      default: !!model.default,
      cpm_input: model.cpm_input !== null && model.cpm_input !== undefined ? String(model.cpm_input) : '',
      cpm_input_cache: model.cpm_input_cache !== null && model.cpm_input_cache !== undefined ? String(model.cpm_input_cache) : '',
      cpm_output: model.cpm_output !== null && model.cpm_output !== undefined ? String(model.cpm_output) : '',
      temperature: model.temperature !== null && model.temperature !== undefined ? String(model.temperature) : '',
      reasoning_effort: model.reasoning_effort || '',
      release_date: model.release_date ? String(model.release_date).slice(0, 10) : '',
      type: model.type || 'regular',
      supported_parameters: stringifyJsonField(model.supported_parameters),
      default_parameters: stringifyJsonField(model.default_parameters),
      parameter_settings: stringifyJsonField(model.parameter_settings),
    });
    setShowModelModal(true);
  };

  const handleFetchOpenRouterMetadata = async () => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to look up OpenRouter models.');
      return;
    }
    const trimmed = modelForm.model_id.trim();
    if (!trimmed) {
      alert('Enter an OpenRouter model ID first (e.g., openai/gpt-5).');
      return;
    }
    setIsFetchingOpenRouter(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/openrouter/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ openrouter_model_id: trimmed }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      const prefill = result?.data?.prefill;
      const ctx = result?.data?.openrouter;
      if (!prefill) throw new Error('OpenRouter lookup returned no prefill data.');
      setModelForm({
        model_id: prefill.model_id || trimmed,
        model_name: prefill.model_name || trimmed,
        vendor: 'openrouter',
        enabled: prefill.enabled !== false,
        default: false,
        cpm_input: prefill.cpm_input != null ? String(prefill.cpm_input) : '',
        cpm_input_cache: prefill.cpm_input_cache != null ? String(prefill.cpm_input_cache) : '',
        cpm_output: prefill.cpm_output != null ? String(prefill.cpm_output) : '',
        temperature: '',
        reasoning_effort: '',
        release_date: prefill.release_date || '',
        type: prefill.type || 'regular',
        supported_parameters: stringifyJsonField(prefill.supported_parameters || []),
        default_parameters: stringifyJsonField(prefill.default_parameters || {}),
        parameter_settings: '{}',
      });
      setOpenRouterContext(ctx || null);
    } catch (err: any) {
      console.error('OpenRouter lookup failed:', err);
      alert(`OpenRouter lookup failed: ${err.message}`);
    } finally {
      setIsFetchingOpenRouter(false);
    }
  };

  const handleSaveModel = async () => {
    if (!modelForm.model_id.trim() || !modelForm.model_name.trim()) {
      alert('Model ID and Model Name are required.');
      return;
    }
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to manage models.');
      return;
    }

    const parseNumberOrNull = (val: string, label: string) => {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const parsed = parseFloat(trimmed);
      if (Number.isNaN(parsed)) {
        throw new Error(`${label} must be a number.`);
      }
      return parsed;
    };

    const parseJsonOrThrow = (val: string, label: string): unknown => {
      const trimmed = val.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch (e: any) {
        throw new Error(`${label} is not valid JSON: ${e.message}`);
      }
    };

    let payload: Record<string, unknown>;
    try {
      payload = {
        model_id: modelForm.model_id.trim(),
        model_name: modelForm.model_name.trim(),
        vendor: modelForm.vendor,
        enabled: modelForm.enabled,
        default: modelForm.default,
        cpm_input: parseNumberOrNull(modelForm.cpm_input, 'CPM input'),
        cpm_input_cache: parseNumberOrNull(modelForm.cpm_input_cache, 'CPM input cache'),
        cpm_output: parseNumberOrNull(modelForm.cpm_output, 'CPM output'),
        temperature: parseNumberOrNull(modelForm.temperature, 'Temperature'),
        reasoning_effort: modelForm.reasoning_effort || null,
        release_date: modelForm.release_date || null,
        type: modelForm.type || 'regular',
        supported_parameters: parseJsonOrThrow(modelForm.supported_parameters, 'Supported parameters'),
        default_parameters: parseJsonOrThrow(modelForm.default_parameters, 'Default parameters'),
        parameter_settings: parseJsonOrThrow(modelForm.parameter_settings, 'Parameter settings'),
      };
    } catch (parseErr: any) {
      alert(parseErr.message);
      return;
    }

    setIsSavingModel(true);
    try {
      const response = await fetch(editingModel ? `${getApiBaseUrl()}/models/${encodeURIComponent(editingModel.model_id)}` : `${getApiBaseUrl()}/models`, {
        method: editingModel ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }

      setShowModelModal(false);
      setEditingModel(null);
      await fetchModels();
    } catch (err: any) {
      console.error('Failed to save model:', err);
      alert(`Failed to save model: ${err.message}`);
    } finally {
      setIsSavingModel(false);
    }
  };

  const handleToggleModel = async (model: Model) => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to manage models.');
      return;
    }
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/${encodeURIComponent(model.model_id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ enabled: !model.enabled }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      await fetchModels();
    } catch (err: any) {
      console.error('Failed to toggle model:', err);
      alert(`Failed to toggle model: ${err.message}`);
    }
  };

  const handleMakeDefault = async (model: Model) => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to manage models.');
      return;
    }
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/${encodeURIComponent(model.model_id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ default: true }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      await fetchModels();
    } catch (err: any) {
      console.error('Failed to set default model:', err);
      alert(`Failed to set default model: ${err.message}`);
    }
  };

  const handleTestModel = async (model: Model) => {
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to test models.');
      return;
    }
    setTestingModelId(model.model_id);
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/${encodeURIComponent(model.model_id)}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const result = await parseApiResponse(response);
      const data = result?.data || {};
      const testResults: any = data.test_results || {};
      await fetchModels();
      if (response.ok && data.success) {
        const preview = testResults.response_preview || 'Received empty response.';
        const usage = testResults.usage || {};
        const usageBits = [];
        if (usage.prompt_tokens) usageBits.push(`prompt=${usage.prompt_tokens}`);
        if (usage.completion_tokens) usageBits.push(`completion=${usage.completion_tokens}`);
        const usageText = usageBits.length ? ` (${usageBits.join(', ')})` : '';
        alert(`Pass: ${model.model_name}\n${preview}${usageText}`);
      } else {
        const errMsg = testResults.error || result?.error?.message || `Server returned ${response.status}`;
        alert(`Fail: ${model.model_name}\n${errMsg}`);
      }
    } catch (err: any) {
      console.error('Failed to test model:', err);
      await fetchModels();
      alert(`Failed to test model: ${err.message}`);
    } finally {
      setTestingModelId(null);
    }
  };

  const handleDeleteModel = async (model: Model) => {
    const confirmed = window.confirm(`Delete model "${model.model_name}"? This cannot be undone.`);
    if (!confirmed) return;
    const authToken = localStorage.getItem('admin_auth_token');
    if (!authToken) {
      alert('You must be signed in to manage models.');
      return;
    }
    try {
      const response = await fetch(`${getApiBaseUrl()}/models/${encodeURIComponent(model.model_id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        const message = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(message);
      }
      await fetchModels();
    } catch (err: any) {
      console.error('Failed to delete model:', err);
      alert(`Failed to delete model: ${err.message}`);
    }
  };

  // Status badge component
  const StatusBadge = ({ status }: { status: 'completed' | 'in_progress' | 'not_started' }) => {
    const styles = {
      completed: 'bg-green-100 text-green-800 border-green-200',
      in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      not_started: 'bg-gray-100 text-gray-600 border-gray-200',
    };
    const labels = {
      completed: 'Completed',
      in_progress: 'In Progress',
      not_started: 'No Evaluation',
    };
    const tooltips = {
      completed: 'Student has completed the case and received an evaluation',
      in_progress: 'Student started but has not completed an evaluation yet',
      not_started: 'No evaluation record yet (student may have an active chat - check Monitor tab)',
    };
    return (
      <span 
        className={`px-2 py-1 text-xs font-medium rounded-full border ${styles[status]}`}
        title={tooltips[status]}
      >
        {labels[status]}
      </span>
    );
  };

  // Score distribution chart component
  const ScoreChart = ({ distribution }: { distribution: number[] }) => {
    const maxCount = Math.max(...distribution, 1);
    const chartHeight = 80; // pixels
    return (
      <div className="flex items-end gap-1" style={{ height: `${chartHeight + 40}px` }}>
        {distribution.map((count, score) => {
          const barHeight = count > 0 ? Math.max((count / maxCount) * chartHeight, 4) : 0;
          return (
            <div key={score} className="flex flex-col items-center justify-end flex-1 h-full">
              {count > 0 && (
                <span className="text-xs font-medium text-gray-600 mb-1">{count}</span>
              )}
              <div 
                className="w-full bg-blue-500 rounded-t transition-all"
                style={{ height: `${barHeight}px` }}
                title={`Score ${score}: ${count} student${count !== 1 ? 's' : ''}`}
              />
              <span className="text-xs text-gray-500 mt-1">{score}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const SortableHeader = ({ label, sortableKey }: { label: string; sortableKey: SortKey }) => (
    <th
      onClick={() => handleSort(sortableKey)}
      className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {sortKey === sortableKey && (
          <svg className={`w-4 h-4 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M5.22 9.22a.75.75 0 011.06 0L10 12.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 10.28a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </th>
  );

  const vendorLabel = (vendor?: string | null) => {
    switch ((vendor || '').toLowerCase()) {
      case 'openai': return 'OpenAI';
      case 'anthropic': return 'Anthropic';
      case 'google': return 'Google';
      case 'openrouter': return 'OpenRouter';
      default: return vendor || 'Unknown';
    }
  };

  const vendorBadgeClasses = (vendor?: string | null) => {
    switch ((vendor || '').toLowerCase()) {
      case 'openrouter': return 'bg-purple-100 text-purple-700';
      case 'anthropic': return 'bg-orange-100 text-orange-700';
      case 'google': return 'bg-blue-100 text-blue-700';
      case 'openai': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const providerLabel = (modelId: string) => {
    const provider = detectProvider(modelId);
    if (provider === 'openai') return 'OpenAI';
    if (provider === 'anthropic') return 'Anthropic';
    return 'Google';
  };

  const formatModelDisplay = (modelId?: string | null) => {
    if (!modelId) return 'Default';
    const name = modelsMap.get(modelId) || modelId;
    return `${providerLabel(modelId)} • ${name}`;
  };

  const formatCost = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (Number.isNaN(num)) return '—';
    return `$${num.toFixed(2)}`;
  };

  const parseApiResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const text = await response.text();
    return { data: null, error: { message: text } };
  };

  const renderModelsTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Models</h2>
          <p className="text-sm text-gray-500">{sortedModels.length} model{sortedModels.length !== 1 ? 's' : ''} configured</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreateModelModal}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            + Add Model
          </button>
          <button
            onClick={openOpenRouterImportModal}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            + Add Model from OpenRouter
          </button>
          <button
            onClick={fetchModels}
            disabled={isLoadingModels}
            aria-label="Refresh models list"
            title="Refresh models list"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingModels ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        {isLoadingModels ? (
          <div className="p-6 text-sm text-gray-600">Loading models...</div>
        ) : sortedModels.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">No models found. Add a model to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Default</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" title="Cost per million input tokens">Input $/M</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" title="Cost per million output tokens">Output $/M</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedModels.map(model => {
                  const hasPassedTest = model.test_status === 'pass';
                  const hasFailedTest = model.test_status === 'fail';
                  const testedAt = model.test_date ? new Date(model.test_date).toLocaleString() : 'unknown date';
                  const failDetail = (model.test_results && typeof model.test_results === 'object'
                    ? ((model.test_results as Record<string, unknown>).error || (model.test_results as Record<string, unknown>).message) as string | undefined
                    : undefined) || model.test_result || '';
                  const safeResult = sanitizeTextForDisplay(String(failDetail));
                  return (
                    <React.Fragment key={model.model_id}>
                      <tr className={`hover:bg-gray-50 ${model.default ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-gray-900">{model.model_name}</div>
                          <div className="text-xs text-gray-500">{model.model_id}</div>
                          {(model.temperature !== null && model.temperature !== undefined) || model.reasoning_effort ? (
                            <div className="text-[11px] text-gray-500 mt-1 space-x-2">
                              {model.temperature !== null && model.temperature !== undefined && (
                                <span>temp: {model.temperature}</span>
                              )}
                              {model.reasoning_effort && (
                                <span>effort: {model.reasoning_effort}</span>
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${vendorBadgeClasses(model.vendor)}`}>
                            {vendorLabel(model.vendor)}
                          </span>
                          {model.type && model.type !== 'regular' && (
                            <div className="text-[10px] text-gray-500 mt-1">{model.type}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {model.default ? (
                            <span className="px-2 py-1 text-xs font-semibold text-green-700 bg-green-100 rounded-full border border-green-200">
                              Default
                            </span>
                          ) : (
                            <button
                              onClick={() => handleMakeDefault(model)}
                              disabled={!model.enabled}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                model.enabled
                                  ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              }`}
                            >
                              Make default
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleModel(model)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border ${
                              model.enabled
                                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                                : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                            }`}
                          >
                            {model.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.cpm_input)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.cpm_output)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                            <button
                              onClick={() => handleTestModel(model)}
                              disabled={testingModelId === model.model_id}
                              title={
                                hasFailedTest
                                  ? 'failed last test, check API key'
                                  : hasPassedTest
                                    ? 'passed test'
                                    : undefined
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                testingModelId === model.model_id
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                  : hasFailedTest
                                    ? 'bg-pink-100 text-pink-800 border-pink-300 hover:bg-pink-200'
                                    : hasPassedTest
                                      ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200'
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {testingModelId === model.model_id
                                ? 'Testing...'
                                : hasFailedTest
                                  ? 'Restest'
                                  : hasPassedTest
                                    ? 'Tested'
                                    : 'Test'}
                            </button>
                            <button
                              onClick={() => openEditModelModal(model)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteModel(model)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-red-600 border-red-200 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {hasFailedTest && (() => {
                        const fullText = `↳ Tested ${testedAt} and ${safeResult}`;
                        const displayText = fullText.length > 200 ? `${fullText.slice(0, 200)}…` : fullText;
                        return (
                          <tr className="bg-pink-50">
                            <td colSpan={7} className="px-4 pt-1 pb-1 text-[11px] text-gray-600 italic">
                              <span className="block whitespace-normal break-words" title={fullText}>
                                {displayText}
                              </span>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // Helper to truncate scenario name to 20 chars
  const truncateScenarioName = (name: string, maxLen: number = 20) => {
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen) + '...';
  };

  const renderCasesTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Installed Cases</h2>
          <p className="text-sm text-gray-500">{casesList.length} case{casesList.length !== 1 ? 's' : ''} available</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenCaseModal()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Case
          </button>
          <button
            onClick={() => fetchCases()}
            disabled={isLoadingCases}
            title="Refresh cases list"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingCases ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {isLoadingCases ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading cases...</p>
        </div>
      ) : casesList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No cases found. Create your first case to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Version</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Scenarios</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {casesList.map((caseItem) => (
                <tr key={caseItem.case_id} className={!caseItem.enabled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{caseItem.case_title}</div>
                    <div className="text-xs text-gray-400">
                      {caseItem.case_id}
                      {caseItem.visibility && (
                        <> ({caseItem.visibility.charAt(0).toUpperCase() + caseItem.visibility.slice(1)} visibility)</>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {caseItem.case_version || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleCaseEnabled(caseItem)}
                      title="Click to enable/disable"
                      className={`px-2 py-1 text-xs font-medium rounded-full cursor-pointer ${
                        caseItem.enabled
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {caseItem.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {caseItem.scenarios && caseItem.scenarios.length > 0 ? (
                      <div className="space-y-0.5">
                        {caseItem.scenarios.slice(0, 3).map((scenario, idx) => (
                          <div key={scenario.id} className="text-xs text-gray-600" title={scenario.scenario_name}>
                            {idx + 1}. {truncateScenarioName(scenario.scenario_name)}
                            {!scenario.enabled && <span className="text-gray-400 ml-1">(disabled)</span>}
                          </div>
                        ))}
                        {caseItem.scenarios.length > 3 && (
                          <div className="text-xs text-gray-400">+{caseItem.scenarios.length - 3} more</div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setManagingScenarioCase(caseItem);
                          setShowScenarioManager(true);
                        }}
                        className="text-xs text-amber-600 hover:text-amber-700 hover:underline"
                      >
                        no scenarios defined
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleOpenCaseModal(caseItem)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setManagingScenarioCase(caseItem);
                          setShowScenarioManager(true);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-teal-600 border-teal-200 hover:bg-teal-50"
                      >
                        Scenarios
                      </button>
                      <button
                        onClick={() => handleDeleteCase(caseItem.case_id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-red-600 border-red-200 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isUploadingCaseFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">Uploading file...</p>
          </div>
        </div>
      )}

    </div>
  );

  // Helper to get the selected section object
  const getSelectedSection = () => {
    if (!selectedAssignmentSection) return null;
    return assignmentsSectionsList.find((s: any) => s.section_id === selectedAssignmentSection);
  };

  // Handle section selection change
  const handleAssignmentSectionChange = async (sectionId: string) => {
    setSelectedAssignmentSection(sectionId);
    if (sectionId) {
      await fetchSectionCases(sectionId);
      // Also ensure casesList is loaded for the dropdown
      if (casesList.length === 0) {
        fetchCases();
      }
      // Also ensure rubricsList is loaded for the rubric dropdown
      if (rubricsList.length === 0) {
        fetchRubrics();
      }
    }
  };

  // Handle rubric assignment change for a section-case
  const handleUpdateAssignmentRubric = async (sectionId: string, caseId: string, rubricId: number | null) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}/cases/${caseId}/rubric`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ rubric_id: rubricId })
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to update rubric');
      }
      // Refresh the section cases list
      fetchSectionCases(sectionId);
      setSuccessMessage('Rubric updated successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update rubric');
    }
  };

  // Handle copy-from section selection
  const handleCopyFromSectionChange = async (sectionId: string) => {
    setCopyFromSection(sectionId);
    setCopyResult(null);
    if (sectionId) {
      try {
        const { data, error } = await api.from(`sections/${sectionId}/cases`).select('*');
        if (error) throw new Error(error.message);
        setSourceSectionCases(data || []);
      } catch (err) {
        console.error('Error fetching source section cases:', err);
        setSourceSectionCases([]);
      }
    } else {
      setSourceSectionCases([]);
    }
  };

  // Handle copy cases from source section
  const handleCopyAssignments = async () => {
    if (!selectedAssignmentSection || !copyFromSection) return;

    if (!confirm(`Are you sure you want to copy case assignments from the selected section to "${getSelectedSection()?.section_title}"?`)) {
      return;
    }

    setIsCopying(true);
    setCopyResult(null);

    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${selectedAssignmentSection}/cases/copy-from/${copyFromSection}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          copy_options: copyOptions.options,
          copy_scenarios: copyOptions.scenarios,
          copy_scheduling: copyOptions.scheduling
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to copy assignments');
      }

      setCopyResult({
        message: result.message || `Copied ${result.data?.copied || 0} case(s)`,
        type: 'success'
      });

      // Refresh the current section's cases
      await fetchSectionCases(selectedAssignmentSection);

      // Clear copy form
      setCopyFromSection(null);
      setSourceSectionCases([]);
    } catch (err: any) {
      setCopyResult({
        message: err.message || 'Failed to copy assignments',
        type: 'error'
      });
    } finally {
      setIsCopying(false);
    }
  };

  // Handle setting semester as current
  const handleSetCurrentSemester = async (semesterId: number) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/semesters/${semesterId}/current`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage('Current semester updated');
        fetchSemesters();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update current semester');
    }
  };

  // Handle creating/updating semester
  const handleSaveSemester = async (semesterData: any) => {
    try {
      const isEdit = !!editingSemester;
      const url = isEdit
        ? `${getApiBaseUrl()}/semesters/${editingSemester.id}`
        : `${getApiBaseUrl()}/semesters`;
      const method = isEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(semesterData)
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage(isEdit ? 'Semester updated' : 'Semester created');
        setShowSemesterModal(false);
        setEditingSemester(null);
        fetchSemesters();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save semester');
    }
  };

  // Handle deleting semester
  const handleDeleteSemester = async (semesterId: number) => {
    if (!confirm('Are you sure you want to delete this semester? This cannot be undone.')) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/semesters/${semesterId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}` }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage('Semester deleted');
        fetchSemesters();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete semester');
    }
  };

  // Handle creating/updating course
  const handleSaveCourse = async (courseData: any) => {
    try {
      const isEdit = !!editingCourse;
      const url = isEdit
        ? `${getApiBaseUrl()}/courses/${editingCourse.id}`
        : `${getApiBaseUrl()}/semesters/${selectedSemesterId}/courses`;
      const method = isEdit ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(courseData)
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage(isEdit ? 'Course updated' : 'Course created');
        setShowCourseModal(false);
        setEditingCourse(null);
        if (selectedSemesterId) fetchCourses(selectedSemesterId);
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save course');
    }
  };

  // Handle course sync
  const handleSyncCourse = async (courseId: number) => {
    if (!confirm('Push case assignments from the primary section to all other sections in this course?')) return;
    try {
      const response = await fetch(`${getApiBaseUrl()}/courses/${courseId}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sync_options: true, sync_scenarios: true })
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage(result.message || 'Course synced successfully');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync course');
    }
  };

  // Handle deleting a course (with cascade option)
  const handleDeleteCourse = async (course: Course) => {
    try {
      // First, try to delete without cascade to get info about what would be deleted
      const response = await fetch(`${getApiBaseUrl()}/courses/${course.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`
        }
      });
      const result = await response.json();

      if (result.data?.requires_cascade) {
        // Show confirmation with details about what will be deleted
        const { sections_count, students_count, assignments_count } = result.data;
        const confirmed = confirm(
          `Are you sure you want to delete "${course.course_name}"?\n\n` +
          `This will permanently delete:\n` +
          `• ${sections_count} section(s)\n` +
          `• ${assignments_count} case assignment(s)\n` +
          `• ${students_count} student enrollment(s)\n\n` +
          `This action cannot be undone.`
        );

        if (confirmed) {
          // Delete with cascade
          const cascadeResponse = await fetch(`${getApiBaseUrl()}/courses/${course.id}?cascade=true`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`
            }
          });
          const cascadeResult = await cascadeResponse.json();
          if (cascadeResult.error) {
            setError(cascadeResult.error.message);
          } else {
            setSuccessMessage(`Deleted course "${course.course_name}" and ${cascadeResult.data.sections_deleted} section(s)`);
            if (selectedSemesterId) fetchCourses(selectedSemesterId);
            fetchOrphanedSections();
            setTimeout(() => setSuccessMessage(null), 3000);
          }
        }
      } else if (result.error) {
        setError(result.error.message);
      } else {
        // Course had no sections, deleted successfully
        setSuccessMessage(`Deleted course "${course.course_name}"`);
        if (selectedSemesterId) fetchCourses(selectedSemesterId);
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete course');
    }
  };

  // Handle assigning an orphaned section to a course
  const handleAssignSectionToCourse = async (sectionId: string, courseId: number) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/courses/${courseId}/sections/${sectionId}/assign`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        }
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage('Section assigned to course');
        fetchOrphanedSections();
        if (selectedSemesterId) fetchCourses(selectedSemesterId);
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to assign section');
    }
  };

  // Handle changing a section's course assignment (or unassigning it)
  const handleChangeSectionCourse = async (sectionId: string, newCourseId: number | null) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/sections/${sectionId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ course_id: newCourseId })
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage(newCourseId ? 'Section moved to course' : 'Section unassigned from course');
        fetchSectionStats(); // Refresh sections list
        fetchOrphanedSections();
        if (selectedSemesterId) fetchCourses(selectedSemesterId);
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to change section assignment');
    }
  };

  const renderDismissibleErrorBanner = (className: string) =>
    error ? (
      <div className={`${className} flex items-start justify-between gap-2`}>
        <span className="min-w-0 flex-1 break-words">{error}</span>
        <button
          type="button"
          onClick={() => setError(null)}
          className="flex-shrink-0 text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-200"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    ) : null;

  // Render Semesters Tab
  const renderSemestersTab = () => {
    const canEditSemesters = user?.role === 'admin' && Boolean(user?.superuser);
    return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Semesters</h2>
          <p className="text-sm text-gray-500">
            {canEditSemesters
              ? 'Manage academic semesters and clone setups between terms'
              : 'View academic semesters. Only superuser admins can create or edit semesters.'}
          </p>
        </div>
        {canEditSemesters && (
          <button
            onClick={() => {
              setEditingSemester(null);
              setShowSemesterModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Semester
          </button>
        )}
      </div>

      {renderDismissibleErrorBanner('mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg')}
      {successMessage && <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg">{successMessage}</div>}

      {isLoadingSemesters ? (
        <div className="text-center py-8 text-gray-500">Loading semesters...</div>
      ) : semesters.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No semesters found. Create one to get started.</div>
      ) : (
        <div className="space-y-4">
          {semesters.map((semester) => (
            <div
              key={semester.id}
              className={`bg-white border rounded-lg p-4 ${semester.is_current ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {semester.is_current && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                      Current
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">{semester.semester_name}</h3>
                  <span className="text-sm text-gray-500">
                    {semester.course_count || 0} courses • {semester.section_count || 0} sections
                    {(semesterInstructors.get(semester.id)?.length || 0) > 0 && (
                      <> • <span className="text-purple-600">{semesterInstructors.get(semester.id)?.length} instructor{semesterInstructors.get(semester.id)?.length !== 1 ? 's' : ''}</span></>
                    )}
                  </span>
                </div>
                {canEditSemesters && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedSemesterForInstructors(semester);
                        setShowSemesterInstructorsModal(true);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded"
                    >
                      Instructors
                    </button>
                    {!semester.is_current && (
                      <button
                        onClick={() => handleSetCurrentSemester(semester.id)}
                        className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded"
                      >
                        Set as Current
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingSemester(semester);
                        setShowCloneSemesterModal(true);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                    >
                      Clone
                    </button>
                    <button
                      onClick={() => {
                        setEditingSemester(semester);
                        setShowSemesterModal(true);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteSemester(semester.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Semester Modal */}
      {showSemesterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">{editingSemester ? 'Edit Semester' : 'Create Semester'}</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleSaveSemester({
                semester_name: formData.get('semester_name'),
                start_date: formData.get('start_date') || null,
                end_date: formData.get('end_date') || null,
                is_current: formData.get('is_current') === 'on'
              });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester Name *</label>
                  <input
                    name="semester_name"
                    defaultValue={editingSemester?.semester_name || ''}
                    required
                    placeholder="e.g., Fall 2026"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      name="start_date"
                      defaultValue={editingSemester?.start_date?.split('T')[0] || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <input
                      type="date"
                      name="end_date"
                      defaultValue={editingSemester?.end_date?.split('T')[0] || ''}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>
                {!editingSemester && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="is_current" className="rounded" />
                    <span className="text-sm text-gray-700">Set as current semester</span>
                  </label>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowSemesterModal(false); setEditingSemester(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  {editingSemester ? 'Save Changes' : 'Create Semester'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clone Semester Modal */}
      {showCloneSemesterModal && editingSemester && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Clone Semester</h3>
            <p className="text-sm text-gray-600 mb-4">
              Clone from: <strong>{editingSemester.semester_name}</strong><br/>
              This will copy all courses, sections, and case assignments.
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              try {
                const response = await fetch(`${getApiBaseUrl()}/semesters/${editingSemester.id}/clone`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    new_semester_name: formData.get('new_semester_name'),
                    clone_case_assignments: formData.get('clone_case_assignments') === 'on',
                    clone_chat_options: formData.get('clone_chat_options') === 'on',
                    clone_scenarios: formData.get('clone_scenarios') === 'on'
                  })
                });
                const result = await response.json();
                if (result.error) {
                  setError(result.error.message);
                } else {
                  setSuccessMessage(`Cloned: ${result.data.stats.courses_cloned} courses, ${result.data.stats.sections_cloned} sections, ${result.data.stats.case_assignments_cloned} assignments`);
                  setShowCloneSemesterModal(false);
                  setEditingSemester(null);
                  fetchSemesters();
                  setTimeout(() => setSuccessMessage(null), 5000);
                }
              } catch (err: any) {
                setError(err.message || 'Failed to clone semester');
              }
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Semester Name *</label>
                  <input
                    name="new_semester_name"
                    required
                    placeholder="e.g., Fall 2027"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="clone_case_assignments" defaultChecked className="rounded" />
                    <span className="text-sm text-gray-700">Clone case assignments</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="clone_chat_options" defaultChecked className="rounded" />
                    <span className="text-sm text-gray-700">Clone chat options</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="clone_scenarios" defaultChecked className="rounded" />
                    <span className="text-sm text-gray-700">Clone scenarios</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500">Students will NOT be copied. The new semester will start with empty rosters.</p>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowCloneSemesterModal(false); setEditingSemester(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Clone Semester
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Semester Instructors Modal */}
      {showSemesterInstructorsModal && selectedSemesterForInstructors && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              Instructors for {selectedSemesterForInstructors.semester_name}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Primary instructors assigned to this semester can create and manage courses within it.
            </p>

            {/* Current instructors */}
            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Assigned Instructors</h4>
              {(semesterInstructors.get(selectedSemesterForInstructors.id) || []).length === 0 ? (
                <p className="text-sm text-gray-500 italic">No instructors assigned to this semester</p>
              ) : (
                <div className="space-y-2">
                  {(semesterInstructors.get(selectedSemesterForInstructors.id) || []).map((instructor: any) => (
                    <div key={instructor.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                      <div>
                        <span className="font-medium text-gray-900">{instructor.full_name}</span>
                        <span className="ml-2 text-sm text-gray-500">{instructor.email}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveInstructorFromSemester(instructor.id, selectedSemesterForInstructors.id)}
                        className="text-red-600 hover:text-red-700 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add instructor */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Add Instructor</h4>
              <select
                id="semester-instructor-select"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleAssignInstructorToSemester(e.target.value, selectedSemesterForInstructors.id);
                    e.target.value = '';
                  }
                }}
              >
                <option value="">Select an instructor to add...</option>
                {allInstructors
                  .filter((i: any) => i.active && !(semesterInstructors.get(selectedSemesterForInstructors.id) || []).some((si: any) => si.id === i.id))
                  .map((instructor: any) => (
                    <option key={instructor.id} value={instructor.id}>
                      {instructor.full_name} ({instructor.email})
                    </option>
                  ))
                }
              </select>
              {allInstructors.filter((i: any) => i.active).length === 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  No instructors available. Add instructors in Admin &rarr; Instructors.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowSemesterInstructorsModal(false);
                  setSelectedSemesterForInstructors(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    );
  };

  // Render Course Setup Tab
  const renderCourseSetupTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Course Setup</h2>
          <p className="text-sm text-gray-500">Organize sections into courses for easier assignment management</p>
        </div>
      </div>

      {renderDismissibleErrorBanner('mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg')}
      {successMessage && <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg">{successMessage}</div>}

      {/* Semester Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Semester</label>
        <select
          value={selectedSemesterId || ''}
          onChange={(e) => setSelectedSemesterId(e.target.value ? Number(e.target.value) : null)}
          className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">Select a semester...</option>
          {semesters.map((sem) => (
            <option key={sem.id} value={sem.id}>
              {sem.semester_name} {sem.is_current ? '(Current)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedSemesterId && (
        <>
          {/* Create Course Button — admin-only */}
          {user?.role === 'admin' && (
            <div className="mb-6">
              <button
                onClick={() => {
                  setEditingCourse(null);
                  setShowCourseModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                New Course
              </button>
            </div>
          )}

          {/* Courses List */}
          {isLoadingCourses ? (
            <div className="text-center py-8 text-gray-500">Loading courses...</div>
          ) : courses.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No courses in this semester. Create one to get started.</div>
          ) : (
            <div className="space-y-4">
              {courses.map((course) => (
                <div key={course.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{course.course_name}</h3>
                      {course.course_code && (
                        <span className="text-sm text-gray-500">{course.course_code}</span>
                      )}
                      <span className="text-sm text-gray-500 ml-2">
                        • {course.section_count || 0} sections
                      </span>
                      <div className="text-sm mt-1 space-x-3">
                        {(course as any).primary_instructor_name ? (
                          <span className="text-emerald-700">
                            <span className="font-medium">Primary Instructor:</span> {(course as any).primary_instructor_name}
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            <span className="font-medium">Primary Instructor:</span> <em>not set</em>
                          </span>
                        )}
                        {course.primary_section_title && (
                          <span className="text-indigo-600">
                            <span className="font-medium">Template Section:</span> {course.primary_section_title}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user?.role === 'admin' && (
                        <>
                          <button
                            onClick={() => handleSyncCourse(course.id)}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded"
                            title="Push from template section to all other sections"
                          >
                            Sync
                          </button>
                          <button
                            onClick={() => {
                              setEditingCourse(course);
                              setShowCourseModal(true);
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteCourse(course)}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                            title="Delete course"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {course.description && (
                    <p className="text-sm text-gray-600 mb-2">{course.description}</p>
                  )}
                  <div className="text-xs text-gray-500">
                    Sync scheduling: {course.sync_scheduling ? 'Yes' : 'No'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Orphaned Sections */}
          {orphanedSections.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Unassigned Sections</h3>
              <p className="text-sm text-gray-500 mb-4">These sections are not assigned to any course. Select a course to assign each section.</p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="space-y-3">
                  {orphanedSections.map((section: any) => (
                    <div key={section.section_id} className="flex items-center justify-between gap-4 bg-white rounded-lg p-3 border border-yellow-200">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900">{section.section_title}</span>
                        <span className="text-sm text-gray-500 ml-2">({section.section_id})</span>
                        {section.year_term && (
                          <span className="text-sm text-gray-500 ml-2">• {section.year_term}</span>
                        )}
                        <div className="text-xs text-gray-400 mt-0.5">
                          {section.student_count || 0} students • {section.case_count || 0} cases
                        </div>
                      </div>
                      <select
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAssignSectionToCourse(section.section_id, Number(e.target.value));
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Assign to course...</option>
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.course_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Course Modal */}
      {showCourseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">{editingCourse ? 'Edit Course' : 'Create Course'}</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleSaveCourse({
                course_name: formData.get('course_name'),
                course_code: formData.get('course_code') || null,
                description: formData.get('description') || null,
                sync_scheduling: formData.get('sync_scheduling') === 'on',
                primary_instructor_id: (formData.get('primary_instructor_id') as string) || null,
                cascade_to_sections: formData.get('cascade_to_sections') === 'on'
              });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Name *</label>
                  <p className="text-xs text-gray-500 mb-1">Full descriptive name for this course</p>
                  <input
                    name="course_name"
                    defaultValue={editingCourse?.course_name || ''}
                    required
                    placeholder="e.g., MBA 530 - Operations Management"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Code</label>
                  <p className="text-xs text-gray-500 mb-1">Short catalog identifier (optional)</p>
                  <input
                    name="course_code"
                    defaultValue={editingCourse?.course_code || ''}
                    placeholder="e.g., MBA530"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    name="description"
                    defaultValue={editingCourse?.description || ''}
                    placeholder="Optional notes about this course"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Primary Instructor *</label>
                  <p className="text-xs text-gray-500 mb-1">The instructor who owns this course. Required so student chats can resolve API keys.</p>
                  <select
                    name="primary_instructor_id"
                    defaultValue={editingCourse?.primary_instructor_id || ''}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="">Select an instructor...</option>
                    {allInstructors
                      .filter((i: any) => i.active && !i.is_system_account)
                      .map((i: any) => (
                        <option key={i.id} value={i.id}>
                          {i.full_name || i.email}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      name="cascade_to_sections"
                      defaultChecked
                      className="rounded mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Also set as primary instructor on all sections in this course</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Recommended. Sections need their own <code>primary_instructor_id</code> so student chats can resolve the right API keys. Uncheck only if some sections in this course are owned by different instructors.
                      </p>
                    </div>
                  </label>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      name="sync_scheduling"
                      defaultChecked={editingCourse?.sync_scheduling || false}
                      className="rounded mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Include case schedules when syncing</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        When syncing from the template section to other sections, also copy the case open/close dates. Uncheck if different sections need different schedules (e.g., different class meeting times).
                      </p>
                    </div>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowCourseModal(false); setEditingCourse(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  {editingCourse ? 'Save Changes' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  const renderAssignmentsTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Case Assignments</h2>
          <p className="text-sm text-gray-500">Manage which cases are assigned to each section</p>
        </div>
        <button
          onClick={() => {
            fetchAssignmentsSections();
            if (selectedAssignmentSection) {
              fetchSectionCases(selectedAssignmentSection);
            }
          }}
          disabled={isLoadingAssignments}
          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
          aria-label="Refresh case assignments"
          title="Refresh case assignments"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoadingAssignments ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Success/Error Messages */}
      {renderDismissibleErrorBanner('mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg')}
      {successMessage && (
        <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* Section Selector Dropdown */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Course Section</label>
        <select
          value={selectedAssignmentSection || ''}
          onChange={(e) => handleAssignmentSectionChange(e.target.value)}
          className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Select a course section...</option>
          {assignmentsSectionsList.filter((s: any) => s.enabled).map((section: any) => (
            <option key={section.section_id} value={section.section_id}>
              {section.section_title} ({section.section_id}) - {section.year_term}
            </option>
          ))}
        </select>
      </div>

      {isLoadingAssignments ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading sections...</p>
        </div>
      ) : assignmentsSectionsList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No sections found. Create sections in the Sections tab first.</p>
        </div>
      ) : !selectedAssignmentSection ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Select a course section above to manage its case assignments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Section Header */}
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900">{getSelectedSection()?.section_title}</span>
                <span className="ml-2 text-sm text-gray-500">({selectedAssignmentSection})</span>
              </div>
              <div className="flex items-center gap-2">
                {getSelectedSection()?.year_term && (
                  <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                    {getSelectedSection()?.year_term}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section Content */}
          <div className="p-4">
            {isLoadingSectionCases ? (
              <div className="text-center py-4">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-4 border-blue-500 border-t-transparent"></div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Add Case Dropdown */}
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value=""
                    onChange={async (e) => {
                      if (e.target.value && selectedAssignmentSection) {
                        await handleAssignCaseToSection(selectedAssignmentSection, e.target.value);
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="">+ Assign a case to this section...</option>
                    {casesList
                      .filter(c => !sectionCasesList.find(sc => sc.case_id === c.case_id))
                      .map(c => (
                        <option key={c.case_id} value={c.case_id}>
                          {c.case_title} ({c.case_id})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Assigned Cases */}
                {sectionCasesList.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">No cases assigned to this section yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sectionCasesList.map((sc) => (
                      <div key={sc.case_id} className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                        <div className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{sc.case_title}</span>
                            <span className="text-sm text-gray-500">({sc.case_id})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Rubric Selector */}
                            <select
                              value={sc.rubric_id || ''}
                              onChange={(e) => handleUpdateAssignmentRubric(
                                selectedAssignmentSection!,
                                sc.case_id,
                                e.target.value ? parseInt(e.target.value) : null
                              )}
                              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                              title="Select evaluation rubric"
                            >
                              <option value="">Default Rubric</option>
                              {rubricsList.filter(r => r.enabled).map((rubric: any) => (
                                <option key={rubric.rubric_id} value={rubric.rubric_id}>
                                  {rubric.rubric_name} ({rubric.total_points}pts)
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => navigateToChatOptions(selectedAssignmentSection!, sc.case_id)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-gray-50 text-gray-600 border-gray-200 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200"
                            >
                              Options
                            </button>
                            <button
                              onClick={() => handleExpandScenarios(selectedAssignmentSection!, sc.case_id, sc)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                expandedScenarios === sc.case_id
                                  ? 'bg-green-100 text-green-700 border-green-200'
                                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-green-50'
                              }`}
                            >
                              Scenarios and Positions
                            </button>
                            <button
                              onClick={() => handleExpandScheduling(sc.case_id, sc)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                expandedScheduling === sc.case_id
                                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50'
                              }`}
                            >
                              Scheduling
                            </button>
                            <button
                              onClick={() => sc.active
                                ? handleDeactivateSectionCase(selectedAssignmentSection!, sc.case_id)
                                : handleActivateSectionCase(selectedAssignmentSection!, sc.case_id)
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                                sc.active
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                              title={sc.active ? 'Click to make inactive (students cannot select)' : 'Click to make active (students can select)'}
                            >
                              {sc.active ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={() => handleRemoveCaseFromSection(selectedAssignmentSection!, sc.case_id)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        {/* Expanded Scenarios Assignment */}
                        {expandedScenarios === sc.case_id && (
                          <div className="p-4 bg-green-50 border-t border-gray-200 space-y-4">
                            <h4 className="text-sm font-semibold text-gray-800">Scenario Assignment</h4>

                            {isLoadingScenarioAssignment ? (
                              <div className="text-center py-4">
                                <div className="inline-block animate-spin rounded-full h-6 w-6 border-4 border-green-500 border-t-transparent"></div>
                              </div>
                            ) : availableScenariosForCase.length === 0 ? (
                              <div className="text-sm text-gray-600 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                                No scenarios defined for this case yet. Go to the <strong>Cases</strong> tab and click <strong>Scenarios</strong> to create scenarios first.
                              </div>
                            ) : (
                              <>
                                {/* Enable Scenarios Toggle */}
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={scenarioSettings.use_scenarios}
                                    onChange={(e) => {
                                      if (!e.target.checked) {
                                        // Show warning when disabling scenarios
                                        if (!window.confirm('Without a scenario the chat will not have a topic to discuss. Are you sure you want to disable scenarios?')) {
                                          return;
                                        }
                                      }
                                      setScenarioSettings({...scenarioSettings, use_scenarios: e.target.checked});
                                    }}
                                    className="rounded border-gray-300"
                                  />
                                  <span className="font-medium">Enable scenarios for this section-case</span>
                                </label>

                                {scenarioSettings.use_scenarios && (
                                  <>
                                    {/* Scenario Checkboxes - now ABOVE selection mode */}
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-2">Assign Scenarios</label>
                                      <div className="space-y-2 max-h-64 overflow-y-auto">
                                        {availableScenariosForCase.map((scenario) => {
                                          const isAssigned = Array.isArray(assignedScenarios) && assignedScenarios.some(a => a.scenario_id === scenario.id);
                                          return (
                                            <div key={scenario.id} className="bg-white rounded border border-gray-200 border-l-4 border-l-green-400">
                                              <div className="flex items-start gap-2 text-sm p-2">
                                                <input
                                                  type="checkbox"
                                                  id={`scenario-${scenario.id}`}
                                                  checked={isAssigned}
                                                  onChange={() => handleToggleScenarioAssignment(selectedAssignmentSection!, sc.case_id, scenario.id, isAssigned)}
                                                  className="mt-0.5 rounded border-gray-300 cursor-pointer"
                                                />
                                                <div className="flex-1">
                                                  <div className="flex items-center gap-2">
                                                    <label htmlFor={`scenario-${scenario.id}`} className="font-medium text-gray-900 cursor-pointer hover:text-gray-700">
                                                      {scenario.scenario_name}
                                                    </label>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleViewScenario(scenario, sc.case_id, sc.case_title)}
                                                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                                    >
                                                      (view details)
                                                    </button>
                                                  </div>
                                                  <label htmlFor={`scenario-${scenario.id}`} className="block text-xs text-gray-500 cursor-pointer">
                                                    {scenario.protagonist}
                                                    {scenario.chat_time_limit > 0 && ` • ${scenario.chat_time_limit}min limit`}
                                                  </label>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {/* Scenario Selection Mode - radio buttons, below scenarios */}
                                    {(() => {
                                      const assignedCount = Array.isArray(assignedScenarios) ? assignedScenarios.length : 0;
                                      if (assignedCount <= 1) {
                                        return (
                                          <div className="text-xs text-gray-500 italic">
                                            Scenario Selection Mode: Only one scenario {assignedCount === 1 ? 'assigned' : 'available'}
                                          </div>
                                        );
                                      }
                                      return (
                                        <div>
                                          <label className="block text-xs font-medium text-gray-700 mb-2">Scenario Selection Mode</label>
                                          <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`selection_mode_${sc.case_id}`}
                                                value="student_choice"
                                                checked={scenarioSettings.selection_mode === 'student_choice'}
                                                onChange={(e) => setScenarioSettings({...scenarioSettings, selection_mode: e.target.value})}
                                                className="text-green-600"
                                              />
                                              Student Choice (pick any one)
                                            </label>
                                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`selection_mode_${sc.case_id}`}
                                                value="all_required"
                                                checked={scenarioSettings.selection_mode === 'all_required'}
                                                onChange={(e) => setScenarioSettings({...scenarioSettings, selection_mode: e.target.value})}
                                                className="text-green-600"
                                              />
                                              All Required (must complete all)
                                            </label>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* Require Order (only for all_required) */}
                                    {scenarioSettings.selection_mode === 'all_required' && (
                                      <label className="flex items-center gap-2 text-sm ml-6">
                                        <input
                                          type="checkbox"
                                          checked={scenarioSettings.require_order}
                                          onChange={(e) => setScenarioSettings({...scenarioSettings, require_order: e.target.checked})}
                                          className="rounded border-gray-300"
                                        />
                                        Require completion in order
                                      </label>
                                    )}

                                  </>
                                )}

                                {/* Position Tracking Settings */}
                                <div className="pt-3 mt-3 border-t border-gray-200 space-y-3">
                                  <h5 className="text-xs font-semibold text-gray-700">Position Tracking</h5>

                                  {/* Enable Position Tracking Toggle */}
                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={positionSettings.position_tracking_enabled}
                                      onChange={(e) => setPositionSettings({...positionSettings, position_tracking_enabled: e.target.checked})}
                                      className="rounded border-gray-300"
                                    />
                                    <span>Enable position tracking for this assignment</span>
                                  </label>

                                  {/* Case 1: Position tracking enabled but NO positions available */}
                                  {positionSettings.position_tracking_enabled && assignmentPositions.length === 0 && (
                                    <div className="ml-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                                      {assignedScenarios.length === 0 ? (
                                        <>
                                          No scenarios are assigned to this course section yet. Assign scenarios above first, then save — positions defined for those scenarios will appear here.
                                        </>
                                      ) : (
                                        <>
                                          No positions have been defined for the assigned scenarios yet. To use position tracking, you need to define positions.{' '}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPrimaryTab('content');
                                              setContentSubTab('cases');
                                              setManagingScenarioCase({ case_id: sc.case_id, case_title: sc.case_title } as Case);
                                              setShowScenarioManager(true);
                                              setExpandedScenarios(null);
                                            }}
                                            className="text-purple-600 hover:text-purple-800 underline font-medium"
                                          >
                                            Go to Case Library &gt; Scenarios
                                          </button>{' '}
                                          to define positions for each scenario.
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* Case 2: Position tracking enabled AND positions exist - show full UI */}
                                  {positionSettings.position_tracking_enabled && assignmentPositions.length > 0 && (
                                    <div className="ml-6 space-y-3">
                                      {/* Position Capture Method */}
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">Position Capture Method</label>
                                        <select
                                          value={positionSettings.position_capture_method}
                                          onChange={(e) => setPositionSettings({...positionSettings, position_capture_method: e.target.value})}
                                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                        >
                                          <option value="explicit">Student selects position</option>
                                          <option value="ai_inferred">AI infers from conversation</option>
                                          <option value="instructor_manual">Instructor assigns after review</option>
                                          <option value="none">No position capture</option>
                                        </select>
                                      </div>

                                      {/* Track Position Change */}
                                      <label className="flex items-center gap-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={positionSettings.track_position_change}
                                          onChange={(e) => setPositionSettings({...positionSettings, track_position_change: e.target.checked})}
                                          className="rounded border-gray-300"
                                        />
                                        Track if student's position changes during chat
                                      </label>

                                      {/* Available Positions with drag-and-drop reordering */}
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-2">
                                          Available Positions <span className="text-gray-400 font-normal">(drag to reorder)</span>
                                        </label>
                                        <DndContext
                                          sensors={positionSensors}
                                          collisionDetection={closestCenter}
                                          onDragEnd={(event) => handlePositionDragEnd(event, selectedAssignmentSection!, sc.case_id)}
                                        >
                                          <SortableContext
                                            items={assignmentPositions.map(p => p.position_id)}
                                            strategy={verticalListSortingStrategy}
                                          >
                                            <div className="space-y-2">
                                              {assignmentPositions.map((pos: any) => (
                                                <SortablePositionItem
                                                  key={pos.position_id}
                                                  position={pos}
                                                  sectionId={selectedAssignmentSection!}
                                                  caseId={sc.case_id}
                                                  onToggle={handleToggleAssignmentPosition}
                                                />
                                              ))}
                                            </div>
                                          </SortableContext>
                                        </DndContext>
                                        <p className="text-xs text-gray-500 mt-2">
                                          Note: To add or edit positions, go to{' '}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setPrimaryTab('content');
                                              setContentSubTab('cases');
                                              setManagingScenarioCase({ case_id: sc.case_id, case_title: sc.case_title } as Case);
                                              setShowScenarioManager(true);
                                              setExpandedScenarios(null);
                                            }}
                                            className="text-purple-600 hover:text-purple-800 underline font-medium"
                                          >
                                            Case Library &gt; Scenarios
                                          </button>{' '}
                                          for this case.
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  {/* Save Position Settings Button */}
                                  {assignmentPositions.length > 0 && (
                                    <div className="flex justify-end pt-2">
                                      <button
                                        onClick={() => handleSavePositionSettings(selectedAssignmentSection!, sc.case_id)}
                                        disabled={isSavingPositionSettings}
                                        className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                                      >
                                        {isSavingPositionSettings ? 'Saving...' : 'Save Position Settings'}
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Action Buttons */}
                                <div className="flex justify-end gap-2 pt-2 border-t">
                                  <button
                                    onClick={() => { setExpandedScenarios(null); }}
                                    className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                                  >
                                    Close
                                  </button>
                                  <button
                                    onClick={() => handleSaveScenarioSettings(selectedAssignmentSection!, sc.case_id)}
                                    disabled={isSavingScenarioAssignment}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                                  >
                                    {isSavingScenarioAssignment ? 'Saving...' : 'Save Settings'}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Expanded Scheduling */}
                        {expandedScheduling === sc.case_id && editingScheduling && (
                          <div className="p-4 bg-blue-50 border-t border-gray-200 space-y-4">
                            <h4 className="text-sm font-semibold text-gray-800">Scheduling & Availability</h4>

                            {/* Manual Status Override */}
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-2">Availability Control</label>
                              <select
                                value={editingScheduling.manual_status}
                                onChange={(e) => setEditingScheduling({...editingScheduling, manual_status: e.target.value})}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              >
                                <option value="auto">Auto (use dates below)</option>
                                <option value="manually_opened">Always Available (manually opened)</option>
                                <option value="manually_closed">Never Available (manually closed)</option>
                              </select>
                              <p className="text-xs text-gray-500 mt-1">
                                {editingScheduling.manual_status === 'auto' && 'Case availability will be determined by the open and close dates below.'}
                                {editingScheduling.manual_status === 'manually_opened' && 'Case will be available to students regardless of dates.'}
                                {editingScheduling.manual_status === 'manually_closed' && 'Case will not be available to students regardless of dates.'}
                              </p>
                            </div>

                            {/* Date/Time Controls - only show if auto mode */}
                            {editingScheduling.manual_status === 'auto' && (
                              <>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Open Date & Time</label>
                                  <input
                                    type="datetime-local"
                                    value={editingScheduling.open_date}
                                    onChange={(e) => setEditingScheduling({...editingScheduling, open_date: e.target.value})}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    When the case becomes available to students. Leave empty for no open restriction.
                                  </p>
                                </div>

                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Close Date & Time</label>
                                  <input
                                    type="datetime-local"
                                    value={editingScheduling.close_date}
                                    onChange={(e) => setEditingScheduling({...editingScheduling, close_date: e.target.value})}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    When the case is no longer available for starting new chats. Students can continue existing chats after this time.
                                  </p>
                                </div>
                              </>
                            )}

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-2 pt-2 border-t">
                              <button
                                onClick={() => { setExpandedScheduling(null); setEditingScheduling(null); }}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveScheduling(selectedAssignmentSection!, sc.case_id)}
                                disabled={isSavingScheduling}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                {isSavingScheduling ? 'Saving...' : 'Save Scheduling'}
                              </button>
                            </div>
                          </div>
                        )}

                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Copy Assignments Section */}
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Copy Case Assignments</h4>

            {/* Copy Result Message */}
            {copyResult && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                copyResult.type === 'success'
                  ? 'bg-green-100 border border-green-200 text-green-700'
                  : 'bg-red-100 border border-red-200 text-red-700'
              }`}>
                {copyResult.message}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Copy case assignments from course section...
              </label>
              <select
                value={copyFromSection || ''}
                onChange={(e) => handleCopyFromSectionChange(e.target.value)}
                className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">Select a source section...</option>
                {assignmentsSectionsList
                  .filter((s: any) => s.enabled && s.section_id !== selectedAssignmentSection)
                  .map((section: any) => (
                    <option key={section.section_id} value={section.section_id}>
                      {section.section_title} ({section.section_id}) - {section.year_term}
                    </option>
                  ))}
              </select>
            </div>

            {copyFromSection && (
              <div className="space-y-4">
                {/* Copy Options */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={copyOptions.options}
                      onChange={(e) => setCopyOptions({...copyOptions, options: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Also copy chat options
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={copyOptions.scenarios}
                      onChange={(e) => setCopyOptions({...copyOptions, scenarios: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Also copy scenarios
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={copyOptions.scheduling}
                      onChange={(e) => setCopyOptions({...copyOptions, scheduling: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Also copy scheduling
                  </label>
                </div>

                {/* Source Section Cases Preview */}
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-700 mb-2">
                    Cases in source section ({sourceSectionCases.length}):
                  </p>
                  {sourceSectionCases.length === 0 ? (
                    <p className="text-xs text-gray-500">No cases assigned to this section.</p>
                  ) : (
                    <ul className="text-xs text-gray-600 space-y-1">
                      {sourceSectionCases.map((sc: any) => (
                        <li key={sc.case_id} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                          <span className="font-medium">{sc.case_title}</span>
                          <span className="text-gray-400">
                            {sc.use_scenarios && `(${(sc.scenarios?.length || 0)} scenarios)`}
                            {sc.open_date && ` • Scheduled`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Copy Button */}
                <button
                  onClick={handleCopyAssignments}
                  disabled={isCopying || sourceSectionCases.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCopying ? 'Copying...' : `Copy cases from "${assignmentsSectionsList.find((s: any) => s.section_id === copyFromSection)?.section_title || copyFromSection}"`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Fetch defaults from API
  const fetchChatOptionsDefaults = async (sectionId?: string) => {
    try {
      const token = localStorage.getItem('admin_auth_token');
      const url = sectionId
        ? `${getApiBaseUrl()}/chat-options/defaults?section_id=${sectionId}`
        : `${getApiBaseUrl()}/chat-options/defaults`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      // Merge with defaultChatOptions to ensure all fields are present
      const mergedData = { ...defaultChatOptions, ...(result.data || {}) };
      return {
        data: mergedData,
        section_specific: result.section_specific || false
      };
    } catch (error) {
      console.error('Error fetching defaults:', error);
      return {
        data: { ...defaultChatOptions },
        section_specific: false
      };
    }
  };

  // Handle chat options section/case selection change
  const handleChatOptionsSectionChange = async (sectionId: string) => {
    setChatOptionsSection(sectionId);
    setChatOptionsCase(null);
    setUseDefaultOptions(true);

    if (sectionId === '__global_default__') {
      // Editing global default
      setIsEditingDefault('global');
      const { data: defaults, section_specific } = await fetchChatOptionsDefaults();
      setEditingChatOptions({ ...defaults });
      setApplicableDefault(null);
      setIsDefaultSectionSpecific(false);
    } else if (sectionId) {
      // Regular section selected - reset default editing mode
      setIsEditingDefault(null);
      await fetchSectionCases(sectionId);
      // Fetch applicable default for this section
      const { data: defaults, section_specific } = await fetchChatOptionsDefaults(sectionId);
      setApplicableDefault(defaults);
      setIsDefaultSectionSpecific(section_specific);
    } else {
      // Nothing selected
      setIsEditingDefault(null);
      setApplicableDefault(null);
      setIsDefaultSectionSpecific(false);
    }
  };

  // Handle chat options case selection change
  const handleChatOptionsCaseChange = async (caseId: string) => {
    setChatOptionsCase(caseId);

    if (caseId === '__section_default__') {
      // Editing section default
      setIsEditingDefault('section');
      setUseDefaultOptions(true);
      // Fetch section-specific default (will fall back to global if not set)
      const { data: defaults, section_specific } = await fetchChatOptionsDefaults(chatOptionsSection || undefined);
      setEditingChatOptions({ ...defaults });
      setIsDefaultSectionSpecific(section_specific);
    } else if (caseId) {
      // Regular case selected
      setIsEditingDefault(null);
      const sc = sectionCasesList.find((s: any) => s.case_id === caseId);
      if (sc) {
        const hasCustomOptions = sc.chat_options_is_custom === true;
        setUseDefaultOptions(!hasCustomOptions);
        if (hasCustomOptions) {
          setEditingChatOptions({ ...sc.chat_options });
        } else {
          // Refresh defaults from API to ensure we have the latest values
          const { data: freshDefaults, section_specific } = await fetchChatOptionsDefaults(chatOptionsSection || undefined);
          setApplicableDefault(freshDefaults);
          setIsDefaultSectionSpecific(section_specific);
          setEditingChatOptions({ ...freshDefaults });
        }
      }
    } else {
      setIsEditingDefault(null);
    }
  };

  // Get the selected chat options case data
  const getSelectedChatOptionsCase = () => {
    if (!chatOptionsCase) return null;
    return sectionCasesList.find((sc: any) => sc.case_id === chatOptionsCase);
  };

  // Handle bulk copy chat options
  const handleBulkCopyChatOptions = async (target: 'section' | 'all') => {
    if (!chatOptionsSection || !chatOptionsCase) return;

    const targetDescription = target === 'section'
      ? `all cases in "${assignmentsSectionsList.find((s: any) => s.section_id === chatOptionsSection)?.section_title || chatOptionsSection}"`
      : 'all cases in all sections';

    if (!confirm(`Are you sure you want to copy these chat options to ${targetDescription}?`)) {
      return;
    }

    setIsBulkCopying(true);
    setBulkCopyResult(null);

    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/chat-options/bulk-copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          source_section_id: chatOptionsSection,
          source_case_id: chatOptionsCase,
          target,
          target_section_id: target === 'section' ? chatOptionsSection : undefined
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to copy chat options');
      }

      setBulkCopyResult({
        message: result.message || `Chat options copied to ${result.data?.updated || 0} assignment(s)`,
        type: 'success'
      });
    } catch (err: any) {
      setBulkCopyResult({
        message: err.message || 'Failed to copy chat options',
        type: 'error'
      });
    } finally {
      setIsBulkCopying(false);
    }
  };

  // Handle saving chat options as defaults
  const handleSaveAsDefaults = async (forSection: boolean) => {
    if (!editingChatOptions) return;

    const description = forSection
      ? `section "${assignmentsSectionsList.find((s: any) => s.section_id === chatOptionsSection)?.section_title || chatOptionsSection}"`
      : 'all sections';

    if (!confirm(`Save these settings as default for ${description}?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/chat-options/defaults`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          section_id: forSection ? chatOptionsSection : null,
          chat_options: editingChatOptions
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to save defaults');
      }

      setSuccessMessage(result.message || 'Defaults saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save defaults');
    }
  };

  // Handle saving the default directly (when in defaults editing mode)
  const handleSaveDefault = async () => {
    if (!editingChatOptions) return;

    setIsSavingChatOptions(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/chat-options/defaults`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          section_id: isEditingDefault === 'section' ? chatOptionsSection : null,
          chat_options: editingChatOptions
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to save defaults');
      }

      setSuccessMessage(result.message || 'Default saved successfully');
      setTimeout(() => setSuccessMessage(null), 5000);

      // Update applicable default and section_specific flag after save
      if (isEditingDefault === 'section') {
        setApplicableDefault({ ...editingChatOptions });
        setIsDefaultSectionSpecific(true);
      } else if (isEditingDefault === 'global') {
        // After saving global, keep the edited options visible
        // No need to refetch since we just saved them
        // If we're in a section context, update applicable default to reflect new global
        if (chatOptionsSection && !isDefaultSectionSpecific) {
          setApplicableDefault({ ...editingChatOptions });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save defaults');
    } finally {
      setIsSavingChatOptions(false);
    }
  };

  // Handle clearing custom options (revert to defaults by setting chat_options to NULL)
  const handleClearCustomOptions = async () => {
    if (!chatOptionsSection || !chatOptionsCase) return;

    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/sections/${chatOptionsSection}/cases/${chatOptionsCase}/options`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          chat_options: null
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to clear custom options');
      }

      // Refresh section cases to update local state
      await fetchSectionCases(chatOptionsSection);
      setSuccessMessage('Reverted to default options');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to clear custom options');
    }
  };

  const renderChatOptionsTab = () => (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">Chat Options</h2>
            <HelpTooltip title="Chat Options Help">
              <ChatOptionsHelp />
            </HelpTooltip>
          </div>
          <p className="text-sm text-gray-500">Configure chat settings for each section-case assignment</p>
        </div>
        <button
          onClick={() => {
            fetchAssignmentsSections();
            if (chatOptionsSection) {
              fetchSectionCases(chatOptionsSection);
            }
          }}
          disabled={isLoadingAssignments}
          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
          aria-label="Refresh chat options"
          title="Refresh chat options"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoadingAssignments ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Success/Error Messages */}
      {renderDismissibleErrorBanner('mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg')}
      {successMessage && (
        <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {successMessage}
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-200" title="Dismiss">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {/* Section and Case Selectors */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Course Section</label>
            <select
              value={chatOptionsSection || ''}
              onChange={(e) => handleChatOptionsSectionChange(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            >
              <option value="">Select a section...</option>
              <option value="__global_default__" className="font-medium text-purple-700">Default for all sections</option>
              {assignmentsSectionsList.filter((s: any) => s.enabled).map((section: any) => (
                <option key={section.section_id} value={section.section_id}>
                  {section.section_title} ({section.section_id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Case</label>
            <select
              value={chatOptionsCase || ''}
              onChange={(e) => handleChatOptionsCaseChange(e.target.value)}
              disabled={!chatOptionsSection || chatOptionsSection === '__global_default__'}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{chatOptionsSection === '__global_default__' ? '-- Not applicable --' : 'Select a case...'}</option>
              {chatOptionsSection && chatOptionsSection !== '__global_default__' && (
                <option value="__section_default__" className="font-medium text-purple-700">Default for this section</option>
              )}
              {sectionCasesList.map((sc: any) => (
                <option key={sc.case_id} value={sc.case_id}>
                  {sc.case_title} ({sc.case_id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Chat Options Form */}
      {((chatOptionsSection && chatOptionsCase && editingChatOptions) || isEditingDefault === 'global') ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header - changes based on what we're editing */}
          <div className={`p-4 border-b border-gray-200 ${isEditingDefault ? 'bg-amber-50' : 'bg-purple-50'}`}>
            {isEditingDefault === 'global' ? (
              <>
                <h3 className="font-medium text-gray-900">Global Default Chat Options</h3>
                <p className="text-sm text-gray-600 mt-1">
                  These settings apply to all new case assignments unless overridden by section or assignment-specific settings.
                </p>
              </>
            ) : isEditingDefault === 'section' ? (
              <>
                <h3 className="font-medium text-gray-900">
                  Default for Section: {assignmentsSectionsList.find((s: any) => s.section_id === chatOptionsSection)?.section_title}
                </h3>
                {!isDefaultSectionSpecific ? (
                  <div className="mt-2 p-2 bg-blue-100 border border-blue-300 rounded-lg">
                    <p className="text-sm text-blue-900">
                      <strong>No section-specific default exists.</strong> The form below shows global defaults. You can modify and save to create a section-specific default.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 mt-1">
                    These settings apply to new case assignments in this section unless overridden at the assignment level.
                  </p>
                )}
              </>
            ) : (
              <h3 className="font-medium text-gray-900">
                Chat Options for {getSelectedChatOptionsCase()?.case_title}
              </h3>
            )}
          </div>

          {/* Use Default Checkbox - only for regular section-case assignments */}
          {!isEditingDefault && (
            <div className="p-4 bg-gray-50 border-b border-gray-200">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useDefaultOptions}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setUseDefaultOptions(checked);
                    if (checked) {
                      // When checking, clear custom options in database and show defaults (read-only)
                      await handleClearCustomOptions();
                      if (applicableDefault) {
                        setEditingChatOptions({ ...applicableDefault });
                      }
                    } else if (applicableDefault) {
                      // When unchecking, initialize with default values for editing
                      setEditingChatOptions({ ...applicableDefault });
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <div>
                  <span className="font-medium text-gray-900">Use default chat options</span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {useDefaultOptions
                      ? 'Using inherited defaults. Uncheck to customize settings for this assignment.'
                      : 'Custom settings for this assignment. Check to revert to defaults.'}
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Info banner when viewing inherited defaults */}
          {!isEditingDefault && useDefaultOptions && applicableDefault && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-blue-800">
                  Using defaults from {getInheritanceSource(isEditingDefault, chatOptionsSection, isDefaultSectionSpecific)}. Expand categories below to view settings.
                </span>
              </div>
              <button
                onClick={() => {
                  // Determine if we should navigate to section or global defaults
                  const result = (async () => {
                    const token = localStorage.getItem('admin_auth_token');
                    const url = chatOptionsSection
                      ? `${getApiBaseUrl()}/chat-options/defaults?section_id=${chatOptionsSection}`
                      : `${getApiBaseUrl()}/chat-options/defaults`;
                    const response = await fetch(url, {
                      headers: { Authorization: `Bearer ${token}` }
                    });
                    const data = await response.json();
                    return data.section_specific;
                  })();
                  
                  result.then((isSectionSpecific) => {
                    if (isSectionSpecific) {
                      // Navigate to section default
                      setChatOptionsCase('__section_default__');
                    } else {
                      // Navigate to global default
                      handleChatOptionsSectionChange('__global_default__');
                    }
                  });
                }}
                className="text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline whitespace-nowrap"
              >
                View/Edit Defaults →
              </button>
            </div>
          )}

          <div className={`p-4 space-y-2 ${!isEditingDefault && useDefaultOptions ? 'opacity-60' : ''}`}>
            {/* Modified options summary */}
            {!useDefaultOptions && applicableDefault && editingChatOptions && (() => {
              const optionKeys = Object.keys(defaultChatOptions);
              const modifiedCount = optionKeys.filter(key => isOptionModified(key, editingChatOptions[key], applicableDefault)).length;
              if (modifiedCount > 0) {
                return (
                  <div className="mb-3 p-2 bg-purple-50 border border-purple-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-600 text-sm font-medium">{modifiedCount} option{modifiedCount !== 1 ? 's' : ''} modified</span>
                      <span className="text-xs text-purple-500">from {getInheritanceSource(isEditingDefault, chatOptionsSection, isDefaultSectionSpecific)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingChatOptions({ ...applicableDefault })}
                      className="text-xs text-purple-600 hover:text-purple-800 underline"
                    >
                      Reset all to defaults
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            {/* Categories Header with Expand/Collapse All */}
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-200">
              <h4 className="text-sm font-semibold text-gray-800">Categories of Chat Options</h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={expandAllCategories}
                  className="text-xs text-purple-600 hover:text-purple-800"
                >
                  Expand All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={collapseAllCategories}
                  className="text-xs text-purple-600 hover:text-purple-800"
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Hints Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('hints')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Hints</span>
                <span className="text-gray-400">{expandedCategories.has('hints') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('hints') && (
                <div className="pb-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`${!useDefaultOptions && isOptionModified('hints_allowed', editingChatOptions.hints_allowed, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-gray-700">Hints Allowed</label>
                        {!useDefaultOptions && isOptionModified('hints_allowed', editingChatOptions.hints_allowed, applicableDefault) && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Modified</span>
                            <button
                              type="button"
                              onClick={() => setEditingChatOptions({...editingChatOptions, hints_allowed: applicableDefault?.hints_allowed ?? 3})}
                              className="text-xs text-gray-500 hover:text-purple-600"
                              title={`Reset to default (${applicableDefault?.hints_allowed ?? 3})`}
                            >
                              ↩
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={editingChatOptions.hints_allowed ?? 3}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, hints_allowed: parseInt(e.target.value) || 0})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${useDefaultOptions ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                      {useDefaultOptions && applicableDefault && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">Inherited from {getInheritanceSource(isEditingDefault, chatOptionsSection)}</p>
                      )}
                    </div>
                    <div className={`${!useDefaultOptions && isOptionModified('free_hints', editingChatOptions.free_hints, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-gray-700">Free Hints (no penalty)</label>
                        {!useDefaultOptions && isOptionModified('free_hints', editingChatOptions.free_hints, applicableDefault) && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Modified</span>
                            <button
                              type="button"
                              onClick={() => setEditingChatOptions({...editingChatOptions, free_hints: applicableDefault?.free_hints ?? 1})}
                              className="text-xs text-gray-500 hover:text-purple-600"
                              title={`Reset to default (${applicableDefault?.free_hints ?? 1})`}
                            >
                              ↩
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={editingChatOptions.free_hints ?? 1}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, free_hints: parseInt(e.target.value) || 0})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${useDefaultOptions ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                      {useDefaultOptions && applicableDefault && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">Inherited from {getInheritanceSource(isEditingDefault, chatOptionsSection)}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Display & Flow Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('display')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Display & Flow</span>
                <span className="text-gray-400">{expandedCategories.has('display') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('display') && (
                <div className="pb-4 pt-2 space-y-2">
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('show_case', editingChatOptions.show_case, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.show_case ?? true}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, show_case: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Show case content in left panel</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('show_case', editingChatOptions.show_case, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, show_case: applicableDefault?.show_case ?? true})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('show_timer', editingChatOptions.show_timer, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.show_timer ?? true}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, show_timer: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Show countdown timer during chat</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('show_timer', editingChatOptions.show_timer, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, show_timer: applicableDefault?.show_timer ?? true})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('do_evaluation', editingChatOptions.do_evaluation, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.do_evaluation ?? true}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, do_evaluation: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Run evaluation after chat</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('do_evaluation', editingChatOptions.do_evaluation, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, do_evaluation: applicableDefault?.do_evaluation ?? true})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('show_evaluation_details', editingChatOptions.show_evaluation_details, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.show_evaluation_details ?? true}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, show_evaluation_details: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Show full evaluation criteria (vs just score)</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('show_evaluation_details', editingChatOptions.show_evaluation_details, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, show_evaluation_details: applicableDefault?.show_evaluation_details ?? true})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('ask_for_feedback', editingChatOptions.ask_for_feedback, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.ask_for_feedback ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, ask_for_feedback: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Ask for feedback at end of chat</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('ask_for_feedback', editingChatOptions.ask_for_feedback, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, ask_for_feedback: applicableDefault?.ask_for_feedback ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('ask_save_transcript', editingChatOptions.ask_save_transcript, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.ask_save_transcript ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, ask_save_transcript: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Ask to save anonymized transcript</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('ask_save_transcript', editingChatOptions.ask_save_transcript, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, ask_save_transcript: applicableDefault?.ask_save_transcript ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('auto_save_transcript', editingChatOptions.auto_save_transcript, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.auto_save_transcript ?? true}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, auto_save_transcript: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Auto-save transcript during chat</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('auto_save_transcript', editingChatOptions.auto_save_transcript, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, auto_save_transcript: applicableDefault?.auto_save_transcript ?? true})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('always_save_transcript', editingChatOptions.always_save_transcript, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.always_save_transcript ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, always_save_transcript: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Always save transcript at the end without asking</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('always_save_transcript', editingChatOptions.always_save_transcript, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, always_save_transcript: applicableDefault?.always_save_transcript ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  {useDefaultOptions && applicableDefault && (
                    <p className="text-xs text-gray-400 mt-2 italic">All settings inherited from {getInheritanceSource(isEditingDefault, chatOptionsSection, isDefaultSectionSpecific)}</p>
                  )}
                </div>
              )}
            </div>

            {/* Persona Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('persona')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Persona</span>
                <span className="text-gray-400">{expandedCategories.has('persona') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('persona') && (
                <div className="pb-4 pt-2">
                  {renderPersonaChatOptionsFields(!isEditingDefault && useDefaultOptions)}
                </div>
              )}
            </div>

            {/* Custom Instructions Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('instructions')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Custom Instructions</span>
                <span className="text-gray-400">{expandedCategories.has('instructions') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('instructions') && (
                <div className="pb-4 pt-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Additional instructions for the chatbot, such as personality or response guidance
                  </label>
                  <textarea
                    value={editingChatOptions.chatbot_personality ?? ''}
                    onChange={(e) => setEditingChatOptions({...editingChatOptions, chatbot_personality: e.target.value})}
                    placeholder="Additional AI instructions to customize chatbot behavior..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm h-24 resize-y"
                  />
                </div>
              )}
            </div>

            {/* Chat Controls Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('controls')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Chat Controls</span>
                <span className="text-gray-400">{expandedCategories.has('controls') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('controls') && (
                <div className="pb-4 pt-2 space-y-3">
                  <div className="space-y-2">
                    <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('allow_repeat', editingChatOptions.allow_repeat, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editingChatOptions.allow_repeat ?? false}
                          onChange={(e) => setEditingChatOptions({...editingChatOptions, allow_repeat: e.target.checked})}
                          disabled={!isEditingDefault && useDefaultOptions}
                          className="rounded border-gray-300"
                        />
                        <span className={useDefaultOptions ? 'text-gray-500' : ''}>Allow students to repeat the chat multiple times</span>
                      </label>
                      {!useDefaultOptions && isOptionModified('allow_repeat', editingChatOptions.allow_repeat, applicableDefault) && (
                        <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, allow_repeat: applicableDefault?.allow_repeat ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                      )}
                    </div>
                    <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('timeout_chat', editingChatOptions.timeout_chat, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editingChatOptions.timeout_chat ?? false}
                          onChange={(e) => setEditingChatOptions({...editingChatOptions, timeout_chat: e.target.checked})}
                          disabled={!isEditingDefault && useDefaultOptions}
                          className="rounded border-gray-300"
                        />
                        <span className={useDefaultOptions ? 'text-gray-500' : ''}>Auto-end chat when time limit expires</span>
                      </label>
                      {!useDefaultOptions && isOptionModified('timeout_chat', editingChatOptions.timeout_chat, applicableDefault) && (
                        <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, timeout_chat: applicableDefault?.timeout_chat ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                      )}
                    </div>
                    <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('allow_finish_button', editingChatOptions.allow_finish_button, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editingChatOptions.allow_finish_button ?? false}
                          onChange={(e) => setEditingChatOptions({...editingChatOptions, allow_finish_button: e.target.checked})}
                          disabled={!isEditingDefault && useDefaultOptions}
                          className="rounded border-gray-300"
                        />
                        <span className={useDefaultOptions ? 'text-gray-500' : ''}>Provide students a "Finish Chat" button to conclude the chat when done</span>
                      </label>
                      {!useDefaultOptions && isOptionModified('allow_finish_button', editingChatOptions.allow_finish_button, applicableDefault) && (
                        <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, allow_finish_button: applicableDefault?.allow_finish_button ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                      )}
                    </div>
                    <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('restart_chat', editingChatOptions.restart_chat, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editingChatOptions.restart_chat ?? false}
                          onChange={(e) => setEditingChatOptions({...editingChatOptions, restart_chat: e.target.checked})}
                          disabled={!isEditingDefault && useDefaultOptions}
                          className="rounded border-gray-300"
                        />
                        <span className={useDefaultOptions ? 'text-gray-500' : ''}>Provide students a "Restart Chat" button to restart the current case chat</span>
                      </label>
                      {!useDefaultOptions && isOptionModified('restart_chat', editingChatOptions.restart_chat, applicableDefault) && (
                        <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, restart_chat: applicableDefault?.restart_chat ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                      )}
                    </div>
                    <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('allow_exit', editingChatOptions.allow_exit, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editingChatOptions.allow_exit ?? false}
                          onChange={(e) => setEditingChatOptions({...editingChatOptions, allow_exit: e.target.checked})}
                          disabled={!isEditingDefault && useDefaultOptions}
                          className="rounded border-gray-300"
                        />
                        <span className={useDefaultOptions ? 'text-gray-500' : ''}>Provide students a "Cancel Chat" button to cancel and perhaps start over</span>
                      </label>
                      {!useDefaultOptions && isOptionModified('allow_exit', editingChatOptions.allow_exit, applicableDefault) && (
                        <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, allow_exit: applicableDefault?.allow_exit ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div className={`${!useDefaultOptions && isOptionModified('require_minimum_exchanges', editingChatOptions.require_minimum_exchanges, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-gray-700">Minimum Exchanges</label>
                        {!useDefaultOptions && isOptionModified('require_minimum_exchanges', editingChatOptions.require_minimum_exchanges, applicableDefault) && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Modified</span>
                            <button
                              type="button"
                              onClick={() => setEditingChatOptions({...editingChatOptions, require_minimum_exchanges: applicableDefault?.require_minimum_exchanges ?? 0})}
                              className="text-xs text-gray-500 hover:text-purple-600"
                              title={`Reset to default (${applicableDefault?.require_minimum_exchanges ?? 0})`}
                            >
                              ↩
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={editingChatOptions.require_minimum_exchanges ?? 0}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, require_minimum_exchanges: parseInt(e.target.value) || 0})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${useDefaultOptions ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                      <p className="text-xs text-gray-500 mt-1">Required before "time is up" (0 = none)</p>
                    </div>
                    <div className={`${!useDefaultOptions && isOptionModified('max_message_length', editingChatOptions.max_message_length, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-gray-700">Max Message Length</label>
                        {!useDefaultOptions && isOptionModified('max_message_length', editingChatOptions.max_message_length, applicableDefault) && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">Modified</span>
                            <button
                              type="button"
                              onClick={() => setEditingChatOptions({...editingChatOptions, max_message_length: applicableDefault?.max_message_length ?? 0})}
                              className="text-xs text-gray-500 hover:text-purple-600"
                              title={`Reset to default (${applicableDefault?.max_message_length ?? 0})`}
                            >
                              ↩
                            </button>
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        value={editingChatOptions.max_message_length ?? 0}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, max_message_length: parseInt(e.target.value) || 0})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm ${useDefaultOptions ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                      <p className="text-xs text-gray-500 mt-1">Characters per message (0 = unlimited)</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Advanced Section */}
            <div className="border-b border-gray-200">
              <button
                type="button"
                onClick={() => toggleCategory('advanced')}
                className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
              >
                <span>Advanced</span>
                <span className="text-gray-400">{expandedCategories.has('advanced') ? '\u25BC' : '\u25B6'}</span>
              </button>
              {expandedCategories.has('advanced') && (
                <div className="pb-4 pt-2">
                  <div className={`flex items-center justify-between ${!useDefaultOptions && isOptionModified('disable_position_tracking', editingChatOptions.disable_position_tracking, applicableDefault) ? 'pl-2 border-l-2 border-purple-400' : ''}`}>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.disable_position_tracking ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, disable_position_tracking: e.target.checked})}
                        disabled={!isEditingDefault && useDefaultOptions}
                        className="rounded border-gray-300"
                      />
                      <span className={useDefaultOptions ? 'text-gray-500' : ''}>Disable position tracking for this assignment</span>
                    </label>
                    {!useDefaultOptions && isOptionModified('disable_position_tracking', editingChatOptions.disable_position_tracking, applicableDefault) && (
                      <button type="button" onClick={() => setEditingChatOptions({...editingChatOptions, disable_position_tracking: applicableDefault?.disable_position_tracking ?? false})} className="text-xs text-gray-500 hover:text-purple-600" title="Reset to default">↩</button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 ml-6">Override scenario-level position tracking settings</p>
                </div>
              )}
            </div>

            {/* Save Actions - different based on what we're editing */}
            {isEditingDefault ? (
              /* Editing default: show save default button */
              <div className="pt-4 border-t space-y-3">
                {/* Success/Error messages for save actions */}
                {successMessage && isEditingDefault && (
                  <div className="bg-green-100 border border-green-200 text-green-700 p-3 rounded-lg flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {successMessage}
                  </div>
                )}
                {error && isEditingDefault && renderDismissibleErrorBanner('bg-red-100 border border-red-200 text-red-700 p-3 rounded-lg')}
                <div className="flex justify-between">
                  {isEditingDefault === 'section' && (
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this section default? The section will revert to using global defaults.')) {
                          return;
                        }
                        try {
                          const token = localStorage.getItem('admin_auth_token');
                          const response = await fetch(`${getApiBaseUrl()}/chat-options/defaults?section_id=${chatOptionsSection}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${token}` }
                          });
                          const result = await response.json();
                          if (!response.ok || result.error) {
                            throw new Error(result.error?.message || 'Failed to delete section default');
                          }
                          setSuccessMessage('Section default deleted. Now using global defaults.');
                          setTimeout(() => setSuccessMessage(null), 5000);
                          // Reload the section defaults to show global fallback
                          const { data: defaults, section_specific } = await fetchChatOptionsDefaults(chatOptionsSection || undefined);
                          setEditingChatOptions({ ...defaults });
                          setIsDefaultSectionSpecific(section_specific);
                        } catch (err: any) {
                          setError(err.message || 'Failed to delete section default');
                          setTimeout(() => setError(null), 5000);
                        }
                      }}
                      disabled={isSavingChatOptions}
                      className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete Section Default
                    </button>
                  )}
                  {isEditingDefault === 'global' && <div />}
                  <button
                    onClick={handleSaveDefault}
                    disabled={isSavingChatOptions}
                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isSavingChatOptions ? 'Saving...' : isEditingDefault === 'global' ? 'Save Global Default' : 'Save Section Default'}
                  </button>
                </div>
              </div>
            ) : useDefaultOptions ? (
              /* Using defaults: show info message */
              <div className="pt-4 border-t text-center">
                <p className="text-sm text-gray-500">
                  Using default settings. Uncheck "Use default chat options" above to customize.
                </p>
              </div>
            ) : (
              /* Custom options: show normal save buttons */
              <div className="flex justify-between pt-4 border-t">
                <button
                  onClick={handleResetChatOptions}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                >
                  Reset to Defaults
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const sc = sectionCasesList.find((s: any) => s.case_id === chatOptionsCase);
                      if (sc) {
                        setEditingChatOptions(sc.chat_options ? { ...sc.chat_options } : { ...defaultChatOptions });
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveChatOptions(chatOptionsSection!, chatOptionsCase!)}
                    disabled={isSavingChatOptions}
                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isSavingChatOptions ? 'Saving...' : 'Save Options'}
                  </button>
                </div>
              </div>
            )}

            {/* Use Settings Elsewhere Section - only show when editing custom options (not defaults, not using defaults) */}
            {!isEditingDefault && !useDefaultOptions && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between py-2">
                  <button
                    type="button"
                    onClick={() => setBulkActionsExpanded(!bulkActionsExpanded)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
                  >
                    Use these option settings elsewhere
                    <span className="text-gray-400">{bulkActionsExpanded ? '\u25BC' : '\u25B6'}</span>
                  </button>
                  <HelpTooltip title="Use Settings Elsewhere">
                    <p>These options let you use the above settings as defaults for all new case assignments, or copy these chat options to other existing cases or sections.</p>
                  </HelpTooltip>
                </div>

                {bulkActionsExpanded && (
                  <div className="pt-4">
                    {/* Bulk Copy Result Message */}
                    {bulkCopyResult && (
                      <div className={`mb-4 p-3 rounded-lg text-sm ${
                        bulkCopyResult.type === 'success'
                          ? 'bg-green-100 border border-green-200 text-green-700'
                          : 'bg-red-100 border border-red-200 text-red-700'
                      }`}>
                        {bulkCopyResult.message}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {/* Defaults Column */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600 mb-2">Save as default settings for new case assignments:</p>
                        <button
                          onClick={() => handleSaveAsDefaults(true)}
                          className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 text-left"
                        >
                          Make default for this section
                        </button>
                        <button
                          onClick={() => handleSaveAsDefaults(false)}
                          className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 text-left"
                        >
                          Make default for all sections
                        </button>
                      </div>

                      {/* Copy Column */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600 mb-2">Copy these settings to existing case assignments:</p>
                        <button
                          onClick={() => handleBulkCopyChatOptions('section')}
                          disabled={isBulkCopying}
                          className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 text-left disabled:opacity-50"
                        >
                          {isBulkCopying ? 'Copying...' : 'Copy to all case assignments in this section'}
                        </button>
                        <button
                          onClick={() => handleBulkCopyChatOptions('all')}
                          disabled={isBulkCopying}
                          className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 text-left disabled:opacity-50"
                        >
                          {isBulkCopying ? 'Copying...' : 'Copy to all case assignments in all sections'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">
            {!chatOptionsSection
              ? 'Select "Default for all sections" to manage global defaults, or select a section and case to configure specific chat options.'
              : chatOptionsSection === '__global_default__'
                ? 'Global defaults will appear above once loaded.'
                : 'Select a case to configure its chat options, or select "Default for this section" to manage section-specific defaults.'}
          </p>
        </div>
      )}
    </div>
  );

  const renderPersonasTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Chatbot Personas</h2>
            <p className="text-sm text-gray-500">Manage AI personality configurations for case chats</p>
          </div>
          <HelpTooltip title="Chatbot Personas">
            <PersonasHelp />
          </HelpTooltip>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleOpenPersonaModal()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Persona
          </button>
          <button
            onClick={fetchPersonas}
            disabled={isLoadingPersonas}
            aria-label="Refresh personas list"
            title="Refresh personas list"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingPersonas ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
        Built-in personas are read-only. Use <strong>Clone</strong> to create your own version, then choose it under <strong>Assignments → Chat Options</strong>.
      </div>

      {personaListError && (
        <div className="mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 break-words">{personaListError}</span>
          <button type="button" onClick={() => setPersonaListError(null)} className="text-red-600 hover:text-red-800 p-1">×</button>
        </div>
      )}

      {isLoadingPersonas ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading personas...</p>
        </div>
      ) : personasList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No personas found. Run the database migration to add default personas, or create a new one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortPersonasList(personasList).map((persona) => {
                const editable = canEditPersona(persona, personaAccessContext);
                const deletable = canDeletePersona(persona, personaAccessContext);
                const canToggle = canTogglePersonaEnabled(persona, personaAccessContext);
                return (
                <tr key={persona.persona_id} className={!persona.enabled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{persona.persona_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 font-medium">{persona.persona_name}</td>
                  <td className="px-4 py-3">
                    {isSystemPersona(persona) ? (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Built-in</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">Custom</span>
                    )}
                    {!isSystemPersona(persona) && persona.visibility && persona.visibility !== 'private' && (
                      <span className="ml-1 px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">{visibilityLabel(persona.visibility)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{ownerLabel(persona, personaAccessContext)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={persona.description || undefined}>
                    {persona.description || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {canToggle ? (
                      <button
                        onClick={() => handleTogglePersonaEnabled(persona)}
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          persona.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {persona.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    ) : (
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        persona.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {persona.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      {editable ? (
                        <button
                          onClick={() => handleOpenPersonaModal(persona, false)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenPersonaModal(persona, true)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        >
                          View
                        </button>
                      )}
                      <button
                        onClick={() => handleClonePersona(persona)}
                        disabled={isCloningPersona}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50"
                      >
                        Clone
                      </button>
                      {deletable && (
                        <button
                          onClick={() => handleDeletePersona(persona.persona_id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-red-600 border-red-200 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // Handle sorting for Latest Chats table
  const handleChatsSort = (key: string) => {
    if (chatsSortKey === key) {
      setChatsSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setChatsSortKey(key);
      setChatsSortDirection('asc');
    }
  };

  // Sort case chats list
  const sortedCaseChatsList = useMemo(() => {
    return [...caseChatsList].sort((a, b) => {
      let valA = a[chatsSortKey];
      let valB = b[chatsSortKey];

      // Handle null/undefined values
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      // Convert to lowercase for string comparison
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return chatsSortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return chatsSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [caseChatsList, chatsSortKey, chatsSortDirection]);

// Fetch case chats for Latest Chats tab
  const fetchCaseChats = useCallback(async () => {
    setIsLoadingCaseChats(true);
    try {
      // First, mark old chats as abandoned (chats inactive for > 24 hours)
      // This replaces the need for a cron job
      try {
        await fetch(`${getApiBaseUrl()}/case-chats/mark-abandoned`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ timeout_minutes: 1440 }) // 24 hours = 1440 minutes
        });
      } catch (abandonErr) {
        console.warn('Could not mark abandoned chats:', abandonErr);
        // Continue anyway - this is a cleanup step, not critical
      }

      const params = new URLSearchParams();
      if (caseChatsFilter.status !== 'all') params.append('status', caseChatsFilter.status);
      if (caseChatsFilter.section_id !== 'all') params.append('section_id', caseChatsFilter.section_id);
      params.append('limit', chatsLimit.toString());

      const response = await fetch(`${getApiBaseUrl()}/case-chats?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`
        }
      });
      const result = await response.json();
      if (result.data) {
        let chats = result.data;
        // Update stats for nav badges (calculate from unfiltered data)
        const activeCount = chats.filter((c: any) => ['started', 'in_progress'].includes(c.status)).length;
        const abandonedCount = chats.filter((c: any) => c.status === 'abandoned').length;
        setStats({ activeChats: activeCount, abandonedChats: abandonedCount });

        // Client-side search filter
        if (caseChatsFilter.search) {
          const searchLower = caseChatsFilter.search.toLowerCase();
          chats = chats.filter((c: any) =>
            c.student_name?.toLowerCase().includes(searchLower) ||
            c.case_title?.toLowerCase().includes(searchLower)
          );
        }
        setCaseChatsList(chats);
      }
    } catch (err) {
      console.error('Error fetching case chats:', err);
      setCaseChatsList([]);
    } finally {
      setIsLoadingCaseChats(false);
    }
  }, [caseChatsFilter, chatsLimit]);

  // Fetch case chats when filters change or monitor tab is active
  useEffect(() => {
    if (primaryTab === 'monitor') {
      fetchCaseChats();
    }
  }, [primaryTab, caseChatsFilter.status, caseChatsFilter.section_id, fetchCaseChats]);

  // Fetch initial stats on mount
  useEffect(() => {
    fetchCaseChats();
  }, []);

  // Fetch cases for live session when section changes
  const fetchLiveSessionCases = useCallback(async (sectionId: string) => {
    if (!sectionId) {
      setLiveSessionCases([]);
      return;
    }

    setIsLoadingLiveSessionCases(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/sections/${sectionId}/cases`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`
          }
        }
      );
      const result = await response.json();
      if (result.data) {
        setLiveSessionCases(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching live session cases:', err);
      setLiveSessionCases([]);
    } finally {
      setIsLoadingLiveSessionCases(false);
    }
  }, []);

  // Fetch live session data
  const fetchLiveSession = useCallback(async () => {
    if (!liveSessionSection || !liveSessionCase) return;

    setIsLoadingLiveSession(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/sections/${liveSessionSection}/cases/${liveSessionCase}/live-session`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`
          }
        }
      );
      const result = await response.json();
      if (result.data) {
        setLiveSessionData(result.data.students || []);
        setLiveSessionSummary(result.data.summary || { total: 0, completed: 0, in_progress: 0, not_started: 0 });
        setLastLiveRefresh(new Date());
      }
    } catch (err) {
      console.error('Error fetching live session:', err);
    } finally {
      setIsLoadingLiveSession(false);
    }
  }, [liveSessionSection, liveSessionCase]);

  // Auto-refresh live session data every 30 seconds
  useEffect(() => {
    if (primaryTab === 'monitor' && monitorSubTab === 'live' && liveAutoRefresh && liveSessionSection && liveSessionCase) {
      fetchLiveSession();
      const interval = setInterval(fetchLiveSession, 30000);
      return () => clearInterval(interval);
    }
  }, [primaryTab, monitorSubTab, liveAutoRefresh, liveSessionSection, liveSessionCase, fetchLiveSession]);

  // Fetch when section or case changes
  useEffect(() => {
    if (liveSessionSection && liveSessionCase) {
      fetchLiveSession();
    }
  }, [liveSessionSection, liveSessionCase, fetchLiveSession]);

  // Auto-refresh chat sessions every 30 seconds when enabled
  useEffect(() => {
    if (primaryTab === 'monitor' && monitorSubTab === 'chats' && chatsAutoRefresh) {
      const interval = setInterval(fetchCaseChats, 30000);
      return () => clearInterval(interval);
    }
  }, [primaryTab, monitorSubTab, chatsAutoRefresh, fetchCaseChats]);

  // Kill a chat session
  const handleKillChat = async (chatId: string) => {
    if (!confirm('Are you sure you want to kill this chat session? The student will not be able to continue.')) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/case-chats/${chatId}/kill`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        fetchCaseChats();
      } else {
        const result = await response.json();
        alert(result.error?.message || 'Failed to kill chat');
      }
    } catch (err) {
      console.error('Error killing chat:', err);
      alert('Failed to kill chat');
    }
  };

  // Delete a chat session (allows student to try again)
  const handleDeleteChat = async (chatId: string) => {
    if (!confirm('Are you sure you want to delete this chat session? This will allow the student to start a new chat for this case. This action cannot be undone.')) return;

    try {
      const response = await fetch(`${getApiBaseUrl()}/case-chats/${chatId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_auth_token')}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        fetchCaseChats();
      } else {
        const result = await response.json();
        alert(result.error?.message || 'Failed to delete chat');
      }
    } catch (err) {
      console.error('Error deleting chat:', err);
      alert('Failed to delete chat');
    }
  };

  // Format duration between two timestamps
  const formatDuration = (startTime: string, endTime: string | null) => {
    if (!startTime) return '0m';

    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = end.getTime() - start.getTime();

    // Handle invalid or negative durations
    if (diffMs < 0) return '0m';

    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);

    // Show seconds for durations under 1 minute
    if (diffMins < 1) return `${diffSecs}s`;

    // Show minutes for durations under 1 hour
    if (diffMins < 60) return `${diffMins}m`;

    // Show hours and minutes for longer durations
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
  };

  const ChatsSortableHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th
      onClick={() => handleChatsSort(sortKey)}
      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {chatsSortKey === sortKey && (
          <svg className={`w-4 h-4 transition-transform ${chatsSortDirection === 'asc' ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M5.22 9.22a.75.75 0 011.06 0L10 12.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 10.28a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </th>
  );

  const renderLiveSession = () => (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Live Session Monitor</h2>
          <p className="text-sm text-gray-500">Real-time view of student progress during an active case session</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={liveAutoRefresh}
              onChange={(e) => setLiveAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchLiveSession}
            disabled={isLoadingLiveSession || !liveSessionSection || !liveSessionCase}
            aria-label="Refresh results"
            title="Refresh results"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingLiveSession ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Section and Case Selectors */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={liveSessionSection}
          onChange={(e) => {
            const newSection = e.target.value;
            setLiveSessionSection(newSection);
            setLiveSessionCase(''); // Reset case when section changes
            setLiveSessionCases([]); // Clear cases
            setLiveSessionData([]);
            setLiveSessionSummary({ total: 0, completed: 0, in_progress: 0, not_started: 0 });
            if (newSection) {
              fetchLiveSessionCases(newSection);
            }
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-green-500 focus:border-green-500"
        >
          <option value="">Select Section...</option>
          {sectionStats.filter(s => s.section_id !== 'unassigned').map(s => (
            <option key={s.section_id} value={s.section_id}>{s.section_title}</option>
          ))}
        </select>
        <select
          value={liveSessionCase}
          onChange={(e) => setLiveSessionCase(e.target.value)}
          disabled={!liveSessionSection || isLoadingLiveSessionCases}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-green-500 focus:border-green-500 disabled:opacity-50"
        >
          <option value="">{isLoadingLiveSessionCases ? 'Loading cases...' : 'Select Case...'}</option>
          {liveSessionCases.map((sc: any) => (
            <option key={sc.case_id} value={sc.case_id}>{sc.case_title}</option>
          ))}
        </select>
        {lastLiveRefresh && (
          <span className="text-xs text-gray-500 self-center">
            Last updated: {lastLiveRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Summary Stats Bar */}
      {liveSessionSection && liveSessionCase && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gray-800">{liveSessionSummary.total}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Students</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{liveSessionSummary.completed}</div>
            <div className="text-xs text-green-600 uppercase tracking-wide">Completed</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{liveSessionSummary.in_progress}</div>
            <div className="text-xs text-blue-600 uppercase tracking-wide">In Progress</div>
          </div>
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gray-500">{liveSessionSummary.not_started}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Not Started</div>
          </div>
        </div>
      )}

      {/* Student List */}
      {!liveSessionSection || !liveSessionCase ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Select a section and case to view live session data.</p>
        </div>
      ) : isLoadingLiveSession && liveSessionData.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-green-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading session data...</p>
        </div>
      ) : liveSessionData.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No students enrolled in this section.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Student</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Chat Topic</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Position</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {liveSessionData.map((student: any) => (
                <tr
                  key={student.student_id}
                  className={`${
                    student.status === 'completed' ? 'bg-green-50' :
                    student.status === 'in_progress' ? 'bg-blue-50' :
                    student.status === 'abandoned' ? 'bg-orange-50' :
                    'bg-white'
                  } hover:bg-gray-100`}
                >
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{student.student_name}</div>
                    <div className="text-xs text-gray-500">{student.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      student.status === 'completed' ? 'bg-green-100 text-green-700' :
                      student.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      student.status === 'abandoned' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {student.status === 'not_started' ? 'Not Started' :
                       student.status === 'in_progress' ? 'In Progress' :
                       student.status === 'abandoned' ? 'Abandoned' :
                       'Completed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {student.chat_topic ? (
                      <span>{student.chat_topic}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {student.position ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-gray-700">{student.position}</span>
                        {student.position_changed && student.final_position && (
                          <span className="text-xs text-amber-600">Changed to: {student.final_position}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {student.duration_minutes !== null ? (
                      <span>{student.duration_minutes} min</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {student.evaluation_score !== null ? (
                      <span className="font-medium text-gray-700">
                        {student.evaluation_score}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderChatsTab = () => (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Latest Chat Sessions</h2>
          <p className="text-sm text-gray-500">Monitor and manage the latest (most recent) chat sessions</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chatsAutoRefresh}
              onChange={(e) => setChatsAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchCaseChats}
            disabled={isLoadingCaseChats}
            aria-label="Refresh results"
            title="Refresh results"
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingCaseChats ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={caseChatsFilter.status}
          onChange={(e) => setCaseChatsFilter(prev => ({ ...prev, status: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">All Statuses</option>
          <option value="started">Started</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="abandoned">Abandoned</option>
          <option value="canceled">Canceled</option>
          <option value="killed">Killed</option>
        </select>
        <select
          value={caseChatsFilter.section_id}
          onChange={(e) => setCaseChatsFilter(prev => ({ ...prev, section_id: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">All Sections</option>
          {sectionStats.filter(s => s.section_id !== 'unassigned').map(s => (
            <option key={s.section_id} value={s.section_id}>{s.section_title}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search by student or case..."
          value={caseChatsFilter.search}
          onChange={(e) => setCaseChatsFilter(prev => ({ ...prev, search: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500 w-64"
        />
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Show:</label>
          <select
            value={chatsLimit}
            onChange={(e) => setChatsLimit(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
          <span className="text-sm text-gray-500">most recent</span>
        </div>
      </div>

      {/* Chats Table */}
      {isLoadingCaseChats ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-2 text-gray-500">Loading chat sessions...</p>
        </div>
      ) : caseChatsList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No chat sessions found matching your filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <ChatsSortableHeader label="Student" sortKey="student_name" />
                <ChatsSortableHeader label="Case" sortKey="case_title" />
                <ChatsSortableHeader label="Section" sortKey="section_title" />
                <ChatsSortableHeader label="Status" sortKey="status" />
                <ChatsSortableHeader label="Position" sortKey="initial_position" />
                <ChatsSortableHeader label="Started" sortKey="start_time" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedCaseChatsList.map((chat) => (
                <tr key={chat.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{chat.student_name || 'Unknown'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{chat.case_title || chat.case_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{chat.section_title || chat.section_id || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      chat.status === 'completed' ? 'bg-green-100 text-green-700' :
                      chat.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      chat.status === 'started' ? 'bg-yellow-100 text-yellow-700' :
                      chat.status === 'abandoned' ? 'bg-orange-100 text-orange-700' :
                      chat.status === 'canceled' ? 'bg-gray-100 text-gray-600' :
                      chat.status === 'killed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {chat.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {chat.initial_position ? (
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                          chat.initial_position === 'for' ? 'bg-green-100 text-green-700' :
                          chat.initial_position === 'against' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {chat.initial_position}
                        </span>
                        {chat.final_position && chat.final_position !== chat.initial_position && (
                          <span className="text-xs text-amber-600">
                            → {chat.final_position}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(chat.start_time).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDuration(chat.start_time, chat.end_time)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {chat.transcript && (
                        <button
                          onClick={() => {
                            setSelectedCaseChat(chat);
                            setShowChatTranscriptModal(true);
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        >
                          Transcript
                        </button>
                      )}
                      {chat.evaluation_id && (
                        <button
                          onClick={async () => {
                            // Navigate to the evaluation - could implement a modal here
                            window.open(`#evaluation/${chat.evaluation_id}`, '_blank');
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-600 border-blue-200 hover:bg-blue-50"
                        >
                          Evaluation
                        </button>
                      )}
                      {['started', 'in_progress'].includes(chat.status) && (
                        <button
                          onClick={() => handleKillChat(chat.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-red-600 border-red-200 hover:bg-red-50"
                        >
                          Kill
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteChat(chat.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-red-700 border-red-300 hover:bg-red-100"
                        title="Delete this chat session to allow student to try again"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transcript Modal */}
      {showChatTranscriptModal && selectedCaseChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Chat Transcript</h3>
                <p className="text-sm text-gray-500">
                  {selectedCaseChat.student_name} - {selectedCaseChat.case_title}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowChatTranscriptModal(false);
                  setSelectedCaseChat(null);
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded-lg">
                {selectedCaseChat.transcript || 'No transcript available'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Incomplete students count for alerts
  const incompleteCount = useMemo(() => {
    return studentDetails.filter(s => s.status === 'in_progress').length;
  }, [studentDetails]);
  
  // Count of disabled sections for showing in toggle
  const disabledSectionsCount = useMemo(() => {
    return sectionStats.filter(s => !s.enabled && s.section_id !== 'unassigned' && s.section_id !== 'other_courses').length;
  }, [sectionStats]);

  const sortedModels = useMemo(() => {
    return [...modelsList].sort((a, b) => {
      return a.model_name.localeCompare(b.model_name);
    });
  }, [modelsList]);

  // Load instructors once for the admin "View as" picker.
  useEffect(() => {
    if (user?.role === 'admin' && allInstructors.length === 0) {
      fetchAllInstructors();
    }
  }, [user, allInstructors.length, fetchAllInstructors]);

  const impersonatedInstructor = useMemo(() => {
    if (!impersonateId) return null;
    return allInstructors.find((i: any) => i.id === impersonateId) || null;
  }, [impersonateId, allInstructors]);

  const applyImpersonation = (id: string | null) => {
    setImpersonationId(id);
    setImpersonateIdState(id);
    // Reload so every cached fetch (cases, sections, rubrics, etc.) re-runs
    // under the new X-Act-As-Instructor scope.
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Impersonation banner — sticky across the top whenever an admin is
          viewing as a specific instructor. */}
      {user?.role === 'admin' && impersonatedInstructor && (
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 bg-yellow-300 border-b border-yellow-500 text-yellow-900 text-sm font-medium">
          <span>
            Acting as <strong>{impersonatedInstructor.full_name || impersonatedInstructor.email}</strong>.
            All reads/writes are scoped to this instructor and audit-logged.
          </span>
          <button
            onClick={() => applyImpersonation(null)}
            className="ml-4 px-3 py-1 text-xs font-semibold rounded-md bg-yellow-900 text-yellow-50 hover:bg-yellow-800"
          >
            Exit impersonation
          </button>
        </div>
      )}

      <AiUsageWarningBanner onNavigate={() => { setPrimaryTab('monitor'); setMonitorSubTab('ai-usage'); }} />

      {/* Header */}
      <header className="flex-shrink-0 flex justify-between items-center px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Instructor Dashboard</h1>
          {user && (
            <span className="text-xs font-medium text-gray-600">
              {user.email}
              {user.superuser && <span className="ml-1 text-purple-600 font-semibold">(super)</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {semesters.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
              Semester:
              <select
                value={selectedSemesterId || ''}
                onChange={(e) => setSelectedSemesterId(e.target.value ? Number(e.target.value) : null)}
                className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 max-w-[14rem]"
                title="Filter the dashboard to a specific semester. Defaults to the current semester."
              >
                {semesters.map((sem) => (
                  <option key={sem.id} value={sem.id}>
                    {sem.semester_name}{sem.is_current ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {user?.role === 'admin' && (
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
              View as:
              <select
                value={impersonateId || ''}
                onChange={(e) => applyImpersonation(e.target.value || null)}
                className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 max-w-[14rem]"
                title="Scope the dashboard to a specific instructor. Useful for impersonating to debug their setup."
              >
                <option value="">(self — full admin vision)</option>
                {allInstructors.filter((i: any) => i.active && !i.is_system_account).map((i: any) => (
                  <option key={i.id} value={i.id}>
                    {i.full_name || i.email}
                  </option>
                ))}
              </select>
            </label>
          )}
          <a
            href="#/case-writer"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 p-2 rounded-md hover:bg-blue-50 transition-colors"
          >
            Case Writer
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.open('#', 'student');
            }}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 p-2 rounded-md hover:bg-gray-100 transition-colors"
          >
            to student screen
          </a>
          <button onClick={onLogout} className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-md hover:bg-gray-100">
            <span>Sign Out</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content - New Workflow-Centric Navigation */}
      <main className="flex-1 overflow-y-auto">
        {/* Primary Navigation */}
        <div className="px-6 pt-2 border-b border-gray-200 bg-white">
          <div className="flex gap-1">
            {/* Dashboard Home */}
            <button
              onClick={() => setPrimaryTab('home')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                primaryTab === 'home'
                  ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                Home
              </span>
            </button>

            {/* Assignments (new primary tab) */}
            {hasAccess(user, 'assignments') && (
              <button
                onClick={() => {
                  setPrimaryTab('assignments');
                  if (casesList.length === 0) fetchCases();
                  fetchAssignmentsSections();
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'assignments'
                    ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  Assignments
                </span>
              </button>
            )}

            {/* Monitor (chats, AI usage, cache, live session) */}
            {hasAccess(user, 'chats') && (
              <button
                onClick={() => setPrimaryTab('monitor')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'monitor'
                    ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                    <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                  </svg>
                  Monitor
                  {stats.activeChats > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                      {stats.activeChats}
                    </span>
                  )}
                </span>
              </button>
            )}

            {/* Results */}
            <button
              onClick={() => setPrimaryTab('results')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                primaryTab === 'results'
                  ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                </svg>
                Results
              </span>
            </button>

            {/* Courses */}
            {(hasAccess(user, 'sections') || hasAccess(user, 'students')) && (
              <button
                onClick={() => {
                  setPrimaryTab('courses');
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'courses'
                    ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838l-2.727 1.17 1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762z" />
                  </svg>
                  Courses
                </span>
              </button>
            )}

            {/* Content */}
            {(hasAccess(user, 'cases') || hasAccess(user, 'casefiles') || hasAccess(user, 'caseprep')) && (
              <button
                onClick={() => {
                  setPrimaryTab('content');
                  if (casesList.length === 0) fetchCases();
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'content'
                    ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                  </svg>
                  Content
                </span>
              </button>
            )}

            {/* Setup */}
            {hasSetupAccess() && (
              <button
                onClick={() => {
                  setPrimaryTab('setup');
                  if (personasList.length === 0 && hasAccess(user, 'personas')) fetchPersonas();
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'setup'
                    ? 'bg-gray-50 text-teal-600 border-b-2 border-teal-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
                  </svg>
                  Setup
                </span>
              </button>
            )}

            {/* Feedback */}
            <button
              onClick={() => setPrimaryTab('feedback')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                primaryTab === 'feedback'
                  ? 'bg-gray-50 text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" />
                </svg>
                Feedback
                {feedbackUnreadCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-600 text-white text-[10px] font-semibold">
                    {feedbackUnreadCount > 99 ? '99+' : feedbackUnreadCount}
                  </span>
                )}
              </span>
            </button>

            {/* Admin */}
            {hasAdminAccess() && (
              <button
                onClick={() => setPrimaryTab('admin')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'admin'
                    ? 'bg-gray-50 text-purple-600 border-b-2 border-purple-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Admin {user?.superuser ? '*' : ''}
                </span>
              </button>
            )}
          </div>

          {/* Sub-navigation for Home */}
          {primaryTab === 'home' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => setHomeSubTab('welcome')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  homeSubTab === 'welcome'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Welcome
              </button>
              <button
                onClick={() => setHomeSubTab('dashboard')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  homeSubTab === 'dashboard'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Dashboard
              </button>
            </div>
          )}

          {/* Sub-navigation for Assignments */}
          {primaryTab === 'assignments' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => {
                  setAssignmentsSubTab('assignments');
                  fetchAssignmentsSections();
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  assignmentsSubTab === 'assignments'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Assignments
              </button>
              <button
                onClick={() => {
                  setAssignmentsSubTab('chat-options');
                  fetchAssignmentsSections();
                  if (personasList.length === 0) fetchPersonas();
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  assignmentsSubTab === 'chat-options'
                    ? 'bg-purple-100 text-purple-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Chat Options
              </button>
            </div>
          )}

          {/* Sub-navigation for Courses */}
          {primaryTab === 'courses' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'sections') && (
                <button
                  onClick={() => {
                    setCoursesSubTab('sections');
                    fetchAllCourses();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'sections'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Sections
                </button>
              )}
              {hasAccess(user, 'students') && (
                <button
                  onClick={() => setCoursesSubTab('students')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'students'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Students
                </button>
              )}
              {hasAccess(user, 'sections') && (
                <button
                  onClick={() => {
                    setCoursesSubTab('course-setup');
                    fetchSemesters();
                    fetchOrphanedSections();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'course-setup'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Courses
                </button>
              )}
              {hasAccess(user, 'sections') && (
                <button
                  onClick={() => {
                    setCoursesSubTab('semesters');
                    fetchSemesters();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'semesters'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Semesters
                </button>
              )}
            </div>
          )}

          {/* Sub-navigation for Content */}
          {primaryTab === 'content' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'cases') && (
                <button
                  onClick={() => setContentSubTab('cases')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    contentSubTab === 'cases'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Cases
                </button>
              )}
              {hasAccess(user, 'casefiles') && (
                <button
                  onClick={() => setContentSubTab('casefiles')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    contentSubTab === 'casefiles'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Case Files
                </button>
              )}
              {hasAccess(user, 'caseprep') && (
                <button
                  onClick={() => setContentSubTab('caseprep')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    contentSubTab === 'caseprep'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  AI Case Prep
                </button>
              )}
            </div>
          )}

          {/* Sub-navigation for Monitor */}
          {primaryTab === 'monitor' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => setMonitorSubTab('live')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  monitorSubTab === 'live'
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Live Session
              </button>
              <button
                onClick={() => setMonitorSubTab('chats')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  monitorSubTab === 'chats'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Latest Chats
              </button>
              <button
                onClick={() => setMonitorSubTab('ai-usage')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  monitorSubTab === 'ai-usage'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                AI Usage
              </button>
              <button
                onClick={() => setMonitorSubTab('cache')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  monitorSubTab === 'cache'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Cache Analytics
              </button>
            </div>
          )}

          {/* Sub-navigation for Results */}
          {primaryTab === 'results' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => setResultsSubTab('section-results')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  resultsSubTab === 'section-results'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Section Results
              </button>
              <button
                onClick={() => setResultsSubTab('responses')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  resultsSubTab === 'responses'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Student Results
              </button>
              <button
                onClick={() => setResultsSubTab('positions')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  resultsSubTab === 'positions'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Position Analytics
              </button>
            </div>
          )}

          {/* Sub-navigation for Setup */}
          {primaryTab === 'setup' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'personas') && (
                <button
                  onClick={() => {
                    setSetupSubTab('personas');
                    if (personasList.length === 0) fetchPersonas();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    setupSubTab === 'personas'
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Personas
                </button>
              )}
              {hasAccess(user, 'apikeys') && (
                <button
                  onClick={() => setSetupSubTab('apikeys')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    setupSubTab === 'apikeys'
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  API Keys
                </button>
              )}
              {hasAccess(user, 'teams') && (
                <button
                  onClick={() => setSetupSubTab('teams')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    setupSubTab === 'teams'
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Teams
                </button>
              )}
              {hasAccess(user, 'rubrics') && (
                <button
                  onClick={() => {
                    setSetupSubTab('rubrics');
                    if (rubricsList.length === 0) fetchRubrics();
                    if (criteriaList.length === 0) fetchCriteria();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    setupSubTab === 'rubrics'
                      ? 'bg-teal-100 text-teal-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Rubrics
                </button>
              )}
            </div>
          )}

          {/* Sub-navigation for Feedback */}
          {primaryTab === 'feedback' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => setFeedbackSubTab('mine')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  feedbackSubTab === 'mine'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                My Feedback
              </button>
              {(hasAccess(user, 'feedback_admin') || feedbackEligibility?.viewerHasAnyAllowedSource) && (
                <button
                  onClick={() => setFeedbackSubTab('inbox')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    feedbackSubTab === 'inbox'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Inbox
                  {feedbackUnreadCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold">
                      {feedbackUnreadCount > 99 ? '99+' : feedbackUnreadCount}
                    </span>
                  )}
                </button>
              )}
              {hasAccess(user, 'feedback_admin') && (
                <button
                  onClick={() => setFeedbackSubTab('summary')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    feedbackSubTab === 'summary'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Summary
                </button>
              )}
            </div>
          )}

          {/* Sub-navigation for Admin */}
          {primaryTab === 'admin' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'instructors') && (
                <button
                  onClick={() => setAdminSubTab('instructors')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'instructors'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Instructors
                </button>
              )}
              {hasAccess(user, 'settings') && (
                <button
                  onClick={() => setAdminSubTab('settings')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'settings'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Settings
                </button>
              )}
              {hasAccess(user, 'models') && (
                <button
                  onClick={() => setAdminSubTab('models')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'models'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Models
                </button>
              )}
              {hasAccess(user, 'prompts') && (
                <button
                  onClick={() => setAdminSubTab('prompts')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'prompts'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Prompts
                </button>
              )}
              {hasAccess(user, 'instructors') && (
                <button
                  onClick={() => setAdminSubTab('admins')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'admins'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Admins
                </button>
              )}
              {hasAccess(user, 'settings') && (
                <button
                  onClick={() => setAdminSubTab('logging')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'logging'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Logging
                </button>
              )}
              {user?.superuser && (
                <button
                  onClick={() => setAdminSubTab('shadow')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'shadow'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Shadow-Owned
                </button>
              )}
            </div>
          )}

          {/* Sub-navigation for Rubrics (under Setup) */}
          {primaryTab === 'setup' && setupSubTab === 'rubrics' && (
            <div className="flex gap-1 mt-2 pb-2">
              <button
                onClick={() => {
                  setRubricsSubTab('rubrics');
                  if (rubricsList.length === 0) fetchRubrics();
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  rubricsSubTab === 'rubrics'
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Rubrics
              </button>
              <button
                onClick={() => {
                  setRubricsSubTab('criteria');
                  if (criteriaList.length === 0) fetchCriteria();
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  rubricsSubTab === 'criteria'
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Criteria Library
              </button>
            </div>
          )}
        </div>

        {/* Content Rendering based on Primary Tab */}
        {primaryTab === 'home' ? (
          homeSubTab === 'welcome' ? (
            <WelcomeScreen />
          ) : (
            <DashboardHome user={user} onNavigate={handleNavigate} />
          )
        ) : primaryTab === 'assignments' ? (
          assignmentsSubTab === 'chat-options' ? (
            renderChatOptionsTab()
          ) : (
            renderAssignmentsTab()
          )
        ) : primaryTab === 'results' ? (
          resultsSubTab === 'positions' ? (
            <div className="p-6 max-w-7xl mx-auto">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Position Analytics</h2>
              <PositionAnalytics />
            </div>
          ) : resultsSubTab === 'section-results' ? (
            <SectionResultsSummary initialSectionId={resultsInitialSectionId} onNavigate={handleNavigate} />
          ) : (
            <Analytics onNavigate={handleNavigate} initialSectionId={resultsInitialSectionId} initialCaseId={resultsInitialCaseId} />
          )
        ) : primaryTab === 'monitor' ? (
          monitorSubTab === 'live' ? (
            renderLiveSession()
          ) : monitorSubTab === 'cache' ? (
            <CacheMetrics />
          ) : monitorSubTab === 'ai-usage' ? (
            <AiUsagePanel />
          ) : (
            renderChatsTab()
          )
        ) : primaryTab === 'content' ? (
          contentSubTab === 'caseprep' ? (
            <CasePrepManager />
          ) : contentSubTab === 'casefiles' ? (
            <CaseFilesManager />
          ) : (
            renderCasesTab()
          )
        ) : primaryTab === 'setup' && setupSubTab !== 'rubrics' ? (
          setupSubTab === 'personas' ? (
            renderPersonasTab()
          ) : setupSubTab === 'apikeys' ? (
            <ApiKeysManager />
          ) : setupSubTab === 'teams' ? (
            <TeamsManager />
          ) : null
        ) : primaryTab === 'feedback' ? (
          feedbackSubTab === 'mine' ? (
            <FeedbackMine />
          ) : feedbackSubTab === 'inbox' ? (
            <FeedbackInbox onChange={refreshFeedbackUnreadCount} />
          ) : feedbackSubTab === 'summary' ? (
            <FeedbackSummary />
          ) : null
        ) : primaryTab === 'admin' ? (
          adminSubTab === 'models' ? (
            renderModelsTab()
          ) : adminSubTab === 'prompts' ? (
            <PromptManager />
          ) : adminSubTab === 'settings' ? (
            <SettingsManager />
          ) : adminSubTab === 'instructors' && hasAccess(user, 'instructors') ? (
            <InstructorManager user={user} mode="instructors" />
          ) : adminSubTab === 'admins' && hasAccess(user, 'instructors') ? (
            <InstructorManager user={user} mode="admins" />
          ) : adminSubTab === 'logging' ? (
            <LoggingManager />
          ) : adminSubTab === 'shadow' ? (
            <ShadowOwnershipManager />
          ) : null
        ) : primaryTab === 'setup' && setupSubTab === 'rubrics' ? (
          <div className="p-6 max-w-7xl mx-auto">
            {rubricsSubTab === 'rubrics' ? (
              <div>
                <div className="mb-6 flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Evaluation Rubrics</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Manage rubrics used for evaluating student performance
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenRubricModal()}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      + New Rubric
                    </button>
                    <button
                      onClick={fetchRubrics}
                      disabled={isLoadingRubrics}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      {isLoadingRubrics ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                </div>

                {isLoadingRubrics ? (
                  <div className="text-center py-8 text-gray-500">Loading rubrics...</div>
                ) : rubricsList.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No rubrics found. Run the database migration to create the default rubric.</div>
                ) : (
                  <div className="space-y-4">
                    {rubricsList.map((rubric: any) => (
                      <div
                        key={rubric.rubric_id}
                        className={`bg-white rounded-lg border p-4 ${
                          rubric.enabled ? 'border-gray-200' : 'border-gray-300 bg-gray-50 opacity-60'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className={`text-lg font-medium ${rubric.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
                              {rubric.rubric_name}
                              {!!rubric.is_system_default && (
                                <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Default</span>
                              )}
                              {!rubric.enabled && (
                                <span className="ml-2 px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">Disabled</span>
                              )}
                              {!!rubric.prompt_stale && (
                                <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">Needs Regeneration</span>
                              )}
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">{rubric.description}</p>
                            <p className="text-sm text-gray-600 mt-2">
                              <strong>Total Points:</strong> {rubric.total_points} |{' '}
                              <strong>Criteria:</strong> {Array.isArray(rubric.criteria_ids) ? rubric.criteria_ids.join(', ') : 'None'}
                            </p>
                          </div>
                          <div className="flex gap-2 ml-4 flex-wrap justify-end">
                            {/* Enable/Disable Toggle */}
                            <button
                              onClick={() => handleToggleRubricEnabled(rubric.rubric_id, rubric.enabled)}
                              className={`px-3 py-1.5 text-sm rounded ${
                                rubric.enabled
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                              title={rubric.enabled ? 'Click to disable' : 'Click to enable'}
                            >
                              {rubric.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                            {/* Set as Default (only for enabled, non-default rubrics) */}
                            {!!rubric.enabled && !rubric.is_system_default ? (
                              <button
                                onClick={() => handleSetRubricDefault(rubric.rubric_id)}
                                className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                title="Set as system default rubric"
                              >
                                Set Default
                              </button>
                            ) : null}
                            {!!rubric.prompt_stale && (
                              <button
                                onClick={() => handleRegenerateRubric(rubric.rubric_id)}
                                className="px-3 py-1.5 text-sm bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                              >
                                Regenerate
                              </button>
                            )}
                            <button
                              onClick={() => handleShowRubricUsage(rubric)}
                              className="px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                              title="Show assignments using this rubric"
                            >
                              Uses
                            </button>
                            <button
                              onClick={() => handleOpenRubricModal(rubric)}
                              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            >
                              Edit
                            </button>
                            {!rubric.is_system_default && (
                              <button
                                onClick={() => handleDeleteRubric(rubric.rubric_id)}
                                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        {rubric.additional_prompt && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                            <p className="text-xs font-medium text-gray-600 mb-1">Additional Instructions:</p>
                            <p className="text-sm text-gray-700">{rubric.additional_prompt}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-6 flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Criteria Library</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Reusable evaluation criteria that can be included in multiple rubrics
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenCriterionModal()}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      + New Criterion
                    </button>
                    <button
                      onClick={fetchCriteria}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {criteriaList.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No criteria found. Run the database migration to create default criteria.</div>
                ) : (
                  <div className="space-y-4">
                    {criteriaList.map((criterion: any) => {
                      const guide = typeof criterion.scoring_guide === 'string'
                        ? JSON.parse(criterion.scoring_guide || '{}')
                        : (criterion.scoring_guide || {});
                      return (
                        <div
                          key={criterion.id}
                          className={`bg-white rounded-lg border p-4 ${
                            criterion.enabled ? 'border-gray-200' : 'border-gray-300 bg-gray-50 opacity-60'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h3 className={`text-lg font-medium ${criterion.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                {criterion.name}
                                <span className="ml-2 text-sm font-mono text-gray-500">({criterion.criteria_id})</span>
                                {!criterion.enabled && (
                                  <span className="ml-2 px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">Disabled</span>
                                )}
                              </h3>
                              <p className="text-sm text-gray-600 mt-1">{criterion.question_text}</p>
                              <p className="text-sm text-gray-500 mt-2">
                                <strong>Max Points:</strong> {criterion.max_points}
                              </p>
                              {Object.keys(guide).length > 0 && (
                                <div className="mt-2 text-xs text-gray-500">
                                  <strong>Scoring Guide:</strong>
                                  <ul className="ml-4 mt-1">
                                    {Object.entries(guide).map(([score, desc]) => (
                                      <li key={score}>{score} pt: {desc as string}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              {/* Enable/Disable Toggle */}
                              <button
                                onClick={() => handleToggleCriterionEnabled(criterion.criteria_id, criterion.enabled)}
                                className={`px-3 py-1.5 text-sm rounded ${
                                  criterion.enabled
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                }`}
                                title={criterion.enabled ? 'Click to disable' : 'Click to enable'}
                              >
                                {criterion.enabled ? 'Enabled' : 'Disabled'}
                              </button>
                              <button
                                onClick={() => handleOpenCriterionModal(criterion)}
                                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteCriterion(criterion.criteria_id)}
                                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Criterion Modal */}
            {showCriterionModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">
                      {editingCriterion ? 'Edit Criterion' : 'New Criterion'}
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Criterion ID *</label>
                        <input
                          type="text"
                          value={criterionForm.criteria_id}
                          onChange={(e) => setCriterionForm({ ...criterionForm, criteria_id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                          disabled={!!editingCriterion}
                          placeholder="e.g., critical_thinking"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100"
                        />
                        <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, and underscores only</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
                        <input
                          type="text"
                          value={criterionForm.name}
                          onChange={(e) => setCriterionForm({ ...criterionForm, name: e.target.value })}
                          placeholder="e.g., Critical Thinking"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Question Text *</label>
                        <textarea
                          value={criterionForm.question_text}
                          onChange={(e) => setCriterionForm({ ...criterionForm, question_text: e.target.value })}
                          placeholder="e.g., Did the student demonstrate critical thinking skills?"
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Max Points</label>
                        <input
                          type="number"
                          value={criterionForm.max_points}
                          onChange={(e) => setCriterionForm({ ...criterionForm, max_points: parseInt(e.target.value) || 5 })}
                          min={1}
                          max={100}
                          className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Scoring Guide</label>
                        <p className="text-xs text-gray-500 mb-2">Define what each score means (1 to max points)</p>
                        <div className="space-y-2">
                          {Array.from({ length: criterionForm.max_points }, (_, i) => i + 1).map((score) => (
                            <div key={score} className="flex gap-2 items-center">
                              <span className="w-8 text-sm font-medium text-gray-600">{score}:</span>
                              <input
                                type="text"
                                value={criterionForm.scoring_guide[String(score)] || ''}
                                onChange={(e) => setCriterionForm({
                                  ...criterionForm,
                                  scoring_guide: { ...criterionForm.scoring_guide, [String(score)]: e.target.value }
                                })}
                                placeholder={`Description for ${score} point${score > 1 ? 's' : ''}`}
                                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowCriterionModal(false)}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveCriterion}
                        disabled={isSavingCriterion}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {isSavingCriterion ? 'Saving...' : 'Save Criterion'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Rubric Modal */}
            {showRubricModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">
                      {editingRubric ? 'Edit Rubric' : 'New Rubric'}
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Rubric Name *</label>
                        <input
                          type="text"
                          value={rubricForm.rubric_name}
                          onChange={(e) => setRubricForm({ ...rubricForm, rubric_name: e.target.value })}
                          placeholder="e.g., Advanced Case Analysis Rubric"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                          value={rubricForm.description}
                          onChange={(e) => setRubricForm({ ...rubricForm, description: e.target.value })}
                          placeholder="Describe when to use this rubric..."
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Select Criteria * <span className="font-normal text-gray-500">(click to add/remove, drag to reorder)</span>
                        </label>
                        <div className="border border-gray-300 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                          {criteriaList.length === 0 ? (
                            <p className="text-sm text-gray-500">Loading criteria...</p>
                          ) : (
                            <>
                              {/* Selected criteria (in order) */}
                              {rubricForm.criteria_ids.length > 0 && (
                                <div className="mb-3 pb-3 border-b border-gray-200">
                                  <p className="text-xs font-medium text-gray-500 mb-2">Selected (in order):</p>
                                  {rubricForm.criteria_ids.map((id, index) => {
                                    const criterion = criteriaList.find(c => c.criteria_id === id);
                                    if (!criterion) return null;
                                    return (
                                      <div
                                        key={id}
                                        draggable
                                        onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                          handleCriteriaOrderChange(dragIndex, index);
                                        }}
                                        className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded mb-1 cursor-move"
                                      >
                                        <span className="text-gray-400">☰</span>
                                        <span className="flex-1 text-sm">
                                          <strong>{criterion.name}</strong>
                                          <span className="text-gray-500 ml-2">({criterion.max_points} pts)</span>
                                        </span>
                                        <button
                                          onClick={() => toggleCriterionInRubric(id)}
                                          className="text-red-500 hover:text-red-700 text-sm"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Available criteria */}
                              <p className="text-xs font-medium text-gray-500 mb-2">Available criteria:</p>
                              {criteriaList.filter(c => !rubricForm.criteria_ids.includes(c.criteria_id)).map((criterion) => (
                                <div
                                  key={criterion.criteria_id}
                                  onClick={() => toggleCriterionInRubric(criterion.criteria_id)}
                                  className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded cursor-pointer hover:bg-gray-100"
                                >
                                  <span className="flex-1 text-sm">
                                    <strong>{criterion.name}</strong>
                                    <span className="text-gray-500 ml-2">({criterion.max_points} pts)</span>
                                  </span>
                                  <span className="text-green-600 text-sm">+ Add</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Total: {rubricForm.criteria_ids.reduce((sum, id) => {
                            const c = criteriaList.find(c => c.criteria_id === id);
                            return sum + (c?.max_points || 0);
                          }, 0)} points
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Instructions (Optional)</label>
                        <textarea
                          value={rubricForm.additional_prompt}
                          onChange={(e) => setRubricForm({ ...rubricForm, additional_prompt: e.target.value })}
                          placeholder="e.g., Be strict on grammar and spelling. Focus on financial analysis depth."
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">These instructions will be included in the LLM evaluation prompt</p>
                      </div>
                      <VisibilityPicker
                        value={rubricForm.visibility}
                        onChange={v => setRubricForm({ ...rubricForm, visibility: v })}
                        teamShares={rubricForm.team_shares}
                        onTeamSharesChange={shares => setRubricForm({ ...rubricForm, team_shares: shares })}
                        canPublish={Boolean(user?.superuser) || Boolean((user as any)?.can_publish)}
                      />
                    </div>
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        onClick={() => setShowRubricModal(false)}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveRubric}
                        disabled={isSavingRubric}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {isSavingRubric ? 'Saving...' : 'Save Rubric'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Rubric Usage Modal */}
            {showRubricUsageModal && rubricUsageData && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">Rubric Usage</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Assignments using "{rubricUsageData.rubric.rubric_name}"
                        </p>
                      </div>
                      <button
                        onClick={() => setShowRubricUsageModal(false)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {isLoadingRubricUsage ? (
                      <div className="text-center py-8">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-purple-500 border-t-transparent"></div>
                        <p className="mt-2 text-gray-500">Loading assignments...</p>
                      </div>
                    ) : rubricUsageData.assignments.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p>This rubric is not currently assigned to any section-cases.</p>
                        <p className="text-sm mt-2">
                          {!!rubricUsageData.rubric.is_system_default
                            ? "As the system default, it will be used for assignments without a specific rubric."
                            : "Assign it to a section-case in the Assignments tab."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600 mb-3">
                          Found {rubricUsageData.assignments.length} assignment{rubricUsageData.assignments.length !== 1 ? 's' : ''}:
                        </p>
                        {rubricUsageData.assignments.map((assignment: any, index: number) => (
                          <div
                            key={`${assignment.section_id}-${assignment.case_id}`}
                            className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-gray-900">{assignment.section_title}</p>
                                <p className="text-sm text-gray-600">{assignment.case_title}</p>
                              </div>
                              <div className="text-right">
                                <span className={`px-2 py-0.5 text-xs rounded ${
                                  assignment.active
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-gray-200 text-gray-600'
                                }`}>
                                  {assignment.active ? 'Active' : 'Inactive'}
                                </span>
                                <p className="text-xs text-gray-500 mt-1">{assignment.year_term}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end mt-6 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => setShowRubricUsageModal(false)}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : primaryTab === 'courses' ? (
          coursesSubTab === 'semesters' ? (
            renderSemestersTab()
          ) : coursesSubTab === 'course-setup' ? (
            renderCourseSetupTab()
          ) : coursesSubTab === 'students' ? (
            <StudentManager initialSectionFilter={studentsInitialSectionId} />
          ) : (
          /* ==================== SECTION LIST ==================== */
          <div className="p-6 max-w-7xl mx-auto">
            {/* Section List Header */}
            <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Course Sections</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {filteredSections.length} section{filteredSections.length !== 1 ? 's' : ''}
                  {!showAllSections && disabledSectionsCount > 0 && (
                    <span className="text-gray-400"> ({disabledSectionsCount} disabled hidden)</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {/* Show All / Enabled Toggle */}
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

                {/* View Mode Toggle: Grouped / List / Tiles */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setSectionViewMode('grouped')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      sectionViewMode === 'grouped'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Grouped by semester and course"
                  >
                    Grouped
                  </button>
                  <button
                    onClick={() => setSectionViewMode('list')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      sectionViewMode === 'list'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Flat list view"
                  >
                    List
                  </button>
                  <button
                    onClick={() => setSectionViewMode('tiles')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      sectionViewMode === 'tiles'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Tile view"
                  >
                    Tiles
                  </button>
                </div>

                {/* Create New Section */}
                <button
                  onClick={handleCreateSection}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  New Section
                </button>

                {/* Download SQL */}
                <button
                  onClick={handleDownloadToMySQL}
                  disabled={isExporting}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isExporting 
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  title="Generate a .sql file to upsert data into MySQL"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  {isExporting ? 'Exporting...' : 'Download SQL'}
                </button>

                {/* Refresh */}
                <button
                  onClick={() => fetchSectionStats()}
                  disabled={isLoadingSections}
                  className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
                  aria-label="Refresh sections"
                  title="Refresh sections"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoadingSections ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            {renderDismissibleErrorBanner('mb-6 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg')}

            {successMessage && (
              <div className="mb-6 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {successMessage}
              </div>
            )}

            {/* Section Display: Tiles or List */}
            {isLoadingSections && !sectionStats.length ? (
              <div className="text-center p-12 text-gray-500">Loading sections...</div>
            ) : filteredSections.length === 0 ? (
              <div className="text-center p-12 text-gray-500">
                <p className="text-lg font-medium">No sections found</p>
                <p className="text-sm mt-1">Create a new section to get started.</p>
              </div>
            ) : sectionViewMode === 'grouped' ? (
              /* ========== GROUPED VIEW ========== */
              <div className="space-y-6">
                {groupedSections.map((semesterGroup) => {
                  const semKey = String(semesterGroup.semesterId);
                  const isSemCollapsed = collapsedSemesters.has(semKey);

                  return (
                    <div key={semKey} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                      {/* Semester Header */}
                      <button
                        onClick={() => toggleSemesterCollapse(semesterGroup.semesterId)}
                        className={`w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r ${
                          semesterGroup.semesterIsCurrent
                            ? 'from-indigo-50 to-purple-50 border-b border-indigo-200'
                            : semesterGroup.semesterId === null
                            ? 'from-yellow-50 to-orange-50 border-b border-yellow-200'
                            : 'from-gray-50 to-gray-100 border-b border-gray-200'
                        } hover:bg-gray-100 transition-colors`}
                      >
                        <div className="flex items-center gap-3">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className={`w-5 h-5 text-gray-500 transition-transform ${isSemCollapsed ? '' : 'rotate-90'}`}
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="font-semibold text-gray-900">{semesterGroup.semesterName}</span>
                          {semesterGroup.semesterIsCurrent && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                              Current
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-gray-500">
                          {semesterGroup.courses.reduce((sum, c) => sum + c.sections.length, 0)} sections
                        </span>
                      </button>

                      {/* Semester Content */}
                      {!isSemCollapsed && (
                        <div className="p-4 space-y-4">
                          {semesterGroup.courses.map((courseGroup) => {
                            const courseKey = `${semesterGroup.semesterId}-${courseGroup.courseId}`;
                            const isCourseCollapsed = collapsedCourses.has(courseKey);

                            return (
                              <div key={courseKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* Course Header */}
                                <button
                                  onClick={() => toggleCourseCollapse(semesterGroup.semesterId, courseGroup.courseId)}
                                  className={`w-full px-3 py-2 flex items-center justify-between ${
                                    courseGroup.courseId === null
                                      ? 'bg-yellow-50 hover:bg-yellow-100'
                                      : 'bg-gray-50 hover:bg-gray-100'
                                  } transition-colors`}
                                >
                                  <div className="flex items-center gap-2">
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className={`w-4 h-4 text-gray-400 transition-transform ${isCourseCollapsed ? '' : 'rotate-90'}`}
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                    >
                                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                    <span className="font-medium text-gray-800">{courseGroup.courseName}</span>
                                  </div>
                                  <span className="text-xs text-gray-500">{courseGroup.sections.length} section(s)</span>
                                </button>

                                {/* Course Sections */}
                                {!isCourseCollapsed && (
                                  <div className="bg-white overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      {renderSectionTableHeader({ hideTermColumn: true })}
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {courseGroup.sections.map((section) =>
                                          renderSectionRow(section, { hideTermColumn: true })
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : sectionViewMode === 'tiles' ? (
              /* ========== TILES VIEW ========== */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSections.map(section => (
                  <div
                    key={section.section_id}
                    className={`bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow ${
                      !section.enabled ? 'opacity-75' : ''
                    }`}
                  >
                    {/* Card Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`font-semibold text-lg truncate ${
                            !section.enabled ? 'text-gray-500' : 'text-gray-900'
                          }`}>
                            {section.section_title}
                          </h3>
                        </div>
                        <span className="inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                          {section.year_term}
                        </span>
                        {section.primary_instructor_name && (
                          <span className="inline-block ml-1 px-2 py-0.5 text-xs font-medium bg-purple-50 text-purple-700 rounded-full" title="Primary Instructor">
                            {section.primary_instructor_name}
                          </span>
                        )}
                      </div>

                      {/* Action Buttons */}
                      {section.section_id !== 'unassigned' && (
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={(e) => handleEditSection(section, e)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit section"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => handleDuplicateSection(section, e)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Duplicate section"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                              <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm mb-3">
                      <div className="flex items-center gap-1.5" title="completed/started">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                        </svg>
                        <span className="text-gray-600">
                          <span className="font-semibold text-gray-900">{section.completions}</span>/{section.starts}
                        </span>
                      </div>
                      {section.section_id !== 'unassigned' && section.section_id !== 'other_courses' && (
                        <button
                          onClick={(e) => handleToggleStatus(section, e)}
                          className={`px-2 py-0.5 text-xs font-medium rounded-full transition-colors ${
                            section.enabled
                              ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-200'
                              : 'bg-pink-100 text-pink-800 hover:bg-pink-200 border border-pink-200'
                          }`}
                          title={`Click to ${section.enabled ? 'disable' : 'enable'}`}
                        >
                          {section.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      )}
                    </div>

                    {/* Model Info */}
                    {(section.chat_model || section.super_model) && (
                      <div className="text-xs text-gray-500 space-y-0.5 border-t border-gray-100 pt-3">
                        {section.chat_model && (
                          <div className="truncate">Chat: {formatModelDisplay(section.chat_model)}</div>
                        )}
                        {section.super_model && (
                          <div className="truncate">Super: {formatModelDisplay(section.super_model)}</div>
                        )}
                      </div>
                    )}

                    {/* View Results Link */}
                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => handleSectionClick(section)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        View Results
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ========== LIST VIEW ========== */
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  {renderSectionTableHeader()}
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSections.map(section => renderSectionRow(section))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
        ) : null}
      </main>

      {/* Transcript Modal */}
      {showTranscriptModal && selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Chat Transcript</h3>
                <p className="text-sm text-gray-500">{selectedStudent.full_name}</p>
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
      {showEvaluationModal && selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Evaluation Details</h3>
                <p className="text-sm text-gray-500">{selectedStudent.full_name} - Score: {selectedStudent.score}/15</p>
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
              {/* Summary */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Summary</h4>
                <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">{selectedStudent.summary || 'No summary available.'}</p>
              </div>
              
              {/* Criteria */}
              {selectedStudent.criteria && Array.isArray(selectedStudent.criteria) && selectedStudent.criteria.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Evaluation Criteria</h4>
                  <div className="space-y-2">
                    {selectedStudent.criteria.map((criterion: any, index: number) => (
                      <div key={index} className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-sm font-medium text-gray-700">{criterion.question || `Criterion ${index + 1}`}</span>
                          <span className={`text-sm font-bold ${criterion.score >= 4 ? 'text-green-600' : criterion.score >= 2 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {criterion.score}/5
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{criterion.feedback}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Student Feedback */}
              {(selectedStudent.liked || selectedStudent.improve) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Student Feedback</h4>
                  {selectedStudent.liked && (
                    <div className="mb-2">
                      <span className="text-xs font-medium text-gray-500">What they liked:</span>
                      <p className="text-sm text-gray-600 bg-green-50 p-2 rounded mt-1">{selectedStudent.liked}</p>
                    </div>
                  )}
                  {selectedStudent.improve && (
                    <div>
                      <span className="text-xs font-medium text-gray-500">Suggestions for improvement:</span>
                      <p className="text-sm text-gray-600 bg-yellow-50 p-2 rounded mt-1">{selectedStudent.improve}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Modal */}
      {showModelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">
                {editingModel
                  ? 'Edit Model'
                  : isOpenRouterImport
                    ? 'Add Model from OpenRouter'
                    : 'Create Model'}
              </h3>
              <button
                onClick={() => setShowModelModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Model ID</label>
                  {isOpenRouterImport && (
                    <a
                      href="https://openrouter.ai/models?output_modalities=text"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-purple-700 hover:text-purple-900 hover:underline"
                    >
                      Browse OpenRouter Models ↗
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modelForm.model_id}
                    onChange={(e) => setModelForm({ ...modelForm, model_id: e.target.value })}
                    disabled={!!editingModel}
                    placeholder={isOpenRouterImport ? 'e.g., openai/gpt-5, anthropic/claude-3.5-sonnet' : 'e.g., gemini-1.5-pro, gpt-4o, claude-3.5-sonnet'}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                  {isOpenRouterImport && !editingModel && (
                    <button
                      type="button"
                      onClick={handleFetchOpenRouterMetadata}
                      disabled={isFetchingOpenRouter || !modelForm.model_id.trim()}
                      className="px-3 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-60 whitespace-nowrap"
                    >
                      {isFetchingOpenRouter ? 'Fetching…' : 'Fetch from OpenRouter'}
                    </button>
                  )}
                </div>
                {isOpenRouterImport && (
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the full OpenRouter model ID (vendor/model), then click Fetch to prefill the form.
                  </p>
                )}
              </div>
              {openRouterContext && (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-gray-700">
                  {openRouterContext.context_length != null && (
                    <p><span className="font-semibold">Context window:</span> {openRouterContext.context_length.toLocaleString()} tokens</p>
                  )}
                  {openRouterContext.description && (
                    <p className="mt-1 text-xs text-gray-600 line-clamp-4 whitespace-pre-wrap">{openRouterContext.description}</p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={modelForm.model_name}
                  onChange={(e) => setModelForm({ ...modelForm, model_name: e.target.value })}
                  placeholder="e.g., Gemini 1.5 Pro"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                  <select
                    value={modelForm.vendor}
                    onChange={(e) => setModelForm({ ...modelForm, vendor: e.target.value })}
                    disabled={!!editingModel}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model Type</label>
                  <select
                    value={modelForm.type}
                    onChange={(e) => setModelForm({ ...modelForm, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="regular">regular</option>
                    <option value="reasoning">reasoning</option>
                    <option value="hybrid">hybrid</option>
                    <option value="vision">vision</option>
                    <option value="code">code</option>
                    <option value="other">other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Release Date</label>
                  <input
                    type="date"
                    value={modelForm.release_date}
                    onChange={(e) => setModelForm({ ...modelForm, release_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CPM Input ($/M tokens)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={modelForm.cpm_input}
                    onChange={(e) => setModelForm({ ...modelForm, cpm_input: e.target.value })}
                    placeholder="e.g., 2.50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CPM Input Cache</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={modelForm.cpm_input_cache}
                    onChange={(e) => setModelForm({ ...modelForm, cpm_input_cache: e.target.value })}
                    placeholder="cache read $/M"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CPM Output ($/M tokens)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={modelForm.cpm_output}
                    onChange={(e) => setModelForm({ ...modelForm, cpm_output: e.target.value })}
                    placeholder="e.g., 10.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supported Parameters
                  <span className="ml-2 text-xs text-gray-500 font-normal">(JSON array — populated automatically from OpenRouter)</span>
                </label>
                <textarea
                  value={modelForm.supported_parameters}
                  onChange={(e) => setModelForm({ ...modelForm, supported_parameters: e.target.value })}
                  rows={3}
                  placeholder='e.g., ["temperature","top_p","max_tokens"]'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Parameters
                  <span className="ml-2 text-xs text-gray-500 font-normal">(JSON object — vendor recommended defaults)</span>
                </label>
                <textarea
                  value={modelForm.default_parameters}
                  onChange={(e) => setModelForm({ ...modelForm, default_parameters: e.target.value })}
                  rows={3}
                  placeholder='e.g., {"temperature": 0.7}'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parameter Settings (Overrides)
                  <span className="ml-2 text-xs text-gray-500 font-normal">(JSON object — admin overrides applied at call time)</span>
                </label>
                <textarea
                  value={modelForm.parameter_settings}
                  onChange={(e) => setModelForm({ ...modelForm, parameter_settings: e.target.value })}
                  rows={3}
                  placeholder='e.g., {"temperature": 0.3, "top_p": 0.9}'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  These override defaults and are filtered to keys listed in supported_parameters at call time.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={modelForm.enabled}
                    onChange={(e) => setModelForm({ ...modelForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled (available for selection)
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={modelForm.default}
                    onChange={(e) => setModelForm({ ...modelForm, default: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Default model
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowModelModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveModel}
                disabled={isSavingModel}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {isSavingModel ? 'Saving...' : editingModel ? 'Save Changes' : isOpenRouterImport ? 'Save Model' : 'Create Model'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section Modal */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">
                {editingSection ? 'Edit Section' : 'Create Section'}
              </h3>
              <button
                onClick={() => setShowSectionModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section ID</label>
                <input
                  type="text"
                  value={sectionForm.section_id}
                  onChange={(e) => setSectionForm({ ...sectionForm, section_id: e.target.value })}
                  disabled={!!editingSection}
                  placeholder="e.g., GSCM-W25-001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Title</label>
                <input
                  type="text"
                  value={sectionForm.section_title}
                  onChange={(e) => setSectionForm({ ...sectionForm, section_title: e.target.value })}
                  placeholder="e.g., GSCM 330 Section 001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Semester <span className="text-red-500">*</span></label>
                <select
                  value={sectionForm.semester_id ?? ''}
                  onChange={(e) => {
                    const newSemId = e.target.value ? Number(e.target.value) : null;
                    // Clear course if it doesn't belong to the new semester.
                    const currentCourse = allCourses.find(c => c.id === sectionForm.course_id);
                    const keepCourse = currentCourse && currentCourse.semester_id === newSemId;
                    setSectionForm({
                      ...sectionForm,
                      semester_id: newSemId,
                      course_id: keepCourse ? sectionForm.course_id : null
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">— Select semester —</option>
                  {allSemesters.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_current ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                <select
                  value={sectionForm.course_id ?? ''}
                  disabled={sectionForm.semester_id == null}
                  onChange={(e) => setSectionForm({
                    ...sectionForm,
                    course_id: e.target.value ? Number(e.target.value) : null
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Unassigned</option>
                  {allCourses
                    .filter(c => c.semester_id === sectionForm.semester_id)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.course_name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat Model</label>
                <select
                  value={sectionForm.chat_model}
                  onChange={(e) => setSectionForm({ ...sectionForm, chat_model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Default</option>
                  {modelsList.filter(m => m.enabled).map(model => (
                    <option key={model.model_id} value={model.model_id}>{model.model_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor Model</label>
                <select
                  value={sectionForm.super_model}
                  onChange={(e) => setSectionForm({ ...sectionForm, super_model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Default</option>
                  {modelsList.filter(m => m.enabled).map(model => (
                    <option key={model.model_id} value={model.model_id}>{model.model_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sectionEnabled"
                  checked={sectionForm.enabled}
                  onChange={(e) => setSectionForm({ ...sectionForm, enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="sectionEnabled" className="text-sm font-medium text-gray-700">
                  Section Enabled (visible to students)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="acceptNewStudents"
                  checked={sectionForm.accept_new_students}
                  onChange={(e) => setSectionForm({ ...sectionForm, accept_new_students: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                />
                <label htmlFor="acceptNewStudents" className="text-sm font-medium text-gray-700">
                  Accept new student enrollments
                </label>
              </div>
              <div>
                <label htmlFor="sectionEnrollmentKey" className="block text-sm font-medium text-gray-700 mb-1">
                  Enrollment key (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    id="sectionEnrollmentKey"
                    value={sectionForm.enrollment_key}
                    onChange={(e) => setSectionForm({ ...sectionForm, enrollment_key: e.target.value })}
                    placeholder="e.g. doit"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {sectionForm.enrollment_key && (
                    <button
                      type="button"
                      onClick={() => setSectionForm({ ...sectionForm, enrollment_key: '' })}
                      className="px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  If set, new students must enter this code to self-enroll. Publish it in your syllabus. Leave blank to allow any BYU CAS user to join while "Accept" is on.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowSectionModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSection}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                {editingSection ? 'Save Changes' : 'Create Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section-Cases Modal */}
      {showSectionCasesModal && managingSectionCases && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Manage Cases</h3>
                <p className="text-sm text-gray-500">{managingSectionCases.section_title}</p>
              </div>
              <button
                onClick={() => { setShowSectionCasesModal(false); setManagingSectionCases(null); }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            
            <div className="p-4">
              {/* Add Case Dropdown */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Add a case to this section:</label>
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAssignCaseToSection(managingSectionCases.section_id, e.target.value);
                        e.target.value = '';
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="">Select a case...</option>
                    {casesList
                      .filter(c => c.enabled && !sectionCasesList.some(sc => sc.case_id === c.case_id))
                      .map(c => (
                        <option key={c.case_id} value={c.case_id}>{c.case_title}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              {/* Assigned Cases List */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Assigned Cases:</h4>
                {isLoadingSectionCases ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : sectionCasesList.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 bg-gray-50 rounded-lg">
                    No cases assigned to this section yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sectionCasesList.map(sc => (
                      <div key={sc.case_id} className="border rounded-lg overflow-hidden">
                        <div 
                          className={`flex items-center justify-between p-3 ${
                            sc.active 
                              ? 'bg-emerald-50 border-emerald-200' 
                              : 'bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {sc.active && (
                              <span className="flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{sc.case_title}</p>
                              <p className="text-xs text-gray-500">{sc.protagonist}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleExpandChatOptions(sc.case_id, sc.chat_options)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                                expandedCaseOptions === sc.case_id
                                  ? 'bg-purple-100 text-purple-700 border-purple-200'
                                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-purple-50'
                              }`}
                            >
                              Options
                            </button>
                            <button
                              onClick={() => sc.active
                                ? handleDeactivateSectionCase(managingSectionCases.section_id, sc.case_id)
                                : handleActivateSectionCase(managingSectionCases.section_id, sc.case_id)
                              }
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                                sc.active
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                              title={sc.active ? 'Click to make inactive (students cannot select)' : 'Click to make active (students can select)'}
                            >
                              {sc.active ? 'Active' : 'Inactive'}
                            </button>
                            <button
                              onClick={() => handleRemoveCaseFromSection(managingSectionCases.section_id, sc.case_id)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        
                        {/* Chat Options Panel (Phase 2) */}
                        {expandedCaseOptions === sc.case_id && editingChatOptions && (
                          <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Hints Allowed</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="10"
                                  value={editingChatOptions.hints_allowed ?? 3}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, hints_allowed: parseInt(e.target.value) || 0})}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Free Hints</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="5"
                                  value={editingChatOptions.free_hints ?? 1}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, free_hints: parseInt(e.target.value) || 0})}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={editingChatOptions.ask_for_feedback ?? false}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, ask_for_feedback: e.target.checked})}
                                  className="rounded border-gray-300"
                                />
                                Ask for feedback at end of chat
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={editingChatOptions.ask_save_transcript ?? false}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, ask_save_transcript: e.target.checked})}
                                  className="rounded border-gray-300"
                                />
                                Ask to save anonymized transcript
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={editingChatOptions.auto_save_transcript ?? true}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, auto_save_transcript: e.target.checked})}
                                  className="rounded border-gray-300"
                                />
                                Auto-save transcript during chat
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={editingChatOptions.always_save_transcript ?? false}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, always_save_transcript: e.target.checked})}
                                  className="rounded border-gray-300"
                                />
                                Always save transcript at the end without asking
                              </label>
                            </div>
                            <div>
                              {renderPersonaChatOptionsFields(false)}
                            </div>

                            {/* Position Tracking Override */}
                            <div className="border-t border-gray-200 pt-3 mt-3">
                              <label className="flex items-center gap-2 text-sm text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={editingChatOptions.disable_position_tracking ?? false}
                                  onChange={(e) => setEditingChatOptions({...editingChatOptions, disable_position_tracking: e.target.checked})}
                                  className="rounded border-gray-300"
                                />
                                <span>Disable position tracking</span>
                              </label>
                              <p className="text-xs text-gray-400 mt-1 ml-6">Override scenario settings</p>
                            </div>

                            <div className="flex justify-between pt-2 border-t">
                              <button
                                onClick={handleResetChatOptions}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
                              >
                                Reset to Defaults
                              </button>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => { setExpandedCaseOptions(null); setEditingChatOptions(null); }}
                                  className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveChatOptions(managingSectionCases.section_id, sc.case_id)}
                                  disabled={isSavingChatOptions}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {isSavingChatOptions ? 'Saving...' : 'Save Options'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => { setShowSectionCasesModal(false); setManagingSectionCases(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Case Modal */}
      {showCaseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white">
              <h3 className="text-lg font-bold text-gray-900">
                {editingCase ? 'Edit Case' : 'Create New Case'}
              </h3>
              <button
                onClick={() => setShowCaseModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Case ID *</label>
                <input
                  type="text"
                  value={caseForm.case_id}
                  onChange={(e) => setCaseForm({ ...caseForm, case_id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  disabled={!!editingCase}
                  placeholder="e.g., malawis-pizza"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1">Unique identifier (lowercase, hyphens only)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Case Title *</label>
                <input
                  type="text"
                  value={caseForm.case_title}
                  onChange={(e) => setCaseForm({ ...caseForm, case_title: e.target.value })}
                  placeholder="e.g., Malawi's Pizza Catering"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                <input
                  type="text"
                  value={caseForm.case_version}
                  onChange={(e) => setCaseForm({ ...caseForm, case_version: e.target.value })}
                  placeholder="e.g., 2025, v2.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Optional version label (such as the year of the case)</p>
              </div>
              {/* Info box for editing - encourage going to Scenarios */}
              {editingCase && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Tip:</strong> To edit protagonists, chat questions, and positions, go to the Scenario Manager.
                  </p>
                </div>
              )}
              <div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={caseForm.enabled}
                    onChange={(e) => setCaseForm({ ...caseForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Enabled (available for assignment to sections)
                </label>
              </div>
              <VisibilityPicker
                value={caseForm.visibility}
                onChange={v => setCaseForm({ ...caseForm, visibility: v })}
                teamShares={caseForm.team_shares}
                onTeamSharesChange={shares => setCaseForm({ ...caseForm, team_shares: shares })}
                canPublish={Boolean(user?.superuser) || Boolean((user as any)?.can_publish)}
              />
              {!editingCase && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <strong>Next step:</strong> After creating the case, you'll define scenarios with protagonists, chat questions, and positions.
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowCaseModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              {editingCase ? (
                <>
                  <button
                    onClick={() => handleSaveCase(false)}
                    disabled={isSavingCase}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                  >
                    {isSavingCase ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => handleSaveCase(true)}
                    disabled={isSavingCase}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {isSavingCase ? 'Saving...' : 'Save and go to Scenarios'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleSaveCase(false)}
                    disabled={isSavingCase}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                  >
                    {isSavingCase ? 'Saving...' : 'Create Case'}
                  </button>
                  <button
                    onClick={() => handleSaveCase(true)}
                    disabled={isSavingCase}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                  >
                    {isSavingCase ? 'Saving...' : 'Create Case and go to Scenarios'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Persona Modal */}
      {showPersonaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white">
              <h3 className="text-lg font-bold text-gray-900">
                {personaViewOnly ? 'View Persona' : editingPersona ? 'Edit Persona' : 'Create New Persona'}
              </h3>
              <button
                onClick={() => { setShowPersonaModal(false); setPersonaViewOnly(false); setPersonaModalError(null); }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            {personaModalError && (
              <div className="mx-4 mt-4 bg-red-100 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                {personaModalError}
              </div>
            )}
            {personaViewOnly && editingPersona && isSystemPersona(editingPersona) && (
              <div className="mx-4 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
                Built-in personas are read-only. Clone to create your own editable copy.
              </div>
            )}
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Persona ID *</label>
                  <input
                    type="text"
                    value={personaForm.persona_id}
                    onChange={(e) => setPersonaForm({ ...personaForm, persona_id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                    disabled={!!editingPersona || personaViewOnly}
                    placeholder="e.g., friendly-mentor"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Lowercase, hyphens only</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
                  <input
                    type="text"
                    value={personaForm.persona_name}
                    onChange={(e) => setPersonaForm({ ...personaForm, persona_name: e.target.value })}
                    disabled={personaViewOnly}
                    placeholder="e.g., Friendly Mentor"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={personaForm.description}
                  onChange={(e) => setPersonaForm({ ...personaForm, description: e.target.value })}
                  disabled={personaViewOnly}
                  placeholder="Brief description of this persona's behavior"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">AI Instructions *</label>
                <textarea
                  value={personaForm.instructions}
                  onChange={(e) => setPersonaForm({ ...personaForm, instructions: e.target.value })}
                  disabled={personaViewOnly}
                  placeholder="Detailed instructions for the AI chatbot on how to behave with this persona..."
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y disabled:bg-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1">These instructions guide the chatbot's personality and interaction style</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                  <input
                    type="number"
                    value={personaForm.sort_order}
                    onChange={(e) => setPersonaForm({ ...personaForm, sort_order: parseInt(e.target.value) || 0 })}
                    disabled={personaViewOnly}
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  />
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={personaForm.enabled}
                      onChange={(e) => setPersonaForm({ ...personaForm, enabled: e.target.checked })}
                      disabled={personaViewOnly}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Enabled (available for selection)
                  </label>
                </div>
              </div>
              {!personaViewOnly && (
                <div className="mt-4">
                  <VisibilityPicker
                    value={personaForm.visibility}
                    onChange={v => setPersonaForm({ ...personaForm, visibility: v })}
                    teamShares={personaForm.team_shares}
                    onTeamSharesChange={shares => setPersonaForm({ ...personaForm, team_shares: shares })}
                    canPublish={Boolean(user?.superuser) || Boolean((user as any)?.can_publish)}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => { setShowPersonaModal(false); setPersonaViewOnly(false); setPersonaModalError(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              {personaViewOnly && editingPersona ? (
                <button
                  onClick={() => handleClonePersona(editingPersona)}
                  disabled={isCloningPersona}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {isCloningPersona ? 'Cloning...' : 'Clone to my library'}
                </button>
              ) : (
                <button
                  onClick={handleSavePersona}
                  disabled={isSavingPersona}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSavingPersona ? 'Saving...' : editingPersona ? 'Save Changes' : 'Create Persona'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scenario Manager Modal */}
      {showScenarioManager && managingScenarioCase && (
        <ScenarioManager
          caseId={managingScenarioCase.case_id}
          caseTitle={managingScenarioCase.case_title}
          onClose={() => {
            setShowScenarioManager(false);
            setManagingScenarioCase(null);
            fetchCases();
          }}
          onScenariosChanged={() => {
            fetchCases();
          }}
        />
      )}

      {/* View Scenario Details Modal */}
      {viewingScenario && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setViewingScenario(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">Scenario Details</h2>
              <button
                onClick={() => setViewingScenario(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-5">
              {/* Scenario Name */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{viewingScenario.scenario_name}</h3>
                {!viewingScenario.enabled && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded">Disabled</span>
                )}
              </div>

              {/* Protagonist Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Protagonist Name</label>
                  <p className="text-gray-900">{viewingScenario.protagonist}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Initials</label>
                  <p className="text-gray-900">{viewingScenario.protagonist_initials}</p>
                </div>
              </div>

              {viewingScenario.protagonist_role && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Protagonist Role</label>
                  <p className="text-gray-900">{viewingScenario.protagonist_role}</p>
                </div>
              )}

              {/* Chat Topic */}
              {viewingScenario.chat_topic && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Chat Topic</label>
                  <p className="text-gray-900">{viewingScenario.chat_topic}</p>
                </div>
              )}

              {/* Chat Question */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Chat Question</label>
                <p className="text-gray-900 bg-gray-50 p-3 rounded-lg border">{viewingScenario.chat_question}</p>
              </div>

              {/* Additional Prompt Instructions */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Additional Prompt Instructions</label>
                {viewingScenario.prompt_instructions ? (
                  <pre className="text-gray-900 bg-amber-50 p-3 rounded-lg border border-amber-200 whitespace-pre-wrap text-sm font-mono">{viewingScenario.prompt_instructions}</pre>
                ) : (
                  <p className="text-gray-400 italic">None specified</p>
                )}
              </div>

              {/* Time Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Time Limit</label>
                  <p className="text-gray-900">
                    {viewingScenario.chat_time_limit > 0 ? `${viewingScenario.chat_time_limit} minutes` : 'No limit'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Warning Time</label>
                  <p className="text-gray-900">
                    {viewingScenario.chat_time_limit > 0 ? `${viewingScenario.chat_time_warning} minutes before` : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Defined Positions */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Defined Positions</label>
                {isLoadingViewScenarioPositions ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent"></div>
                    <span className="text-sm">Loading positions...</span>
                  </div>
                ) : viewingScenarioPositions.length > 0 ? (
                  <div className="space-y-1">
                    {viewingScenarioPositions.map((pos: any) => (
                      <div key={pos.position_id} className="flex items-center gap-2 text-sm">
                        <span className={`w-2 h-2 rounded-full ${pos.position_enabled ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span className={pos.position_enabled ? 'text-gray-900' : 'text-gray-400'}>{pos.position_name}</span>
                        {!pos.position_enabled && <span className="text-xs text-gray-400">(disabled)</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 italic">No positions defined</p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-between items-center">
              <button
                onClick={() => {
                  // Open ScenarioManager for this scenario's case
                  const caseInfo = { case_id: viewingScenario.case_id, case_title: viewingScenario.case_title };
                  setViewingScenario(null);
                  setManagingScenarioCase(caseInfo);
                  setShowScenarioManager(true);
                }}
                className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
              >
                Edit Scenario
              </button>
              <button
                onClick={() => setViewingScenario(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 rounded-lg border border-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
