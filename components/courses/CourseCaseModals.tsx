import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import type { CourseSection } from '../../types';

/**
 * Modals for a course's case list and the settings versions its sections follow (migration 078),
 * used by Assignments > By course (CourseAssignments.tsx).
 *
 *   Main            the course's settings for a case, in every semester
 *   semester copy   a tweaked copy shared by some of one semester's sections
 *   Customized      a section with its own settings for the case
 */

/** One section's row for a case, from GET /api/courses/:id/cases. Scheduling is always per section. */
export interface CourseCaseSectionRow {
  section_id: string;
  case_id: string;
  version_id: number | null;
  semester_id: number | null;
  semester_code: string | null;
  semester_name: string | null;
  section_number: number | null;
  active: boolean;
  open_date: string | null;
  close_date: string | null;
  manual_status: string | null;
}

export interface VersionRow {
  version_id: number;
  semester_id: number | null;
  semester_code: string | null;
  semester_name: string | null;
  is_main: boolean;
  label: string;
  rubric_id: number | null;
  sections: CourseCaseSectionRow[];
}

export interface CourseCaseRow {
  course_case_id: number;
  case_id: string;
  case_title: string;
  versions: VersionRow[];
  customized_sections: CourseCaseSectionRow[];
}

/** A case on some of the course's sections but not on the course list. */
export interface UnlistedCaseRow {
  case_id: string;
  case_title: string;
  sections: CourseCaseSectionRow[];
}

/** Sections grouped by semester, preserving newest-first order. */
export function groupSections(sections: CourseSection[]) {
  const groups: { semesterId: number | null; label: string; sections: CourseSection[] }[] = [];
  for (const s of sections) {
    let g = groups.find((x) => x.semesterId === s.semester_id);
    if (!g) {
      g = { semesterId: s.semester_id, label: s.semester_name ? `${s.semester_name} (${s.semester_code})` : 'No semester', sections: [] };
      groups.push(g);
    }
    g.sections.push(s);
  }
  return groups;
}

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
      <div className="flex justify-between items-center p-4 border-b">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close">✕</button>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
      {footer && <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">{footer}</div>}
    </div>
  </div>
);

export const AddCaseModal: React.FC<{
  courseId: number;
  existingCaseIds: string[];
  /** Sections offered; the newest semester among them is ticked by default. */
  sections: CourseSection[];
  /** Preselect a case, e.g. "Make course-wide" for a case already on some sections. */
  initialCaseId?: string;
  /** With initialCaseId: start Main from this section's settings. */
  fromSectionId?: string;
  onClose: () => void;
  /** Receives the added case's id. */
  onSaved: (caseId: string) => void;
}> = ({ courseId, existingCaseIds, sections, initialCaseId, fromSectionId, onClose, onSaved }) => {
  const [cases, setCases] = useState<any[]>([]);
  const [caseId, setCaseId] = useState(initialCaseId || '');
  const groups = useMemo(() => groupSections(sections), [sections]);
  // Default: the newest semester's sections get the case.
  const [selected, setSelected] = useState<Set<string>>(new Set(groups[0]?.sections.map((s) => s.section_id) || []));
  const [fromSection, setFromSection] = useState('');
  const [sectionsWithCase, setSectionsWithCase] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existingKey = existingCaseIds.join(',');
  useEffect(() => {
    const existing = new Set(existingKey.split(','));
    api.get<any[]>('/cases').then(({ data }) => setCases((data || []).filter((c) => c.enabled && !existing.has(c.case_id))));
  }, [existingKey]);

  // Sections of this course that already have the chosen case (their settings can seed Main).
  useEffect(() => {
    setFromSection(caseId && caseId === initialCaseId && fromSectionId ? fromSectionId : '');
    if (!caseId) { setSectionsWithCase([]); return; }
    Promise.all(sections.map((s) => api.get<any[]>(`/sections/${encodeURIComponent(s.section_id)}/cases`)))
      .then((results) => setSectionsWithCase(
        sections.filter((_, i) => (results[i].data || []).some((sc: any) => sc.case_id === caseId)).map((s) => s.section_id)
      ));
  }, [caseId, sections, initialCaseId, fromSectionId]);

  const save = async () => {
    if (!caseId) { setError('Choose a case.'); return; }
    setSaving(true);
    const { error: saveError } = await api.post(`/courses/${courseId}/cases`, {
      case_id: caseId,
      from_section_id: fromSection || undefined,
      section_ids: [...selected],
    });
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved(caseId);
  };

  return (
    <Modal title="Add case to course" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg disabled:opacity-50">{saving ? 'Adding…' : 'Add case'}</button>
      </>
    }>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Case</span>
        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
          <option value="">— Select a case —</option>
          {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_title} ({c.case_id})</option>)}
        </select>
      </label>
      {sectionsWithCase.length > 0 && (
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Start Main from</span>
          <select value={fromSection} onChange={(e) => setFromSection(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
            <option value="">Default chat options</option>
            {sectionsWithCase.map((id) => <option key={id} value={id}>{id}'s current settings</option>)}
          </select>
        </label>
      )}
      <div className="text-sm">
        <span className="font-medium text-gray-700">Give this case to these sections</span>
        <p className="text-xs text-gray-500 mb-1">They get it inactive, following Main. Schedule and activate it afterwards. Sections added later get it automatically.</p>
        {groups.map((g) => (
          <div key={String(g.semesterId)} className="mt-2">
            <div className="text-xs font-semibold text-gray-500">{g.label}</div>
            {g.sections.map((s) => (
              <label key={s.section_id} className="flex items-center gap-2 ml-2">
                <input type="checkbox" className="rounded" checked={selected.has(s.section_id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.section_id); else next.delete(s.section_id);
                    setSelected(next);
                  }} />
                <span className="font-mono text-xs">{s.section_id}</span>
                <span className="text-gray-600">{s.section_title}</span>
                {sectionsWithCase.includes(s.section_id) && <span className="text-xs text-amber-700">(has it; will follow Main)</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
};

export const SemesterCopyModal: React.FC<{
  row: CourseCaseRow;
  from: VersionRow;
  sections: CourseSection[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ row, from, sections, onClose, onSaved }) => {
  const groups = useMemo(() => groupSections(sections).filter((g) => g.semesterId != null), [sections]);
  const [semesterId, setSemesterId] = useState<number | null>(from.semester_id ?? groups[0]?.semesterId ?? null);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const group = groups.find((g) => g.semesterId === semesterId);

  const save = async () => {
    if (!semesterId) { setError('Choose a semester.'); return; }
    if (!label.trim()) { setError('Give the copy a label, e.g. "Evening sections".'); return; }
    setSaving(true);
    const { error: saveError } = await api.post(`/case-versions/${from.version_id}/clone`, {
      semester_id: semesterId, label: label.trim(), section_ids: [...selected],
    });
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved();
  };

  return (
    <Modal title={`Semester copy of ${row.case_title}`} onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg disabled:opacity-50">{saving ? 'Creating…' : 'Create copy'}</button>
      </>
    }>
      <p className="text-sm text-gray-600">
        Copies <strong>{from.is_main ? 'Main' : from.label}</strong>. Sections you pick follow the copy instead; edits to the copy change only them.
      </p>
      {groups.length === 0 ? (
        <p className="text-sm text-amber-700">This course has no sections in any semester yet.</p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Semester</span>
            <select value={semesterId ?? ''} disabled={from.semester_id != null}
              onChange={(e) => { setSemesterId(Number(e.target.value)); setSelected(new Set()); }}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100">
              {groups.map((g) => <option key={String(g.semesterId)} value={g.semesterId ?? ''}>{g.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="e.g., Evening sections"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </label>
          <div className="text-sm">
            <span className="font-medium text-gray-700">Sections that follow the copy</span>
            {(group?.sections || []).map((s) => (
              <label key={s.section_id} className="flex items-center gap-2 ml-2">
                <input type="checkbox" className="rounded" checked={selected.has(s.section_id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.section_id); else next.delete(s.section_id);
                    setSelected(next);
                  }} />
                <span className="font-mono text-xs">{s.section_id}</span>
                <span className="text-gray-600">{s.section_title}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
};

export const FollowersModal: React.FC<{
  courseId: number;
  row: CourseCaseRow;
  sections: CourseSection[];
  canManage: boolean;
  onClose: () => void;
}> = ({ courseId, row, sections, canManage, onClose }) => {
  const [current, setCurrent] = useState(row);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const followOf = (sectionId: string): string => {
    const v = current.versions.find((x) => x.sections.some((s) => s.section_id === sectionId));
    if (v) return String(v.version_id);
    if (current.customized_sections.some((s) => s.section_id === sectionId)) return 'customized';
    return 'none';
  };

  const change = async (section: CourseSection, value: string) => {
    const was = followOf(section.section_id);
    if (value === was) return;
    if (value !== 'customized' && was !== 'none') {
      const v = current.versions.find((x) => String(x.version_id) === value);
      if (!confirm(`Make ${section.section_id} follow "${v?.is_main ? 'Main' : v?.label}"?\n\nIts current settings for this case are replaced. Its schedule is kept.`)) return;
    }
    setBusy(section.section_id);
    setError(null);
    const { error: saveError } = await api.put(
      `/sections/${encodeURIComponent(section.section_id)}/cases/${encodeURIComponent(row.case_id)}/version`,
      { version_id: value === 'customized' ? null : Number(value) }
    );
    if (saveError) setError(saveError.message);
    const { data } = await api.get<CourseCaseRow[]>(`/courses/${courseId}/cases`);
    const fresh = (data || []).find((r) => r.case_id === row.case_id);
    if (fresh) setCurrent(fresh);
    setBusy(null);
  };

  return (
    <Modal title={`Who follows what — ${row.case_title}`} onClose={onClose} footer={
      <button onClick={onClose} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg">Done</button>
    }>
      <p className="text-xs text-gray-500">
        Following a version replaces the section's settings for this case with the version's, now and whenever the version is edited.
        Customized keeps the section's own settings.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {sections.map((s) => {
            const value = followOf(s.section_id);
            const options = current.versions.filter((v) => v.is_main || v.semester_id === s.semester_id);
            return (
              <tr key={s.section_id}>
                <td className="py-1.5 pr-2 font-mono text-xs">{s.section_id}</td>
                <td className="py-1.5 pr-2 text-xs text-gray-500">{s.semester_code}</td>
                <td className="py-1.5">
                  <select value={value} disabled={!canManage || busy === s.section_id}
                    onChange={(e) => change(s, e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded bg-white disabled:bg-gray-100">
                    {value === 'none' && <option value="none">— not assigned —</option>}
                    {options.map((v) => <option key={v.version_id} value={v.version_id}>{v.is_main ? 'Main' : `${v.label} (${v.semester_code} copy)`}</option>)}
                    {value !== 'none' && <option value="customized">Customized</option>}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
};
