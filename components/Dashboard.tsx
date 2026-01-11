


import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, getApiBaseUrl } from '../services/apiClient'; // Dashboard with tiles/list view toggle
import { detectProvider } from '../services/llmService';
import { PromptManager } from './PromptManager';
import { SettingsManager } from './SettingsManager';
import { CasePrepManager } from './CasePrepManager';
import { CaseFilesManager } from './CaseFilesManager';
import { CacheMetrics } from './CacheMetrics';
import { ScenarioManager } from './ScenarioManager';
import InstructorManager from './InstructorManager';
import StudentManager from './StudentManager';
import DashboardHome from './DashboardHome';
import Analytics from './Analytics';
import HelpTooltip from './ui/HelpTooltip';
import { ChatOptionsHelp } from '../help/dashboard';
import { hasAccess } from '../utils/permissions';
import { AdminUser } from '../types';

// New workflow-centric navigation types
type PrimaryTab = 'home' | 'courses' | 'content' | 'monitor' | 'results' | 'admin';
type CoursesSubTab = 'sections' | 'students' | 'assignments' | 'chat-options';
type ContentSubTab = 'cases' | 'casefiles' | 'caseprep';
type MonitorSubTab = 'chats' | 'cache';
type AdminSubTab = 'personas' | 'prompts' | 'models' | 'settings' | 'instructors';

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
  active_case_id?: string | null;
  active_case_title?: string | null;
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
  transcript: string | null;
  liked: string | null;
  improve: string | null;
  created_at: string | null;
  status: 'completed' | 'in_progress' | 'not_started';
  case_id: string | null;
  case_title: string | null;
  evaluation_id: string | null;
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
  enabled: boolean;
  default?: boolean;
  input_cost?: number | null;
  output_cost?: number | null;
  temperature?: number | null;
  reasoning_effort?: string | null;
}

interface Case {
  case_id: string;
  case_title: string;
  protagonist: string;
  protagonist_initials: string;
  chat_topic?: string | null;
  chat_question: string;
  enabled: boolean;
  created_at?: string;
  files?: { id: number; filename: string; file_type: string }[];
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

const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  // New workflow-centric navigation state
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('home');
  const [coursesSubTab, setCoursesSubTab] = useState<CoursesSubTab>('sections');
  const [contentSubTab, setContentSubTab] = useState<ContentSubTab>('cases');
  const [monitorSubTab, setMonitorSubTab] = useState<MonitorSubTab>('chats');
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('personas');

  // Check if user has access to any admin functions
  const hasAdminAccess = useCallback(() => {
    return hasAccess(user, 'personas') || hasAccess(user, 'prompts') ||
           hasAccess(user, 'models') || hasAccess(user, 'settings') ||
           hasAccess(user, 'instructors');
  }, [user]);

  // Legacy tab compatibility - determine first accessible tab for the user
  const getFirstAccessibleTab = (): 'chats' | 'assignments' | 'sections' | 'students' | 'cases' | 'caseprep' | 'personas' | 'prompts' | 'models' | 'settings' | 'instructors' => {
    const tabs: Array<'chats' | 'assignments' | 'sections' | 'students' | 'cases' | 'caseprep' | 'personas' | 'prompts' | 'models' | 'settings' | 'instructors'> =
      ['chats', 'assignments', 'sections', 'students', 'cases', 'caseprep', 'personas', 'prompts', 'models', 'settings', 'instructors'];
    for (const tab of tabs) {
      if (hasAccess(user, tab)) {
        return tab;
      }
    }
    return 'sections'; // Fallback
  };

  const [sectionStats, setSectionStats] = useState<SectionStat[]>([]);
  const [selectedSection, setSelectedSection] = useState<SectionStat | null>(null);
  const [resultsInitialSectionId, setResultsInitialSectionId] = useState<string | undefined>(undefined);
  const [studentDetails, setStudentDetails] = useState<StudentDetail[]>([]);

  // Stats for navigation badges
  const [stats, setStats] = useState({ activeChats: 0, abandonedChats: 0 });
  const [modelsMap, setModelsMap] = useState<Map<string, string>>(new Map());
  const [modelsList, setModelsList] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chats' | 'assignments' | 'sections' | 'students' | 'cases' | 'caseprep' | 'personas' | 'prompts' | 'models' | 'settings' | 'instructors'>(getFirstAccessibleTab());
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [modelForm, setModelForm] = useState<{
    model_id: string;
    model_name: string;
    enabled: boolean;
    default: boolean;
    input_cost: string;
    output_cost: string;
    temperature: string;
    reasoning_effort: string;
  }>({
    model_id: '',
    model_name: '',
    enabled: true,
    default: false,
    input_cost: '',
    output_cost: '',
    temperature: '',
    reasoning_effort: '',
  });
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
  const [sectionViewMode, setSectionViewMode] = useState<'tiles' | 'list'>('list');
  
  // Modal states
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentDetail | null>(null);
  
  // Section management
  const [editingSection, setEditingSection] = useState<SectionStat | null>(null);
  const [sectionForm, setSectionForm] = useState({
    section_id: '',
    section_title: '',
    year_term: '',
    chat_model: '',
    super_model: '',
    enabled: true,
    accept_new_students: false
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
    protagonist: '',
    protagonist_initials: '',
    chat_topic: '',
    chat_question: '',
    enabled: true
  });
  const [isSavingCase, setIsSavingCase] = useState(false);
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
  
  // Default chat options
  const defaultChatOptions = {
    hints_allowed: 3,
    free_hints: 1,
    ask_for_feedback: false,
    ask_save_transcript: false,
    allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
    default_persona: 'moderate',
    show_case: true,
    show_timer: true,
    do_evaluation: true,
    show_evaluation_details: true,
    chatbot_personality: '',
    allow_repeat: false,
    timeout_chat: false,
    restart_chat: false,
    allow_exit: false,
    require_minimum_exchanges: 0,
    max_message_length: 0
  };

  // Chat options category collapse state (start collapsed)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [bulkActionsExpanded, setBulkActionsExpanded] = useState(false);

  // Personas management
  const [personasList, setPersonasList] = useState<any[]>([]);
  const [isLoadingPersonas, setIsLoadingPersonas] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<any | null>(null);
  const [personaForm, setPersonaForm] = useState({
    persona_id: '',
    persona_name: '',
    description: '',
    instructions: '',
    enabled: true,
    sort_order: 0
  });
  const [isSavingPersona, setIsSavingPersona] = useState(false);

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
  const handleNavigate = useCallback((section: string, subTab?: string) => {
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
            enabled: true
          });
        } else if (subTab && ['sections', 'students', 'assignments'].includes(subTab)) {
          setCoursesSubTab(subTab as CoursesSubTab);
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
        break;
      case 'analytics':
        setPrimaryTab('results');
        break;
      case 'results':
        setPrimaryTab('results');
        if (subTab) {
          // subTab is a section_id to pre-filter results
          setResultsInitialSectionId(subTab);
        } else {
          setResultsInitialSectionId(undefined);
        }
        break;
      case 'admin':
        setPrimaryTab('admin');
        if (subTab && ['personas', 'prompts', 'models', 'settings', 'instructors'].includes(subTab)) {
          setAdminSubTab(subTab as AdminSubTab);
        }
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
    setCoursesSubTab('chat-options');
  }, [defaultChatOptions]);

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    const { data, error } = await api
      .from('models')
      .select('model_id, model_name, enabled, default, input_cost, output_cost, temperature, reasoning_effort');
    
    if (error) {
      console.error('Failed to fetch models', error);
    } else if (data) {
      setModelsMap(new Map((data as any[]).map(m => [m.model_id, m.model_name])));
      setModelsList(data as Model[]);
    }
    setIsLoadingModels(false);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const fetchSectionStats = useCallback(async () => {
    setIsLoadingSections(true);
    setError(null);

    const { data: sections, error: sectionsError } = await api
      .from('sections')
      .select('section_id, section_title, year_term, chat_model, super_model, enabled, active_case_id, active_case_title')
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
  }, [fetchSectionStats]);

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

  const handleTabChange = (tab: 'chats' | 'assignments' | 'sections' | 'students' | 'cases' | 'caseprep' | 'personas' | 'prompts' | 'models' | 'settings' | 'instructors') => {
    if (!hasAccess(user, tab)) {
      alert(`You don't have access to ${tab}. Contact a superuser for access.`);
      return;
    }
    setActiveTab(tab);
    if (tab !== 'sections') {
      setSelectedSection(null);
    }
    if (tab === 'cases' && casesList.length === 0) {
      fetchCases();
    }
    if (tab === 'personas' && personasList.length === 0) {
      fetchPersonas();
    }
    if (tab === 'assignments') {
      fetchAssignmentsSections();
      if (casesList.length === 0) {
        fetchCases();
      }
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
        setPersonasList(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching personas:', err);
    } finally {
      setIsLoadingPersonas(false);
    }
  };

  const handleOpenPersonaModal = (persona?: any) => {
    if (persona) {
      setEditingPersona(persona);
      setPersonaForm({
        persona_id: persona.persona_id,
        persona_name: persona.persona_name,
        description: persona.description || '',
        instructions: persona.instructions,
        enabled: persona.enabled,
        sort_order: persona.sort_order || 0
      });
    } else {
      setEditingPersona(null);
      setPersonaForm({
        persona_id: '',
        persona_name: '',
        description: '',
        instructions: '',
        enabled: true,
        sort_order: personasList.length
      });
    }
    setShowPersonaModal(true);
  };

  const handleSavePersona = async () => {
    if (!personaForm.persona_id || !personaForm.persona_name || !personaForm.instructions) {
      setError('Please fill in persona ID, name, and instructions');
      return;
    }
    setIsSavingPersona(true);
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
        throw new Error(result.error?.message || 'Failed to save persona');
      }

      setShowPersonaModal(false);
      fetchPersonas();
    } catch (err: any) {
      setError(err.message || 'Failed to save persona');
    } finally {
      setIsSavingPersona(false);
    }
  };

  const handleDeletePersona = async (personaId: string) => {
    if (!confirm(`Are you sure you want to delete persona "${personaId}"? This cannot be undone.`)) return;
    try {
      const token = localStorage.getItem('admin_auth_token');
      const response = await fetch(`${getApiBaseUrl()}/personas/${personaId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error?.message || 'Failed to delete persona');
      }

      fetchPersonas();
    } catch (err: any) {
      setError(err.message || 'Failed to delete persona');
    }
  };

  const handleTogglePersonaEnabled = async (persona: any) => {
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
        throw new Error(result.error?.message || 'Failed to update persona');
      }

      fetchPersonas();
    } catch (err: any) {
      setError(err.message || 'Failed to update persona');
    }
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
      const { data, error } = await api.from('cases').select('*').order('created_at', { ascending: false });
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
        protagonist: caseItem.protagonist,
        protagonist_initials: caseItem.protagonist_initials,
        chat_topic: caseItem.chat_topic || '',
        chat_question: caseItem.chat_question,
        enabled: caseItem.enabled
      });
    } else {
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
    }
    setShowCaseModal(true);
  };

  const handleSaveCase = async () => {
    if (!caseForm.case_id || !caseForm.case_title || !caseForm.protagonist || !caseForm.protagonist_initials || !caseForm.chat_question) {
      setError('Please fill in all required fields');
      return;
    }
    setIsSavingCase(true);
    try {
      if (editingCase) {
        const { error } = await api.from('cases').update({
          case_title: caseForm.case_title,
          protagonist: caseForm.protagonist,
          protagonist_initials: caseForm.protagonist_initials,
          chat_topic: caseForm.chat_topic || null,
          chat_question: caseForm.chat_question,
          enabled: caseForm.enabled
        }).eq('case_id', editingCase.case_id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await api.from('cases').insert({
          case_id: caseForm.case_id,
          case_title: caseForm.case_title,
          protagonist: caseForm.protagonist,
          protagonist_initials: caseForm.protagonist_initials,
          chat_topic: caseForm.chat_topic || null,
          chat_question: caseForm.chat_question,
          enabled: caseForm.enabled
        });
        if (error) throw new Error(error.message);
      }
      setShowCaseModal(false);
      fetchCases();
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
      fetchSectionCases(sectionId);
      setExpandedCaseOptions(null);
      setEditingChatOptions(null);
      // Show success message and auto-dismiss after 3 seconds
      setSuccessMessage('Chat options saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
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

  // Expand/collapse scenario assignment panel
  const handleExpandScenarios = async (sectionId: string, caseId: string, sectionCase: any) => {
    if (expandedScenarios === caseId) {
      setExpandedScenarios(null);
      setAvailableScenariosForCase([]);
      setAssignedScenarios([]);
      return;
    }

    setExpandedScenarios(caseId);
    setIsLoadingScenarioAssignment(true);

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
    } catch (err) {
      console.error('Failed to load scenario assignments:', err);
      setAvailableScenariosForCase([]);
      setAssignedScenarios([]);
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

  // Save scenario selection mode settings
  const handleSaveScenarioSettings = async (sectionId: string, caseId: string) => {
    setIsSavingScenarioAssignment(true);
    try {
      const token = localStorage.getItem('admin_auth_token');
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
        const cols = ['model_id','model_name','enabled','default_model','input_cost','output_cost'];
        const vals = [
          sqlValue(m.model_id),
          sqlValue(m.model_name),
          sqlValue(m.enabled),
          sqlValue((m as any).default),
          sqlValue(m.input_cost),
          sqlValue(m.output_cost),
        ];
        const updates = ['model_name=VALUES(model_name)','enabled=VALUES(enabled)','default_model=VALUES(default_model)','input_cost=VALUES(input_cost)','output_cost=VALUES(output_cost)'];
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
      enabled: true
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
      accept_new_students: !!section.accept_new_students
    });
    setShowSectionModal(true);
  };

  const handleSaveSection = async () => {
    if (!sectionForm.section_id.trim() || !sectionForm.section_title.trim()) {
      alert('Section ID and Title are required.');
      return;
    }

    try {
      if (editingSection) {
        // Update existing section
        const { error } = await api
          .from('sections')
          .update({
            section_title: sectionForm.section_title,
            year_term: sectionForm.year_term,
            chat_model: sectionForm.chat_model || null,
            super_model: sectionForm.super_model || null,
            enabled: sectionForm.enabled,
            accept_new_students: sectionForm.accept_new_students
          })
          .eq('section_id', sectionForm.section_id);

        if (error) throw error;
      } else {
        // Create new section (default accept_new_students to false/locked)
        const { error } = await api
          .from('sections')
          .insert({
            section_id: sectionForm.section_id,
            section_title: sectionForm.section_title,
            year_term: sectionForm.year_term,
            chat_model: sectionForm.chat_model || null,
            super_model: sectionForm.super_model || null,
            enabled: sectionForm.enabled,
            accept_new_students: sectionForm.accept_new_students
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

  const openCreateModelModal = () => {
    setEditingModel(null);
    setModelForm({
      model_id: '',
      model_name: '',
      enabled: true,
      default: false,
      input_cost: '',
      output_cost: '',
      temperature: '',
      reasoning_effort: '',
    });
    setShowModelModal(true);
  };

  const openEditModelModal = (model: Model) => {
    setEditingModel(model);
    setModelForm({
      model_id: model.model_id,
      model_name: model.model_name,
      enabled: !!model.enabled,
      default: !!model.default,
      input_cost: model.input_cost !== null && model.input_cost !== undefined ? String(model.input_cost) : '',
      output_cost: model.output_cost !== null && model.output_cost !== undefined ? String(model.output_cost) : '',
      temperature: model.temperature !== null && model.temperature !== undefined ? String(model.temperature) : '',
      reasoning_effort: model.reasoning_effort || '',
    });
    setShowModelModal(true);
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

    const parseCost = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const parsed = parseFloat(trimmed);
      if (Number.isNaN(parsed)) {
        throw new Error('Input/output cost must be a number.');
      }
      return parsed;
    };

    const parseTemperature = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const parsed = parseFloat(trimmed);
      if (Number.isNaN(parsed)) {
        throw new Error('Temperature must be a number.');
      }
      return parsed;
    };

    const isReasoningModel = (id: string) => id.toLowerCase().startsWith('o1');

    const payload = {
      model_id: modelForm.model_id.trim(),
      model_name: modelForm.model_name.trim(),
      enabled: modelForm.enabled,
      default: modelForm.default,
      input_cost: parseCost(modelForm.input_cost),
      output_cost: parseCost(modelForm.output_cost),
      temperature: parseTemperature(modelForm.temperature),
      reasoning_effort: modelForm.reasoning_effort || null,
    };

    setIsSavingModel(true);
    try {
      const response = await fetch(editingModel ? `/api/models/${editingModel.model_id}` : '/api/models', {
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
      const response = await fetch(`${getApiBaseUrl()}/models/${model.model_id}`, {
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
      const response = await fetch(`${getApiBaseUrl()}/models/${model.model_id}`, {
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
    const prompt = 'What is the capital of France?';
    setTestingModelId(model.model_id);
    try {
      const response = await fetch(`${getApiBaseUrl()}/llm/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          modelId: model.model_id,
          systemPrompt: 'You are a quick connectivity test agent. Respond concisely.',
          history: [],
          message: prompt,
        }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || result.error) {
        const msg = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(msg);
      }
      const text = result?.data?.text || '';
      const meta = result?.data?.meta || {};
      const parts = [];
      if (meta.provider) parts.push(`provider=${meta.provider}`);
      if (meta.temperature !== null && meta.temperature !== undefined) parts.push(`temperature=${meta.temperature}`);
      if (meta.reasoning_effort) parts.push(`reasoning_effort=${meta.reasoning_effort}`);
      const metaText = parts.length ? ` (params: ${parts.join(', ')})` : '';
      alert(`Success: ${model.model_name} reports that the capital of France is: ${text || 'Received empty response.'}${metaText}`);
    } catch (err: any) {
      console.error('Failed to test model:', err);
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
      const response = await fetch(`${getApiBaseUrl()}/models/${model.model_id}`, {
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
            onClick={fetchModels}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            onClick={openCreateModelModal}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Add Model
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Input Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Output Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedModels.map(model => (
                  <tr key={model.model_id} className="hover:bg-gray-50">
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
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                        {providerLabel(model.model_id)}
                      </span>
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
                    <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.input_cost)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatCost(model.output_cost)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleTestModel(model)}
                          disabled={testingModelId === model.model_id}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                            testingModelId === model.model_id
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {testingModelId === model.model_id ? 'Testing...' : 'Test'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderCasesTab = () => (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Business Cases</h2>
          <p className="text-sm text-gray-500">{casesList.length} case{casesList.length !== 1 ? 's' : ''} available</p>
        </div>
        <button
          onClick={() => handleOpenCaseModal()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + New Case
        </button>
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Case ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Protagonist</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {casesList.map((caseItem) => (
                <tr key={caseItem.case_id} className={!caseItem.enabled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{caseItem.case_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{caseItem.case_title}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {caseItem.protagonist} <span className="text-gray-400">({caseItem.protagonist_initials})</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleCaseEnabled(caseItem)}
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        caseItem.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {caseItem.enabled ? 'Enabled' : 'Disabled'}
                    </button>
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

      {showScenarioManager && managingScenarioCase && (
        <ScenarioManager
          caseId={managingScenarioCase.case_id}
          caseTitle={managingScenarioCase.case_title}
          onClose={() => {
            setShowScenarioManager(false);
            setManagingScenarioCase(null);
          }}
          onScenariosChanged={() => {
            // Optionally refresh something if needed
          }}
        />
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
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Success/Error Messages */}
      {error && (
        <div className="mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">{error}</div>
      )}
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
                              Scenarios
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
                            {sc.active ? (
                              <button
                                onClick={() => handleDeactivateSectionCase(selectedAssignmentSection!, sc.case_id)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              >
                                Active
                              </button>
                            ) : (
                              <button
                                onClick={() => handleActivateSectionCase(selectedAssignmentSection!, sc.case_id)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600"
                              >
                                Set Active
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveCaseFromSection(selectedAssignmentSection!, sc.case_id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Remove from section"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
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
                                    onChange={(e) => setScenarioSettings({...scenarioSettings, use_scenarios: e.target.checked})}
                                    className="rounded border-gray-300"
                                  />
                                  <span className="font-medium">Enable scenarios for this section-case</span>
                                </label>

                                {scenarioSettings.use_scenarios && (
                                  <>
                                    {/* Selection Mode */}
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">Selection Mode</label>
                                      <select
                                        value={scenarioSettings.selection_mode}
                                        onChange={(e) => setScenarioSettings({...scenarioSettings, selection_mode: e.target.value})}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                      >
                                        <option value="student_choice">Student Choice (pick any one)</option>
                                        <option value="all_required">All Required (must complete all)</option>
                                      </select>
                                    </div>

                                    {/* Require Order (only for all_required) */}
                                    {scenarioSettings.selection_mode === 'all_required' && (
                                      <label className="flex items-center gap-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={scenarioSettings.require_order}
                                          onChange={(e) => setScenarioSettings({...scenarioSettings, require_order: e.target.checked})}
                                          className="rounded border-gray-300"
                                        />
                                        Require completion in order
                                      </label>
                                    )}

                                    {/* Scenario Checkboxes */}
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-2">Assign Scenarios</label>
                                      <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {availableScenariosForCase.map((scenario) => {
                                          const isAssigned = Array.isArray(assignedScenarios) && assignedScenarios.some(a => a.scenario_id === scenario.id);
                                          return (
                                            <label key={scenario.id} className="flex items-start gap-2 text-sm p-2 bg-white rounded border border-gray-200 hover:bg-gray-50">
                                              <input
                                                type="checkbox"
                                                checked={isAssigned}
                                                onChange={() => handleToggleScenarioAssignment(selectedAssignmentSection!, sc.case_id, scenario.id, isAssigned)}
                                                className="mt-0.5 rounded border-gray-300"
                                              />
                                              <div className="flex-1">
                                                <div className="font-medium text-gray-900">{scenario.scenario_name}</div>
                                                <div className="text-xs text-gray-500">
                                                  {scenario.protagonist}
                                                  {scenario.chat_time_limit > 0 && ` • ${scenario.chat_time_limit}min limit`}
                                                </div>
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                )}

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
      return result.data || defaultChatOptions;
    } catch (error) {
      console.error('Error fetching defaults:', error);
      return defaultChatOptions;
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
      const defaults = await fetchChatOptionsDefaults();
      setEditingChatOptions({ ...defaults });
      setApplicableDefault(null);
    } else if (sectionId) {
      // Regular section selected - reset default editing mode
      setIsEditingDefault(null);
      await fetchSectionCases(sectionId);
      // Fetch applicable default for this section
      const defaults = await fetchChatOptionsDefaults(sectionId);
      setApplicableDefault(defaults);
    } else {
      // Nothing selected
      setIsEditingDefault(null);
      setApplicableDefault(null);
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
      const defaults = await fetchChatOptionsDefaults(chatOptionsSection || undefined);
      setEditingChatOptions({ ...defaults });
    } else if (caseId) {
      // Regular case selected
      setIsEditingDefault(null);
      const sc = sectionCasesList.find((s: any) => s.case_id === caseId);
      if (sc) {
        // If chat_options is null, use defaults and set useDefaultOptions to true
        const hasCustomOptions = sc.chat_options !== null;
        setUseDefaultOptions(!hasCustomOptions);
        if (hasCustomOptions) {
          setEditingChatOptions({ ...sc.chat_options });
        } else {
          // Use the applicable default
          setEditingChatOptions({ ...applicableDefault } || { ...defaultChatOptions });
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
      setTimeout(() => setSuccessMessage(null), 3000);

      // Update applicable default if we just saved section default
      if (isEditingDefault === 'section') {
        setApplicableDefault({ ...editingChatOptions });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save defaults');
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
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Success/Error Messages */}
      {error && (
        <div className="mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">{error}</div>
      )}
      {successMessage && (
        <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          {successMessage}
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
                <p className="text-sm text-gray-600 mt-1">
                  These settings apply to new case assignments in this section unless overridden at the assignment level.
                </p>
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

          <div className={`p-4 space-y-2 ${!isEditingDefault && useDefaultOptions ? 'opacity-60 pointer-events-none' : ''}`}>
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
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Hints Allowed</label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={editingChatOptions.hints_allowed ?? 3}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, hints_allowed: parseInt(e.target.value) || 0})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Free Hints (no score penalty)</label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={editingChatOptions.free_hints ?? 1}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, free_hints: parseInt(e.target.value) || 0})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
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
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editingChatOptions.show_case ?? true}
                      onChange={(e) => setEditingChatOptions({...editingChatOptions, show_case: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Show case content in left panel
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editingChatOptions.show_timer ?? true}
                      onChange={(e) => setEditingChatOptions({...editingChatOptions, show_timer: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Show countdown timer during chat
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editingChatOptions.do_evaluation ?? true}
                      onChange={(e) => setEditingChatOptions({...editingChatOptions, do_evaluation: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Run evaluation after chat
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editingChatOptions.show_evaluation_details ?? true}
                      onChange={(e) => setEditingChatOptions({...editingChatOptions, show_evaluation_details: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    Show full evaluation criteria (vs just score)
                  </label>
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
                  <label className="block text-xs font-medium text-gray-700 mb-1">Default Persona</label>
                  <select
                    value={editingChatOptions.default_persona ?? 'moderate'}
                    onChange={(e) => setEditingChatOptions({...editingChatOptions, default_persona: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {personasList.length > 0 ? (
                      personasList.filter(p => p.enabled).map(p => (
                        <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>
                      ))
                    ) : (
                      <>
                        <option value="moderate">Moderate</option>
                        <option value="strict">Strict</option>
                        <option value="liberal">Liberal</option>
                        <option value="leading">Leading</option>
                        <option value="sycophantic">Sycophantic</option>
                      </>
                    )}
                  </select>
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
                    Chatbot Personality (additional instructions)
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
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.allow_repeat ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, allow_repeat: e.target.checked})}
                        className="rounded border-gray-300"
                      />
                      Allow students to repeat the chat multiple times
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.timeout_chat ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, timeout_chat: e.target.checked})}
                        className="rounded border-gray-300"
                      />
                      Auto-end chat when time limit expires
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.restart_chat ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, restart_chat: e.target.checked})}
                        className="rounded border-gray-300"
                      />
                      Allow students to restart the chat
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editingChatOptions.allow_exit ?? false}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, allow_exit: e.target.checked})}
                        className="rounded border-gray-300"
                      />
                      Provide exit button to leave chat
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Minimum Exchanges</label>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={editingChatOptions.require_minimum_exchanges ?? 0}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, require_minimum_exchanges: parseInt(e.target.value) || 0})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">Required before "time is up" (0 = none)</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Max Message Length</label>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        value={editingChatOptions.max_message_length ?? 0}
                        onChange={(e) => setEditingChatOptions({...editingChatOptions, max_message_length: parseInt(e.target.value) || 0})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={editingChatOptions.disable_position_tracking ?? false}
                      onChange={(e) => setEditingChatOptions({...editingChatOptions, disable_position_tracking: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    <span>Disable position tracking for this assignment</span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">Override scenario-level position tracking settings</p>
                </div>
              )}
            </div>

            {/* Save Actions - different based on what we're editing */}
            {isEditingDefault ? (
              /* Editing default: show save default button */
              <div className="flex justify-end pt-4 border-t">
                <button
                  onClick={handleSaveDefault}
                  disabled={isSavingChatOptions}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {isSavingChatOptions ? 'Saving...' : isEditingDefault === 'global' ? 'Save Global Default' : 'Save Section Default'}
                </button>
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
                <button
                  type="button"
                  onClick={() => setBulkActionsExpanded(!bulkActionsExpanded)}
                  className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-purple-700"
                >
                  <span className="flex items-center gap-2">
                    Use these option settings elsewhere
                    <HelpTooltip title="Use Settings Elsewhere">
                      <p>These options let you use the above settings as defaults for all new case assignments, or copy these chat options to other existing cases or sections.</p>
                    </HelpTooltip>
                  </span>
                  <span className="text-gray-400">{bulkActionsExpanded ? '\u25BC' : '\u25B6'}</span>
                </button>

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
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Chatbot Personas</h2>
          <p className="text-sm text-gray-500">Manage AI personality configurations for case chats</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPersonas}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            onClick={() => handleOpenPersonaModal()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Persona
          </button>
        </div>
      </div>

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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {personasList.map((persona) => (
                <tr key={persona.persona_id} className={!persona.enabled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{persona.persona_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 font-medium">{persona.persona_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={persona.description}>
                    {persona.description || '-'}
                  </td>
                  <td className="px-4 py-3">
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
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenPersonaModal(persona)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeletePersona(persona.persona_id)}
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
    if (primaryTab === 'monitor' || activeTab === 'chats') {
      fetchCaseChats();
    }
  }, [primaryTab, activeTab, caseChatsFilter.status, caseChatsFilter.section_id, fetchCaseChats]);

  // Fetch initial stats on mount
  useEffect(() => {
    fetchCaseChats();
  }, []);

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

  const renderChatsTab = () => (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Latest Chat Sessions</h2>
          <p className="text-sm text-gray-500">Monitor and manage the latest (most recent) chat sessions</p>
        </div>
        <button
          onClick={fetchCaseChats}
          disabled={isLoadingCaseChats}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          {isLoadingCaseChats ? 'Loading...' : 'Refresh'}
        </button>
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
      const defaultDiff = Number(!!b.default) - Number(!!a.default);
      if (defaultDiff !== 0) return defaultDiff;
      return a.model_name.localeCompare(b.model_name);
    });
  }, [modelsList]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
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
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Auto-refresh (30s)
            {autoRefresh && (
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            )}
          </label>
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
        <div className="px-6 pt-4 border-b border-gray-200 bg-white">
          <div className="flex gap-1">
            {/* Dashboard Home */}
            <button
              onClick={() => setPrimaryTab('home')}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                primaryTab === 'home'
                  ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                Dashboard
              </span>
            </button>

            {/* Courses */}
            {(hasAccess(user, 'sections') || hasAccess(user, 'students') || hasAccess(user, 'assignments')) && (
              <button
                onClick={() => {
                  setPrimaryTab('courses');
                  if (casesList.length === 0) fetchCases();
                  if (coursesSubTab === 'assignments') fetchAssignmentsSections();
                }}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
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

            {/* Content Library */}
            {(hasAccess(user, 'cases') || hasAccess(user, 'caseprep')) && (
              <button
                onClick={() => {
                  setPrimaryTab('content');
                  if (casesList.length === 0) fetchCases();
                }}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
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

            {/* Live Monitoring */}
            {hasAccess(user, 'chats') && (
              <button
                onClick={() => setPrimaryTab('monitor')}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
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

            {/* Results (formerly Analytics) */}
            <button
              onClick={() => setPrimaryTab('results')}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
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

            {/* System Admin (for superusers and those with admin permissions) */}
            {hasAdminAccess() && (
              <button
                onClick={() => {
                  setPrimaryTab('admin');
                  if (personasList.length === 0 && hasAccess(user, 'personas')) fetchPersonas();
                }}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  primaryTab === 'admin'
                    ? 'bg-gray-50 text-purple-600 border-b-2 border-purple-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Admin
                </span>
              </button>
            )}
          </div>

          {/* Sub-navigation for Courses */}
          {primaryTab === 'courses' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'sections') && (
                <button
                  onClick={() => setCoursesSubTab('sections')}
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
              {hasAccess(user, 'assignments') && (
                <button
                  onClick={() => {
                    setCoursesSubTab('assignments');
                    fetchAssignmentsSections();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'assignments'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Assignments
                </button>
              )}
              {hasAccess(user, 'assignments') && (
                <button
                  onClick={() => {
                    setCoursesSubTab('chat-options');
                    fetchAssignmentsSections();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    coursesSubTab === 'chat-options'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Chat Options
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

          {/* Sub-navigation for Admin */}
          {primaryTab === 'admin' && (
            <div className="flex gap-1 mt-2 pb-2">
              {hasAccess(user, 'personas') && (
                <button
                  onClick={() => {
                    setAdminSubTab('personas');
                    if (personasList.length === 0) fetchPersonas();
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    adminSubTab === 'personas'
                      ? 'bg-purple-100 text-purple-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Personas
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
            </div>
          )}
        </div>

        {/* Content Rendering based on Primary Tab */}
        {primaryTab === 'home' ? (
          <DashboardHome user={user} onNavigate={handleNavigate} />
        ) : primaryTab === 'results' ? (
          <Analytics onNavigate={handleNavigate} initialSectionId={resultsInitialSectionId} />
        ) : primaryTab === 'monitor' ? (
          monitorSubTab === 'cache' ? (
            <CacheMetrics />
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
        ) : primaryTab === 'admin' ? (
          adminSubTab === 'models' ? (
            renderModelsTab()
          ) : adminSubTab === 'personas' ? (
            renderPersonasTab()
          ) : adminSubTab === 'prompts' ? (
            <PromptManager />
          ) : adminSubTab === 'settings' ? (
            <SettingsManager />
          ) : adminSubTab === 'instructors' ? (
            <InstructorManager user={user} />
          ) : null
        ) : primaryTab === 'courses' ? (
          coursesSubTab === 'students' ? (
            <StudentManager />
          ) : coursesSubTab === 'assignments' ? (
            renderAssignmentsTab()
          ) : coursesSubTab === 'chat-options' ? (
            renderChatOptionsTab()
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

                {/* View Mode Toggle: List / Tiles */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setSectionViewMode('list')}
                    className={`p-1.5 rounded-md transition-colors ${
                      sectionViewMode === 'list' 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="List view"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setSectionViewMode('tiles')}
                    className={`p-1.5 rounded-md transition-colors ${
                      sectionViewMode === 'tiles' 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Tile view"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
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

            {error && (
              <div className="mb-6 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">{error}</div>
            )}

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
            ) : sectionViewMode === 'tiles' ? (
              /* ========== TILES VIEW ========== */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSections.map(section => (
                  <div
                    key={section.section_id}
                    className={`bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow cursor-pointer ${
                      !section.enabled ? 'opacity-75' : ''
                    }`}
                    onClick={() => handleSectionClick(section)}
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
                      <span className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        View Results
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ========== LIST VIEW ========== */
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Term</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active Case</th>
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
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSections.map(section => (
                      <tr 
                        key={section.section_id}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                          !section.enabled ? 'opacity-70' : ''
                        }`}
                        onClick={() => handleSectionClick(section)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${!section.enabled ? 'text-gray-500' : 'text-gray-900'}`}>
                              {section.section_title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                            {section.year_term}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {section.section_id !== 'unassigned' && section.section_id !== 'other_courses' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenSectionCasesModal(section); }}
                              className={`px-2 py-1 text-xs font-medium rounded-lg border transition-colors ${
                                section.active_case_title 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                              }`}
                              title="Manage case assignments"
                            >
                              {section.active_case_title || 'No case'}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600" title="completed/started">
                          <span className="font-semibold text-gray-900">{section.completions}</span>/{section.starts}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {section.section_id !== 'unassigned' && section.section_id !== 'other_courses' ? (
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
                          {section.section_id !== 'unassigned' && section.section_id !== 'other_courses' ? (
                            <button
                              onClick={(e) => handleToggleAcceptNewStudents(section, e)}
                              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                                section.accept_new_students
                                  ? 'bg-pink-500 text-white hover:bg-pink-600'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                              title={section.accept_new_students ? 'Accepting new students - click to lock' : 'Locked - click to accept new students'}
                            >
                              {section.accept_new_students ? 'Accept' : 'Locked'}
                            </button>
                          ) : (
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
                              onClick={(e) => { e.stopPropagation(); handleSectionClick(section); }}
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
                    ))}
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
                {selectedStudent.transcript || 'No transcript available.'}
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
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">
                {editingModel ? 'Edit Model' : 'Create Model'}
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
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model ID</label>
                <input
                  type="text"
                  value={modelForm.model_id}
                  onChange={(e) => setModelForm({ ...modelForm, model_id: e.target.value })}
                  disabled={!!editingModel}
                  placeholder="e.g., gemini-1.5-pro, gpt-4o, claude-3.5-sonnet"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Input Cost</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={modelForm.input_cost}
                    onChange={(e) => setModelForm({ ...modelForm, input_cost: e.target.value })}
                    placeholder="per 1K tokens"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Output Cost</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={modelForm.output_cost}
                    onChange={(e) => setModelForm({ ...modelForm, output_cost: e.target.value })}
                    placeholder="per 1K tokens"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Temperature (non-reasoning models)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="2"
                value={modelForm.temperature}
                onChange={(e) => setModelForm({ ...modelForm, temperature: e.target.value })}
                placeholder="e.g., 0.7"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reasoning Effort (o1 models)</label>
              <select
                value={modelForm.reasoning_effort}
                onChange={(e) => setModelForm({ ...modelForm, reasoning_effort: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">(none)</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
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
                {isSavingModel ? 'Saving...' : editingModel ? 'Save Changes' : 'Create Model'}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                <input
                  type="text"
                  value={sectionForm.year_term}
                  onChange={(e) => setSectionForm({ ...sectionForm, year_term: e.target.value })}
                  placeholder="e.g., Winter 2025"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
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
                            {sc.active ? (
                              <button
                                onClick={() => handleDeactivateSectionCase(managingSectionCases.section_id, sc.case_id)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              >
                                Active
                              </button>
                            ) : (
                              <button
                                onClick={() => handleActivateSectionCase(managingSectionCases.section_id, sc.case_id)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600"
                              >
                                Set Active
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveCaseFromSection(managingSectionCases.section_id, sc.case_id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Remove from section"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
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
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Default Persona</label>
                              <select
                                value={editingChatOptions.default_persona ?? 'moderate'}
                                onChange={(e) => setEditingChatOptions({...editingChatOptions, default_persona: e.target.value})}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value="moderate">Moderate</option>
                                <option value="strict">Strict</option>
                                <option value="liberal">Liberal</option>
                                <option value="leading">Leading</option>
                                <option value="sycophantic">Sycophantic</option>
                              </select>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Protagonist Name *</label>
                  <input
                    type="text"
                    value={caseForm.protagonist}
                    onChange={(e) => setCaseForm({ ...caseForm, protagonist: e.target.value })}
                    placeholder="e.g., Kent Beck"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initials *</label>
                  <input
                    type="text"
                    value={caseForm.protagonist_initials}
                    onChange={(e) => setCaseForm({ ...caseForm, protagonist_initials: e.target.value.toUpperCase().slice(0, 3) })}
                    placeholder="e.g., KB"
                    maxLength={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">For chat bubbles</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat Topic</label>
                <input
                  type="text"
                  value={caseForm.chat_topic}
                  onChange={(e) => setCaseForm({ ...caseForm, chat_topic: e.target.value })}
                  placeholder="e.g., Catering business strategy"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chat Question *</label>
                <textarea
                  value={caseForm.chat_question}
                  onChange={(e) => setCaseForm({ ...caseForm, chat_question: e.target.value })}
                  placeholder="The main question the protagonist asks the student..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
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
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowCaseModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCase}
                disabled={isSavingCase}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {isSavingCase ? 'Saving...' : editingCase ? 'Save Changes' : 'Create Case'}
              </button>
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
                {editingPersona ? 'Edit Persona' : 'Create New Persona'}
              </h3>
              <button
                onClick={() => setShowPersonaModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Persona ID *</label>
                  <input
                    type="text"
                    value={personaForm.persona_id}
                    onChange={(e) => setPersonaForm({ ...personaForm, persona_id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                    disabled={!!editingPersona}
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
                    placeholder="e.g., Friendly Mentor"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={personaForm.description}
                  onChange={(e) => setPersonaForm({ ...personaForm, description: e.target.value })}
                  placeholder="Brief description of this persona's behavior"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">AI Instructions *</label>
                <textarea
                  value={personaForm.instructions}
                  onChange={(e) => setPersonaForm({ ...personaForm, instructions: e.target.value })}
                  placeholder="Detailed instructions for the AI chatbot on how to behave with this persona..."
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
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
                    min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={personaForm.enabled}
                      onChange={(e) => setPersonaForm({ ...personaForm, enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Enabled (available for selection)
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowPersonaModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePersona}
                disabled={isSavingPersona}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {isSavingPersona ? 'Saving...' : editingPersona ? 'Save Changes' : 'Create Persona'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
