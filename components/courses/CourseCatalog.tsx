import React, { useCallback, useEffect, useState } from 'react';
import { api, getApiBaseUrl, getImpersonationId } from '../../services/apiClient';
import { courseCodeError, normalizeCode } from '../../utils/academicIds.js';
import { quote } from '../../utils/confirmLabels';
import type { Course, CourseSection } from '../../types';
import SectionFormModal, { SectionFormDefaults } from './SectionFormModal';
import CourseCasesPanel from './CourseCasesPanel';
import ScheduleCasesModal from './ScheduleCasesModal';
import RolloverModal from './RolloverModal';
import { useSemesterFilter } from './semesterFilter';

interface ModelOption {
  model_id: string;
  model_name: string;
  enabled?: boolean | number;
}

interface Props {
  isAdmin: boolean;
  /** Logged-in instructor id (course owners may add sections). */
  userId?: string | null;
  models: ModelOption[];
  /** Tell the Dashboard its section list is stale. */
  onSectionsChanged?: () => void;
}

interface SemesterGroup {
  semesterId: number | null;
  semesterCode: string | null;
  semesterName: string;
  sections: CourseSection[];
}

/** Sections arrive newest semester first; keep that order while grouping. */
function groupBySemester(sections: CourseSection[]): SemesterGroup[] {
  const groups: SemesterGroup[] = [];
  const byKey = new Map<string, SemesterGroup>();
  for (const s of sections) {
    const key = String(s.semester_id ?? 'none');
    let group = byKey.get(key);
    if (!group) {
      group = {
        semesterId: s.semester_id,
        semesterCode: s.semester_code,
        semesterName: s.semester_name || 'No semester',
        sections: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sections.push(s);
  }
  return groups;
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${localStorage.getItem('admin_auth_token')}` };
  const actAs = getImpersonationId();
  if (actAs) headers['X-Act-As-Instructor'] = actAs;
  return headers;
}

const CourseCatalog: React.FC<Props> = ({ isAdmin, userId, models, onSectionsChanged }) => {
  // The catalog spans semesters by design and is NOT filtered by the header selector; it only
  // uses the chosen semester as a default (rollover source here, new-section semester in SectionFormModal).
  const { semesterId: headerSemesterId } = useSemesterFilter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [details, setDetails] = useState<Map<number, CourseSection[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [orphans, setOrphans] = useState<any[]>([]);
  const [instructors, setInstructors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [courseModal, setCourseModal] = useState<{ course: Course | null } | null>(null);
  const [sectionModal, setSectionModal] = useState<{ defaults: SectionFormDefaults } | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{ courseId: number; semesterId: number; semesterName: string; sections: CourseSection[] } | null>(null);
  const [rolloverCourse, setRolloverCourse] = useState<Course | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 4000);
  };

  const loadCourse = useCallback(async (courseId: number) => {
    const { data, error: loadError } = await api.get<Course>(`/courses/${courseId}`);
    if (loadError) { setError(loadError.message); return; }
    setDetails((prev) => new Map(prev).set(courseId, data?.sections || []));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await api.get<Course[]>('/courses');
    setLoading(false);
    if (loadError) { setError(loadError.message); return; }
    setCourses(data || []);
    if (isAdmin) {
      const [orphanRes, instRes] = await Promise.all([api.get<any[]>('/sections/orphaned'), api.get<any[]>('/instructors')]);
      setOrphans(orphanRes.data || []);
      setInstructors((instRes.data || []).filter((i: any) => i.active && !i.is_system_account));
    }
  }, [isAdmin]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Any expanded course without loaded sections gets loaded -- including ones expanded
  // from a save callback, whose closure cannot see the updated `expanded` set.
  useEffect(() => {
    for (const id of expanded) {
      if (!details.has(id)) loadCourse(id);
    }
  }, [expanded, details, loadCourse]);

  const refreshAfterSectionChange = useCallback(async () => {
    await loadAll();
    setDetails(new Map()); // the effect above reloads whatever is expanded
    onSectionsChanged?.();
  }, [loadAll, onSectionsChanged]);

  const toggleExpanded = (courseId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const canManageCourse = (course: Course) => isAdmin || (!!userId && course.primary_instructor_id === userId);

  const handleDeleteCourse = async (course: Course) => {
    if (!confirm(`Delete course ${quote(course.course_name)} (${course.course_code})?`)) return;
    const url = `${getApiBaseUrl()}/courses/${course.id}`;
    // Without ?cascade the server refuses a course that has sections and reports what would go.
    const first = await fetch(url, { method: 'DELETE', headers: authHeaders() }).then((r) => r.json());
    if (first.data?.requires_cascade) {
      const { sections_count, students_count, assignments_count } = first.data;
      const ok = confirm(
        `${quote(course.course_name)} still has sections. Deleting it permanently removes, across ALL semesters:\n\n` +
        `• ${sections_count} section(s)\n• ${assignments_count} case assignment(s)\n• ${students_count} student enrollment(s)\n\n` +
        `This cannot be undone.`
      );
      if (!ok) return;
      const second = await fetch(`${url}?cascade=true`, { method: 'DELETE', headers: authHeaders() }).then((r) => r.json());
      if (second.error) { setError(second.error.message); return; }
      flash(`Deleted course ${quote(course.course_name)} and ${second.data.sections_deleted} section(s)`);
    } else if (first.error) {
      setError(first.error.message);
      return;
    } else {
      flash(`Deleted course ${quote(course.course_name)}`);
    }
    await refreshAfterSectionChange();
  };

  const handleAssignOrphan = async (sectionId: string, courseId: number) => {
    const { error: assignError } = await api.put(`/courses/${courseId}/sections/${encodeURIComponent(sectionId)}/assign`);
    if (assignError) { setError(assignError.message); return; }
    flash(`Section ${sectionId} assigned to course`);
    await refreshAfterSectionChange();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Courses</h2>
          <p className="text-sm text-gray-500">
            Courses carry over from semester to semester. Each semester's offering is the course's sections in that semester.
          </p>
        </div>
        {/* Course structure (courses, sections, rollover) is admin-only on the server. */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSectionModal({ defaults: {} })}
              className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100"
            >
              + Add section
            </button>
            <button
              onClick={() => setCourseModal({ course: null })}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              + New Course
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-100 border border-red-200 text-red-700 p-3 rounded-lg flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800" aria-label="Dismiss">✕</button>
        </div>
      )}
      {message && <div className="mb-4 bg-green-100 border border-green-200 text-green-700 p-3 rounded-lg">{message}</div>}

      {loading && courses.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading courses…</div>
      ) : courses.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No courses yet.{isAdmin ? ' Create one to get started.' : ''}</div>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => {
            const isOpen = expanded.has(course.id);
            const sections = details.get(course.id);
            const codeWarning = courseCodeError(course.course_code);
            return (
              <div key={course.id} className="bg-white border border-gray-200 rounded-lg">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <button onClick={() => toggleExpanded(course.id)} className="flex items-start gap-2 text-left min-w-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 mt-0.5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{course.course_name}</h3>
                        <code className="text-sm font-mono text-gray-500">{course.course_code}</code>
                      </div>
                      <div className="text-sm mt-1">
                        {course.primary_instructor_name ? (
                          <span className="text-emerald-700"><span className="font-medium">Owner:</span> {course.primary_instructor_name}</span>
                        ) : (
                          <span className="text-amber-700"><span className="font-medium">Owner:</span> <em>not set</em></span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(course.semesters || []).length === 0 ? (
                          <span className="text-xs text-gray-400">No sections yet</span>
                        ) : (course.semesters || []).map((s) => (
                          <span key={s.semester_id} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded-full" title={s.semester_name}>
                            {s.semester_code} · {s.section_count} sec
                          </span>
                        ))}
                      </div>
                      {codeWarning && (
                        <p className="text-xs text-amber-700 mt-1">Course ID can't be used in new section IDs: {codeWarning}</p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => setSectionModal({ defaults: { courseId: course.id } })}
                          className="px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 rounded"
                        >
                          + Add section
                        </button>
                        {(course.semesters || []).length > 0 && (
                          <button
                            onClick={() => setRolloverCourse(course)}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 rounded"
                            title="Copy this course's sections and case setup into another semester"
                          >
                            Roll over…
                          </button>
                        )}
                        <button
                          onClick={() => setCourseModal({ course })}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCourse(course)}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {course.description && isOpen && <p className="px-4 -mt-2 pb-2 text-sm text-gray-600">{course.description}</p>}

                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-4">
                    {!sections ? (
                      <p className="text-sm text-gray-500">Loading sections…</p>
                    ) : sections.length === 0 ? (
                      <p className="text-sm text-gray-500">No sections in any semester yet.</p>
                    ) : groupBySemester(sections).map((group) => (
                      <div key={String(group.semesterId)}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-700">
                            {group.semesterName}
                            {group.semesterCode && <code className="ml-2 text-xs font-mono text-gray-400">{group.semesterCode}</code>}
                          </h4>
                          {group.semesterId && (
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setScheduleModal({ courseId: course.id, semesterId: group.semesterId as number, semesterName: group.semesterName, sections: group.sections })}
                                className="text-xs font-medium text-blue-700 hover:underline"
                              >
                                Schedule cases…
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => setSectionModal({ defaults: { courseId: course.id, semesterId: group.semesterId } })}
                                  className="text-xs font-medium text-green-700 hover:underline"
                                >
                                  + Add section
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 uppercase">
                                <th className="py-1 pr-3">#</th>
                                <th className="py-1 pr-3">Section ID</th>
                                <th className="py-1 pr-3">Title</th>
                                <th className="py-1 pr-3">Instructor</th>
                                <th className="py-1 pr-3 text-right">Students</th>
                                <th className="py-1 pr-3 text-right">Cases</th>
                                <th className="py-1">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {group.sections.map((s) => (
                                <tr key={s.section_id}>
                                  <td className="py-1.5 pr-3 text-gray-500">{s.section_number ?? <span title="Legacy section id without a number">—</span>}</td>
                                  <td className="py-1.5 pr-3 font-mono text-gray-800">{s.section_id}</td>
                                  <td className="py-1.5 pr-3 text-gray-900">{s.section_title}</td>
                                  <td className="py-1.5 pr-3 text-gray-600">{s.primary_instructor_name || '—'}</td>
                                  <td className="py-1.5 pr-3 text-right text-gray-600">{s.student_count}</td>
                                  <td className="py-1.5 pr-3 text-right text-gray-600">{s.case_count}</td>
                                  <td className="py-1.5">
                                    <span className={`px-2 py-0.5 text-xs rounded-full ${s.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                      {s.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                    {sections && (
                      <CourseCasesPanel
                        courseId={course.id}
                        canManage={canManageCourse(course)}
                        sections={sections}
                        onChanged={() => loadCourse(course.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && orphans.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Unassigned Sections</h3>
          <p className="text-sm text-gray-500 mb-3">
            These sections are not part of any course. Assigning one keeps its Section ID and gives it the next section number in its semester.
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2">
            {orphans.map((section) => (
              <div key={section.section_id} className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-lg p-3 border border-yellow-200">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{section.section_title}</span>
                  <span className="text-sm font-mono text-gray-500 ml-2">{section.section_id}</span>
                  {section.year_term && <span className="text-sm text-gray-500 ml-2">• {section.year_term}</span>}
                  <div className="text-xs text-gray-400 mt-0.5">{section.student_count || 0} students • {section.case_count || 0} cases</div>
                </div>
                <select
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                  defaultValue=""
                  disabled={!section.semester_id}
                  title={section.semester_id ? '' : 'Set this section\'s semester first (Sections tab → Edit)'}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAssignOrphan(section.section_id, Number(e.target.value));
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">Assign to course…</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.course_name} ({c.course_code})</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {courseModal && (
        <CourseFormModal
          course={courseModal.course}
          instructors={instructors}
          onClose={() => setCourseModal(null)}
          onSaved={async (text) => {
            setCourseModal(null);
            flash(text);
            await refreshAfterSectionChange();
          }}
        />
      )}

      {rolloverCourse && (
        <RolloverModal
          mode="course"
          courseId={rolloverCourse.id}
          courseName={rolloverCourse.course_name}
          fromSemesterId={
            // Roll from the header semester when the course has sections there, else its newest semester.
            (rolloverCourse.semesters || []).find((s) => s.semester_id === headerSemesterId)?.semester_id
              ?? rolloverCourse.semesters?.[0]?.semester_id ?? null
          }
          onClose={() => setRolloverCourse(null)}
          onDone={async (text) => {
            const courseId = rolloverCourse.id;
            setRolloverCourse(null);
            flash(text);
            setExpanded((prev) => new Set(prev).add(courseId));
            await refreshAfterSectionChange();
          }}
        />
      )}

      {scheduleModal && (
        <ScheduleCasesModal
          {...scheduleModal}
          onClose={() => setScheduleModal(null)}
          onSaved={(text) => {
            setScheduleModal(null);
            flash(text);
            onSectionsChanged?.();
          }}
        />
      )}

      {sectionModal && (
        <SectionFormModal
          section={null}
          defaults={sectionModal.defaults}
          models={models}
          isAdmin={isAdmin}
          onClose={() => setSectionModal(null)}
          onSaved={(text) => {
            flash(text);
            if (sectionModal.defaults.courseId) {
              setExpanded((prev) => new Set(prev).add(sectionModal.defaults.courseId as number));
            }
            refreshAfterSectionChange();
          }}
        />
      )}
    </div>
  );
};

interface CourseFormProps {
  course: Course | null;
  instructors: any[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const CourseFormModal: React.FC<CourseFormProps> = ({ course, instructors, onClose, onSaved }) => {
  const [name, setName] = useState(course?.course_name ?? '');
  const [code, setCode] = useState(course?.course_code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(course));
  const [description, setDescription] = useState(course?.description ?? '');
  const [ownerId, setOwnerId] = useState(course?.primary_instructor_id ?? '');
  const [cascade, setCascade] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest a code from the name ("GSCM 410 - Ops Mgt" -> "gscm410") until one is typed.
  const suggestedCode = normalizeCode((name.split(/\s+-\s+/)[0] || '').replace(/\s+/g, '')).slice(0, 12);
  const effectiveCode = codeTouched ? normalizeCode(code) : suggestedCode;
  const codeChanged = !course || effectiveCode !== course.course_code;
  const codeError = codeChanged ? courseCodeError(effectiveCode) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Course name is required.'); return; }
    if (codeError) { setError(codeError); return; }
    setSaving(true);
    setError(null);
    const body = {
      course_name: name.trim(),
      course_code: effectiveCode,
      description: description.trim() || null,
      primary_instructor_id: ownerId || null,
      ...(course ? { cascade_to_sections: cascade } : {}),
    };
    const result = course ? await api.put(`/courses/${course.id}`, body) : await api.post('/courses', body);
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved(course ? `Course ${quote(body.course_name)} updated` : `Course ${quote(body.course_name)} (${effectiveCode}) created`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">{course ? 'Edit Course' : 'Create Course'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., GSCM 410 - Ops Mgt"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">Section titles default to “{name || 'Course Name'} - Sec 1”.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course ID *</label>
            <input
              value={codeTouched ? code : suggestedCode}
              onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }}
              placeholder="e.g., gscm410"
              maxLength={20}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
            <p className={`text-xs mt-1 ${codeError ? 'text-red-600' : 'text-gray-500'}`}>
              {codeError || `Used in section IDs, e.g. f26-${effectiveCode || 'gscm410'}-1. Lowercase letters, numbers, underscores.`}
            </p>
            {course && codeChanged && !codeError && (
              <p className="text-xs text-amber-700 mt-1">Existing section IDs keep the old course ID; only new sections use the new one.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes about this course"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course Owner</label>
            <p className="text-xs text-gray-500 mb-1">Controls this course's cases and sections in every semester. New sections default to this instructor.</p>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
              <option value="">— No owner (admins only) —</option>
              {instructors.map((i: any) => <option key={i.id} value={i.id}>{i.full_name || i.email}</option>)}
            </select>
          </div>
          {course && ownerId && ownerId !== course.primary_instructor_id && (
            <label className="flex items-start gap-2 bg-blue-50 p-3 rounded-lg">
              <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} className="rounded mt-0.5" />
              <span className="text-sm text-gray-700">
                Also make this instructor the primary instructor of every section of this course (all semesters)
              </span>
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : course ? 'Save Changes' : 'Create Course'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CourseCatalog;
