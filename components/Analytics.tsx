import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/apiClient';
import MultiSelect, { MultiSelectOption } from './ui/MultiSelect';
import Pagination from './ui/Pagination';
import SortableHeader from './ui/SortableHeader';
import StatusBadge, { StatusType } from './ui/StatusBadge';
import ScoreChart from './ui/ScoreChart';

interface AnalyticsProps {
  onNavigate?: (section: string, subTab?: string) => void;
  initialSectionId?: string;
}

interface SummaryData {
  totalStudents: number;
  completedStudents: number;
  totalCompletions: number;
  avgScore: number | null;
  avgHints: number | null;
  avgHelpful: number | null;
  completionRate: number;
  scoreDistribution: Array<{ score: number; count: number }>;
  sectionBreakdown: Array<{
    section_id: string;
    section_title: string;
    year_term: string;
    total_students: number;
    completions: number;
    avg_score: number | null;
  }> | null;
  caseBreakdown: Array<{
    case_id: string;
    case_title: string;
    completions: number;
    avg_score: number | null;
  }> | null;
}

interface StudentResult {
  student_id: string;
  student_name: string;
  section_id: string;
  section_title: string;
  case_id: string;
  case_title: string;
  status: StatusType;
  initial_position: string | null;
  final_position: string | null;
  persona: string | null;
  score: number | null;
  hints: number | null;
  helpful: number | null;
  time_minutes: number | null;
  evaluation_id: string | null;
  case_chat_id: string | null;
  completion_time: string | null;
  allow_rechat: boolean;
  liked: string | null;
  improve: string | null;
}

interface FilterOption {
  section_id: string;
  section_title: string;
  year_term?: string;
}

interface CaseOption {
  case_id: string;
  case_title: string;
}

type SortKey = 'student_name' | 'section_title' | 'case_title' | 'status' | 'initial_position' | 'final_position' | 'persona' | 'score' | 'hints' | 'helpful' | 'completion_time';

const COLUMN_OPTIONS = [
  { key: 'section_title', label: 'Section' },
  { key: 'case_title', label: 'Case' },
  { key: 'status', label: 'Status' },
  { key: 'initial_position', label: 'Initial Position' },
  { key: 'final_position', label: 'Final Position' },
  { key: 'persona', label: 'Persona' },
  { key: 'score', label: 'Score' },
  { key: 'out_of', label: 'Out Of' },
  { key: 'hints', label: 'Hints' },
  { key: 'helpful', label: 'Helpful' },
  { key: 'liked', label: 'Liked' },
  { key: 'improve', label: 'Improve' },
  { key: 'completion_time', label: 'Time' },
];

const DEFAULT_COLUMNS = ['section_title', 'case_title', 'status', 'score'];
const DEFAULT_VISIBLE_COLUMNS = new Set(DEFAULT_COLUMNS);

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'not_started', label: 'Not Started' },
];

const Analytics: React.FC<AnalyticsProps> = ({ onNavigate, initialSectionId }) => {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Filter options (populated from API)
  const [sectionOptions, setSectionOptions] = useState<FilterOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);

  // Selected filters
  const [selectedSections, setSelectedSections] = useState<string[]>(['all']);
  const [selectedCases, setSelectedCases] = useState<string[]>(['all']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['all']);
  const [studentSearch, setStudentSearch] = useState<string>('');

  // Display toggles
  const [showSummaryStats, setShowSummaryStats] = useState(false);
  const [showStudentDetails, setShowStudentDetails] = useState(true);

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(DEFAULT_VISIBLE_COLUMNS);

  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('completion_time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Data
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [students, setStudents] = useState<StudentResult[]>([]);

  // Modal state
  const [selectedStudent, setSelectedStudent] = useState<StudentResult | null>(null);
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [transcriptContent, setTranscriptContent] = useState<string>('');
  const [transcriptData, setTranscriptData] = useState<any>(null); // Full transcript object
  const [evaluationData, setEvaluationData] = useState<any>(null);
  const [evalEditMode, setEvalEditMode] = useState(false);
  const [evalSaving, setEvalSaving] = useState(false);
  const [isAnonymizing, setIsAnonymizing] = useState(false);
  const [autoAnonymize, setAutoAnonymize] = useState(false); // Setting for auto-anonymize

  // Re-evaluation modal state
  const [showReEvaluateModal, setShowReEvaluateModal] = useState(false);
  const [reEvalStudent, setReEvalStudent] = useState<StudentResult | null>(null);
  const [reEvalRubricId, setReEvalRubricId] = useState<number | null>(null);
  const [reEvalModelId, setReEvalModelId] = useState<string>('');
  const [reEvalShowPrompt, setReEvalShowPrompt] = useState(false);
  const [reEvalPrompt, setReEvalPrompt] = useState<string>('');
  const [reEvalLoading, setReEvalLoading] = useState(false);
  const [reEvalResult, setReEvalResult] = useState<any>(null);
  const [rubricsList, setRubricsList] = useState<any[]>([]);
  const [modelsList, setModelsList] = useState<any[]>([]);
  const [transcriptExists, setTranscriptExists] = useState(true);
  const [originalEvaluation, setOriginalEvaluation] = useState<any>(null);
  const [selectedRubricDetails, setSelectedRubricDetails] = useState<any>(null);
  const [reEvalError, setReEvalError] = useState<string | null>(null);
  const [reEvalEditMode, setReEvalEditMode] = useState(false);

  // Fetch filter options and settings on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const response = await api.get('/analytics/filters');
        if (response.data) {
          setSectionOptions(response.data.sections || []);
          setCaseOptions(response.data.cases || []);
        }
      } catch (error) {
        console.error('Failed to fetch filter options:', error);
      }
    };
    const fetchSettings = async () => {
      try {
        const response = await api.get('/settings/auto_anonymize_transcripts');
        if (response.data) {
          setAutoAnonymize(response.data.value === 'true' || response.data.value === true);
        }
      } catch (error) {
        // Setting doesn't exist yet, default to false
        console.log('Auto-anonymize setting not found, defaulting to false');
      }
    };
    fetchFilters();
    fetchSettings();
  }, []);

  // Fetch rubrics and models for re-evaluation
  useEffect(() => {
    const fetchRubrics = async () => {
      try {
        const response = await api.get('/rubrics');
        setRubricsList(response.data?.data || response.data || []);
      } catch (error) {
        console.error('Failed to fetch rubrics:', error);
      }
    };
    const fetchModels = async () => {
      try {
        const response = await api.get('/models?enabled=true');
        setModelsList(response.data || []);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };
    fetchRubrics();
    fetchModels();
  }, []);

  // Handle initial section selection from navigation
  useEffect(() => {
    if (initialSectionId && sectionOptions.length > 0) {
      setSelectedSections([initialSectionId]);
    }
  }, [initialSectionId, sectionOptions]);

  // Fetch results data
  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('section_ids', selectedSections.includes('all') ? 'all' : selectedSections.join(','));
      params.set('case_ids', selectedCases.includes('all') ? 'all' : selectedCases.join(','));
      params.set('statuses', selectedStatuses.includes('all') ? 'all' : selectedStatuses.join(','));
      if (studentSearch.trim()) {
        params.set('student_search', studentSearch.trim());
      }
      params.set('limit', pageSize.toString());
      params.set('offset', ((currentPage - 1) * pageSize).toString());
      params.set('sort_by', sortKey);
      params.set('sort_dir', sortDirection);

      const response = await api.get(`/analytics/results?${params.toString()}`);
      if (response.data) {
        setSummary(response.data.summary);
        setStudents(response.data.students);
        setTotalRecords(response.data.total);
      }
    } catch (error) {
      console.error('Failed to fetch results:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSections, selectedCases, selectedStatuses, studentSearch, pageSize, currentPage, sortKey, sortDirection]);

  useEffect(() => {
    if (sectionOptions.length > 0 || caseOptions.length > 0) {
      fetchResults();
    }
  }, [fetchResults, sectionOptions.length, caseOptions.length]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSections, selectedCases, selectedStatuses, studentSearch, pageSize]);

  // Handle sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Toggle column visibility
  const toggleColumn = (columnKey: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  };

  // Score color helper
  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-400';
    if (score >= 12) return 'text-green-600';
    if (score >= 9) return 'text-blue-600';
    if (score >= 6) return 'text-amber-600';
    return 'text-red-600';
  };

  // View transcript
  const handleViewTranscript = async (student: StudentResult) => {
    setSelectedStudent(student);
    try {
      // Fetch transcript from transcripts table via case_chat_id
      if (student.case_chat_id) {
        const response = await api.get(`/transcripts/chat/${student.case_chat_id}`);
        if (response.data?.transcript) {
          const transcript = response.data;
          setTranscriptData(transcript);
          
          // Check if auto-anonymize is enabled and transcript is not already anonymized
          if (autoAnonymize && !transcript.is_anonymized) {
            // Automatically anonymize the transcript
            await handleAnonymizeTranscript(transcript.id, student.student_name, student.case_title, true);
            return; // handleAnonymizeTranscript will refresh the display
          }
          
          setTranscriptContent(transcript.transcript);
          setShowTranscriptModal(true);
          return;
        }
      }
      
      // No transcript found
      setTranscriptData(null);
      setTranscriptContent('No transcript available');
      setShowTranscriptModal(true);
    } catch (error: any) {
      console.error('Failed to fetch transcript:', error);
      // If 404, transcript doesn't exist (not an error)
      if (error.response?.status === 404) {
        setTranscriptData(null);
        setTranscriptContent('No transcript available');
      } else {
        setTranscriptData(null);
        setTranscriptContent('Error loading transcript');
      }
      setShowTranscriptModal(true);
    }
  };

  // Anonymize transcript
  const handleAnonymizeTranscript = async (
    transcriptId: string, 
    studentName: string, 
    caseTitle: string,
    autoTriggered: boolean = false
  ) => {
    setIsAnonymizing(true);
    try {
      // Create anonymized version of the transcript
      const anonymizedText = transcriptContent.replace(
        new RegExp(`\\b${studentName.split(/\s+/).join('\\b|\\b')}\\b`, 'gi'),
        'STUDENT'
      ).replace(
        new RegExp(`\\b${caseTitle.split(/\s+/).join('\\b|\\b')}\\b`, 'gi'),
        'CASE'
      );

      // Send the anonymized transcript to the server
      const response = await api.patch(`/transcripts/${transcriptId}/anonymize`, {
        anonymized_transcript: anonymizedText
      });

      if (response.data) {
        // Update the local state
        setTranscriptData(response.data);
        setTranscriptContent(response.data.transcript);
        setShowTranscriptModal(true);
        
        if (!autoTriggered) {
          alert('Transcript anonymized successfully');
        }
      }
    } catch (error: any) {
      console.error('Failed to anonymize transcript:', error);
      alert('Failed to anonymize transcript: ' + (error.response?.data?.error?.message || error.message));
    } finally {
      setIsAnonymizing(false);
    }
  };

  // View evaluation
  const handleViewEvaluation = async (student: StudentResult) => {
    if (!student.evaluation_id) return;
    setSelectedStudent(student);
    setEvalEditMode(false);
    try {
      const response = await api.get(`/evaluations?student_ids=${student.student_id}&case_id=${student.case_id}`);
      if (response.data && response.data.length > 0) {
        setEvaluationData(response.data[0]);
        setShowEvaluationModal(true);
      }
    } catch (error) {
      console.error('Failed to fetch evaluation:', error);
    }
  };

  // Save evaluation edits
  const handleSaveEvaluationEdits = async () => {
    if (!selectedStudent?.evaluation_id || !evaluationData) return;
    setEvalSaving(true);
    try {
      await api.patch(`/evaluations/${selectedStudent.evaluation_id}`, {
        score: evaluationData.score,
        summary: evaluationData.summary,
        criteria: evaluationData.criteria
      });
      setEvalEditMode(false);
      setShowEvaluationModal(false);
      fetchResults(); // Refresh the table
    } catch (error) {
      console.error('Failed to save evaluation edits:', error);
    } finally {
      setEvalSaving(false);
    }
  };

  // Toggle re-chat
  const handleToggleRechat = async (student: StudentResult) => {
    if (!student.evaluation_id) return;
    try {
      await api.patch(`/evaluations/${student.evaluation_id}/allow-rechat`, {
        allow_rechat: !student.allow_rechat
      });
      fetchResults();
    } catch (error) {
      console.error('Failed to toggle rechat:', error);
    }
  };

  // Re-evaluation handlers
  const handleOpenReEvaluate = async (student: StudentResult) => {
    setReEvalStudent(student);
    setReEvalResult(null);
    setReEvalPrompt('');
    setReEvalShowPrompt(false);
    setOriginalEvaluation(null);
    setSelectedRubricDetails(null);
    setReEvalError(null);
    setTranscriptExists(true);
    setReEvalEditMode(false);

    // Check if transcript exists
    if (student.case_chat_id) {
      try {
        const response = await api.get(`/transcripts/chat/${student.case_chat_id}`);
        setTranscriptExists(!!response.data?.transcript);
      } catch {
        setTranscriptExists(false);
      }
    } else {
      setTranscriptExists(false);
    }

    // Fetch original evaluation for side-by-side comparison
    if (student.evaluation_id) {
      try {
        const evalResponse = await api.get(`/evaluations/${student.evaluation_id}`);
        setOriginalEvaluation(evalResponse.data?.data || evalResponse.data);
      } catch (e) {
        console.error('Failed to fetch original evaluation:', e);
      }
    }

    // Set defaults: use current rubric/model or system default
    const defaultRubric = rubricsList.find((r: any) => r.is_system_default);
    const initialRubricId = defaultRubric?.rubric_id || rubricsList[0]?.rubric_id || null;
    setReEvalRubricId(initialRubricId);

    // Fetch rubric details for preview
    if (initialRubricId) {
      fetchRubricDetails(initialRubricId);
    }

    const defaultModel = modelsList.find((m: any) => m.default_model);
    setReEvalModelId(defaultModel?.model_id || modelsList[0]?.model_id || '');

    setShowReEvaluateModal(true);
  };

  // Fetch rubric details when selection changes
  const fetchRubricDetails = async (rubricId: number) => {
    try {
      const response = await api.get(`/rubrics/${rubricId}`);
      setSelectedRubricDetails(response.data?.data || response.data);
    } catch (e) {
      console.error('Failed to fetch rubric details:', e);
    }
  };

  // Update rubric details when selection changes
  useEffect(() => {
    if (reEvalRubricId && showReEvaluateModal) {
      fetchRubricDetails(reEvalRubricId);
    }
  }, [reEvalRubricId, showReEvaluateModal]);

  // Fetch prompt preview
  const handleFetchPromptPreview = async () => {
    if (!reEvalStudent?.case_chat_id) return;
    try {
      const params = new URLSearchParams();
      params.set('case_chat_id', reEvalStudent.case_chat_id);
      if (reEvalRubricId) params.set('rubric_id', reEvalRubricId.toString());
      const response = await api.get(`/evaluations/preview-prompt?${params.toString()}`);
      setReEvalPrompt(response.data?.data?.prompt || response.data?.prompt || '');
    } catch (error) {
      console.error('Failed to fetch prompt preview:', error);
    }
  };

  // Fetch prompt when checkbox is toggled on or rubric changes
  useEffect(() => {
    if (reEvalShowPrompt && reEvalStudent?.case_chat_id) {
      handleFetchPromptPreview();
    }
  }, [reEvalShowPrompt, reEvalRubricId]);

  // Execute re-evaluation
  const handleReEvaluate = async () => {
    if (!reEvalStudent?.case_chat_id || !transcriptExists) return;

    setReEvalLoading(true);
    setReEvalError(null);
    try {
      const response = await api.post('/evaluations/re-evaluate', {
        case_chat_id: reEvalStudent.case_chat_id,
        rubric_id: reEvalRubricId,
        model_id: reEvalModelId,
        include_prompt: reEvalShowPrompt
      });
      setReEvalResult(response.data?.data || response.data);
    } catch (error: any) {
      console.error('Re-evaluation failed:', error);
      setReEvalError(error.response?.data?.error?.message || error.message || 'Re-evaluation failed');
    } finally {
      setReEvalLoading(false);
    }
  };

  // Save re-evaluation
  const handleSaveReEvaluation = async () => {
    if (!reEvalStudent?.evaluation_id || !reEvalResult) return;

    try {
      await api.patch(`/evaluations/${reEvalStudent.evaluation_id}`, {
        score: reEvalResult.score,
        summary: reEvalResult.summary,
        criteria: reEvalResult.criteria,
        rubric_id: reEvalRubricId,
        super_model: reEvalModelId
      });

      setShowReEvaluateModal(false);
      fetchResults(); // Refresh the table
    } catch (error) {
      console.error('Failed to save re-evaluation:', error);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['Student'];
    if (visibleColumns.has('section_title')) headers.push('Section');
    if (visibleColumns.has('case_title')) headers.push('Case');
    if (visibleColumns.has('status')) headers.push('Status');
    if (visibleColumns.has('initial_position')) headers.push('Initial Position');
    if (visibleColumns.has('final_position')) headers.push('Final Position');
    if (visibleColumns.has('persona')) headers.push('Persona');
    if (visibleColumns.has('score')) headers.push('Score');
    if (visibleColumns.has('out_of')) headers.push('Out Of');
    if (visibleColumns.has('hints')) headers.push('Hints');
    if (visibleColumns.has('helpful')) headers.push('Helpful');
    if (visibleColumns.has('liked')) headers.push('Liked');
    if (visibleColumns.has('improve')) headers.push('Improve');
    if (visibleColumns.has('completion_time')) headers.push('Time');

    const rows = [headers.join(',')];
    students.forEach(s => {
      const row = [`"${s.student_name}"`];
      if (visibleColumns.has('section_title')) row.push(`"${s.section_title}"`);
      if (visibleColumns.has('case_title')) row.push(`"${s.case_title}"`);
      if (visibleColumns.has('status')) row.push(s.status);
      if (visibleColumns.has('initial_position')) row.push(s.initial_position || '');
      if (visibleColumns.has('final_position')) row.push(s.final_position || '');
      if (visibleColumns.has('persona')) row.push(s.persona || '');
      if (visibleColumns.has('score')) row.push(s.score !== null ? s.score.toString() : '');
      if (visibleColumns.has('out_of')) row.push('15');
      if (visibleColumns.has('hints')) row.push(s.hints?.toString() || '');
      if (visibleColumns.has('helpful')) row.push(s.helpful !== null ? s.helpful.toFixed(1) : '');
      if (visibleColumns.has('liked')) {
        // Replace line breaks with | and escape quotes
        const liked = s.liked ? s.liked.replace(/\r?\n/g, '|').replace(/"/g, '""') : '';
        row.push(`"${liked}"`);
      }
      if (visibleColumns.has('improve')) {
        // Replace line breaks with | and escape quotes
        const improve = s.improve ? s.improve.replace(/\r?\n/g, '|').replace(/"/g, '""') : '';
        row.push(`"${improve}"`);
      }
      if (visibleColumns.has('completion_time')) row.push(s.completion_time ? new Date(s.completion_time).toLocaleString() : '');
      rows.push(row.join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Convert options for MultiSelect
  const sectionSelectOptions: MultiSelectOption[] = useMemo(() =>
    sectionOptions.map(s => ({
      value: s.section_id,
      label: s.section_title,
      subtitle: s.year_term
    })), [sectionOptions]
  );

  const caseSelectOptions: MultiSelectOption[] = useMemo(() =>
    caseOptions.map(c => ({
      value: c.case_id,
      label: c.case_title
    })), [caseOptions]
  );

  const statusSelectOptions: MultiSelectOption[] = useMemo(() =>
    STATUS_OPTIONS.map(s => ({
      value: s.value,
      label: s.label
    })), []
  );

  // Score distribution as array
  const scoreDistributionArray = useMemo(() => {
    if (!summary?.scoreDistribution) return Array(16).fill(0);
    const arr = Array(16).fill(0);
    summary.scoreDistribution.forEach(({ score, count }) => {
      if (score >= 0 && score <= 15) {
        arr[score] = count;
      }
    });
    return arr;
  }, [summary]);

  // Column options for MultiSelect
  const columnSelectOptions: MultiSelectOption[] = useMemo(() =>
    COLUMN_OPTIONS.map(col => ({
      value: col.key,
      label: col.label
    })), []
  );

  // Convert visible columns Set to array for MultiSelect
  const selectedColumns = useMemo(() =>
    Array.from(visibleColumns), [visibleColumns]
  );

  // Handle column selection change
  const handleColumnsChange = (selected: string[]) => {
    if (selected.includes('all') || selected.length === 0) {
      setVisibleColumns(new Set(COLUMN_OPTIONS.map(c => c.key)));
    } else {
      setVisibleColumns(new Set(selected));
    }
  };

  // Generate filter description for headings
  const getFilterDescription = useMemo(() => {
    let sectionText = 'all sections';
    let caseText = 'all cases';

    if (!selectedSections.includes('all') && selectedSections.length > 0) {
      if (selectedSections.length === 1) {
        const section = sectionOptions.find(s => s.section_id === selectedSections[0]);
        sectionText = section ? section.section_title : selectedSections[0];
      } else {
        sectionText = `${selectedSections.length} sections`;
      }
    }

    if (!selectedCases.includes('all') && selectedCases.length > 0) {
      if (selectedCases.length === 1) {
        const caseItem = caseOptions.find(c => c.case_id === selectedCases[0]);
        caseText = caseItem ? caseItem.case_title : selectedCases[0];
      } else {
        caseText = `${selectedCases.length} cases`;
      }
    }

    return { sectionText, caseText };
  }, [selectedSections, selectedCases, sectionOptions, caseOptions]);

  if (isLoading && students.length === 0) {
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
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Results (Analytics & Reports)</h2>
          <p className="text-sm text-gray-500 mt-1">Performance insights from completed case chats</p>
        </div>
        <button
          onClick={fetchResults}
          disabled={isLoading}
          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
          aria-label="Refresh results"
          title="Refresh results"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Course Sections</label>
            <MultiSelect
              options={sectionSelectOptions}
              selected={selectedSections}
              onChange={setSelectedSections}
              placeholder="Select sections..."
              allLabel="ALL Sections"
            />
          </div>
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Cases</label>
            <MultiSelect
              options={caseSelectOptions}
              selected={selectedCases}
              onChange={setSelectedCases}
              placeholder="Select cases..."
              allLabel="ALL Cases"
            />
          </div>
          <div className="min-w-44">
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <MultiSelect
              options={statusSelectOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
              placeholder="Select statuses..."
              allLabel="All Statuses"
            />
          </div>
          <div className="min-w-56">
            <label className="block text-xs font-medium text-gray-700 mb-1">Student</label>
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Enter search characters"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-gray-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSummaryStats}
              onChange={(e) => setShowSummaryStats(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Show summary statistics</span>
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showStudentDetails}
                onChange={(e) => setShowStudentDetails(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Show student details</span>
            </label>
            {showStudentDetails && (
              <>
                <div className="min-w-48">
                  <MultiSelect
                    options={columnSelectOptions}
                    selected={selectedColumns}
                    onChange={handleColumnsChange}
                    placeholder="Columns..."
                    allLabel="All Columns"
                    countLabel="columns showing"
                    defaultLabel="Default Columns"
                    defaultValues={DEFAULT_COLUMNS}
                  />
                </div>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Export CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      {showSummaryStats && summary && (
        <div className="space-y-4">
          {/* Section Heading */}
          <h3 className="text-lg font-semibold text-gray-900">
            Summary Statistics for {getFilterDescription.sectionText}, {getFilterDescription.caseText}
          </h3>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Completions</p>
              <p className="text-3xl font-bold text-gray-900">{summary.totalCompletions}</p>
              <p className="text-xs text-gray-400">{summary.completedStudents} of {summary.totalStudents} students</p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Score</p>
              <p className={`text-3xl font-bold ${getScoreColor(summary.avgScore)}`}>
                {summary.avgScore?.toFixed(1) || '-'}
                <span className="text-lg text-gray-400">/15</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Average Hints</p>
              <p className="text-3xl font-bold text-gray-900">
                {summary.avgHints?.toFixed(1) || '-'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Completion Rate</p>
              <p className="text-3xl font-bold text-blue-600">
                {summary.completionRate.toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Score Distribution</h3>
            <ScoreChart distribution={scoreDistributionArray} />
          </div>

          {/* Section Breakdown */}
          {summary.sectionBreakdown && summary.sectionBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Performance by Section</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Section</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Students</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Completions</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.sectionBreakdown.map(section => (
                      <tr key={section.section_id} className="hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{section.section_title}</p>
                          <p className="text-xs text-gray-500">{section.year_term}</p>
                        </td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{section.total_students}</td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{section.completions}</td>
                        <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(section.avg_score)}`}>
                          {section.avg_score?.toFixed(1) || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Case Breakdown */}
          {summary.caseBreakdown && summary.caseBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Performance by Case</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Case</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Completions</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.caseBreakdown.map(caseItem => (
                      <tr key={caseItem.case_id} className="hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{caseItem.case_title}</p>
                        </td>
                        <td className="px-5 py-4 text-center text-sm text-gray-900">{caseItem.completions}</td>
                        <td className={`px-5 py-4 text-center text-sm font-medium ${getScoreColor(caseItem.avg_score)}`}>
                          {caseItem.avg_score?.toFixed(1) || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Student Details */}
      {showStudentDetails && (
        <div className="space-y-4">
          {/* Section Heading */}
          <h3 className="text-lg font-semibold text-gray-900">
            Student Details for {getFilterDescription.sectionText}, {getFilterDescription.caseText}
          </h3>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <SortableHeader
                    label="Student"
                    sortKey="student_name"
                    currentSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  {visibleColumns.has('section_title') && (
                    <SortableHeader
                      label="Section"
                      sortKey="section_title"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('case_title') && (
                    <SortableHeader
                      label="Case"
                      sortKey="case_title"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('status') && (
                    <SortableHeader
                      label="Status"
                      sortKey="status"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('initial_position') && (
                    <SortableHeader
                      label="Initial Pos"
                      sortKey="initial_position"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('final_position') && (
                    <SortableHeader
                      label="Final Pos"
                      sortKey="final_position"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('persona') && (
                    <SortableHeader
                      label="Persona"
                      sortKey="persona"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('score') && (
                    <SortableHeader
                      label="Score"
                      sortKey="score"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('out_of') && (
                    <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Out Of</th>
                  )}
                  {visibleColumns.has('hints') && (
                    <SortableHeader
                      label="Hints"
                      sortKey="hints"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('helpful') && (
                    <SortableHeader
                      label="Helpful"
                      sortKey="helpful"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  {visibleColumns.has('liked') && (
                    <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Liked</th>
                  )}
                  {visibleColumns.has('improve') && (
                    <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Improve</th>
                  )}
                  {visibleColumns.has('completion_time') && (
                    <SortableHeader
                      label="Time"
                      sortKey="completion_time"
                      currentSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  )}
                  <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student, idx) => (
                  <tr
                    key={`${student.student_id}-${student.case_id}-${idx}`}
                    className={`hover:bg-gray-50 ${student.status === 'in_progress' ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="p-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{student.student_name}</div>
                    </td>
                    {visibleColumns.has('section_title') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">{student.section_title}</td>
                    )}
                    {visibleColumns.has('case_title') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">{student.case_title}</td>
                    )}
                    {visibleColumns.has('status') && (
                      <td className="p-3 whitespace-nowrap">
                        <StatusBadge status={student.status} />
                        {student.allow_rechat && student.status === 'completed' && (
                          <span className="ml-1 text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Re-chat</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('initial_position') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.initial_position ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            {student.initial_position}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('final_position') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.final_position ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                            {student.final_position}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.has('persona') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.persona ? student.persona.charAt(0).toUpperCase() + student.persona.slice(1) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('score') && (
                      <td className="p-3 whitespace-nowrap text-sm">
                        {student.score !== null ? (
                          <span className={`font-medium ${getScoreColor(student.score)}`}>
                            {student.score}
                          </span>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('out_of') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        15
                      </td>
                    )}
                    {visibleColumns.has('hints') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.hints !== null ? student.hints : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('helpful') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.helpful !== null ? `${student.helpful.toFixed(1)}/5` : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('liked') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600" title={student.liked || ''}>
                        {student.liked ? (
                          <span className="text-xs">{student.liked.substring(0, 6)}...</span>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('improve') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600" title={student.improve || ''}>
                        {student.improve ? (
                          <span className="text-xs">{student.improve.substring(0, 6)}...</span>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    {visibleColumns.has('completion_time') && (
                      <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                        {student.completion_time ? new Date(student.completion_time).toLocaleString() : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    <td className="p-3 whitespace-nowrap text-sm">
                      <div className="flex gap-1">
                        {student.case_chat_id && (
                          <button
                            onClick={() => handleViewTranscript(student)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="View transcript"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {student.evaluation_id && (
                          <button
                            onClick={() => handleViewEvaluation(student)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                            title="View evaluation"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {student.case_chat_id && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReEvaluate(student);
                            }}
                            className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded"
                            title="Re-evaluate transcript"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {student.status === 'completed' && student.evaluation_id && (
                          <button
                            onClick={() => handleToggleRechat(student)}
                            className={`p-1.5 rounded ${student.allow_rechat
                              ? 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                              : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50'}`}
                            title={student.allow_rechat ? 'Disable re-chat' : 'Allow re-chat'}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={20} className="p-8 text-center text-gray-500">
                      No results found for the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalRecords > 0 && (
            <Pagination
              currentPage={currentPage}
              totalItems={totalRecords}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
            />
          )}
          </div>
        </div>
      )}

      {/* Transcript Modal */}
      {showTranscriptModal && selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">Chat Transcript</h3>
                  {transcriptData && (
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${
                      transcriptData.is_anonymized 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {transcriptData.is_anonymized ? 'Anonymized' : 'Not Anonymized'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{selectedStudent.student_name} - {selectedStudent.case_title}</p>
              </div>
              <div className="flex items-center gap-2">
                {transcriptData && !transcriptData.is_anonymized && (
                  <button
                    onClick={() => handleAnonymizeTranscript(
                      transcriptData.id,
                      selectedStudent.student_name,
                      selectedStudent.case_title
                    )}
                    disabled={isAnonymizing}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg flex items-center gap-1"
                    title="Anonymize this transcript"
                  >
                    {isAnonymizing ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Anonymizing...</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span>Anonymize</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => setShowTranscriptModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
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
      {showEvaluationModal && selectedStudent && evaluationData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Evaluation</h3>
                <p className="text-sm text-gray-500">{selectedStudent.student_name} - {selectedStudent.case_title}</p>
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
              {/* Score and Edit Button */}
              <div className={`p-4 rounded-lg ${evalEditMode ? 'bg-purple-50 border-2 border-purple-200' : 'bg-gray-50'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-4">
                    {evalEditMode ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={evaluationData.score}
                          onChange={(e) => setEvaluationData({ ...evaluationData, score: parseInt(e.target.value) || 0 })}
                          className="w-16 text-3xl font-bold border border-purple-300 rounded px-2 py-1 text-center"
                          min="0"
                          max={evaluationData.criteria?.reduce((sum: number, c: any) => sum + (c.max_score || 5), 0) || 15}
                        />
                        <span className="text-3xl font-bold text-gray-400">/{evaluationData.criteria?.reduce((sum: number, c: any) => sum + (c.max_score || 5), 0) || 15}</span>
                      </div>
                    ) : (
                      <div className={`text-3xl font-bold ${getScoreColor(evaluationData.score)}`}>
                        {evaluationData.score}/{evaluationData.criteria?.reduce((sum: number, c: any) => sum + (c.max_score || 5), 0) || 15}
                      </div>
                    )}
                    <div className="text-sm text-gray-500">
                      Hints: {evaluationData.hints ?? '—'} | Helpful: {evaluationData.helpful?.toFixed(1) ?? '—'}/5
                    </div>
                  </div>
                  <button
                    onClick={() => setEvalEditMode(!evalEditMode)}
                    className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                      evalEditMode
                        ? 'bg-purple-200 text-purple-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                    {evalEditMode ? 'Editing' : 'Edit'}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  <span>Rubric: {rubricsList.find((r: any) => r.rubric_id === evaluationData.rubric_id)?.rubric_name || 'Default'}</span>
                  <span className="mx-2">|</span>
                  <span>Model: {modelsList.find((m: any) => m.model_id === evaluationData.super_model)?.model_name || evaluationData.super_model || 'Unknown'}</span>
                </div>
              </div>

              {/* Summary */}
              <div className={`rounded-lg p-4 ${evalEditMode ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50'}`}>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Summary</h4>
                {evalEditMode ? (
                  <textarea
                    value={evaluationData.summary || ''}
                    onChange={(e) => setEvaluationData({ ...evaluationData, summary: e.target.value })}
                    className="w-full border border-purple-300 rounded px-3 py-2 text-sm min-h-[80px]"
                  />
                ) : (
                  <p className="text-sm text-gray-600">{evaluationData.summary}</p>
                )}
              </div>

              {/* Criteria */}
              {evaluationData.criteria && evaluationData.criteria.length > 0 && (
                <div className={`rounded-lg p-4 ${evalEditMode ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50'}`}>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Criteria Scores</h4>
                  {evaluationData.criteria.map((c: any, i: number) => (
                    <div key={i} className="text-sm border-b border-gray-200 py-3 last:border-0">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700 flex-1">{c.question}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {evalEditMode ? (
                            <input
                              type="number"
                              value={c.score}
                              onChange={(e) => {
                                const newCriteria = [...evaluationData.criteria];
                                newCriteria[i] = { ...newCriteria[i], score: parseInt(e.target.value) || 0 };
                                const newTotal = newCriteria.reduce((sum, cr) => sum + (cr.score || 0), 0);
                                setEvaluationData({ ...evaluationData, criteria: newCriteria, score: newTotal });
                              }}
                              className="w-12 border border-purple-300 rounded px-1 py-0.5 text-center font-medium"
                              min="0"
                              max={c.max_score || 5}
                            />
                          ) : (
                            <span className="font-medium text-gray-800">{c.score}/{c.max_score || 5}</span>
                          )}
                        </div>
                      </div>
                      {evalEditMode ? (
                        <textarea
                          value={c.feedback || ''}
                          onChange={(e) => {
                            const newCriteria = [...evaluationData.criteria];
                            newCriteria[i] = { ...newCriteria[i], feedback: e.target.value };
                            setEvaluationData({ ...evaluationData, criteria: newCriteria });
                          }}
                          className="w-full mt-1 border border-purple-300 rounded px-2 py-1 text-xs min-h-[40px]"
                        />
                      ) : (
                        <p className="text-gray-500 text-xs mt-1">{c.feedback}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Student Feedback */}
              {evaluationData.liked && (
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-green-700 mb-2">Student Feedback - Liked</h4>
                  <p className="text-sm text-gray-600">{evaluationData.liked}</p>
                </div>
              )}
              {evaluationData.improve && (
                <div className="bg-amber-50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Student Feedback - Improve</h4>
                  <p className="text-sm text-gray-600">{evaluationData.improve}</p>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            {evalEditMode && (
              <div className="p-4 border-t flex justify-end gap-2">
                <button
                  onClick={() => {
                    setEvalEditMode(false);
                    // Refetch to discard changes
                    handleViewEvaluation(selectedStudent);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  Do Not Save
                </button>
                <button
                  onClick={handleSaveEvaluationEdits}
                  disabled={evalSaving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {evalSaving && (
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  Save Edits
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Re-Evaluate Modal */}
      {showReEvaluateModal && reEvalStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Re-evaluate Transcript</h3>
                <p className="text-sm text-gray-500">{reEvalStudent.student_name} - {reEvalStudent.case_title}</p>
              </div>
              <button
                onClick={() => setShowReEvaluateModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!reEvalResult ? (
                /* Configuration Form */
                <div className="space-y-4">
                  {!transcriptExists && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-lg">
                      Sorry, no transcript recorded for this student chat.
                    </div>
                  )}

                  {reEvalError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded-lg">
                      {reEvalError}
                    </div>
                  )}

                  {/* Rubric Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Rubric</label>
                    <select
                      value={reEvalRubricId || ''}
                      onChange={(e) => setReEvalRubricId(Number(e.target.value) || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      disabled={!transcriptExists}
                    >
                      {rubricsList.map((r: any) => (
                        <option key={r.rubric_id} value={r.rubric_id}>
                          {r.rubric_name} {r.is_system_default ? '(Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">AI Model</label>
                    <select
                      value={reEvalModelId}
                      onChange={(e) => setReEvalModelId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      disabled={!transcriptExists}
                    >
                      {modelsList.map((m: any) => (
                        <option key={m.model_id} value={m.model_id}>
                          {m.model_name} {m.default_model ? '(Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Rubric Details Preview */}
                  {selectedRubricDetails && selectedRubricDetails.criteria && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-sm text-gray-700 mb-2">Rubric Criteria Preview</h4>
                      <div className="space-y-2 text-sm">
                        {selectedRubricDetails.criteria.map((c: any, i: number) => (
                          <div key={i} className="border-b border-gray-200 pb-2 last:border-0">
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-800">Q{i + 1}. {c.name || c.criteria_id}</span>
                              <span className="text-gray-500">{c.max_points} pts</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">{c.question_text}</p>
                          </div>
                        ))}
                        <div className="text-right text-gray-600 font-medium pt-2 border-t">
                          Total: {selectedRubricDetails.total_points} points
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Show Prompt Checkbox */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="showReEvalPrompt"
                      checked={reEvalShowPrompt}
                      onChange={(e) => setReEvalShowPrompt(e.target.checked)}
                      disabled={!transcriptExists}
                      className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    />
                    <label htmlFor="showReEvalPrompt" className="text-sm text-gray-700">
                      Display evaluation AI prompt
                    </label>
                  </div>

                  {/* Prompt Preview */}
                  {reEvalShowPrompt && reEvalPrompt && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Evaluation Prompt Preview
                      </label>
                      <textarea
                        value={reEvalPrompt}
                        readOnly
                        className="w-full h-48 border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50"
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* Results Display with Side-by-Side Comparison */
                <div className="space-y-4">
                  {/* Side-by-Side Score Comparison */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <div className="text-xs text-gray-500 uppercase mb-1">Original</div>
                      <span className={`text-2xl font-bold ${getScoreColor(originalEvaluation?.score)}`}>
                        {originalEvaluation?.score ?? '—'}/{originalEvaluation?.criteria?.reduce((sum: number, c: any) => sum + (c.max_score || 0), 0) || 15}
                      </span>
                      <div className="text-xs text-gray-500 mt-2">
                        <div>Rubric: {rubricsList.find((r: any) => r.rubric_id === originalEvaluation?.rubric_id)?.rubric_name || 'Default'}</div>
                        <div>Model: {modelsList.find((m: any) => m.model_id === originalEvaluation?.super_model)?.model_name || originalEvaluation?.super_model || 'Unknown'}</div>
                      </div>
                    </div>
                    <div className={`p-4 rounded-lg border-2 ${reEvalEditMode ? 'bg-purple-50 border-purple-200' : 'bg-green-50 border-green-200'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <div className={`text-xs uppercase ${reEvalEditMode ? 'text-purple-600' : 'text-green-600'}`}>New</div>
                        <button
                          onClick={() => setReEvalEditMode(!reEvalEditMode)}
                          className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
                            reEvalEditMode
                              ? 'bg-purple-200 text-purple-700'
                              : 'bg-green-200 text-green-700 hover:bg-green-300'
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                          {reEvalEditMode ? 'Editing' : 'Edit'}
                        </button>
                      </div>
                      {reEvalEditMode ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={reEvalResult.score}
                            onChange={(e) => setReEvalResult({ ...reEvalResult, score: parseInt(e.target.value) || 0 })}
                            className="w-16 text-2xl font-bold border border-purple-300 rounded px-2 py-1 text-center"
                            min="0"
                            max={selectedRubricDetails?.total_points || 15}
                          />
                          <span className="text-2xl font-bold text-gray-400">/{selectedRubricDetails?.total_points || 15}</span>
                        </div>
                      ) : (
                        <>
                          <span className={`text-2xl font-bold ${getScoreColor(reEvalResult.score)}`}>
                            {reEvalResult.score}/{selectedRubricDetails?.total_points || 15}
                          </span>
                          {reEvalResult.score !== originalEvaluation?.score && (
                            <span className={`ml-2 text-sm ${reEvalResult.score > (originalEvaluation?.score || 0) ? 'text-green-600' : 'text-red-600'}`}>
                              ({reEvalResult.score > (originalEvaluation?.score || 0) ? '+' : ''}{reEvalResult.score - (originalEvaluation?.score || 0)})
                            </span>
                          )}
                        </>
                      )}
                      <div className={`text-xs mt-2 ${reEvalEditMode ? 'text-purple-700' : 'text-green-700'}`}>
                        <div>Rubric: {rubricsList.find((r: any) => r.rubric_id === reEvalRubricId)?.rubric_name || 'Default'}</div>
                        <div>Model: {modelsList.find((m: any) => m.model_id === reEvalModelId)?.model_name || reEvalModelId}</div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Comparison */}
                  <div>
                    <h4 className="font-medium text-gray-700 mb-2">Summary</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-3 rounded-lg text-sm">
                        <div className="text-xs text-gray-500 mb-1">Original</div>
                        <p className="text-gray-600">{originalEvaluation?.summary || '—'}</p>
                      </div>
                      <div className={`p-3 rounded-lg text-sm border ${reEvalEditMode ? 'bg-purple-50 border-purple-200' : 'bg-green-50 border-green-200'}`}>
                        <div className={`text-xs mb-1 ${reEvalEditMode ? 'text-purple-600' : 'text-green-600'}`}>New</div>
                        {reEvalEditMode ? (
                          <textarea
                            value={reEvalResult.summary}
                            onChange={(e) => setReEvalResult({ ...reEvalResult, summary: e.target.value })}
                            className="w-full border border-purple-300 rounded px-2 py-1 text-sm min-h-[80px]"
                          />
                        ) : (
                          <p className="text-gray-800">{reEvalResult.summary}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Criteria Scores Comparison */}
                  <div>
                    <h4 className="font-medium text-gray-700 mb-2">Criteria Scores</h4>
                    {reEvalResult.criteria?.map((c: any, i: number) => {
                      const origCriteria = originalEvaluation?.criteria?.[i];
                      const scoreDiff = c.score - (origCriteria?.score || 0);
                      return (
                        <div key={i} className={`text-sm border-b border-gray-200 py-3 last:border-0 ${reEvalEditMode ? 'bg-purple-50 -mx-2 px-2 rounded' : ''}`}>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-700 flex-1">{c.question}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-gray-400 w-8 text-right">{origCriteria?.score ?? '—'}</span>
                              <span className="text-gray-400">→</span>
                              {reEvalEditMode ? (
                                <input
                                  type="number"
                                  value={c.score}
                                  onChange={(e) => {
                                    const newCriteria = [...reEvalResult.criteria];
                                    newCriteria[i] = { ...newCriteria[i], score: parseInt(e.target.value) || 0 };
                                    const newTotal = newCriteria.reduce((sum, cr) => sum + (cr.score || 0), 0);
                                    setReEvalResult({ ...reEvalResult, criteria: newCriteria, score: newTotal });
                                  }}
                                  className="w-12 border border-purple-300 rounded px-1 py-0.5 text-center font-medium"
                                  min="0"
                                  max={c.max_score}
                                />
                              ) : (
                                <span className="font-medium text-gray-800 w-12">{c.score}/{c.max_score}</span>
                              )}
                              {!reEvalEditMode && scoreDiff !== 0 && (
                                <span className={`text-xs w-8 ${scoreDiff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  ({scoreDiff > 0 ? '+' : ''}{scoreDiff})
                                </span>
                              )}
                            </div>
                          </div>
                          {reEvalEditMode ? (
                            <textarea
                              value={c.feedback}
                              onChange={(e) => {
                                const newCriteria = [...reEvalResult.criteria];
                                newCriteria[i] = { ...newCriteria[i], feedback: e.target.value };
                                setReEvalResult({ ...reEvalResult, criteria: newCriteria });
                              }}
                              className="w-full mt-1 border border-purple-300 rounded px-2 py-1 text-xs min-h-[40px]"
                            />
                          ) : (
                            <p className="text-gray-500 text-xs mt-1">{c.feedback}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Prompt Used (if requested) */}
                  {reEvalShowPrompt && reEvalResult.prompt && (
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">Prompt Used</h4>
                      <textarea
                        value={reEvalResult.prompt}
                        readOnly
                        className="w-full h-32 border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="p-4 border-t flex justify-end gap-2">
              {!reEvalResult ? (
                <>
                  <button
                    onClick={() => setShowReEvaluateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReEvaluate}
                    disabled={!transcriptExists || reEvalLoading}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {reEvalLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Evaluating with {modelsList.find((m: any) => m.model_id === reEvalModelId)?.model_name || reEvalModelId}...</span>
                      </>
                    ) : (
                      <span>Re-evaluate</span>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowReEvaluateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                  >
                    Do Not Save
                  </button>
                  <button
                    onClick={handleSaveReEvaluation}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Save This Re-evaluation
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
