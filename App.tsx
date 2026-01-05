

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message, MessageRole, ConversationPhase, EvaluationResult, CEOPersona, Section, CaseChat, ChatStatus } from './types';
import { createChatSession, getEvaluation } from './services/llmService';
import type { LLMChatSession } from './services/llmService';
import { CaseData, DEFAULT_CASE_DATA } from './constants';
import { api, getApiBaseUrl } from './services/apiClient';
import BusinessCase from './components/BusinessCase';
import ChatWindow from './components/ChatWindow';
import MessageInput from './components/MessageInput';
import Evaluation from './components/Evaluation';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import ResizablePanes from './components/ResizablePanes';

interface Model {
    model_id: string;
    model_name: string;
    enabled?: boolean;
    default?: boolean;
    input_cost?: number | null;
    output_cost?: number | null;
}

const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
const DEFAULT_FONT_SIZE = 'text-base';

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
  const [view, setView] = useState<'student' | 'admin'>('student');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [sessionUser, setSessionUser] = useState<any>(null);
  
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
  
  // Default chat options
  const defaultChatOptions = {
    hints_allowed: 3,
    free_hints: 1,
    ask_for_feedback: false,
    ask_save_transcript: false,
    allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
    default_persona: 'moderate'
  };

  // Available cases for selected section
  const [availableCases, setAvailableCases] = useState<any[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isLoadingAvailableCases, setIsLoadingAvailableCases] = useState(false);
  const [studentSavedSectionId, setStudentSavedSectionId] = useState<string | null>(null);
  const [hasFetchedStudentSection, setHasFetchedStudentSection] = useState(false);
  
  // Case completion tracking
  const [caseCompletionStatus, setCaseCompletionStatus] = useState<Record<string, { completed: boolean; allowRechat: boolean }>>({});

  const isLargeScreen = useMediaQuery('(min-width: 1024px)');
  const direction = isLargeScreen ? 'vertical' : 'horizontal';
  const initialSize = isLargeScreen ? 33 : 50;

  useEffect(() => {
    // Handles client-side routing and auth state
    const handleRouteChange = async () => {
        api.auth.applyCasCallbackFromUrl();
        const { data: { session } } = await api.auth.getSession();
        setSessionUser(session?.user || null);
        const urlParams = new URLSearchParams(window.location.search);
        
        // Use hash-based routing for robust SPA navigation.
        // Fallback to query param for AI Studio Preview compatibility.
        if (window.location.hash === '#/admin' || urlParams.get('view') === 'admin') {
            setView('admin');
            setIsAdminAuthenticated(!!session && session.user?.role === 'admin');
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
        const { data, error: fetchError } = await api
            .from('sections')
            .select('section_id, section_title, year_term, chat_model, super_model')
            .eq('enabled', true)
            .order('year_term', { ascending: false })
            .order('section_title', { ascending: true });

        if (fetchError) {
            console.error('Error fetching sections:', fetchError);
            setError('Could not load course sections from the database.');
        } else if (data) {
            setSections(data as Section[]);
            if (data.length === 0) {
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
            setError('Could not load AI models from the database.');
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

  // Fetch student's saved section when they log in
  useEffect(() => {
    const fetchStudentSection = async () => {
      if (!sessionUser || sessionUser.role !== 'student' || hasFetchedStudentSection) return;
      
      try {
        const { data, error } = await api
          .from('students')
          .select('section_id')
          .eq('id', sessionUser.id)
          .single();
        
        if (!error && data && data.section_id && !data.section_id.startsWith('other:')) {
          setStudentSavedSectionId(data.section_id);
          setSelectedSection(data.section_id);
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

  // Fetch available cases for the selected section
  const fetchAvailableCases = async (sectionId: string) => {
    if (!sectionId || sectionId === 'other') {
      setAvailableCases([]);
      setSelectedCaseId(null);
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
        
        // Check completion status for each case
        if (sessionUser?.id && activeCases.length > 0) {
          const completionStatuses: Record<string, { completed: boolean; allowRechat: boolean }> = {};
          for (const caseItem of activeCases) {
            try {
              const response = await fetch(`${getApiBaseUrl()}/evaluations/check-completion/${sessionUser.id}/${caseItem.case_id}`);
              const result = await response.json();
              if (result.data) {
                completionStatuses[caseItem.case_id] = {
                  completed: result.data.completed,
                  allowRechat: result.data.allow_rechat
                };
              }
            } catch (e) {
              console.error('Error checking completion:', e);
            }
          }
          setCaseCompletionStatus(completionStatuses);
        }
        
        // Auto-select if only one case available and not completed (or allow_rechat)
        if (activeCases.length === 1) {
          const caseId = activeCases[0].case_id;
          const status = caseCompletionStatus[caseId];
          if (!status?.completed || status?.allowRechat) {
            setSelectedCaseId(caseId);
          } else {
            setSelectedCaseId(null);
          }
        } else {
          setSelectedCaseId(null);
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
        return;
      }
      
      // Find the selected case from available cases to get chat_options
      const selectedCase = availableCases.find(c => c.case_id === selectedCaseId);
      if (selectedCase) {
        // Extract and set chat options
        const options = selectedCase.chat_options || defaultChatOptions;
        setChatOptions(options);
        
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

  const startConversation = useCallback(async (name: string, persona: CEOPersona, modelId: string) => {
    setIsLoading(true);
    setError(null);
    setHintsUsed(0);  // Reset hint counter at start of conversation
    try {
      // Use active case data or default
      const caseData = activeCaseData || DEFAULT_CASE_DATA;
      
      // Build first message using case protagonist and question
      const firstMessageContent = `Hello ${name}, I am ${caseData.protagonist}, the protagonist of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
      const initialHistory: Message[] = [{ role: MessageRole.MODEL, content: firstMessageContent }];

      // Create chat session with case data for cache-optimized prompts
      const session = createChatSession(name, persona, modelId, initialHistory, caseData);
      setChatSession(session);
      setMessages(initialHistory);
      setConversationPhase(ConversationPhase.CHATTING);
    } catch (e) {
      console.error("Failed to start conversation:", e);
      setError("Failed to initialize the chat session. Please check your API key and refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, [activeCaseData]);
  
  const handleSendMessage = async (userMessage: string) => {
    if (conversationPhase === ConversationPhase.CHATTING) {
        const lowerCaseMessage = userMessage.toLowerCase();
        if (lowerCaseMessage.includes("time is up") || lowerCaseMessage.includes("time's up")) {
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
        
        const affirmative = ['yes', 'y', 'sure', 'ok', 'yeah', 'yep', 'absolutely', 'i would', 'of course'].some(word => userMessage.toLowerCase().includes(word));
        
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
        
        const affirmative = ['yes', 'y', 'sure', 'ok', 'yeah', 'yep', 'absolutely', 'i would', 'of course'].some(word => userMessage.toLowerCase().includes(word));
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

  const handleProceedToEvaluation = async () => {
    if (!studentFirstName || !selectedSuperModel) return;
    setConversationPhase(ConversationPhase.EVALUATION_LOADING);
    setError(null);
    try {
    const fullName = sessionUser?.full_name || `${studentFirstName}`;
    const lastName = sessionUser?.last_name || '';
    // Pass case data and chat options for cache-optimized evaluation prompt
    const caseData = activeCaseData || DEFAULT_CASE_DATA;
    const result = await getEvaluation(messages, studentFirstName, fullName, selectedSuperModel, caseData, chatOptions);
      setEvaluationResult(result);
      
      if (studentDBId) {
        const sanitizedLiked = sanitizeFeedback(likedFeedback);
        const sanitizedImprove = sanitizeFeedback(improveFeedback);

        let transcriptToSave: string | null = null;
        if (shareTranscript) {
          const transcript = messages.map(msg => {
            const speaker = msg.role === MessageRole.USER ? fullName : 'CEO';
            return `${speaker}: ${msg.content}`;
          }).join('\n\n');

          // Anonymize the transcript
          const nameRegex = new RegExp(`\\b(${fullName}|${studentFirstName}|${lastName})\\b`, 'gi');
          transcriptToSave = transcript.replace(nameRegex, 'STUDENT');
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
            persona: ceoPersona,
            hints: result.hints,
            helpful: helpfulScore,
            liked: sanitizedLiked,
            improve: sanitizedImprove,
            chat_model: selectedChatModel,
            super_model: selectedSuperModel,
            transcript: transcriptToSave,
          });

        if (evaluationError) {
          console.error("Error saving evaluation:", evaluationError);
        } else {
          // If evaluation is saved, try to update the student's finished_at timestamp
          const { error: studentUpdateError } = await api
            .from('students')
            .update({ finished_at: mysqlTimestamp })
            .eq('id', studentDBId);
          if (studentUpdateError) console.error("Error updating student finished_at timestamp:", studentUpdateError);
        }
      }
      setConversationPhase(ConversationPhase.EVALUATING);
    } catch (e) {
      console.error("Failed to get evaluation:", e);
      setError("Sorry, there was an error generating your performance review. Please try again.");
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
        const caseChatResponse = await fetch(`${getApiBaseUrl()}/case-chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: studentId,
            case_id: selectedCaseId,
            section_id: sectionToSave,
            persona: ceoPersona,
            chat_model: selectedChatModel,
          }),
        });
        const caseChatResult = await caseChatResponse.json();
        if (caseChatResult.data?.id) {
          setCurrentCaseChatId(caseChatResult.data.id);
        }
      } catch (err) {
        console.error('Failed to create case_chat record:', err);
        // Continue anyway - chat tracking is optional
      }

      await startConversation(trimmedFirstName, ceoPersona, selectedChatModel);
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
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const sectionId = e.target.value;
      setSelectedSection(sectionId);
      // Reset case selection when section changes
      setSelectedCaseId(null);
      setActiveCaseData(null);
      setChatOptions(defaultChatOptions);

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

  if (!isReady) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }
  
  if (view === 'admin') {
    if (isAdminAuthenticated) {
      return <Dashboard onLogout={handleAdminLogout} user={sessionUser as any} />;
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
            <p className="mt-2 text-gray-600">Please sign in with your BYU CAS account to begin chatting with an AI case protagonist.</p>
          </div>
          <div className="space-y-4">
            <button
              onClick={() => api.auth.beginCasLogin()}
              className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Login with BYU CAS
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
    const isCaseCompleted = selectedCaseStatus?.completed && !selectedCaseStatus?.allowRechat;
    const canStartChat = isSectionValid && selectedCaseId && activeCaseData && !isLoadingCase && !isCaseCompleted;
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
            <div>
              <label htmlFor="section" className="block text-sm font-medium text-gray-700">Your Course Section</label>
              <select 
                id="section" 
                value={selectedSection} 
                onChange={handleSectionChange} 
                className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="" disabled>Select your course section...</option>
                {sections.map((sec) => (
                  <option key={sec.section_id} value={sec.section_id}>
                    {sec.section_title} ({sec.year_term})
                  </option>
                ))}
              </select>
              {studentSavedSectionId && selectedSection === studentSavedSectionId && (
                <p className="mt-1 text-xs text-green-600">✓ Previously selected section</p>
              )}
            </div>
            
            {/* Available Cases for Section */}
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
                  <div className="text-center py-3 text-gray-500 text-sm">Loading available cases...</div>
                ) : availableCases.length === 0 ? (
                  <div className="text-center py-3 text-gray-500 text-sm bg-yellow-50 border border-yellow-200 rounded-lg">
                    Currently no available case chats for this section. Please check back later or contact your instructor.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableCases.map((caseItem) => {
                      const status = caseCompletionStatus[caseItem.case_id];
                      const isCompleted = status?.completed && !status?.allowRechat;
                      const canRechat = status?.completed && status?.allowRechat;

                      // Check scheduling availability
                      const checkAvailability = () => {
                        const now = new Date();
                        if (caseItem.manual_status === 'manually_opened') {
                          return { available: true, message: null };
                        }
                        if (caseItem.manual_status === 'manually_closed') {
                          return { available: false, message: 'This case has been manually closed by the instructor.' };
                        }
                        // Auto mode
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

                      return (
                        <div key={caseItem.case_id}>
                          <label
                            className={`flex items-center p-3 rounded-lg border transition-colors ${
                              isDisabled
                                ? 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-75'
                                : selectedCaseId === caseItem.case_id
                                  ? 'bg-blue-50 border-blue-300 cursor-pointer'
                                  : 'bg-white border-gray-200 hover:bg-gray-50 cursor-pointer'
                            }`}
                          >
                            <input
                              type="radio"
                              name="selectedCase"
                              value={caseItem.case_id}
                              checked={selectedCaseId === caseItem.case_id}
                              onChange={(e) => !isDisabled && setSelectedCaseId(e.target.value)}
                              disabled={isDisabled}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 disabled:opacity-50"
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
                              <span className="block text-xs text-gray-500">Protagonist: {caseItem.protagonist}</span>
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
                )}
                
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
            
            <p className="text-xs text-gray-500 italic px-2">You can optionally and anonymously share your chat conversation with the developers to improve the dialog for future students. You will be asked about this later.</p>
            
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
              {isLoading ? 'Initializing...' : !isSectionValid ? 'Select Your Section' : !selectedCaseId ? 'Select a Case' : isCaseCompleted ? 'Case Already Completed' : !activeCaseData ? 'Loading Case...' : 'Start Chat'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const chatModelName = models.find(m => m.model_id === selectedChatModel)?.model_name || selectedChatModel;
  const superModelName = models.find(m => m.model_id === selectedSuperModel)?.model_name || selectedSuperModel;

  const studentShell = (
    <div className="h-screen w-screen p-4 lg:p-6 font-sans bg-gray-100 overflow-hidden relative">
      {logoutButton}
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
        <aside className="w-full h-full flex flex-col bg-gray-200 rounded-xl shadow-lg">
          {error && <div className="p-4 bg-red-500 text-white text-center font-semibold rounded-t-xl">{error}</div>}
          <ChatWindow 
            messages={messages} 
            isLoading={isLoading} 
            ceoPersona={ceoPersona} 
            chatModelName={chatModelName} 
            chatFontSize={chatFontSize}
            protagonistName={activeCaseData?.protagonist}
            protagonistInitials={activeCaseData?.protagonist_initials}
            caseTitle={activeCaseData?.case_title}
          />
          {conversationPhase === ConversationPhase.FEEDBACK_COMPLETE ? (
              <div className="p-4 bg-white border-t border-gray-200 flex justify-center items-center">
                  <button
                      onClick={handleProceedToEvaluation}
                      className="px-6 py-3 bg-orange-600 text-white font-semibold rounded-xl hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 animate-pulse"
                  >
                      Click here to engage the AI Supervisor
                  </button>
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
              />
          )}
        </aside>
      </ResizablePanes>
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
      />
    );
  }

  return studentShell;
};

export default App;