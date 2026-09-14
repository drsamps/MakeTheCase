import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import { defaultSectionTitle, tryMintSectionId } from '../../utils/academicIds.js';
import type { Course, Semester } from '../../types';
import { useSemesterFilter } from './semesterFilter';

/** The fields of a section row this modal reads when editing. */
export interface EditableSection {
  section_id: string;
  section_title: string;
  chat_model: string | null;
  super_model: string | null;
  enabled?: boolean | number;
  accept_new_students?: boolean | number;
  enrollment_key?: string | null;
  semester_id?: number | null;
  course_id?: number | null;
  course_id_num?: number | null;
  section_number?: number | null;
  primary_instructor_name?: string | null;
}

export interface SectionFormDefaults {
  semesterId?: number | null;
  courseId?: number | null;
  chatModel?: string | null;
  superModel?: string | null;
}

interface ModelOption {
  model_id: string;
  model_name: string;
  enabled?: boolean | number;
}

interface Props {
  /** null = create */
  section: EditableSection | null;
  defaults?: SectionFormDefaults;
  models: ModelOption[];
  isAdmin: boolean;
  onClose: () => void;
  /** Called after every successful save (including each "Save & add another"). */
  onSaved: (message: string) => void;
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100';
const readOnlyClass = 'px-3 py-2 text-sm bg-gray-100 border border-gray-200 rounded-lg truncate';

const SectionFormModal: React.FC<Props> = ({ section, defaults, models, isAdmin, onClose, onSaved }) => {
  const isEdit = Boolean(section);
  // Creating a section, or moving one to another course/semester/number, is course structure:
  // admin-only on the server (sections.js, courses.js). Instructors edit the rest.
  const canRestructure = isAdmin;
  const originalCourseId = section ? (section.course_id_num ?? section.course_id ?? null) : null;

  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // New sections default to the semester chosen in the dashboard header (when one is), then the current one.
  const { semesterId: headerSemesterId } = useSemesterFilter();
  const [semesterId, setSemesterId] = useState<number | null>(
    section ? (section.semester_id ?? null) : (defaults?.semesterId ?? headerSemesterId ?? null)
  );
  const [courseId, setCourseId] = useState<number | null>(originalCourseId ?? defaults?.courseId ?? null);
  const [sectionNumber, setSectionNumber] = useState<string>(section?.section_number != null ? String(section.section_number) : '');
  const [overrideId, setOverrideId] = useState(false);
  const [manualId, setManualId] = useState('');
  const [title, setTitle] = useState(section?.section_title ?? '');
  // Latch: once the instructor types a title, stop re-deriving it. Clearing the field releases it.
  const [titleEdited, setTitleEdited] = useState(isEdit);
  const [chatModel, setChatModel] = useState(section?.chat_model ?? defaults?.chatModel ?? '');
  const [superModel, setSuperModel] = useState(section?.super_model ?? defaults?.superModel ?? '');
  const [primaryInstructorId, setPrimaryInstructorId] = useState('');
  const [instructorEdited, setInstructorEdited] = useState(false);
  const [enabled, setEnabled] = useState(section ? Boolean(section.enabled) : true);
  const [acceptNew, setAcceptNew] = useState(section ? Boolean(section.accept_new_students) : false);
  const [enrollmentKey, setEnrollmentKey] = useState(section?.enrollment_key ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [semRes, courseRes, instRes] = await Promise.all([
        api.get<Semester[]>('/semesters'),
        api.get<Course[]>('/courses'),
        api.get<any[]>('/instructors'),
      ]);
      if (semRes.error || courseRes.error) {
        setLoadError(semRes.error?.message || courseRes.error?.message || 'Failed to load');
        return;
      }
      const semList = semRes.data || [];
      setSemesters(semList);
      setCourses(courseRes.data || []);
      setInstructors((instRes.data || []).filter((i: any) => i.active && !i.is_system_account));
      // New sections default to the current semester.
      setSemesterId((prev) => prev ?? semList.find((s) => s.is_current)?.id ?? null);
    })();
  }, []);

  const semester = semesters.find((s) => s.id === semesterId) || null;
  const course = courses.find((c) => c.id === courseId) || null;

  // Next free section number whenever the course or semester changes (create only).
  const refreshNextNumber = useCallback(async () => {
    if (isEdit || !courseId || !semesterId) return;
    const { data } = await api.get<{ section_number: number }>(`/courses/${courseId}/next-section?semester_id=${semesterId}`);
    if (data) setSectionNumber(String(data.section_number));
  }, [isEdit, courseId, semesterId]);

  // A different course or semester has a different next number, even if one was typed.
  useEffect(() => {
    refreshNextNumber();
  }, [refreshNextNumber]);

  // Primary instructor follows the course owner until chosen explicitly.
  useEffect(() => {
    if (!isEdit && !instructorEdited) setPrimaryInstructorId(course?.primary_instructor_id || '');
  }, [isEdit, instructorEdited, course]);

  const suggestedTitle = course && sectionNumber ? defaultSectionTitle(course.course_name, sectionNumber) : '';
  useEffect(() => {
    if (!titleEdited && suggestedTitle) setTitle(suggestedTitle);
  }, [titleEdited, suggestedTitle]);

  const minted = useMemo(() => {
    if (!semester || !course || !sectionNumber) return { id: '', error: null as string | null };
    return tryMintSectionId(semester.semester_code, course.course_code, Number(sectionNumber));
  }, [semester, course, sectionNumber]);

  const handleSave = async (addAnother: boolean) => {
    setError(null);
    if (!isEdit && !canRestructure) { setError('Only admins can create sections.'); return; }
    if (!semesterId) { setError('Please select a semester.'); return; }
    if (!courseId && !isEdit && (!manualId.trim() || !title.trim())) {
      setError('A section without a course needs a Section ID and title.');
      return;
    }
    if (courseId && !isEdit && !overrideId && minted.error) { setError(minted.error); return; }

    setSaving(true);
    let result: { data: any; error: { message: string } | null };
    if (isEdit && section) {
      const body: Record<string, unknown> = {
        section_title: title.trim() || section.section_title,
        enabled,
        accept_new_students: acceptNew,
        enrollment_key: enrollmentKey.trim() || null,
      };
      // Only send admin/primary-only fields that changed, so a TA can still save a title.
      if ((section.chat_model ?? '') !== chatModel) body.chat_model = chatModel || null;
      if ((section.super_model ?? '') !== superModel) body.super_model = superModel || null;
      if (canRestructure) {
        if ((section.semester_id ?? null) !== semesterId) body.semester_id = semesterId;
        if (originalCourseId !== courseId) body.course_id = courseId;
        const originalNumber = section.section_number != null ? String(section.section_number) : '';
        if (courseId && sectionNumber !== originalNumber) body.section_number = sectionNumber ? Number(sectionNumber) : null;
      }
      result = await api.patch(`/sections/${encodeURIComponent(section.section_id)}`, body);
    } else {
      const body = {
        semester_id: semesterId,
        course_id: courseId,
        section_number: courseId && sectionNumber ? Number(sectionNumber) : undefined,
        section_id: overrideId || !courseId ? manualId.trim() : undefined,
        section_title: title.trim() || undefined,
        chat_model: chatModel || null,
        super_model: superModel || null,
        primary_instructor_id: primaryInstructorId || null,
        enabled,
        accept_new_students: acceptNew,
        enrollment_key: enrollmentKey.trim() || null,
      };
      result = courseId
        ? await api.post(`/courses/${courseId}/sections`, body)
        : await api.post('/sections', body);
    }
    setSaving(false);

    if (result.error) { setError(result.error.message); return; }
    const savedId = result.data?.section_id ?? section?.section_id;
    onSaved(isEdit ? `Section ${savedId} updated` : `Section ${savedId} created`);

    if (addAnother && !isEdit) {
      setTitleEdited(false);
      setOverrideId(false);
      setManualId('');
      await refreshNextNumber();
    } else {
      onClose();
    }
  };

  const enabledModels = models.filter((m) => m.enabled);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Section' : 'Create Section'}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}

          {!isEdit && !canRestructure && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              Only admins can create sections. Ask an admin to add one for you.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Semester {canRestructure && <span className="text-red-500">*</span>}</label>
            {canRestructure ? (
              <select value={semesterId ?? ''} onChange={(e) => setSemesterId(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
                <option value="">— Select semester —</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.semester_name} ({s.semester_code}){s.is_current ? ' — Current' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className={readOnlyClass} title="Only admins can move a section to another semester">
                {semester ? `${semester.semester_name} (${semester.semester_code})` : '—'}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
            {canRestructure ? (
              <select value={courseId ?? ''} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
                <option value="">No course (unassigned)</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.course_name} ({c.course_code})</option>
                ))}
              </select>
            ) : (
              <div className={readOnlyClass} title="Only admins can move a section to another course">
                {course ? `${course.course_name} (${course.course_code})` : 'No course (unassigned)'}
              </div>
            )}
          </div>

          {courseId && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section #</label>
                {canRestructure ? (
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={sectionNumber}
                    onChange={(e) => setSectionNumber(e.target.value)}
                    className={inputClass}
                  />
                ) : (
                  <div className={readOnlyClass} title="Only admins can renumber a section">{sectionNumber || '—'}</div>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Section ID</label>
                {isEdit ? (
                  <div className="px-3 py-2 text-sm font-mono bg-gray-100 border border-gray-200 rounded-lg truncate" title="Section IDs never change after creation">
                    {section?.section_id}
                  </div>
                ) : overrideId ? (
                  <input value={manualId} onChange={(e) => setManualId(e.target.value)} maxLength={20} className={`${inputClass} font-mono`} />
                ) : (
                  <div className={`px-3 py-2 text-sm font-mono border rounded-lg truncate ${minted.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-900'}`}>
                    {minted.id || '—'}
                  </div>
                )}
              </div>
            </div>
          )}
          {courseId && !isEdit && (
            <div className="-mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                {minted.error && !overrideId ? <span className="text-red-600">{minted.error}</span> : 'Format: {semester}-{course}-{section #}'}
              </p>
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={overrideId}
                  onChange={(e) => { setOverrideId(e.target.checked); if (e.target.checked && !manualId) setManualId(minted.id); }}
                  className="rounded"
                />
                Override ID
              </label>
            </div>
          )}
          {!courseId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section ID {!isEdit && <span className="text-red-500">*</span>}</label>
              {isEdit ? (
                <div className="px-3 py-2 text-sm font-mono bg-gray-100 border border-gray-200 rounded-lg">{section?.section_id}</div>
              ) : (
                <input value={manualId} onChange={(e) => setManualId(e.target.value)} maxLength={20} placeholder="e.g., workshop-2026" className={`${inputClass} font-mono`} />
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section Title</label>
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleEdited(e.target.value !== ''); }}
              placeholder={suggestedTitle || 'e.g., GSCM 410 - Ops Mgt - Sec 1'}
              className={inputClass}
            />
            {isEdit && suggestedTitle && title !== suggestedTitle && (
              <button type="button" onClick={() => setTitle(suggestedTitle)} className="mt-1 text-xs text-indigo-600 hover:underline">
                Use “{suggestedTitle}”
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chat Model</label>
            <select value={chatModel} onChange={(e) => setChatModel(e.target.value)} className={inputClass}>
              <option value="">Default</option>
              {enabledModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor Model</label>
            <select value={superModel} onChange={(e) => setSuperModel(e.target.value)} className={inputClass}>
              <option value="">Default</option>
              {enabledModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_name}</option>)}
            </select>
          </div>

          {isEdit ? (
            section?.primary_instructor_name && (
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-700">Primary Instructor:</span> {section.primary_instructor_name}
              </p>
            )
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Primary Instructor</label>
              <select
                value={primaryInstructorId}
                onChange={(e) => { setPrimaryInstructorId(e.target.value); setInstructorEdited(true); }}
                className={inputClass}
              >
                <option value="">{course ? '— Course owner —' : '— None —'}</option>
                {instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name || i.email}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Defaults to the course owner. Student chats use this instructor's API keys.</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Section Enabled (visible to students)
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={acceptNew} onChange={(e) => setAcceptNew(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Accept new student enrollments
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Enrollment key (optional)</label>
            <input value={enrollmentKey} onChange={(e) => setEnrollmentKey(e.target.value)} placeholder="e.g. doit" className={inputClass} />
            <p className="mt-1 text-xs text-gray-500">
              If set, new students must enter this code to self-enroll. Leave blank to allow any BYU CAS user to join while "Accept" is on.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            {isEdit ? 'Cancel' : 'Close'}
          </button>
          {!isEdit && courseId && canRestructure && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
            >
              Save & add another
            </button>
          )}
          {(isEdit || canRestructure) && (
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Section'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SectionFormModal;
