import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import type { CourseSection } from '../../types';

/**
 * Schedule one case on several sections of a course in one semester (POST /courses/:id/schedule).
 * Dates stay per section; an optional per-section offset (minutes) handles different meeting times.
 */

interface Props {
  courseId: number;
  semesterId: number;
  semesterName: string;
  sections: CourseSection[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface CaseOption {
  case_id: string;
  case_title: string;
}

const fmt = (date: Date | null) => (date ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const ScheduleCasesModal: React.FC<Props> = ({ courseId, semesterId, semesterName, sections, onClose, onSaved }) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  // section_id -> case_id -> current { open_date, close_date, manual_status }
  const [current, setCurrent] = useState<Record<string, Record<string, any>>>({});
  const [caseId, setCaseId] = useState('');
  const [openAt, setOpenAt] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [manualStatus, setManualStatus] = useState('auto');
  const [selected, setSelected] = useState<Set<string>>(new Set(sections.map((s) => s.section_id)));
  const [offsets, setOffsets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const results = await Promise.all(sections.map((s) => api.get<any[]>(`/sections/${encodeURIComponent(s.section_id)}/cases`)));
      const bySection: Record<string, Record<string, any>> = {};
      const options = new Map<string, CaseOption>();
      sections.forEach((s, i) => {
        bySection[s.section_id] = {};
        for (const sc of results[i].data || []) {
          bySection[s.section_id][sc.case_id] = sc;
          options.set(sc.case_id, { case_id: sc.case_id, case_title: sc.case_title });
        }
      });
      setCurrent(bySection);
      const list = [...options.values()].sort((a, b) => a.case_title.localeCompare(b.case_title));
      setCases(list);
      if (list.length === 1) setCaseId(list[0].case_id);
    })();
  }, [sections]);

  const openDate = openAt ? new Date(openAt) : null;
  const closeDate = closeAt ? new Date(closeAt) : null;

  const preview = useMemo(() => sections.map((s) => {
    const minutes = Number(offsets[s.section_id] || 0);
    const shift = (value: string) => (value ? new Date(new Date(value).getTime() + minutes * 60_000) : null);
    const existing = caseId ? current[s.section_id]?.[caseId] : null;
    return { section: s, open: shift(openAt), close: shift(closeAt), existing };
  }), [sections, offsets, openAt, closeAt, caseId, current]);

  // Sections without the chosen case show a disabled checkbox, so they can't be unchecked;
  // leave them out rather than blocking the save.
  const targets = [...selected].filter((id) => !caseId || current[id]?.[caseId]);

  const save = async () => {
    setError(null);
    if (!caseId) { setError('Choose a case.'); return; }
    if (targets.length === 0) { setError('Choose at least one section that has this case.'); return; }
    if (openDate && closeDate && closeDate <= openDate) { setError('Close must be after open.'); return; }
    setSaving(true);
    const { data, error: saveError } = await api.post<{ updated: any[]; skipped: any[] }>(`/courses/${courseId}/schedule`, {
      semester_id: semesterId,
      case_id: caseId,
      section_ids: targets,
      open_date: openDate ? openDate.toISOString() : null,
      close_date: closeDate ? closeDate.toISOString() : null,
      manual_status: manualStatus,
      offsets: Object.fromEntries(Object.entries(offsets).filter(([, v]) => Number(v)).map(([k, v]) => [k, Number(v)])),
    });
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved(`Scheduled ${data?.updated.length ?? 0} section(s)`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Schedule cases</h3>
            <p className="text-sm text-gray-500">{semesterName}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close">✕</button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Case</span>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
              <option value="">— Select a case —</option>
              {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_title}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <label className="block">
              <span className="font-medium text-gray-700">Opens</span>
              <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg" />
            </label>
            <label className="block">
              <span className="font-medium text-gray-700">Closes</span>
              <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg" />
            </label>
            <label className="block">
              <span className="font-medium text-gray-700">Status</span>
              <select value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg bg-white">
                <option value="auto">Follow dates</option>
                <option value="manually_opened">Open now</option>
                <option value="manually_closed">Closed</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-2">Leave a date empty for no limit. An offset moves both dates for that section (e.g. 90 for a class 1½ hours later).</p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-1 pr-2"></th>
                  <th className="py-1 pr-2">Section</th>
                  <th className="py-1 pr-2">Offset (min)</th>
                  <th className="py-1 pr-2">New opens / closes</th>
                  <th className="py-1">Currently</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map(({ section, open, close, existing }) => {
                  const checked = selected.has(section.section_id);
                  const hasCase = !caseId || Boolean(existing);
                  return (
                    <tr key={section.section_id} className={hasCase ? '' : 'opacity-50'}>
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" className="rounded" checked={checked} disabled={!hasCase}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(section.section_id); else next.delete(section.section_id);
                            setSelected(next);
                          }} />
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-xs">{section.section_id}</td>
                      <td className="py-1.5 pr-2">
                        <input type="number" step={5} value={offsets[section.section_id] ?? ''} placeholder="0"
                          onChange={(e) => setOffsets({ ...offsets, [section.section_id]: e.target.value })}
                          className="w-20 px-2 py-1 border border-gray-300 rounded" />
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-gray-800">
                        {checked && hasCase ? <>{fmt(open)}<br />{fmt(close)}</> : <span className="text-gray-400">{hasCase ? 'unchanged' : 'case not assigned'}</span>}
                      </td>
                      <td className="py-1.5 text-xs text-gray-500">
                        {existing ? <>{fmt(existing.open_date ? new Date(existing.open_date) : null)}<br />{fmt(existing.close_date ? new Date(existing.close_date) : null)}</> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : `Apply to ${targets.length} section${targets.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleCasesModal;
