

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message, MessageRole, ConversationPhase, EvaluationResult, CEOPersona, Section } from './types';
import { createChatSession, getEvaluation } from './services/llmService';
import type { LLMChatSession } from './services/llmService';
import { api } from './services/apiClient';
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [selectedChatModel, setSelectedChatModel] = useState<string | null>(null);
  const [selectedSuperModel, setSelectedSuperModel] = useState<string | null>(null);

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

  const startConversation = useCallback(async (name: string, persona: CEOPersona, modelId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const firstMessageContent = `Hello ${name}, I am Kent Beck, the CEO of Malawi's Pizza. Thank you for meeting with me today. Our time is limited so let's get straight to my quandary: **Should we stay in the catering business, or is pizza catering a distraction from our core restaurant operations?**`;
      const initialHistory: Message[] = [{ role: MessageRole.MODEL, content: firstMessageContent }];

      const session = createChatSession(name, persona, modelId, initialHistory);
      setChatSession(session);
      setMessages(initialHistory);
      setConversationPhase(ConversationPhase.CHATTING);
    } catch (e) {
      console.error("Failed to start conversation:", e);
      setError("Failed to initialize the chat session. Please check your API key and refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const handleSendMessage = async (userMessage: string) => {
    if (conversationPhase === ConversationPhase.CHATTING) {
        const lowerCaseMessage = userMessage.toLowerCase();
        if (lowerCaseMessage.includes("time is up") || lowerCaseMessage.includes("time's up")) {
            const finalUserMessage: Message = { role: MessageRole.USER, content: userMessage };
            const ceoPermissionRequest: Message = {
                role: MessageRole.MODEL,
                content: `${studentFirstName}, thank you for meeting with me. I am glad you were able to study this case and share your insights. I hope our conversation was challenging yet helpful. **Would you be willing to provide feedback by answering a few questions about our interaction?**`
            };
            setMessages(prev => [...prev, finalUserMessage, ceoPermissionRequest]);
            setConversationPhase(ConversationPhase.AWAITING_HELPFUL_PERMISSION);
            return;
        }

        if (!chatSession) return;

        const newUserMessage: Message = { role: MessageRole.USER, content: userMessage };
        setMessages((prev) => [...prev, newUserMessage]);
        setIsLoading(true);
        setError(null);

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
            // Student declined feedback, proceed to ask for transcript permission.
            const ceoTranscriptRequest: Message = {
                role: MessageRole.MODEL,
                content: "It has been a delight talking with you today. **Would you be willing to let me pass this conversation transcript to the developers to help improve the simulated conversations for future students?** The conversation will be completely anonymized (your name will be removed). This would be **a big help** in developing this AI chat case teaching tool 😊."
            };
            setMessages(prev => [...prev, ceoTranscriptRequest]);
            setConversationPhase(ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION);
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

        const ceoTranscriptRequest: Message = {
            role: MessageRole.MODEL,
            content: "It has been a delight talking with you today. **Would you be willing to let me pass this conversation transcript to the developers to help improve the simulated conversations for future students?** The conversation will be completely anonymized (your name will be removed). This would be **a big help** in developing this AI chat case teaching tool 😊.",
        };
        setMessages(prev => [...prev, userImproveReply, ceoTranscriptRequest]);
        setConversationPhase(ConversationPhase.AWAITING_TRANSCRIPT_PERMISSION);
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
    const result = await getEvaluation(messages, studentFirstName, fullName, selectedSuperModel);
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

        const finishedTimestamp = new Date().toISOString();

        const { error: evaluationError } = await api
          .from('evaluations')
          .insert({
            student_id: studentDBId,
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
            .update({ finished_at: finishedTimestamp })
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
    } else if (selectedSection === 'other') {
        if (!otherSectionText.trim()) {
            setError('Please enter your course section name.');
            setIsLoading(false);
            return;
        }
        sectionToSave = `other:${otherSectionText.trim().substring(0, 14)}`;
    } else {
        sectionToSave = selectedSection;
    }

    try {
      const { data, error: updateError } = await api
        .from('students')
        .update({
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
          full_name: fullName,
          persona: ceoPersona,
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

      setStudentDBId((data as any).id);
      setStudentFirstName(trimmedFirstName);
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
    setSelectedSection('');
    setOtherSectionText('');
    setHelpfulScore(null);
    setLikedFeedback(null);
    setImproveFeedback(null);
    setShareTranscript(false);
    setSelectedChatModel(defaultModel);
    setSelectedSuperModel(defaultModel);
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const sectionId = e.target.value;
      setSelectedSection(sectionId);

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

  const handleAdminLogin = () => setIsAdminAuthenticated(true);
  
  const handleAdminLogout = async () => {
    await api.auth.signOut();
    setIsAdminAuthenticated(false);
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
      return <Dashboard onLogout={handleAdminLogout} />;
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
            <h1 className="text-3xl font-bold text-gray-900">Chat with the CEO</h1>
            <p className="mt-2 text-gray-600">Please sign in with your BYU CAS account to begin.</p>
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
    const isSectionValid = (selectedSection === 'other' && otherSectionText.trim() !== '') || (selectedSection !== 'other' && selectedSection !== '');

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-200 relative">
        {logoutButton}
        <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl">
          <div className="text-center">
            <h1
              className="text-3xl font-bold text-gray-900"
              title="admin"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.location.hash = '#/admin';
                }
              }}
            >
              Chat with the CEO
            </h1>
            <p className="mt-2 text-gray-600">You will have a brief opportunity to chat with the (AI simulated) CEO about the case. You are signed in with BYU CAS below. Choose your course section and CEO persona to begin.</p>
          </div>
          <form onSubmit={handleNameSubmit} className="space-y-6">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-gray-800">
                Signed in as <span className="font-semibold">{displayFullName}{displayUsername ? ` (${displayUsername})` : ''}</span>
              </p>
            </div>
            <div>
              <label htmlFor="section" className="block text-sm font-medium text-gray-700">What course section are you in?</label>
              <select id="section" value={selectedSection} onChange={handleSectionChange} className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                <option value="" disabled>Click to select...</option>
                {sections.map((sec) => (<option key={sec.section_id} value={sec.section_id}>{sec.section_title} ({sec.year_term})</option>))}
                <option value="other">Other...</option>
              </select>
            </div>
            {selectedSection === 'other' && (
              <div>
                <label htmlFor="otherSection" className="block text-sm font-medium text-gray-700">Please specify your section</label>
                <input id="otherSection" type="text" value={otherSectionText} onChange={(e) => setOtherSectionText(e.target.value)} className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., BUSM 101" required />
              </div>
            )}
             <div>
                <label htmlFor="ceoPersona" className="block text-sm font-medium text-gray-700">CEO Personality</label>
                <p className="mt-1 text-xs text-gray-500">Determines how strictly the CEO requires you to cite case facts.</p>
                <select id="ceoPersona" value={ceoPersona} onChange={(e) => setCeoPersona(e.target.value as CEOPersona)} className="w-full px-4 py-2 mt-1 text-gray-900 bg-gray-100 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                    <option value={CEOPersona.MODERATE}>Moderate (Recommended)</option>
                    <option value={CEOPersona.STRICT}>Strict</option>
                    <option value={CEOPersona.LIBERAL}>Liberal</option>
                    <option value={CEOPersona.LEADING}>Leading</option>
                    <option value={CEOPersona.SYCOPHANTIC}>Sycophantic</option>
                </select>
            </div>
            <p className="text-xs text-gray-500 italic px-2">You can optionally and anonymously share your chat conversation with the developers to improve the dialog for future students. You will be asked about this later.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={isLoading || !isSectionValid} className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400">
              {isLoading ? 'Initializing...' : 'Start Chat'}
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
          />
        </div>
        <aside className="w-full h-full flex flex-col bg-gray-200 rounded-xl shadow-lg">
          {error && <div className="p-4 bg-red-500 text-white text-center font-semibold rounded-t-xl">{error}</div>}
          <ChatWindow messages={messages} isLoading={isLoading} ceoPersona={ceoPersona} chatModelName={chatModelName} chatFontSize={chatFontSize} />
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
    return <Evaluation result={evaluationResult} studentName={displayName} onRestart={handleRestart} superModelName={superModelName} />;
  }

  return studentShell;
};

export default App;