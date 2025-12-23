

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/apiClient';

interface DashboardProps {
  onLogout: () => void;
}

interface SectionStat {
  section_id: string;
  section_title: string;
  year_term: string;
  starts: number;
  completions: number;
  chat_model: string | null;
  super_model: string | null;
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
}

// FIX: Added an interface for the evaluation data to ensure type safety.
interface EvaluationData {
  student_id: string;
  score: number | null;
  hints: number | null;
  helpful: number | null;
  created_at: string;
  chat_model: string | null;
  super_model: string | null;
}

type SortKey = 'full_name' | 'persona' | 'score' | 'hints' | 'helpful' | 'completion_time' | 'chat_model' | 'super_model';
type SortDirection = 'asc' | 'desc';

const Dashboard: React.FC<DashboardProps> = ({ onLogout }) => {
  const [sectionStats, setSectionStats] = useState<SectionStat[]>([]);
  const [selectedSection, setSelectedSection] = useState<SectionStat | null>(null);
  const [studentDetails, setStudentDetails] = useState<StudentDetail[]>([]);
  const [modelsMap, setModelsMap] = useState<Map<string, string>>(new Map());
  const [isLoadingSections, setIsLoadingSections] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('completion_time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showOnlyCompleted, setShowOnlyCompleted] = useState(false);

  useEffect(() => {
    const fetchModels = async () => {
        const { data, error } = await api
            .from('models')
            .select('model_id, model_name');
        
        if (error) {
            console.error('Failed to fetch models', error);
        } else if (data) {
            setModelsMap(new Map((data as any[]).map(m => [m.model_id, m.model_name])));
        }
    };
    fetchModels();
  }, []);

  const fetchSectionStats = useCallback(async () => {
    setIsLoadingSections(true);
    setError(null);

    const { data: sections, error: sectionsError } = await api
      .from('sections')
      .select('section_id, section_title, year_term, chat_model, super_model')
      .eq('enabled', true)
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
      .select('id, section_id');

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

    const stats: SectionStat[] = (sections as any[] || []).map(section => {
      const sectionStudents = (students as any[] || []).filter(s => s.section_id === section.section_id);
      const completions = sectionStudents.filter(s => completedStudentIds.has(s.id)).length;
      return {
        ...section,
        starts: sectionStudents.length,
        completions: completions,
      };
    });

    const assignedStudentSectionIds = new Set((sections as any[] || []).map(s => s.section_id));
    const unassignedStudents = (students as any[] || []).filter(s => !s.section_id || !assignedStudentSectionIds.has(s.section_id));

    if (unassignedStudents.length > 0) {
        const unassignedCompletions = unassignedStudents.filter(s => completedStudentIds.has(s.id)).length;
        const unassignedSectionStat: SectionStat = {
            section_id: 'unassigned',
            section_title: 'Not in a course',
            year_term: 'unassigned',
            starts: unassignedStudents.length,
            completions: unassignedCompletions,
            chat_model: null,
            super_model: null,
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
  
    // Step 1: Fetch students for the given section.
    // FIX: A type error was resolved by declaring the types for `studentsData` and `studentsError`
    // before they are conditionally assigned within the `if`/`else` blocks.
    let studentsData: { id: string, full_name: string, persona: string | null, finished_at: string | null, section_id: string | null }[] | null = null;
    let studentsError: any = null;

    if (sectionId === 'unassigned') {
        const { data: allStudents, error: allStudentsError } = await api
            .from('students')
            // FIX: Add section_id to the select statement to allow filtering on it.
            .select('id, full_name, persona, finished_at, section_id');
        
        if (allStudentsError) {
            studentsData = null;
            studentsError = allStudentsError;
        } else {
            const { data: sections, error: sectionsError } = await api
                .from('sections')
                .select('section_id')
                .eq('enabled', true);
            
            if (sectionsError) {
                setError('Failed to get sections to filter unassigned students.');
                setIsLoadingDetails(false);
                return;
            }

            const assignedSectionIds = new Set((sections as any[] || []).map(s => s.section_id));
            studentsData = (allStudents as any[] || []).filter(s => !s.section_id || !assignedSectionIds.has(s.section_id));
            studentsError = null;
        }
    } else {
        const { data, error } = await api
            .from('students')
            // FIX: Add section_id to maintain type consistency for studentsData.
            .select('id, full_name, persona, finished_at, section_id')
            .eq('section_id', sectionId);
        studentsData = data as any;
        studentsError = error;
    }
  
    if (studentsError) {
      console.error(studentsError);
      setError('Failed to load students. This may be a database permission issue. Check the RLS policy on the "students" table.');
      setIsLoadingDetails(false);
      return;
    }
  
    if (!studentsData || studentsData.length === 0) {
      setStudentDetails([]);
      setIsLoadingDetails(false);
      return;
    }
  
    // Step 2: Fetch evaluations for the loaded students.
    const studentIds = studentsData.map(s => s.id);
    const { data: evaluationsData, error: evaluationsError } = await api
      .from('evaluations')
      .select('student_id, score, hints, helpful, created_at, chat_model, super_model')
      .in('student_id', studentIds);
  
    if (evaluationsError) {
      console.error("MySQL error fetching evaluations:", evaluationsError);
      // Graceful handling: show students but indicate evaluations failed with a more specific error.
      const detailedMessage = `Loaded students, but failed to get their evaluations. DB Error: ${evaluationsError.message}`;
      setError(detailedMessage);
      
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
      }));
      setStudentDetails(detailsWithoutScores);
      setIsLoadingDetails(false);
      return;
    }
    
    // Step 3: Join the data on the client-side.
    const evaluationsMap = new Map<string, EvaluationData>();
    if (Array.isArray(evaluationsData)) {
      for (const e of evaluationsData) {
        // FIX: Correctly typed the evaluationsMap to resolve errors when accessing evaluation properties.
        // This also adds a null check to prevent potential runtime errors if the data array contains nullish values.
        if (e && e.student_id) {
          evaluationsMap.set(e.student_id, e as EvaluationData);
        }
      }
    }
    
    const combinedDetails = studentsData.map(student => {
      const evaluation = evaluationsMap.get(student.id);
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

  const handleSectionClick = (section: SectionStat) => {
    setSelectedSection(section);
    setSortKey('completion_time');
    setSortDirection('desc');
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'full_name' || key === 'persona' ? 'asc' : 'desc');
    }
  };

  const sortedStudentDetails = useMemo(() => {
    const filteredDetails = showOnlyCompleted
      ? studentDetails.filter(student => student.completion_time !== null)
      : studentDetails;

    return [...filteredDetails].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];

      if (valA === null) return 1;
      if (valB === null) return -1;
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [studentDetails, sortKey, sortDirection, showOnlyCompleted]);

  // Export to MySQL helpers and action
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
    // handle ISO date strings
    if (typeof val === 'string') {
      // try to normalize ISO timestamps to 'YYYY-MM-DD HH:MM:SS'
      const d = new Date(val);
      if (!isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
        const ts = d.toISOString().slice(0, 19).replace('T', ' ');
        return `'${sqlEscapeString(ts)}'`;
      }
      return `'${sqlEscapeString(val)}'`;
    }
    // JSON/object
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
      // Fetch all tables (exclude admins)
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

      // models
      for (const m of models) {
        const cols = ['model_id','model_name','enabled','default_model','input_cost','output_cost'];
        const vals = [
          sqlValue(m.model_id),
          sqlValue(m.model_name),
          sqlValue(m.enabled),
          // Supabase has column named 'default'; map to MySQL 'default_model'
          sqlValue((m as any).default),
          sqlValue(m.input_cost),
          sqlValue(m.output_cost),
        ];
        const updates = ['model_name=VALUES(model_name)','enabled=VALUES(enabled)','default_model=VALUES(default_model)','input_cost=VALUES(input_cost)','output_cost=VALUES(output_cost)'];
        lines.push(`INSERT INTO models (${cols.join(',')}) VALUES (${vals.join(',')}) ON DUPLICATE KEY UPDATE ${updates.join(',')};`);
      }

      // sections
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

      // students
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

      // evaluations
      for (const e of evaluations) {
        const cols = ['id','created_at','student_id','score','summary','criteria','persona','hints','helpful','liked','improve','chat_model','super_model','transcript'];
        const vals = [
          sqlValue(e.id),
          sqlValue(e.created_at),
          sqlValue(e.student_id),
          sqlValue(e.score),
          sqlValue(e.summary),
          // criteria is JSON
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

  const SortableHeader = ({ label, sortableKey }: { label: string; sortableKey: SortKey }) => (
    <th
      onClick={() => handleSort(sortableKey)}
      className="p-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
  
  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 font-sans">
      <header className="flex-shrink-0 flex justify-between items-center px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Instructor Dashboard</h1>
          <span className="text-xs font-medium text-gray-500">(MySQL Database)</span>
        </div>
        <div className="flex items-center gap-4">
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
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-80 flex-shrink-0 bg-white border-r border-gray-200 p-4 overflow-y-auto">
          <div className="flex justify-between items-center px-2 pb-2 mb-2 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Course Sections</h2>
            <button
                onClick={() => fetchSectionStats()}
                disabled={isLoadingSections}
                className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md disabled:opacity-50"
                aria-label="Refresh sections"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${isLoadingSections ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm-1 9a1 1 0 011-1h5a1 1 0 110 2H5a1 1 0 01-1-1zm11-1a1 1 0 100 2h-5a1 1 0 100-2h5z" clipRule="evenodd" />
                </svg>
            </button>
          </div>
          {isLoadingSections && !sectionStats.length ? (
            <div className="text-center p-4 text-gray-500">Loading sections...</div>
          ) : (
          <>
            <ul className="space-y-1">
              {sectionStats.map(section => (
                <li key={section.section_id}>
                  <button
                    className={`w-full text-left p-3 rounded-lg transition-colors ${selectedSection?.section_id === section.section_id ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}
                    onClick={() => handleSectionClick(section)}
                  >
                    <div className={`font-semibold ${selectedSection?.section_id === section.section_id ? 'text-blue-900' : 'text-gray-800'}`}>{section.section_title}</div>
                    <div className="flex justify-between items-center text-sm mt-1">
                      <span className={`${selectedSection?.section_id === section.section_id ? 'text-blue-700' : 'text-gray-500'}`}>{section.completions} / {section.starts} completed</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${selectedSection?.section_id === section.section_id ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-700'}`}>{section.year_term}</span>
                    </div>
                     <div className="text-xs mt-2 text-gray-500">
                        {section.chat_model && (<div>Chat: {modelsMap.get(section.chat_model) || section.chat_model}</div>)}
                        {section.super_model && (<div>Super: {modelsMap.get(section.super_model) || section.super_model}</div>)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 p-2 border-t">
              <button
                onClick={handleDownloadToMySQL}
                disabled={isExporting}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-white ${isExporting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
                title="Generate a .sql file to upsert data into MySQL"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 014.5 2h11A1.5 1.5 0 0117 3.5v7a1.5 1.5 0 01-1.5 1.5H12l-2 2-2-2H4.5A1.5 1.5 0 013 10.5v-7zm2 1a.5.5 0 00-.5.5v5A.5.5 0 005 10h10a.5.5 0 00.5-.5v-5a.5.5 0 00-.5-.5H5z" clipRule="evenodd" />
                </svg>
                {isExporting ? 'Preparing SQL…' : 'Download to MySQL'}
              </button>
              <p className="mt-1 text-xs text-gray-500">Exports models, sections, students, evaluations. Admins are not exported.</p>
              <a
                href="./docs/mysql-database-structure-Oct2025.sql"
                download
                className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                Download MySQL ceochat table structure
              </a>
            </div>
          </>
          )}
        </nav>
        <main className="flex-1 p-6 overflow-y-auto">
          {!selectedSection ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-4 text-gray-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
              <p className="text-lg font-medium text-gray-700">Select a section</p>
              <p>Choose a course section from the sidebar to view student details.</p>
            </div>
          ) : (
            <>
              {error && <p className="mb-4 bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">{error}</p>}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{selectedSection.section_title}</h2>
                        <p className="text-sm text-gray-500">{selectedSection.year_term}</p>
                    </div>
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="showOnlyCompleted"
                            checked={showOnlyCompleted}
                            onChange={(e) => setShowOnlyCompleted(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <label htmlFor="showOnlyCompleted" className="ml-2 block text-sm font-medium text-gray-900 cursor-pointer">
                            Only show completed
                        </label>
                    </div>
                </div>
                <div>
                  {isLoadingDetails ? (
                    <div className="p-6 text-center text-gray-500">Loading student data...</div>
                  ) : !studentDetails.length ? (
                    <div className="p-6 text-center text-gray-500">No students have started the simulation for this section yet.</div>
                  ) : !sortedStudentDetails.length ? (
                    <div className="p-6 text-center text-gray-500">No completed students to display.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <SortableHeader label="Student Name" sortableKey="full_name" />
                            <SortableHeader label="CEO Persona" sortableKey="persona" />
                            <SortableHeader label="Score" sortableKey="score" />
                            <SortableHeader label="Hints" sortableKey="hints" />
                            <SortableHeader label="Helpful" sortableKey="helpful" />
                            <SortableHeader label="Chat Model" sortableKey="chat_model" />
                            <SortableHeader label="Super Model" sortableKey="super_model" />
                            <SortableHeader label="Completion Time" sortableKey="completion_time" />
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {sortedStudentDetails.map(student => (
                            <tr key={student.id} className="hover:bg-gray-50">
                              <td className="p-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.full_name}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-900">{student.persona ? student.persona.charAt(0).toUpperCase() + student.persona.slice(1) : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-900">{student.score !== null ? `${student.score} / 15` : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-900">{student.hints !== null ? student.hints : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-900">{student.helpful !== null ? `${student.helpful.toFixed(1)} / 5` : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-500">{student.chat_model ? (modelsMap.get(student.chat_model) || student.chat_model) : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-500">{student.super_model ? (modelsMap.get(student.super_model) || student.super_model) : <span className="text-gray-400">N/A</span>}</td>
                              <td className="p-4 whitespace-nowrap text-sm text-gray-900">{student.completion_time ? new Date(student.completion_time).toLocaleString() : <span className="text-gray-500 font-medium">Not Completed</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;