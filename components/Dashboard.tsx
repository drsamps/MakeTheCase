


import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/apiClient'; // Dashboard with tiles/list view toggle

interface DashboardProps {
  onLogout: () => void;
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
}

interface EvaluationData {
  student_id: string;
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
}

interface Model {
  model_id: string;
  model_name: string;
  enabled: boolean;
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

const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [sectionStats, setSectionStats] = useState<SectionStat[]>([]);
  const [selectedSection, setSelectedSection] = useState<SectionStat | null>(null);
  const [studentDetails, setStudentDetails] = useState<StudentDetail[]>([]);
  const [modelsMap, setModelsMap] = useState<Map<string, string>>(new Map());
  const [modelsList, setModelsList] = useState<Model[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('completion_time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Section list filter: show only enabled sections by default
  const [showAllSections, setShowAllSections] = useState(false);
  
  // Section list view mode: tiles (cards) or list (table)
  const [sectionViewMode, setSectionViewMode] = useState<'tiles' | 'list'>('tiles');
  
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
    enabled: true
  });

  // Fetch models
  useEffect(() => {
    const fetchModels = async () => {
      const { data, error } = await api
        .from('models')
        .select('model_id, model_name, enabled');
      
      if (error) {
        console.error('Failed to fetch models', error);
      } else if (data) {
        setModelsMap(new Map((data as any[]).map(m => [m.model_id, m.model_name])));
        setModelsList(data as Model[]);
      }
    };
    fetchModels();
  }, []);

  const fetchSectionStats = useCallback(async () => {
    setIsLoadingSections(true);
    setError(null);

    const { data: sections, error: sectionsError } = await api
      .from('sections')
      .select('section_id, section_title, year_term, chat_model, super_model, enabled')
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

  const fetchStudentDetails = useCallback(async (sectionId: string) => {
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
    const { data: evaluationsData, error: evaluationsError } = await api
      .from('evaluations')
      .select('student_id, score, hints, helpful, created_at, chat_model, super_model, summary, criteria, transcript, liked, improve')
      .in('student_id', studentIds);
  
    if (evaluationsError) {
      console.error("MySQL error fetching evaluations:", evaluationsError);
      const detailsWithoutScores = studentsData.map(student => ({
        id: student.id,
        full_name: student.full_name,
        persona: student.persona,
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
      }));
      setStudentDetails(detailsWithoutScores);
      setIsLoadingDetails(false);
      return;
    }
    
    const evaluationsMap = new Map<string, EvaluationData>();
    if (Array.isArray(evaluationsData)) {
      for (const e of evaluationsData) {
        if (e && e.student_id) {
          evaluationsMap.set(e.student_id, e as EvaluationData);
        }
      }
    }
    
    const combinedDetails = studentsData.map(student => {
      const evaluation = evaluationsMap.get(student.id);
      const hasEvaluation = evaluation !== undefined;
      const hasStarted = student.finished_at !== null || hasEvaluation;
      
      let status: 'completed' | 'in_progress' | 'not_started' = 'not_started';
      if (hasEvaluation) {
        status = 'completed';
      } else if (hasStarted) {
        status = 'in_progress';
      }
      
      return {
        id: student.id,
        full_name: student.full_name,
        persona: student.persona,
        completion_time: evaluation?.created_at ?? student.finished_at,
        score: evaluation?.score ?? null,
        hints: evaluation?.hints ?? null,
        helpful: evaluation?.helpful ?? null,
        chat_model: evaluation?.chat_model ?? null,
        super_model: evaluation?.super_model ?? null,
        summary: evaluation?.summary ?? null,
        criteria: evaluation?.criteria ?? null,
        transcript: evaluation?.transcript ?? null,
        liked: evaluation?.liked ?? null,
        improve: evaluation?.improve ?? null,
        created_at: student.created_at,
        status,
      };
    });
  
    setStudentDetails(combinedDetails);
    setIsLoadingDetails(false);
  }, []);

  useEffect(() => {
    fetchSectionStats();
  }, [fetchSectionStats]);

  useEffect(() => {
    if (selectedSection) {
      fetchStudentDetails(selectedSection.section_id);
    }
  }, [selectedSection, fetchStudentDetails]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh && selectedSection) {
      autoRefreshIntervalRef.current = setInterval(() => {
        fetchStudentDetails(selectedSection.section_id);
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
  }, [autoRefresh, selectedSection, fetchStudentDetails, fetchSectionStats]);

  const handleSectionClick = (section: SectionStat) => {
    setSelectedSection(section);
    setSortKey('completion_time');
    setSortDirection('desc');
    setSearchQuery('');
    setFilterMode('all');
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
    return sectionStats.filter(s => s.enabled !== false || s.section_id === 'unassigned' || s.section_id === 'other_courses');
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
  }, [studentDetails, sortKey, sortDirection, filterMode, searchQuery]);

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
        const cols = ['id','created_at','first_name','last_name','full_name','persona','section_id','finished_at'];
        const vals = [
          sqlValue(st.id),
          sqlValue(st.created_at),
          sqlValue(st.first_name),
          sqlValue(st.last_name),
          sqlValue(st.full_name),
          sqlValue(st.persona),
          sqlValue(st.section_id),
          sqlValue(st.finished_at),
        ];
        const updates = ['created_at=VALUES(created_at)','first_name=VALUES(first_name)','last_name=VALUES(last_name)','full_name=VALUES(full_name)','persona=VALUES(persona)','section_id=VALUES(section_id)','finished_at=VALUES(finished_at)'];
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
      enabled: section.enabled !== false
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
            enabled: sectionForm.enabled
          })
          .eq('section_id', sectionForm.section_id);
        
        if (error) throw error;
      } else {
        // Create new section
        const { error } = await api
          .from('sections')
          .insert({
            section_id: sectionForm.section_id,
            section_title: sectionForm.section_title,
            year_term: sectionForm.year_term,
            chat_model: sectionForm.chat_model || null,
            super_model: sectionForm.super_model || null,
            enabled: sectionForm.enabled
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
      not_started: 'Not Started',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full border ${styles[status]}`}>
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

  // Incomplete students count for alerts
  const incompleteCount = useMemo(() => {
    return studentDetails.filter(s => s.status === 'in_progress').length;
  }, [studentDetails]);
  
  // Count of disabled sections for showing in toggle
  const disabledSectionsCount = useMemo(() => {
    return sectionStats.filter(s => s.enabled === false && s.section_id !== 'unassigned').length;
  }, [sectionStats]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Header */}
      <header className="flex-shrink-0 flex justify-between items-center px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Instructor Dashboard</h1>
          <span className="text-xs font-medium text-gray-500">(MySQL Database)</span>
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
              window.location.hash = '';
            }}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 p-2 rounded-md hover:bg-gray-100 transition-colors"
          >
            to CEO chatbot
          </a>
          <button onClick={onLogout} className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-md hover:bg-gray-100">
            <span>Sign Out</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content - Two Screen Layout */}
      <main className="flex-1 overflow-y-auto">
        {!selectedSection ? (
          /* ==================== SCREEN 1: SECTION LIST ==================== */
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

                {/* View Mode Toggle: Tiles / List */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
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
                      section.enabled === false ? 'opacity-75' : ''
                    }`}
                    onClick={() => handleSectionClick(section)}
                  >
                    {/* Card Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`font-semibold text-lg truncate ${
                            section.enabled === false ? 'text-gray-500' : 'text-gray-900'
                          }`}>
                            {section.section_title}
                          </h3>
                          {section.enabled === false && section.section_id !== 'unassigned' && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded-full flex-shrink-0">
                              disabled
                            </span>
                          )}
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
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                        </svg>
                        <span className="text-gray-600">
                          <span className="font-semibold text-gray-900">{section.completions}</span>/{section.starts}
                        </span>
                      </div>
                      {section.inProgress > 0 && (
                        <span className="flex items-center gap-1.5 text-yellow-600 font-medium">
                          <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-yellow-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                          </span>
                          {section.inProgress} active
                        </span>
                      )}
                    </div>

                    {/* Model Info */}
                    {(section.chat_model || section.super_model) && (
                      <div className="text-xs text-gray-500 space-y-0.5 border-t border-gray-100 pt-3">
                        {section.chat_model && (
                          <div className="truncate">Chat: {modelsMap.get(section.chat_model) || section.chat_model}</div>
                        )}
                        {section.super_model && (
                          <div className="truncate">Super: {modelsMap.get(section.super_model) || section.super_model}</div>
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Students</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chat Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Super Model</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSections.map(section => (
                      <tr 
                        key={section.section_id}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                          section.enabled === false ? 'opacity-70' : ''
                        }`}
                        onClick={() => handleSectionClick(section)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${section.enabled === false ? 'text-gray-500' : 'text-gray-900'}`}>
                              {section.section_title}
                            </span>
                            {section.enabled === false && section.section_id !== 'unassigned' && (
                              <span className="px-1.5 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded">
                                disabled
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                            {section.year_term}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          <span className="font-semibold text-gray-900">{section.completions}</span>/{section.starts}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {section.inProgress > 0 ? (
                            <span className="flex items-center gap-1.5 text-yellow-600 text-sm font-medium">
                              <span className="flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-yellow-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                              </span>
                              {section.inProgress} active
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                          {section.chat_model ? (modelsMap.get(section.chat_model) || section.chat_model) : <span className="text-gray-300">default</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                          {section.super_model ? (modelsMap.get(section.super_model) || section.super_model) : <span className="text-gray-300">default</span>}
                        </td>
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
        ) : (
          /* ==================== SCREEN 2: SECTION RESULTS ==================== */
          <div className="p-6 max-w-7xl mx-auto">
            {/* Breadcrumb Navigation */}
            <nav className="mb-6">
              <ol className="flex items-center gap-2 text-sm">
                <li>
                  <button
                    onClick={handleBackToSections}
                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 hover:underline"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                    </svg>
                    Sections
                  </button>
                </li>
                <li className="text-gray-400">/</li>
                <li className="text-gray-900 font-medium">{selectedSection.section_title}</li>
                {selectedSection.enabled === false && selectedSection.section_id !== 'unassigned' && (
                  <li>
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded-full">
                      disabled
                    </span>
                  </li>
                )}
              </ol>
            </nav>

            {error && <p className="mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">{error}</p>}
            
            {/* Section Summary Stats */}
            {sectionSummaryStats && sectionSummaryStats.totalStudents > 0 && (
              <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Completion Rate</div>
                  <div className="text-2xl font-bold text-gray-900">{sectionSummaryStats.completionRate.toFixed(0)}%</div>
                  <div className="text-xs text-gray-400">{sectionSummaryStats.completedStudents} of {sectionSummaryStats.totalStudents}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Avg Score</div>
                  <div className="text-2xl font-bold text-gray-900">{sectionSummaryStats.avgScore !== null ? sectionSummaryStats.avgScore.toFixed(1) : 'N/A'}</div>
                  <div className="text-xs text-gray-400">out of 15</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Avg Hints</div>
                  <div className="text-2xl font-bold text-gray-900">{sectionSummaryStats.avgHints !== null ? sectionSummaryStats.avgHints.toFixed(1) : 'N/A'}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="text-sm text-gray-500">Avg Helpful</div>
                  <div className="text-2xl font-bold text-gray-900">{sectionSummaryStats.avgHelpful !== null ? sectionSummaryStats.avgHelpful.toFixed(1) : 'N/A'}</div>
                  <div className="text-xs text-gray-400">out of 5</div>
                </div>
                {incompleteCount > 0 && (
                  <div className="bg-yellow-50 rounded-lg shadow-sm border border-yellow-200 p-4 col-span-2">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium text-yellow-800">{incompleteCount} student{incompleteCount !== 1 ? 's' : ''} in progress</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Score Distribution Chart */}
            {sectionSummaryStats && sectionSummaryStats.completedStudents > 0 && (
              <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Score Distribution</h3>
                <ScoreChart distribution={scoreDistribution} />
              </div>
            )}

            {/* Student Table */}
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
              <div className="p-4 border-b">
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedSection.section_title}</h2>
                    <p className="text-sm text-gray-500">{selectedSection.year_term}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Search */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search students..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48"
                      />
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* Filter */}
                    <select
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="all">All Students</option>
                      <option value="completed">Completed</option>
                      <option value="in_progress">In Progress</option>
                      <option value="not_started">Not Started</option>
                    </select>

                    {/* CSV Export */}
                    <button
                      onClick={handleDownloadCSV}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      Export CSV
                    </button>

                    {/* Edit Section */}
                    {selectedSection.section_id !== 'unassigned' && (
                      <button
                        onClick={() => handleEditSection(selectedSection)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                        Edit Section
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div>
                {isLoadingDetails ? (
                  <div className="p-6 text-center text-gray-500">Loading student data...</div>
                ) : !studentDetails.length ? (
                  <div className="p-6 text-center text-gray-500">No students have started the simulation for this section yet.</div>
                ) : !sortedStudentDetails.length ? (
                  <div className="p-6 text-center text-gray-500">No students match the current filter.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <SortableHeader label="Student" sortableKey="full_name" />
                          <SortableHeader label="Status" sortableKey="status" />
                          <SortableHeader label="Persona" sortableKey="persona" />
                          <SortableHeader label="Score" sortableKey="score" />
                          <SortableHeader label="Hints" sortableKey="hints" />
                          <SortableHeader label="Helpful" sortableKey="helpful" />
                          <SortableHeader label="Time" sortableKey="completion_time" />
                          <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {sortedStudentDetails.map(student => (
                          <tr key={student.id} className={`hover:bg-gray-50 ${student.status === 'in_progress' ? 'bg-yellow-50' : ''}`}>
                            <td className="p-3 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">{student.full_name}</div>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <StatusBadge status={student.status} />
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                              {student.persona ? student.persona.charAt(0).toUpperCase() + student.persona.slice(1) : <span className="text-gray-400">-</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm text-gray-900">
                              {student.score !== null ? (
                                <span className={`font-medium ${student.score >= 12 ? 'text-green-600' : student.score >= 8 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {student.score}/15
                                </span>
                              ) : <span className="text-gray-400">-</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                              {student.hints !== null ? student.hints : <span className="text-gray-400">-</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                              {student.helpful !== null ? `${student.helpful.toFixed(1)}/5` : <span className="text-gray-400">-</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm text-gray-600">
                              {student.completion_time ? new Date(student.completion_time).toLocaleString() : <span className="text-gray-400">-</span>}
                            </td>
                            <td className="p-3 whitespace-nowrap text-sm">
                              <div className="flex gap-1">
                                {student.transcript && (
                                  <button
                                    onClick={() => { setSelectedStudent(student); setShowTranscriptModal(true); }}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                    title="View transcript"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                                {student.summary && (
                                  <button
                                    onClick={() => { setSelectedStudent(student); setShowEvaluationModal(true); }}
                                    className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                                    title="View evaluation"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
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
          </div>
        )}
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
    </div>
  );
};

export default Dashboard;
