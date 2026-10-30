import React, { useEffect, useState } from 'react';
import { api } from '../services/apiClient';
import { activityTypeInfo, useActivityTypeList } from '../services/activityTypeList';
import SubmissionForm from './SubmissionForm';

interface Choice { section_id: string; section_label: string; case_id: string; case_title: string }

/**
 * Students screen: an instructor adds or replaces a student's work for an activity that takes a
 * submission (StudyChat D6). The server checks the caller manages the section.
 */
const StudentSubmissionModal: React.FC<{ student: { id: string; full_name: string }; onClose: () => void }> = ({ student, onClose }) => {
  const rev = useActivityTypeList();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sections } = await api.get<{ section_id: string; section_title?: string }[]>(`/students/${encodeURIComponent(student.id)}/sections`);
      const found: Choice[] = [];
      for (const s of sections || []) {
        const { data: cases } = await api.get<{ case_id: string; case_title: string; activity_type?: string }[]>(`/sections/${encodeURIComponent(s.section_id)}/cases`);
        for (const c of cases || []) {
          if (activityTypeInfo(c.activity_type).material === 'student_submission') {
            found.push({ section_id: s.section_id, section_label: s.section_title || s.section_id, case_id: c.case_id, case_title: c.case_title });
          }
        }
      }
      if (!cancelled) setChoices(found);
    })();
    return () => { cancelled = true; };
  }, [student.id, rev]);

  const choice = choices?.[picked];
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-3">
        <h3 className="text-xl font-bold">Submission for {student.full_name}</h3>
        {choices === null && <p className="text-sm text-gray-500">Loading…</p>}
        {choices?.length === 0 && <p className="text-sm text-gray-600">None of this student's sections has an activity that takes a submission.</p>}
        {choices && choices.length > 1 && (
          <label className="block text-sm">
            <span className="text-gray-700">Activity</span>
            <select value={picked} onChange={(e) => setPicked(Number(e.target.value))} className="mt-1 w-full rounded border border-gray-300 px-2 py-1">
              {choices.map((c, i) => <option key={`${c.section_id}:${c.case_id}`} value={i}>{c.case_title} ({c.section_label})</option>)}
            </select>
          </label>
        )}
        {choice && (
          <SubmissionForm
            key={`${choice.section_id}:${choice.case_id}`}
            sectionId={choice.section_id}
            caseId={choice.case_id}
            studentId={student.id}
            title={choice.case_title}
            help="A chat in progress keeps the version it started with. New chats use the newest one."
          />
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
};

export default StudentSubmissionModal;
