

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message, MessageRole, ConversationPhase, EvaluationResult, CEOPersona, Section, CaseChat, ChatStatus, RubricForPrompt } from './types';
import { createChatSession, getEvaluation } from './services/llmService';
import type { LLMChatSession } from './services/llmService';
import { CaseData, DEFAULT_CASE_DATA } from './constants';
import { api, getApiBaseUrl, refreshAuthToken } from './services/apiClient';
import BusinessCase from './components/BusinessCase';
import ChatWindow from './components/ChatWindow';
import MessageInput from './components/MessageInput';
import Evaluation from './components/Evaluation';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CaseWriterShell from './components/caseWriter/CaseWriterShell';
import ResizablePanes from './components/ResizablePanes';
import ScenarioSelector from './components/ScenarioSelector';
import ChatTimer from './components/ChatTimer';

interface Model {
    model_id: string;
    model_name: string;
    enabled?: boolean;
    default?: boolean;
    cpm_input?: number | null;
    cpm_output?: number | null;
}

const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
const DEFAULT_FONT_SIZE = 'text-base';

const isEnabledFlag = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

const isDisabledFlag = (value: unknown): boolean =>
  value === false || value === 0 || value === '0' || value === 'false';

/** Yes/no for feedback/transcript permission replies. Avoids substring false positives (e.g. includes('y') matches "today"). */
function isAffirmativeConsentReply(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (!lower) return false;

  if (
    /^\s*no\b/.test(lower) ||
    /\b(nope|nah|no thanks|no thank you|thanks,? no|not today|not now|not really|not interested|i'?d rather not|rather not|maybe later|another time|don'?t think so)\b/.test(lower) ||
    /\bi would(n'?t| not)\b/.test(lower) ||
    /\bi won'?t\b/.test(lower)
  ) {
    return false;
  }

  if (
    /\b(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|certainly)\b/.test(lower) ||
    /\bof course\b/.test(lower)
  ) {
    return true;
  }

  if (/\bi would\b/.test(lower)) {
    return true;
  }

  return /^\s*y\s*[!.]?\s*$/i.test(lower);
}

// Play a subtle double-beep sound to alert instructor of API errors
const playErrorSound = () => {
  const ctx = new AudioContext();
  [0, 0.12].forEach(delay => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + 0.08);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.08);
  });
};

const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.matchMedia(query).matches;
        }
        return false;
    });

    useEffect(() => {
        const media = window.matchMedia(query);
        const listener = () => setMatches(media.matches);
        media.addEventListener('change', listener);
        // Ensure the initial state is correct
        if (media.matches !== matches) {
            setMatches(media.matches);
        }
        return () => media.removeEventListener('change', listener);
    }, [matches, query]);

    return matches;
};

const App: React.FC = () => {
  // Common state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // View mode state
  const [isReady, setIsReady] = useState(false);
  const [view, setView] = useState<'student' | 'admin' | 'evaluation' | 'case-writer'>('student');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [viewingEvaluationId, setViewingEvaluationId] = useState<string | null>(null);
  const [viewingEvaluationData, setViewingEvaluationData] = useState<EvaluationResult | null>(null);
  const [isLoadingEvaluation, setIsLoadingEvaluation] = useState(false);
  
  // Student-specific state
  const [studentFirstName, setStudentFirstName] = useState<string | null>(null);
  const [studentDBId, setStudentDBId] = useState<string | null>(null);
  const [tempFirstName, setTempFirstName] = useState<string>('');
  const [tempLastName, setTempLastName] = useState<string>('');
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>('');
  const [otherSectionText, setOtherSectionText] = useState<string>('');
  const [ceoPersona, setCeoPersona] = useState<CEOPersona>(CEOPersona.MODERATE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatSession, setChatSession] = useState<LLMChatSession | null>(null);
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>(ConversationPhase.PRE_CHAT);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [helpfulScore, setHelpfulScore] = useState<number | null>(null);
  const [likedFeedback, setLikedFeedback] = useState<string | null>(null);
  const [improveFeedback, setImproveFeedback] = useState<string | null>(null);
  const [shareTranscript, setShareTranscript] = useState<boolean>(false);
  const [chatFontSize, setChatFontSize] = useState<string>('text-sm');
  const [caseFontSize, setCaseFontSize] = useState<string>('text-sm');
  const [hintsUsed, setHintsUsed] = useState<number>(0);
  const [currentCaseChatId, setCurrentCaseChatId] = useState<string | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(null);
  const [selectedSuperModel, setSelectedSuperModel] = useState<string | null>(null);
  const [activeCaseData, setActiveCaseData] = useState<CaseData | null>(null);
  const [isLoadingCase, setIsLoadingCase] = useState(false);
  
  // Chat options from section-case assignment (Phase 2)
  const [chatOptions, setChatOptions] = useState<any>(null);

  // Active rubric for evaluation
  const [activeRubric, setActiveRubric] = useState<RubricForPrompt | null>(null);

  // Position tracking state (using position IDs from scenario_positions table)
  const [selectedInitialPositionId, setSelectedInitialPositionId] = useState<number | null>(null);
  const [selectedFinalPositionId, setSelectedFinalPositionId] = useState<number | null>(null);
  const [awaitingPositionSelection, setAwaitingPositionSelection] = useState(false);
  
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
    allow_repeat: false,
    timeout_chat: false,
    allow_finish_button: false,
    restart_chat: false,
    allow_exit: false
  };

  // Available cases for selected section
  const [availableCases, setAvailableCases] = useState<any[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isLoadingAvailableCases, setIsLoadingAvailableCases] = useState(false);
  const [studentSavedSectionId, setStudentSavedSectionId] = useState<string | null>(null);
  const [enrolledSectionIds, setEnrolledSectionIds] = useState<string[]>([]);
  // Enabled status per enrolled section, sourced from my-sections (students can't hit the admin section API)
  const [enrolledSectionEnabledMap, setEnrolledSectionEnabledMap] = useState<Record<string, boolean>>({});
  const [hasFetchedStudentSection, setHasFetchedStudentSection] = useState(false);

  // Scenario support
  const [availableScenarios, setAvailableScenarios] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [scenarioSelectionMode, setScenarioSelectionMode] = useState<'student_choice' | 'all_required'>('student_choice');
  const [scenarioRequireOrder, setScenarioRequireOrder] = useState(false);
  const [useScenarios, setUseScenarios] = useState(false);
  
  // Case and scenario completion tracking
  const [caseCompletionStatus, setCaseCompletionStatus] = useState<Record<string, { completed: boolean; allowRechat: boolean }>>({});
  const [scenarioCompletionStatus, setScenarioCompletionStatus] = useState<Record<number, { completed: boolean; allowRechat: boolean }>>({});

  const isLargeScreen = useMediaQuery('(min-width: 1024px)');
  const direction = isLargeScreen ? 'vertical' : 'horizontal';
  const initialSize = isLargeScreen ? 33 : 50;

  // Proactive JWT refresh: on app boot, on window focus, and every 20 minutes.
  // Keeps a logged-in user from being bounced mid-session by the 12h TTL.
  useEffect(() => {
    refreshAuthToken();
    const onFocus = () => { refreshAuthToken(); };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => { refreshAuthToken(); }, 20 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    // Handles client-side routing and auth state
    const handleRouteChange = async () => {
        // Apply CAS callback params (token/role/fullName/email) from URL
        const casResult = api.auth.applyCasCallbackFromUrl();

        const { data: { session } } = await api.auth.getSession();
        setSessionUser(session?.user || null);
        const urlParams = new URLSearchParams(window.location.search);

        // If CAS delivered an admin token, immediately move to the admin view
        // even before the session fetch resolves. This avoids bouncing back to
        // the student login when the browser already holds a student token.
        if (casResult?.role === 'admin') {
            setView('admin');
            setIsAdminAuthenticated(true);
            // Preserve whatever session user we have; fall back to CAS payload fields.
            setSessionUser(prev => prev || {
              role: 'admin',
              email: casResult.email || session?.user?.email,
              full_name: casResult.fullName || session?.user?.full_name,
            } as any);
            if (window.location.hash !== '#/admin') {
                window.location.hash = '#/admin';
            }
        }

        // Check for evaluation view route: #evaluation/:id
        const evaluationMatch = window.location.hash.match(/^#evaluation\/([a-f0-9-]+)$/);
        if (evaluationMatch) {
            const evaluationId = evaluationMatch[1];
            setView('evaluation');
            setViewingEvaluationId(evaluationId);
            setIsLoadingEvaluation(true);

            // Fetch the evaluation data
            try {
                const response = await fetch(`${getApiBaseUrl()}/evaluations/${evaluationId}`);
                const result = await response.json();

                if (result.data) {
                    // Convert the API response to EvaluationResult format
                    const evalData: EvaluationResult = {
                        totalScore: result.data.score || 0,
                        summary: result.data.summary || '',
                        criteria: result.data.criteria || [],
                        hints: result.data.hints || 0
                    };
                    setViewingEvaluationData(evalData);
                } else {
                    console.error('Evaluation not found:', result.error);
                    setViewingEvaluationData(null);
                }
            } catch (err) {
                console.error('Error fetching evaluation:', err);
                setViewingEvaluationData(null);
            } finally {
                setIsLoadingEvaluation(false);
            }
            setIsReady(true);
            return;
        }

        // Use hash-based routing for robust SPA navigation.
        // Fallback to query param for AI Studio Preview compatibility.
        const hash = window.location.hash;
        if (hash === '#/admin' || hash.startsWith('#/admin') || urlParams.get('view') === 'admin') {
            setView('admin');
            setIsAdminAuthenticated(!!session && session.user?.role === 'admin');
        } else if (hash === '#/case-writer' || hash.startsWith('#/case-writer')) {
            setView('case-writer');
            setIsAdminAuthenticated(!!session && (session.user?.role === 'admin' || session.user?.role === 'instructor'));
        } else {
            setView('student');
        }
        setIsReady(true);
    };
    
    // On initial page load, always default to the student view.
    // If the URL hash points to the admin page, we clear it.
    // The 'hashchange' listener will then fire and call handleRouteChange,
    // which will correctly set the view to 'student'.
    if (window.location.hash === '#/admin') {
        window.location.hash = '';
    } else {
        // If the hash is not '#/admin', we can safely perform the initial render check.
        handleRouteChange();
    }

    // Listen for hash changes to handle subsequent navigation (e.g., back/forward buttons, ctrl+click)
    window.addEventListener('hashchange', handleRouteChange);
    
    // Cleanup listener on component unmount
    return () => {
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);
  
  useEffect(() => {
    const fetchSections = async () => {
        // Use public endpoint that doesn't require authentication
        const { data, error: fetchError } = await api.get<Section[]>('/sections/public');

        if (fetchError) {
            console.error('Error fetching sections:', fetchError);
            // Check if backend server is down (connection refused/failed to fetch)
            const errorMsg = fetchError.message || '';
            if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ECONNREFUSED') ||
                errorMsg.includes('NetworkError') || errorMsg.includes('fetch failed')) {
                setError('Backend server paused - please try again later.');
            } else {
                setError('Could not load course sections from the database.');
            }
        } else if (data) {
            // Sort by year_term descending, then section_title ascending
            const sorted = [...data].sort((a, b) => {
                const termCompare = (b.year_term || '').localeCompare(a.year_term || '');
                if (termCompare !== 0) return termCompare;
                return (a.section_title || '').localeCompare(b.section_title || '');
            });
            setSections(sorted);
            if (sorted.length === 0) {
                setSelectedSection('other');
            }
        }
    };
    
    const fetchModels = async () => {
        const { data, error: modelError } = await api
            .from('models')
            .select('model_id, model_name, default, enabled')
            .eq('enabled', true);
        
        if (modelError) {
            console.error('Error fetching models:', modelError);
            // Check if backend server is down
            const errorMsg = modelError.message || '';
            if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ECONNREFUSED') || 
                errorMsg.includes('NetworkError') || errorMsg.includes('fetch failed')) {
                setError('Backend server paused - please try again later.');
            } else {
                setError('Could not load AI models from the database.');
            }
        } else if (data) {
            setModels(data as Model[]);
            const defaultM = (data as any[]).find(m => m.default);
            let initialModelId = null;
            if (defaultM) {
                initialModelId = defaultM.model_id;
            } else if (data.length > 0) {
                initialModelId = (data as Model[])[0].model_id;
            }
            
            if (initialModelId) {
                setDefaultModel(initialModelId);
                setSelectedChatModel(initialModelId);
                setSelectedSuperModel(initialModelId);
            }
        }
    };

    if (view === 'student' && conversationPhase === ConversationPhase.PRE_CHAT) {
        fetchModels();
        fetchSections();
    }
  }, [conversationPhase, view]);

  // Ensure enrolled sections still appear even if the section is disabled (so the student's saved section shows up)
  useEffect(() => {
    const fetchMissingEnrolledSections = async () => {
      if (view !== 'student' || conversationPhase !== ConversationPhase.PRE_CHAT) return;
      if (enrolledSectionIds.length === 0) return;

      const missing = enrolledSectionIds.filter(
        (id) => !sections.some((s) => s.section_id === id)
      );
      if (missing.length === 0) return;

      try {
        const results = await Promise.all(
          missing.map((id) => api.get(`/sections/${id}`))
        );

        const found = results
          .map((res) => (res && !res.error ? res.data : null))
          .filter(Boolean);

        if (found.length > 0) {
          setSections((prev) => {
            const existing = new Set(prev.map((s) => s.section_id));
            const merged = [...prev];
            for (const sec of found as any[]) {
              if (!existing.has(sec.section_id)) {
                merged.push({
                  section_id: sec.section_id,
                  section_title: sec.section_title,
                  year_term: sec.year_term,
                  chat_model: sec.chat_model,
                  super_model: sec.super_model,
                  accept_new_students: sec.accept_new_students,
                  enabled: sec.enabled !== false && sec.enabled !== 0,
                });
              }
            }
            return merged;
          });
        }
      } catch (err) {
        console.error('Error fetching disabled sections:', err);
      }
    };

    fetchMissingEnrolledSections();
  }, [enrolledSectionIds, sections, view, conversationPhase]);

  // Fetch student's saved section(s) when they log in
  useEffect(() => {
    const fetchStudentSection = async () => {
      if (!sessionUser || sessionUser.role !== 'student' || hasFetchedStudentSection) return;

      try {
        // Try to get enrolled sections from junction table first
        const sectionsResponse = await api.get(`/student-sections/my-sections`);
        if (!sectionsResponse.error && sectionsResponse.data && sectionsResponse.data.length > 0) {
          const sectionIds = sectionsResponse.data.map((s: any) => s.section_id);
          setEnrolledSectionIds(sectionIds);
          // Store enabled status from the my-sections response (already has s.enabled via JOIN)
          const enabledMap: Record<string, boolean> = {};
          for (const s of sectionsResponse.data) {
            enabledMap[s.section_id] = s.enabled !== false && s.enabled !== 0;
          }
          setEnrolledSectionEnabledMap(enabledMap);
          // Set primary section as selected
          const primary = sectionsResponse.data.find((s: any) => s.is_primary);
          if (primary) {
            setStudentSavedSectionId(primary.section_id);
            setSelectedSection(primary.section_id);
          } else if (sectionIds.length > 0) {
            setStudentSavedSectionId(sectionIds[0]);
            setSelectedSection(sectionIds[0]);
          }
        } else {
          // Fall back to legacy section_id field
          const { data, error } = await api
            .from('students')
            .select('section_id')
            .eq('id', sessionUser.id)
            .single();

          if (!error && data && data.section_id && !data.section_id.startsWith('other:')) {
            setStudentSavedSectionId(data.section_id);
            setSelectedSection(data.section_id);
            setEnrolledSectionIds([data.section_id]);
          }
        }
      } catch (err) {
        console.error('Error fetching student section:', err);
      } finally {
        setHasFetchedStudentSection(true);
      }
    };

    if (sessionUser && conversationPhase === ConversationPhase.PRE_CHAT) {
      fetchStudentSection();
    }
  }, [sessionUser, conversationPhase, hasFetchedStudentSection]);

  // HMR/hot-reload recovery: if section IDs are already loaded but the enabled map is empty
  // (new state reset to {} by React on hot update), trigger a re-fetch.
  useEffect(() => {
    if (
      hasFetchedStudentSection &&
      enrolledSectionIds.length > 0 &&
      Object.keys(enrolledSectionEnabledMap).length === 0 &&
      sessionUser?.role === 'student'
    ) {
      setHasFetchedStudentSection(false);
    }
  }, [hasFetchedStudentSection, enrolledSectionIds, enrolledSectionEnabledMap, sessionUser]);

  // Fetch available cases for the selected section
  const fetchAvailableCases = async (sectionId: string) => {
    if (!sectionId || sectionId === 'other') {
      setAvailableCases([]);
      setSelectedCaseId(null);
      setSelectedScenarioId(null);
      return;
    }

    setIsLoadingAvailableCases(true);
    try {
      const { data, error } = await api.from(`sections/${sectionId}/cases`).select('*');

      if (error) {
        console.error('Error fetching section cases:', error);
        setAvailableCases([]);
      } else {
        // Filter to only show active cases
        const activeCases = (data || []).filter((c: any) => c.active && c.case_enabled !== false);
        setAvailableCases(activeCases);

        // Check completion status for each case and scenario
        if (sessionUser?.id && activeCases.length > 0) {
          const caseCompletionStatuses: Record<string, { completed: boolean; allowRechat: boolean }> = {};
          const scenarioCompletionStatuses: Record<number, { completed: boolean; allowRechat: boolean }> = {};

          for (const caseItem of activeCases) {
            try {
              // Check case-level completion
              const response = await fetch(`${getApiBaseUrl()}/evaluations/check-completion/${sessionUser.id}/${caseItem.case_id}`);
              const result = await response.json();
              if (result.data) {
                caseCompletionStatuses[caseItem.case_id] = {
                  completed: result.data.completed,
                  allowRechat: result.data.allow_rechat
                };
              }

              // Check scenario-level completion for each scenario
              if (caseItem.scenarios && caseItem.scenarios.length > 0) {
                for (const scenario of caseItem.scenarios) {
                  try {
                    const scenarioResponse = await fetch(
                      `${getApiBaseUrl()}/evaluations/check-completion/${sessionUser.id}/${caseItem.case_id}?scenario_id=${scenario.scenario_id}`
                    );
                    const scenarioResult = await scenarioResponse.json();
                    if (scenarioResult.data) {
                      scenarioCompletionStatuses[scenario.scenario_id] = {
                        completed: scenarioResult.data.completed,
                        allowRechat: scenarioResult.data.allow_rechat
                      };
                    }
                  } catch (e) {
                    console.error('Error checking scenario completion:', e);
                  }
                }
              }
            } catch (e) {
              console.error('Error checking completion:', e);
            }
          }
          setCaseCompletionStatus(caseCompletionStatuses);
          setScenarioCompletionStatus(scenarioCompletionStatuses);
        }

        // Build flattened list of available chats (scenarios)
        // Auto-select if only one scenario available across all cases
        const allScenarios: Array<{ caseId: string; scenarioId: number }> = [];
        for (const caseItem of activeCases) {
          if (caseItem.scenarios && caseItem.scenarios.length > 0) {
            for (const scenario of caseItem.scenarios) {
              allScenarios.push({ caseId: caseItem.case_id, scenarioId: scenario.scenario_id });
            }
          }
        }

        if (allScenarios.length === 1) {
          const { caseId, scenarioId } = allScenarios[0];
          setSelectedCaseId(caseId);
          setSelectedScenarioId(scenarioId);
        } else {
          setSelectedCaseId(null);
          setSelectedScenarioId(null);
        }
      }
    } catch (err) {
      console.error('Error fetching available cases:', err);
      setAvailableCases([]);
    } finally {
      setIsLoadingAvailableCases(false);
    }
  };

  // Fetch cases when section changes
  useEffect(() => {
    if (selectedSection && selectedSection !== 'other') {
      fetchAvailableCases(selectedSection);
    } else {
      setAvailableCases([]);
      setSelectedCaseId(null);
    }
  }, [selectedSection]);

  // Fetch case data when a case is selected from available cases
  useEffect(() => {
    const fetchSelectedCaseData = async () => {
      if (!selectedCaseId) {
        setActiveCaseData(null);
        setChatOptions(defaultChatOptions);
        setActiveRubric(null);
        setAvailableScenarios([]);
        setSelectedScenarioId(null);
        setUseScenarios(false);
        return;
      }

      // Find the selected case from available cases to get chat_options and scenarios
      const selectedCase = availableCases.find(c => c.case_id === selectedCaseId);
      if (selectedCase) {
        // Extract and set chat options
        const options = selectedCase.chat_options || defaultChatOptions;
        setChatOptions(options);

        // Fetch rubric for evaluation (use assigned rubric_id or default)
        try {
          const rubricUrl = selectedCase.rubric_id
            ? `${getApiBaseUrl()}/rubrics/${selectedCase.rubric_id}`
            : `${getApiBaseUrl()}/rubrics/default`;
          const rubricResponse = await fetch(rubricUrl);
          if (rubricResponse.ok) {
            const rubricResult = await rubricResponse.json();
            if (rubricResult.data) {
              setActiveRubric({
                criteria_prompt: rubricResult.data.criteria_prompt,
                additional_prompt: rubricResult.data.additional_prompt,
                total_points: rubricResult.data.total_points,
                rubric_id: rubricResult.data.rubric_id
              });
            }
          } else {
            console.warn('Could not fetch rubric, using default evaluation criteria');
            setActiveRubric(null);
          }
        } catch (rubricErr) {
          console.warn('Error fetching rubric:', rubricErr);
          setActiveRubric(null);
        }

        // Set default persona from chat options
        if (options.default_persona) {
          const personaMap: Record<string, CEOPersona> = {
            moderate: CEOPersona.MODERATE,
            strict: CEOPersona.STRICT,
            liberal: CEOPersona.LIBERAL,
            leading: CEOPersona.LEADING,
            sycophantic: CEOPersona.SYCOPHANTIC
          };
          setCeoPersona(personaMap[options.default_persona] || CEOPersona.MODERATE);
        }

        // Handle scenarios from the active-case response
        if (selectedCase.use_scenarios && selectedCase.scenarios?.length > 0) {
          setUseScenarios(true);
          setAvailableScenarios(selectedCase.scenarios);
          setScenarioSelectionMode(selectedCase.selection_mode || 'student_choice');
          setScenarioRequireOrder(selectedCase.require_order || false);

          // Auto-select first incomplete scenario in all_required mode
          if (selectedCase.selection_mode === 'all_required') {
            const firstIncomplete = selectedCase.scenarios.find((s: any) => !s.completed);
            if (firstIncomplete) {
              setSelectedScenarioId(firstIncomplete.scenario_id);
            }
          } else if (selectedCase.scenarios.length === 1) {
            // Auto-select if only one scenario
            setSelectedScenarioId(selectedCase.scenarios[0].scenario_id);
          }
        } else {
          setUseScenarios(false);
          setAvailableScenarios([]);
          setSelectedScenarioId(null);
        }
      }

      setIsLoadingCase(true);
      setError(null); // Clear any previous errors
      try {
        // Fetch case content from the API
        const caseResponse = await fetch(`${getApiBaseUrl()}/llm/case-data/${selectedCaseId}`);
        
        // Check if response is ok (status 200-299)
        if (!caseResponse.ok) {
          const errorText = await caseResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: { message: errorText || `HTTP ${caseResponse.status}` } };
          }
          console.error('Case data API error:', caseResponse.status, errorData);
          setActiveCaseData(null);
          setError(`Unable to load case content (HTTP ${caseResponse.status}): ${errorData.error?.message || 'Case files may be missing on server. Please check server logs.'}`);
          setIsLoadingCase(false);
          return;
        }
        
        const caseResult = await caseResponse.json();
        
        if (caseResult.data) {
          setActiveCaseData(caseResult.data as CaseData);
          setError(null); // Clear any previous errors on success
        } else {
          console.error('Could not fetch case content:', caseResult.error);
          setActiveCaseData(null);
          setError(`Unable to load case content: ${caseResult.error?.message || 'Case files may be missing on server. Please check server logs.'}`);
        }
      } catch (err) {
        console.error('Error fetching case data:', err);
        setActiveCaseData(null);
        setError(`Failed to load case data: ${err instanceof Error ? err.message : 'Network error. Please check your connection and try again.'}`);
      } finally {
        setIsLoadingCase(false);
      }
    };
    
    fetchSelectedCaseData();
  }, [selectedCaseId, availableCases]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (
      !isLoading &&
      conversationPhase !== ConversationPhase.FEEDBACK_COMPLETE &&
      lastMessage?.role === MessageRole.MODEL
    ) {
      inputRef.current?.focus();
    }
  }, [messages, isLoading, conversationPhase]);

  // Heartbeat effect: update last_activity every 30 seconds during active chat
  useEffect(() => {
    if (currentCaseChatId && conversationPhase === ConversationPhase.CHATTING) {
      // Start heartbeat
      heartbeatIntervalRef.current = setInterval(async () => {
        try {
          await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/activity`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          console.error('Heartbeat failed:', err);
        }
      }, 30000); // Every 30 seconds

      return () => {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      };
    }
  }, [currentCaseChatId, conversationPhase]);

  const startConversation = useCallback(async (name: string, persona: CEOPersona, modelId: string, studentId?: string) => {
    setIsLoading(true);
    setError(null);
    setHintsUsed(0);  // Reset hint counter at start of conversation
    try {
      // Use active case data or default
      let caseData = activeCaseData || DEFAULT_CASE_DATA;

      // If a scenario is selected, override case data with scenario-specific values
      if (selectedScenarioId && availableScenarios.length > 0) {
        const selectedScenario = availableScenarios.find(s => s.scenario_id === selectedScenarioId);
        if (selectedScenario) {
          // Start with scenario's arguments
          let argumentsFor = selectedScenario.arguments_for || undefined;
          let argumentsAgainst = selectedScenario.arguments_against || undefined;

          // If a position is selected and has position-specific arguments, use those instead
          if (selectedInitialPositionId && selectedScenario.positions?.length > 0) {
            const selectedPosition = selectedScenario.positions.find(
              (p: any) => p.position_id === selectedInitialPositionId
            );
            if (selectedPosition) {
              // Position-specific arguments override scenario arguments
              if (selectedPosition.arguments_for) {
                argumentsFor = selectedPosition.arguments_for;
              }
              if (selectedPosition.arguments_against) {
                argumentsAgainst = selectedPosition.arguments_against;
              }
            }
          }

          caseData = {
            ...caseData,
            protagonist: selectedScenario.protagonist,
            protagonist_initials: selectedScenario.protagonist_initials,
            protagonist_role: selectedScenario.protagonist_role || undefined,
            chat_topic: selectedScenario.chat_topic || undefined,
            chat_question: selectedScenario.chat_question,
            prompt_instructions: selectedScenario.prompt_instructions || undefined,
            arguments_for: argumentsFor,
            arguments_against: argumentsAgainst,
          };
          // Update activeCaseData so scenario values are available later (e.g., in final position UI)
          setActiveCaseData(caseData as CaseData);
        }
      }

      // Build first message using case protagonist and question
      const roleDescription = caseData.protagonist_role || 'the protagonist';
      const firstMessageContent = `Hello ${name}, I am ${caseData.protagonist}, ${roleDescription} of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
      const initialHistory: Message[] = [{ role: MessageRole.MODEL, content: firstMessageContent }];

      // Create chat session with case data for cache-optimized prompts
      const freeHints = chatOptions?.free_hints ?? 1;
      const chatbotPersonality = chatOptions?.chatbot_personality || undefined;
      const session = createChatSession(name, persona, modelId, initialHistory, caseData, { freeHints, chatbotPersonality }, studentId || studentDBId || undefined);
      setChatSession(session);
      setMessages(initialHistory);
      setConversationPhase(ConversationPhase.CHATTING);

      // Check if we need position selection in chat (for 'explicit' capture method)
      const activeCaseInfo = availableCases.find(c => c.case_id === selectedCaseId);
      const isPosTrackingEnabled = isEnabledFlag(activeCaseInfo?.position_tracking_enabled);
      const posCaptureMethod = activeCaseInfo?.position_capture_method || 'explicit';
      const selectedScenario = selectedScenarioId
        ? availableScenarios.find(s => s.scenario_id === selectedScenarioId)
        : null;
      const positionsAvailable = selectedScenario?.positions?.length > 0;

      if (isPosTrackingEnabled && posCaptureMethod === 'explicit' && positionsAvailable) {
        setAwaitingPositionSelection(true);
      } else {
        setAwaitingPositionSelection(false);
      }
    } catch (e) {
      console.error("Failed to start conversation:", e);
      setError("Failed to initialize the chat session. Please check your API key and refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, [activeCaseData, selectedScenarioId, availableScenarios, selectedInitialPositionId, availableCases, selectedCaseId, chatOptions]);
  
  const handleSendMessage = async (userMessage: string) => {
    if (conversationPhase === ConversationPhase.CHATTING) {
        // Start timer on first user message (only if there are exactly 1 message - the initial CEO greeting)
        if (currentCaseChatId && messages.length === 1) {
          try {
            await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/start-timer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (err) {
            console.error('Failed to start timer:', err);
          }
        }

        const lowerCaseMessage = userMessage.toLowerCase();
        if (lowerCaseMessage.includes("time is up") || lowerCaseMessage.includes("time's up") || lowerCaseMessage.includes("i would like to finish this chat conversation")) {
            // Check minimum exchanges requirement
            const minExchanges = chatOptions?.require_minimum_exchanges ?? 0;
            const userMessageCount = messages.filter(m => m.role === MessageRole.USER).length;
            if (minExchanges > 0 && userMessageCount < minExchanges) {
              const ceoWarning: Message = {
                role: MessageRole.MODEL,
                content: `I appreciate your time management, but we haven't had enough of a discussion yet. Let's continue our conversation a bit longer - I'd like to hear more of your analysis before we wrap up.`
              };
              setMessages(prev => [...prev, { role: MessageRole.USER, content: userMessage }, ceoWarning]);
              return;
            }
            const finalUserMessage: Message = { role: MessageRole.USER, content: userMessage };

            // Check chat options to determine next phase
            const askForFeedback = chatOptions?.ask_for_feedback ?? false;
            const askSaveTranscript = chatOptions?.ask_save_transcript ?? false;
            
            if (askForFeedback) {
                // Ask for feedback (existing behavior)
                const ceoPermissionRequest: Message = {
                    role: MessageRole.MODEL,
                    content: `${studentFirstName}, thank you for meeting with me. I am glad you were able to study this case and share your insights. I hope our conversation was challenging yet helpful. **Would you be willing to provide feedback by answering a few questions about our interaction?**`
                };
                setMessages(prev => [...prev, finalUserMessage, ceoPermissionRequest]);
                setConversationPhase(ConversationPhase.AWAITING_HELPFUL_PERMISSION);
            } else if (askSaveTranscript) {
                // Skip feedback, ask for transcript permission
                const ceoTranscriptRequest: Message = {
                    role: MessageRole.MODEL,
                    content: `${studentFirstName}, thank you for meeting with me. I am glad you were able to study this case and share your insights. **Would you be willing to let me pass this conversation transcript to the developers to help improve the simulated conversations for future students?** The conversation will be completely anonymized (your name will be removed).`
                };
                setMessages(prev => [...prev, finalUserMessage, ceoTranscriptRequest]);
                setConversationPhase(ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION);
            } else {
                // Skip both feedback and transcript permission
                const ceoFarewell: Message = {
                    role: MessageRole.MODEL,
                    content: `${studentFirstName}, thank you for meeting with me today. I am glad you were able to study this case and share your insights. I hope our conversation was challenging yet helpful. Click the button below to proceed to the evaluation.`
                };
                setMessages(prev => [...prev, finalUserMessage, ceoFarewell]);
                setConversationPhase(ConversationPhase.FEEDBACK_COMPLETE);
            }
            return;
        }
        
        // Check for hint request and enforce limit
        const isHintRequest = /\bhint\b/i.test(userMessage);
        const hintsAllowed = chatOptions?.hints_allowed ?? 3;
        
        if (isHintRequest && hintsUsed >= hintsAllowed) {
            // Hint limit reached - refuse the hint
            const newUserMessage: Message = { role: MessageRole.USER, content: userMessage };
            const refusalMessage: Message = {
                role: MessageRole.MODEL,
                content: hintsAllowed === 0 
                    ? "I'm sorry, but hints have been disabled for this conversation. Please try to work through this on your own using the case materials."
                    : `I'm sorry, but you've already used all ${hintsAllowed} of your allowed hints. You'll need to work through this on your own now.`
            };
            setMessages((prev) => [...prev, newUserMessage, refusalMessage]);
            return;
        }

        if (!chatSession) return;

        const newUserMessage: Message = { role: MessageRole.USER, content: userMessage };
        setMessages((prev) => [...prev, newUserMessage]);
        setIsLoading(true);
        setError(null);
        
        // Track hint usage
        if (isHintRequest) {
            setHintsUsed(prev => prev + 1);
        }

        try {
            // Clear any pending retry before making a new request
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
            const response = await chatSession.sendMessage({ message: userMessage });
            const modelMessage: Message = { role: MessageRole.MODEL, content: response.text };
            setMessages((prev) => [...prev, modelMessage]);

            // Auto-save transcript after each successful exchange
            if ((chatOptions?.auto_save_transcript ?? true) && currentCaseChatId) {
              const fullName = sessionUser?.full_name || studentFirstName || 'Student';
              const protagonistLabel = activeCaseData?.protagonist || 'CEO';
              const allMessages = [...messages, newUserMessage, modelMessage];
              const transcript = allMessages.map(msg => {
                const speaker = msg.role === MessageRole.USER ? fullName : protagonistLabel;
                return `${speaker}: ${msg.content}`;
              }).join('\n\n');
              fetch(`${getApiBaseUrl()}/transcripts/chat/${currentCaseChatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript }),
              }).catch(err => console.error('Auto-save transcript failed:', err));
            }
        } catch (e) {
            console.error("Failed to send message:", e);
            playErrorSound();
            setError("Sorry, there is a delay in AI model response. Please wait 30 seconds.");
            const errorMessage: Message = {
                role: MessageRole.MODEL,
                content: "Sorry, I have been interrupted for a moment taking care of another matter. Can you please hold on for about 30 seconds and I will get back with you.",
            };
            setMessages((prev) => [...prev, errorMessage]);
            
            // Schedule automatic retry after 25 seconds
            retryTimeoutRef.current = setTimeout(async () => {
                if (!chatSession) return;
                try {
                    const retryResponse = await chatSession.sendMessage({ message: userMessage });
                    // Success - remove the "interrupted" message and add success messages
                    setMessages((prev) => {
                        const withoutError = prev.slice(0, -1); // Remove the "interrupted" message
                        return [
                            ...withoutError,
                            { role: MessageRole.MODEL, content: "Thank you for your patience." },
                            { role: MessageRole.MODEL, content: retryResponse.text }
                        ];
                    });
                    setError(null);
                } catch (retryError) {
                    console.error("Retry failed:", retryError);
                    // Update the error message to indicate continued failure
                    setError("The AI model is still busy. Please wait 30 seconds and try again.");
                }
            }, 25000);
        } finally {
            setIsLoading(false);
        }
    } else if (conversationPhase === ConversationPhase.AWAITING_HELPFUL_PERMISSION) {
        const userReply: Message = { role: MessageRole.USER, content: userMessage };
        setMessages(prev => [...prev, userReply]);
        
        const affirmative = isAffirmativeConsentReply(userMessage);

        if (affirmative) {
            const ceoScoreRequest: Message = {
                role: MessageRole.MODEL,
                content: "Great! On a scale of 1 to 5, how helpful was our conversation in your thinking through this case situation? (1=not helpful, 5=extremely helpful)"
            };
            setMessages(prev => [...prev, ceoScoreRequest]);
            setConversationPhase(ConversationPhase.AWAITING_HELPFUL_SCORE);
        } else {
            // Student declined feedback - check if we should ask for transcript permission
            const askSaveTranscript = chatOptions?.ask_save_transcript ?? false;
            
            if (askSaveTranscript) {
                const ceoTranscriptRequest: Message = {
                    role: MessageRole.MODEL,
                    content: "It has been a delight talking with you today. **Would you be willing to let me pass this conversation transcript to the developers to help improve the simulated conversations for future students?** The conversation will be completely anonymized (your name will be removed). This would be **a big help** in developing this AI chat case teaching tool 😊."
                };
                setMessages(prev => [...prev, ceoTranscriptRequest]);
                setConversationPhase(ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION);
            } else {
                // Skip transcript permission
                const ceoFarewell: Message = {
                    role: MessageRole.MODEL,
                    content: "It has been a delight talking with you today. Click the button below to proceed to the evaluation."
                };
                setMessages(prev => [...prev, ceoFarewell]);
                setConversationPhase(ConversationPhase.FEEDBACK_COMPLETE);
            }
        }
    } else if (conversationPhase === ConversationPhase.AWAITING_HELPFUL_SCORE) {
        const userScoreReply: Message = { role: MessageRole.USER, content: userMessage };
        
        const numberMatch = userMessage.match(/\d(\.\d+)?/);
        let score: number | null = null;
        if (numberMatch && numberMatch[0]) {
            const parsedScore = parseFloat(numberMatch[0]);
            if (!isNaN(parsedScore) && parsedScore >= 1 && parsedScore <= 5) {
                score = parsedScore;
            }
        }
        setHelpfulScore(score);

        const ceoLikedRequest: Message = {
            role: MessageRole.MODEL,
            content: "Thank you. What did you **like most** about this simulated conversation?",
        };
        setMessages(prev => [...prev, userScoreReply, ceoLikedRequest]);
        setConversationPhase(ConversationPhase.AWAITING_LIKED_FEEDBACK);
    } else if (conversationPhase === ConversationPhase.AWAITING_LIKED_FEEDBACK) {
        const userLikedReply: Message = { role: MessageRole.USER, content: userMessage };
        setLikedFeedback(userMessage);

        const ceoImproveRequest: Message = {
            role: MessageRole.MODEL,
            content: "That's helpful. What way do you think this simulated conversation **might be improved**?",
        };
        setMessages(prev => [...prev, userLikedReply, ceoImproveRequest]);
        setConversationPhase(ConversationPhase.AWAITING_IMPROVE_FEEDBACK);
    } else if (conversationPhase === ConversationPhase.AWAITING_IMPROVE_FEEDBACK) {
        const userImproveReply: Message = { role: MessageRole.USER, content: userMessage };
        setImproveFeedback(userMessage);

        // Check if we should ask for transcript permission
        const askSaveTranscript = chatOptions?.ask_save_transcript ?? false;
        
        if (askSaveTranscript) {
            const ceoTranscriptRequest: Message = {
                role: MessageRole.MODEL,
                content: "It has been a delight talking with you today. **Would you be willing to let me pass this conversation transcript to the developers to help improve the simulated conversations for future students?** The conversation will be completely anonymized (your name will be removed). This would be **a big help** in developing this AI chat case teaching tool 😊.",
            };
            setMessages(prev => [...prev, userImproveReply, ceoTranscriptRequest]);
            setConversationPhase(ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION);
        } else {
            // Skip transcript permission
            const ceoFarewell: Message = {
                role: MessageRole.MODEL,
                content: "Thank you for your valuable feedback! Click the button below to proceed to the evaluation.",
            };
            setMessages(prev => [...prev, userImproveReply, ceoFarewell]);
            setConversationPhase(ConversationPhase.FEEDBACK_COMPLETE);
        }
    } else if (conversationPhase === ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION) {
        const userTranscriptReply: Message = { role: MessageRole.USER, content: userMessage };
        
        const affirmative = isAffirmativeConsentReply(userMessage);
        if (affirmative) {
            setShareTranscript(true);
        }

        const ceoGoodbyeMessage: Message = {
            role: MessageRole.MODEL,
            content: `Thank you for your time, ${studentFirstName}. Goodbye and have a nice day. I am going to turn this over to the AI Supervisor to give you feedback.`,
        };
        setMessages(prev => [...prev, userTranscriptReply, ceoGoodbyeMessage]);
        setConversationPhase(ConversationPhase.FEEDBACK_COMPLETE);
    }
  };

  const sanitizeFeedback = (text: string | null): string | null => {
    if (!text) return null;
    // Light sanitization to remove common SQL injection characters as a defense-in-depth measure.
    // The API backend uses parameterized queries for protection against SQL injection.
    return text.replace(/;/g, '').replace(/--/g, '');
  };

  // Save final position to case_chat when student selects it at chat end
  const handleFinalPositionSelect = async (positionId: number) => {
    setSelectedFinalPositionId(positionId);
    if (currentCaseChatId) {
      try {
        await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/final-position`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ final_position_id: positionId })
        });
      } catch (err) {
        console.error('Failed to save final position:', err);
      }
    }
  };

  // Handle initial position selection during chat (for 'explicit' capture method)
  const handleInitialPositionSelect = async (position: { position_id: number; position_name: string; position: string }) => {
    setSelectedInitialPositionId(position.position_id);
    setAwaitingPositionSelection(false);

    // Save position to database
    if (currentCaseChatId) {
      try {
        await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/initial-position`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initial_position_id: position.position_id })
        });
      } catch (err) {
        console.error('Failed to save initial position:', err);
      }
    }

    // Add position as user message and trigger AI response
    const userPositionMessage: Message = {
      role: MessageRole.USER,
      content: position.position
    };
    setMessages(prev => [...prev, userPositionMessage]);

    // Now send to LLM to get protagonist response acknowledging the position
    if (chatSession) {
      setIsLoading(true);
      try {
        const response = await chatSession.sendMessage(position.position);
        const modelMessage: Message = {
          role: MessageRole.MODEL,
          content: response.response.text(),
        };
        setMessages(prev => [...prev, modelMessage]);
      } catch (err) {
        console.error('Failed to get AI response:', err);
        const errorMessage: Message = {
          role: MessageRole.MODEL,
          content: "I appreciate your position. Could you elaborate on why you believe that?"
        };
        setMessages(prev => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleProceedToEvaluation = async () => {
    if (!studentFirstName || !selectedSuperModel) return;
    setConversationPhase(ConversationPhase.EVALUATION_LOADING);
    setError(null);
    try {
    const fullName = sessionUser?.full_name || `${studentFirstName}`;
    const protagonistLabel = activeCaseData?.protagonist || 'CEO';
    const result = await getEvaluation(messages, currentCaseChatId!, selectedSuperModel, protagonistLabel, activeRubric?.rubric_id);
      setEvaluationResult(result);
      
      if (studentDBId) {
        const sanitizedLiked = sanitizeFeedback(likedFeedback);
        const sanitizedImprove = sanitizeFeedback(improveFeedback);

        // Check if transcript should be saved (either by user permission or always_save_transcript setting)
        const alwaysSave = chatOptions?.always_save_transcript ?? false;
        const shouldSaveTranscript = shareTranscript || alwaysSave;

        let transcriptToSave: string | null = null;
        if (shouldSaveTranscript) {
          // Save the ORIGINAL transcript (NOT anonymized)
          // Anonymization happens at display time, not save time
          transcriptToSave = messages.map(msg => {
            const speaker = msg.role === MessageRole.USER ? fullName : 'CEO';
            return `${speaker}: ${msg.content}`;
          }).join('\n\n');
        }

        const finishedTimestamp = new Date();
        const mysqlTimestamp = finishedTimestamp.toISOString().slice(0, 19).replace('T', ' ');

        const { error: evaluationError } = await api
          .from('evaluations')
          .insert({
            student_id: studentDBId,
            case_id: selectedCaseId,
            case_chat_id: currentCaseChatId,
            score: result.totalScore,
            summary: result.summary,
            criteria: result.criteria,
            helpful: helpfulScore,
            liked: sanitizedLiked,
            improve: sanitizedImprove,
            super_model: selectedSuperModel,
            rubric_id: result.rubric_id || null,
          });

        if (evaluationError) {
          console.error("Error saving evaluation:", evaluationError);
        } else {
          // Save transcript separately to transcripts table (upsert — may already exist from auto-save)
          if (transcriptToSave && currentCaseChatId) {
            try {
              const transcriptResponse = await fetch(`${getApiBaseUrl()}/transcripts/chat/${currentCaseChatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transcript: transcriptToSave,
                  saved_with_permission: shouldSaveTranscript && shareTranscript
                })
              });
              if (!transcriptResponse.ok) {
                console.error("Error saving transcript:", await transcriptResponse.text());
              }
            } catch (transcriptError) {
              console.error("Error saving transcript:", transcriptError);
            }
          }

          // If evaluation is saved, try to update the student's finished_at timestamp
          const { error: studentUpdateError } = await api
            .from('students')
            .update({ finished_at: mysqlTimestamp })
            .eq('id', studentDBId);
          if (studentUpdateError) console.error("Error updating student finished_at timestamp:", studentUpdateError);
        }
      }
      setConversationPhase(ConversationPhase.EVALUATING);
    } catch (e: any) {
      console.error("Failed to get evaluation:", e);

      if (e?.code === 'EVAL_VALIDATION_FAILED' && currentCaseChatId) {
        // Mark the chat as needing instructor review
        try {
          await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'evaluation_failed' }),
          });
        } catch (statusErr) {
          console.error("Failed to update case_chat status:", statusErr);
        }
        setError("We were unable to generate your evaluation automatically. Your instructor will review your conversation and provide an evaluation at a later time.");
      } else {
        setError("Sorry, there was an error generating your performance review. Please try again.");
      }
      setConversationPhase(ConversationPhase.CHATTING);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionUser || sessionUser.role !== 'student') {
      setError('Please login with BYU CAS first.');
      return;
    }

    if (!selectedChatModel) return;

    setIsLoading(true);
    setError(null);

    const trimmedFirstName =
      (sessionUser.first_name && sessionUser.first_name.trim()) ||
      (sessionUser.full_name ? sessionUser.full_name.split(' ')[0] : '') ||
      sessionUser.email ||
      'Student';
    const trimmedLastName = sessionUser.last_name || '';
    const fullName =
      sessionUser.full_name ||
      `${trimmedFirstName}${trimmedLastName ? ` ${trimmedLastName}` : ''}`;
    
    let sectionToSave: string;
    if (selectedSection === '') {
        setError('Please select a course section.');
        setIsLoading(false);
        return;
    } else {
        sectionToSave = selectedSection;
    }
    
    // Validate case selection
    if (!selectedCaseId || !activeCaseData) {
        setError('Please select a case to chat about.');
        setIsLoading(false);
        return;
    }

    try {
      const { data, error: updateError } = await api
        .from('students')
        .update({
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
          full_name: fullName,
          favorite_persona: ceoPersona,
          section_id: sectionToSave,
        })
        .eq('id', sessionUser.id)
        .select('id')
        .single();

      if (updateError) {
        console.error("Error saving student to database:", updateError);
        setError("Could not connect to the database to save session. Please check your MySQL configuration.");
        setIsLoading(false);
        return;
      }

      const studentId = (data as any).id;
      setStudentDBId(studentId);
      setStudentFirstName(trimmedFirstName);

      // Create case_chat record to track this chat session
      try {
        const caseChatPayload: Record<string, any> = {
          student_id: studentId,
          case_id: selectedCaseId,
          section_id: sectionToSave,
          persona: ceoPersona,
          chat_model: selectedChatModel,
          scenario_id: selectedScenarioId || undefined,
        };

        // Include position_id if explicit capture method is enabled (from assignment-level settings)
        // Check assignment's position tracking settings (from active-case endpoint)
        const activeCaseInfo = availableCases.find(c => c.case_id === selectedCaseId);
        const isPosTrackingEnabled = isEnabledFlag(activeCaseInfo?.position_tracking_enabled);
        const posCaptureMethod = activeCaseInfo?.position_capture_method || 'explicit';

        if (isPosTrackingEnabled && posCaptureMethod === 'explicit' && selectedInitialPositionId) {
          caseChatPayload.initial_position_id = selectedInitialPositionId;
          caseChatPayload.position_method = 'explicit';
        }

        const caseChatResponse = await fetch(`${getApiBaseUrl()}/case-chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(caseChatPayload),
        });
        const caseChatResult = await caseChatResponse.json();
        if (caseChatResponse.status === 409 && caseChatResult?.error?.code === 'INSTRUCTOR_SETUP_INCOMPLETE') {
          setError(caseChatResult.error.message || "This section isn't ready yet — your instructor still needs to finish setup.");
          return;
        }
        if (caseChatResult.data?.id) {
          setCurrentCaseChatId(caseChatResult.data.id);
        }
      } catch (err) {
        console.error('Failed to create case_chat record:', err);
        // Continue anyway - chat tracking is optional
      }

      await startConversation(trimmedFirstName, ceoPersona, selectedChatModel, studentId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = () => {
    // Clear any pending retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    // Clear heartbeat interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    setStudentFirstName(null);
    setStudentDBId(null);
    setTempFirstName('');
    setTempLastName('');
    setMessages([]);
    setIsLoading(false);
    setChatSession(null);
    setError(null);
    setConversationPhase(ConversationPhase.PRE_CHAT);
    setEvaluationResult(null);
    setCeoPersona(CEOPersona.MODERATE);
    setCurrentCaseChatId(null);
    setSelectedInitialPositionId(null);
    setSelectedFinalPositionId(null);
    setAwaitingPositionSelection(false);
    // Keep section selected if student has a saved section
    if (!studentSavedSectionId) {
      setSelectedSection('');
    }
    setOtherSectionText('');
    setHelpfulScore(null);
    setSelectedCaseId(null);
    setActiveCaseData(null);
    setLikedFeedback(null);
    setImproveFeedback(null);
    setShareTranscript(false);
    setSelectedChatModel(defaultModel);
    setSelectedSuperModel(defaultModel);
    // Reset scenario state
    setAvailableScenarios([]);
    setSelectedScenarioId(null);
    setUseScenarios(false);
    setScenarioSelectionMode('student_choice');
    setScenarioRequireOrder(false);
  };

  const handleSectionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const sectionId = e.target.value;
      setSelectedSection(sectionId);
      // Reset case selection when section changes
      setSelectedCaseId(null);
      setActiveCaseData(null);
      setChatOptions(defaultChatOptions);
      // Reset scenario state
      setAvailableScenarios([]);
      setSelectedScenarioId(null);
      setUseScenarios(false);

      if (sectionId === 'other' || !sectionId) {
          setSelectedChatModel(defaultModel);
          setSelectedSuperModel(defaultModel);
      } else {
          const section = sections.find(s => s.section_id === sectionId);
          if (section) {
              setSelectedChatModel(section.chat_model || defaultModel);
              setSelectedSuperModel(section.super_model || defaultModel);
          }
      }

      // For multi-section students, persist the chosen section as primary in the DB
      const hasEnabledData = Object.keys(enrolledSectionEnabledMap).length > 0;
      const activeEnrolledIds = enrolledSectionIds.filter(id =>
        !hasEnabledData || enrolledSectionEnabledMap[id] !== false
      );
      if (activeEnrolledIds.length > 1 && enrolledSectionIds.includes(sectionId)) {
        try {
          const { error: patchError } = await api.patch('/student-sections/current', { section_id: sectionId });
          if (patchError) {
            console.error('Error setting current section:', patchError.message);
          } else {
            setStudentSavedSectionId(sectionId);
          }
        } catch (err) {
          console.error('Error setting current section:', err);
        }
      }
  };

  const handleAdminLogin = async () => {
    setIsAdminAuthenticated(true);
    // Fetch the admin user session data
    try {
      const { data: { session } } = await api.auth.getSession();
      setSessionUser(session?.user || null);
    } catch (error) {
      console.error('Failed to fetch admin session:', error);
    }
  };

  const handleAdminLogout = async () => {
    await api.auth.signOut();
    setIsAdminAuthenticated(false);
    setSessionUser(null);
    // Redirect to student view after logout
    window.location.hash = '';
  };

  const handleStudentLogout = async () => {
    await api.auth.signOut();
    setSessionUser(null);
    handleRestart();
  };

  const handleExitChat = async () => {
    if (!confirm('Are you sure you want to cancel this chat? Your progress will be lost and you may need to start over.')) return;

    // Mark the chat as canceled
    if (currentCaseChatId) {
      try {
        await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'canceled' })
        });
      } catch (err) {
        console.error('Error canceling chat:', err);
      }
    }

    // Reset to the pre-chat state
    handleRestart();
  };

  const handleRestartChat = async () => {
    if (!confirm('Are you sure you want to restart this chat? All your current progress will be lost.')) return;

    // Mark the current chat as canceled
    if (currentCaseChatId) {
      try {
        await fetch(`${getApiBaseUrl()}/case-chats/${currentCaseChatId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'canceled' })
        });
      } catch (err) {
        console.error('Error canceling chat:', err);
      }
    }

    // Clear heartbeat interval
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Reset messages and restart the conversation with the same settings
    setMessages([]);
    setIsLoading(false);
    setChatSession(null);
    setError(null);
    setConversationPhase(ConversationPhase.PRE_CHAT);
    setCurrentCaseChatId(null);
    setHintsUsed(0);

    // Immediately start a new conversation with the same settings
    if (studentFirstName && selectedChatModel) {
      await startConversation(studentFirstName, ceoPersona, selectedChatModel, studentDBId || undefined);
    }
  };

  const handleFinishChat = () => {
    if (!confirm('Are you finished with this conversation? Would you like to wrap up so that your chat results can be recorded?')) return;
    
    // Send the finish message which will trigger the "time is up" flow
    handleSendMessage("I would like to finish this chat conversation");
  };

  if (!isReady) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  // Evaluation view mode - for viewing evaluations from admin links
  if (view === 'evaluation') {
    if (isLoadingEvaluation) {
      return <div className="flex items-center justify-center min-h-screen">Loading evaluation...</div>;
    }

    if (!viewingEvaluationData) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="text-red-600 mb-4">Evaluation not found</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Close Window
          </button>
        </div>
      );
    }

    return (
      <Evaluation
        result={viewingEvaluationData}
        studentName="Student"
        onRestart={() => window.close()}
        superModelName={null}
        onLogout={() => window.close()}
        onTitleContextNav={() => window.close()}
      />
    );
  }

  if (view === 'admin') {
    if (isAdminAuthenticated) {
      return <Dashboard onLogout={handleAdminLogout} user={sessionUser as any} />;
    }
    return <Login onLoginSuccess={handleAdminLogin} />;
  }

  if (view === 'case-writer') {
    if (isAdminAuthenticated) {
      return <CaseWriterShell onLogout={handleAdminLogout} user={sessionUser as any} />;
    }
    return <Login onLoginSuccess={handleAdminLogin} />;
  }

  // --- Student View Rendering ---

  const displayFullName = (sessionUser?.full_name ||
    `${sessionUser?.first_name || ''} ${sessionUser?.last_name || ''}`.trim()) || sessionUser?.email || 'Student';
  const displayUsername = sessionUser?.email || sessionUser?.id || '';
  const logoutButton = sessionUser ? (
    <button
      onClick={handleStudentLogout}
      className="fixed top-4 right-4 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      Logout
    </button>
  ) : null;

  if (!sessionUser || sessionUser.role !== 'student') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-200">
        <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl">
          <div className="text-center">
            <h1
              className="text-3xl font-bold text-gray-900"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open('#/admin', 'admin');
                }
              }}
            >
              Make The Case
            </h1>
            <p className="mt-2 text-gray-600">
              Click below to sign in with your BYU NetID to chat with cases as assigned by your instructor.
            </p>
          </div>
          <div className="space-y-4">
            <button
              onClick={() => api.auth.beginCasLogin('student')}
              className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Click to login with BYU NetID
            </button>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (conversationPhase === ConversationPhase.PRE_CHAT) {
    const isSectionValid = selectedSection !== '' && selectedSection !== 'other';
    const selectedCaseStatus = selectedCaseId ? caseCompletionStatus[selectedCaseId] : null;
    // Check if case is completed and repeating is NOT allowed
    // Allow repeat if: allow_repeat is true OR allow_rechat is true
    const allowRepeat = chatOptions?.allow_repeat ?? false;
    const isCaseCompleted = selectedCaseStatus?.completed && !selectedCaseStatus?.allowRechat && !allowRepeat;
    // Check if scenario selection is required and valid
    const scenarioRequirementMet = !useScenarios || selectedScenarioId !== null;
    const allScenariosCompleted = useScenarios && availableScenarios.length > 0 && availableScenarios.every((s: any) => s.completed);

    // Get selected scenario (if scenarios enabled)
    const selectedScenario = selectedScenarioId
      ? availableScenarios.find((s: any) => s.scenario_id === selectedScenarioId)
      : null;

    // Position tracking settings from assignment level (section_cases table)
    // These come from the active-case endpoint response
    const activeCaseInfo = availableCases.find(c => c.case_id === selectedCaseId);
    const isPositionTrackingEnabled = isEnabledFlag(activeCaseInfo?.position_tracking_enabled);
    const positionCaptureMethod = activeCaseInfo?.position_capture_method || 'explicit';
    const trackPositionChange = !isDisabledFlag(activeCaseInfo?.track_position_change);

    // Available positions come from the selected scenario's positions array
    const availablePositions = selectedScenario?.positions || [];

    // Position selection happens IN CHAT for 'explicit' method, so no pre-chat requirement
    // For 'explicit' method: positions are selected after protagonist greeting in the chat
    const positionRequirementMet = true;
    const canStartChat = isSectionValid && selectedCaseId && activeCaseData && !isLoadingCase && !isCaseCompleted && scenarioRequirementMet && !allScenariosCompleted && positionRequirementMet;
    const sectionName = sections.find(s => s.section_id === selectedSection)?.section_title || selectedSection;

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-200 relative">
        {logoutButton}
        <div className="w-full max-w-lg p-8 space-y-6 bg-white rounded-2xl shadow-xl">
          <div className="text-center">
            <h1
              className="text-3xl font-bold text-gray-900"
              title="admin"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open('#/admin', 'admin');
                }
              }}
            >
              Make The Case
            </h1>
            <p className="mt-2 text-gray-600">
              Welcome <span className="font-semibold">{sessionUser?.first_name || displayFullName.split(' ')[0]}</span>! This tool allows you to chat with an AI simulated protagonist from a case you have studied.
            </p>
          </div>
          <form onSubmit={handleNameSubmit} className="space-y-5">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-gray-800">
                Signed in as <span className="font-semibold">{displayFullName}{displayUsername ? ` (${displayUsername})` : ''}</span>
              </p>
            </div>
            
            {/* Section Selection */}
            {(() => {
              // Use the enabled map populated from my-sections (authoritative for students).
              // If the map is not yet loaded, default all to active (brief pre-load state).
              const hasEnabledData = Object.keys(enrolledSectionEnabledMap).length > 0;
              const activeEnrolledIds = enrolledSectionIds.filter(id =>
                !hasEnabledData || enrolledSectionEnabledMap[id] !== false
              );
              const disabledEnrolledCount = hasEnabledData
                ? enrolledSectionIds.filter(id => enrolledSectionEnabledMap[id] === false).length
                : 0;
              // isMultiActive: only true when 2+ active enrolled sections exist in sections list
              // (gating on sections state avoids a brief flash before sections load).
              const activeInSections = sections.filter(sec => activeEnrolledIds.includes(sec.section_id));
              const isMultiActive = activeInSections.length > 1;
              const isSectionLocked = !isMultiActive && !!studentSavedSectionId;
              return (
                <div>
                  <label htmlFor="section" className="block text-sm font-medium text-gray-700">Your Course Section</label>
                  {isMultiActive ? (
                    <p className="text-xs text-blue-600 mt-1">
                      You are enrolled in {activeEnrolledIds.length} active course sections. Choose one:
                      {disabledEnrolledCount > 0 && (
                        <span className="text-gray-500 ml-1">
                          (Also enrolled in {disabledEnrolledCount} disabled section{disabledEnrolledCount > 1 ? 's' : ''}.)
                        </span>
                      )}
                    </p>
                  ) : disabledEnrolledCount > 0 && enrolledSectionIds.length > 1 ? (
                    <p className="text-xs text-gray-500 mt-1">
                      Also enrolled in {disabledEnrolledCount} disabled section{disabledEnrolledCount > 1 ? 's' : ''}.
                    </p>
                  ) : null}
                  <select
                    id="section"
                    value={selectedSection}
                    onChange={handleSectionChange}
                    disabled={isSectionLocked}
                    className={`w-full px-4 py-2 mt-1 text-gray-900 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 ${
                      isSectionLocked ? 'bg-gray-200 cursor-not-allowed' : 'bg-gray-100'
                    }`}
                  >
                    <option value="" disabled>Select your course section...</option>
                    {sections
                      .filter(sec =>
                        isMultiActive
                          ? activeEnrolledIds.includes(sec.section_id)
                          : enrolledSectionIds.includes(sec.section_id) || sec.accept_new_students
                      )
                      .map((sec) => (
                        <option key={sec.section_id} value={sec.section_id}>
                          {sec.section_title} ({sec.year_term}){enrolledSectionIds.includes(sec.section_id) ? ' ✓' : ''}
                        </option>
                      ))}
                  </select>
                  {isSectionLocked && studentSavedSectionId && selectedSection === studentSavedSectionId && (
                    <p className="mt-1 text-xs text-green-600">✓ Previously selected section (contact instructor to change)</p>
                  )}
                </div>
              );
            })()}

            {/* Remember Section Button - shown when section selected but not yet enrolled */}
            {selectedSection && !enrolledSectionIds.includes(selectedSection) && !studentSavedSectionId && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.post('/student-sections/enroll', {
                      student_id: sessionUser?.id,
                      section_id: selectedSection
                    });
                    setEnrolledSectionIds([...enrolledSectionIds, selectedSection]);
                    setStudentSavedSectionId(selectedSection);
                  } catch (err) {
                    console.error('Error saving section:', err);
                  }
                }}
                className="w-full px-4 py-3 text-white bg-pink-500 hover:bg-pink-600 rounded-lg font-medium transition-colors"
              >
                Click here to remember your course section
              </button>
            )}

            {/* Available Case Chats (Scenarios) for Section */}
            {isSectionValid && (
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Available case chats for {sectionName}:
                  </label>
                  <button
                    type="button"
                    onClick={() => fetchAvailableCases(selectedSection)}
                    disabled={isLoadingAvailableCases}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${isLoadingAvailableCases ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                    Refresh
                  </button>
                </div>

                {isLoadingAvailableCases ? (
                  <div className="text-center py-3 text-gray-500 text-sm">Loading available case chats...</div>
                ) : (() => {
                  // Flatten cases and scenarios into a single list
                  const availableChats: Array<{
                    caseItem: any;
                    scenario: any;
                    key: string;
                  }> = [];

                  for (const caseItem of availableCases) {
                    if (caseItem.scenarios && caseItem.scenarios.length > 0) {
                      for (const scenario of caseItem.scenarios) {
                        availableChats.push({
                          caseItem,
                          scenario,
                          key: `${caseItem.case_id}-${scenario.scenario_id}`
                        });
                      }
                    }
                  }

                  if (availableChats.length === 0) {
                    return (
                      <div className="text-center py-3 text-gray-500 text-sm bg-yellow-50 border border-yellow-200 rounded-lg">
                        Currently no available case chats for this section. Please check back later or contact your instructor.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {availableChats.map(({ caseItem, scenario, key }) => {
                        // Check scenario-level completion
                        const scenarioStatus = scenarioCompletionStatus[scenario.scenario_id];
                        const isCompleted = scenarioStatus?.completed && !scenarioStatus?.allowRechat;
                        const canRechat = scenarioStatus?.completed && scenarioStatus?.allowRechat;

                        // Check case-level scheduling availability
                        const checkAvailability = () => {
                          const now = new Date();
                          if (caseItem.manual_status === 'manually_opened') {
                            return { available: true, message: null };
                          }
                          if (caseItem.manual_status === 'manually_closed') {
                            return { available: false, message: 'This case has been manually closed by the instructor.' };
                          }
                          if (caseItem.open_date && new Date(caseItem.open_date) > now) {
                            return {
                              available: false,
                              message: `Opens ${new Date(caseItem.open_date).toLocaleString()}`
                            };
                          }
                          if (caseItem.close_date && new Date(caseItem.close_date) < now) {
                            return {
                              available: false,
                              message: `Closed ${new Date(caseItem.close_date).toLocaleString()}`
                            };
                          }
                          return { available: true, message: null };
                        };

                        const availability = checkAvailability();
                        const isDisabled = isCompleted || !availability.available;
                        const isSelected = selectedCaseId === caseItem.case_id && selectedScenarioId === scenario.scenario_id;

                        const protagonistRole = scenario.protagonist_role ? ` (${scenario.protagonist_role})` : '';

                        return (
                          <div key={key}>
                            <label
                              className={`flex items-start p-3 rounded-lg border transition-colors ${
                                isDisabled
                                  ? 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-75'
                                  : isSelected
                                    ? 'bg-blue-50 border-blue-300 cursor-pointer'
                                    : 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer'
                              }`}
                            >
                              <input
                                type="radio"
                                name="selectedScenario"
                                value={key}
                                checked={isSelected}
                                onChange={() => {
                                  if (!isDisabled) {
                                    setSelectedCaseId(caseItem.case_id);
                                    setSelectedScenarioId(scenario.scenario_id);
                                  }
                                }}
                                disabled={isDisabled}
                                className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 disabled:opacity-50"
                              />
                              <div className="ml-3 flex-1">
                                <div className="flex items-center justify-between">
                                  <span className={`block font-medium ${isCompleted ? 'text-green-800' : 'text-gray-900'}`}>
                                    {caseItem.case_title}
                                  </span>
                                  {isCompleted && (
                                    <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">
                                      ✓ Completed
                                    </span>
                                  )}
                                  {canRechat && (
                                    <span className="text-xs font-medium text-orange-700 bg-orange-100 px-2 py-0.5 rounded">
                                      Re-chat Available
                                    </span>
                                  )}
                                  {!availability.available && !isCompleted && (
                                    <span className="text-xs font-medium text-gray-600 bg-gray-200 px-2 py-0.5 rounded">
                                      Not Available
                                    </span>
                                  )}
                                </div>
                                <span className="block text-sm text-gray-600 mt-0.5">
                                  Chat with {scenario.protagonist}{protagonistRole} about {scenario.chat_topic}.
                                </span>
                                {!availability.available && availability.message && (
                                  <span className="block text-xs text-amber-600 mt-1">
                                    {availability.message}
                                  </span>
                                )}
                              </div>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {isLoadingCase && selectedCaseId && (
                  <p className="mt-2 text-xs text-gray-500">Loading case content...</p>
                )}
              </div>
            )}

            {/* Protagonist Personality */}
            {selectedCaseId && activeCaseData && (
              <div>
                <label htmlFor="ceoPersona" className="block text-sm font-medium text-gray-700">Protagonist Personality</label>
                <p className="mt-1 text-xs text-gray-500">Determines how strictly the protagonist requires you to cite case facts.</p>
                <select id="ceoPersona" value={ceoPersona} onChange={(e) => setCeoPersona(e.target.value as CEOPersona)} className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                    {/* Filter personas based on allowed_personas from chat options */}
                    {(() => {
                      const allowedList = (chatOptions?.allowed_personas || 'moderate,strict,liberal,leading,sycophantic').split(',').map((p: string) => p.trim().toLowerCase());
                      const personaOptions = [
                        { value: CEOPersona.MODERATE, label: 'Moderate (Recommended)', key: 'moderate' },
                        { value: CEOPersona.STRICT, label: 'Strict', key: 'strict' },
                        { value: CEOPersona.LIBERAL, label: 'Liberal', key: 'liberal' },
                        { value: CEOPersona.LEADING, label: 'Leading', key: 'leading' },
                        { value: CEOPersona.SYCOPHANTIC, label: 'Sycophantic', key: 'sycophantic' },
                      ];
                      return personaOptions
                        .filter(p => allowedList.includes(p.key))
                        .map(p => <option key={p.value} value={p.value}>{p.label}</option>);
                    })()}
                </select>
              </div>
            )}

            {/* Position selection for 'explicit' method now happens IN the chat after protagonist greeting */}

            <p className="text-xs text-gray-500 italic px-2">Disclosure: Some courses and cases allow you to share your chat conversation with the instructor to track progress and improve the dialog for future students.</p>
            
            {error && (
              <div className="p-4 bg-red-50 border-2 border-red-300 rounded-lg">
                <p className="text-sm font-semibold text-red-800 mb-1">⚠️ Error Loading Case</p>
                <p className="text-sm text-red-700">{error}</p>
                <p className="text-xs text-red-600 mt-2">Please check the browser console (F12) for more details, or contact your instructor.</p>
              </div>
            )}
            
            {selectedCaseId && !activeCaseData && !isLoadingCase && !error && (
              <p className="text-sm text-orange-600 p-3 bg-orange-50 rounded-lg border border-orange-200">
                ⚠️ Case content failed to load. Please refresh the page or contact your instructor if the problem persists.
              </p>
            )}
            
            <button
              type="submit"
              disabled={isLoading || !canStartChat}
              className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Initializing...' : !isSectionValid ? 'Select Your Section' : !selectedCaseId ? 'Select a Case' : isCaseCompleted ? 'Case Already Completed' : !activeCaseData ? 'Loading Case...' : allScenariosCompleted ? 'All Scenarios Completed' : useScenarios && !selectedScenarioId ? 'Select a Scenario' : !positionRequirementMet ? 'Select Your Position' : 'Start Chat'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const chatModelName = models.find(m => m.model_id === selectedChatModel)?.model_name || selectedChatModel;
  const superModelName = models.find(m => m.model_id === selectedSuperModel)?.model_name || selectedSuperModel;

  // Check if case content should be shown (defaults to true if not specified)
  const showCaseContent = chatOptions?.show_case !== false;

  // Chat panel content - reused for both layouts
  const chatPanel = (
    <aside className="w-full h-full flex flex-col bg-gray-200 rounded-xl shadow-lg">
      {error && <div className="p-4 bg-red-500 text-white text-center font-semibold rounded-t-xl">{error}</div>}
      {currentCaseChatId && (chatOptions?.show_timer !== false) && (
        <div className="flex justify-end px-3 py-1 mt-12">
          <ChatTimer
            chatId={currentCaseChatId}
            warningMinutes={5}
            onTimeUp={() => {
              // Auto-submit "time is up" when timer expires (only if timeout_chat is enabled)
              if (chatOptions?.timeout_chat) {
                handleSendMessage("time is up");
              }
            }}
          />
        </div>
      )}
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        ceoPersona={ceoPersona}
        chatModelName={chatModelName}
        chatFontSize={chatFontSize}
        protagonistName={activeCaseData?.protagonist}
        protagonistInitials={activeCaseData?.protagonist_initials}
        caseTitle={activeCaseData?.case_title}
        awaitingPositionSelection={awaitingPositionSelection && conversationPhase === ConversationPhase.CHATTING}
        positionOptions={(() => {
          const selectedScenario = selectedScenarioId
            ? availableScenarios.find(s => s.scenario_id === selectedScenarioId)
            : null;
          return selectedScenario?.positions || [];
        })()}
        onPositionSelect={handleInitialPositionSelect}
      />
      {conversationPhase === ConversationPhase.FEEDBACK_COMPLETE ? (
          (() => {
            // Get position tracking settings for final position selection
            const activeCaseInfo = availableCases.find(c => c.case_id === selectedCaseId);
            const isPosTrackingEnabled = isEnabledFlag(activeCaseInfo?.position_tracking_enabled);
            const trackPosChange = !isDisabledFlag(activeCaseInfo?.track_position_change);
            const selectedScenario = selectedScenarioId
              ? availableScenarios.find((s: any) => s.scenario_id === selectedScenarioId)
              : null;
            const finalPositions = selectedScenario?.positions || [];
            const shouldShowFinalPosition = isPosTrackingEnabled && trackPosChange && finalPositions.length > 0;
            const canProceed = !shouldShowFinalPosition || selectedFinalPositionId !== null;

            return (
              <div className="p-4 bg-white border-t border-gray-200 space-y-4">
                {/* Final Position Selection - shown when position tracking enabled with change tracking */}
                {shouldShowFinalPosition && (() => {
                  const protagonistName = activeCaseData?.protagonist || 'the protagonist';
                  const chatQuestion = activeCaseData?.chat_question || '';
                  const initialPositionText = selectedInitialPositionId
                    ? finalPositions.find((p: any) => p.position_id === selectedInitialPositionId)?.position
                    : null;

                  return (
                    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                      <div className="text-sm text-gray-700 mb-3 space-y-2">
                        <p>{protagonistName}'s original inquiry was: <strong>{chatQuestion}</strong></p>
                        {initialPositionText && (
                          <p>Your initial position on this was: {initialPositionText}</p>
                        )}
                        <p>Has your position changed based on this simulated conversation with {protagonistName}?<br />What is your <strong>final position</strong> on this issue? (click one)</p>
                      </div>
                      <div className="flex flex-col gap-2 items-start">
                        {finalPositions.map((pos: { position_id: number; position_name: string; position: string }) => (
                          <button
                            key={pos.position_id}
                            type="button"
                            onClick={() => handleFinalPositionSelect(pos.position_id)}
                            className={`px-4 py-3 text-left text-sm rounded-lg transition-colors ${
                              selectedFinalPositionId === pos.position_id
                                ? 'bg-green-600 text-white'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-green-100'
                            }`}
                          >
                            {pos.position}
                          </button>
                        ))}
                      </div>
                      {selectedInitialPositionId && selectedFinalPositionId && selectedInitialPositionId !== selectedFinalPositionId && (
                        <p className="text-xs text-green-600 mt-3">
                          Your position changed from the start of the conversation.
                        </p>
                      )}
                      {selectedInitialPositionId && selectedFinalPositionId && selectedInitialPositionId === selectedFinalPositionId && (
                        <p className="text-xs text-gray-600 mt-3">
                          It sounds like your position is the same as you started with.
                        </p>
                      )}
                    </div>
                  );
                })()}
                <div className="flex justify-center items-center">
                  <button
                      onClick={handleProceedToEvaluation}
                      disabled={!canProceed}
                      className={`px-6 py-3 font-semibold rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                        canProceed
                          ? 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-500 animate-pulse'
                          : 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      }`}
                  >
                      {!canProceed ? 'Select your final position to continue' : 'Click here to engage the AI Supervisor'}
                  </button>
                </div>
              </div>
            );
          })()
      ) : (
          <>
            {/* Chat control buttons */}
            {conversationPhase === ConversationPhase.CHATTING && (chatOptions?.allow_finish_button || chatOptions?.allow_exit || chatOptions?.restart_chat) && (
              <div className="px-4 py-2 bg-white border-t border-gray-200 flex gap-2 justify-end">
                {chatOptions?.allow_finish_button && (() => {
                  const minExchanges = chatOptions?.require_minimum_exchanges ?? 0;
                  const userMessageCount = messages.filter(m => m.role === MessageRole.USER).length;
                  const meetsMinimum = minExchanges === 0 || userMessageCount >= minExchanges;
                  const isDisabled = !meetsMinimum || isLoading;
                  const tooltipText = !meetsMinimum 
                    ? `You need at least ${minExchanges} exchange${minExchanges !== 1 ? 's' : ''} before you can finish (currently ${userMessageCount})`
                    : 'End the chat and get your evaluation';
                  
                  return (
                    <button
                      onClick={handleFinishChat}
                      disabled={isDisabled}
                      title={tooltipText}
                      className="px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Finish Chat
                    </button>
                  );
                })()}
                {chatOptions?.restart_chat && (
                  <button
                    onClick={handleRestartChat}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Restart Chat
                  </button>
                )}
                {chatOptions?.allow_exit && (
                  <button
                    onClick={handleExitChat}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel Chat
                  </button>
                )}
              </div>
            )}
            {/* Position Selection prompt - shown while awaiting position selection */}
            {awaitingPositionSelection && conversationPhase === ConversationPhase.CHATTING ? (
              <div className="p-4 bg-blue-50 border-t border-blue-200">
                <p className="text-sm font-medium text-gray-700 text-center">
                  Please select your initial position from the options above to continue the conversation.
                </p>
              </div>
            ) : (
              <MessageInput
                ref={inputRef}
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
                chatFontSize={chatFontSize}
                onFontSizeChange={setChatFontSize}
                fontSizes={FONT_SIZES}
                defaultFontSize={DEFAULT_FONT_SIZE}
                maxMessageLength={chatOptions?.max_message_length ?? 0}
              />
            )}
          </>
      )}
    </aside>
  );

  const studentShell = (
    <div className="h-screen w-screen p-4 lg:p-6 font-sans bg-gray-100 overflow-hidden relative">
      {logoutButton}
      {showCaseContent ? (
        <ResizablePanes direction={direction} initialSize={initialSize}>
          <div className="w-full h-full">
            <BusinessCase 
              fontSize={caseFontSize} 
              onFontSizeChange={setCaseFontSize}
              fontSizes={FONT_SIZES}
              defaultFontSize={DEFAULT_FONT_SIZE}
              caseTitle={activeCaseData?.case_title}
              caseContent={activeCaseData?.case_content}
            />
          </div>
          {chatPanel}
        </ResizablePanes>
      ) : (
        <div className="w-full h-full max-w-4xl mx-auto">
          {chatPanel}
        </div>
      )}
    </div>
  );

  if (conversationPhase === ConversationPhase.EVALUATION_LOADING || conversationPhase === ConversationPhase.EVALUATING) {
    const displayName = sessionUser?.full_name || studentFirstName || 'Student';
    return (
      <Evaluation
        result={evaluationResult}
        studentName={displayName}
        onRestart={handleRestart}
        superModelName={superModelName}
        onLogout={handleStudentLogout}
        onTitleContextNav={handleRestart}
        showDetails={chatOptions?.show_evaluation_details !== false}
      />
    );
  }

  return studentShell;
};

export default App;
