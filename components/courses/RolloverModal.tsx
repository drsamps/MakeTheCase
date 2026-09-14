import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiClient';
import type { Semester } from '../../types';

/**
 * Roll sections (and their case setup) into another semester. Preview first: the Roll over button
 * stays disabled until a preview for the current choices has loaded. Safe to run twice -- sections
 * that already exist in the target semester are shown as "exists" and skipped.
 *
 *   mode 'course'    POST /api/courses/:id/rollover       one course, choose from + to
 *   mode 'semester'  POST /api/semesters/:id/rollover     every course in a semester, choose to
 */

type Props =
  | { mode: 'course'; courseId: number; courseName: string; fromSemesterId?: number | null; onClose: () => void; onDone: (message: string) => void }
  | { mode: 'semester'; fromSemesterId: number; fromSemesterName: string; onClose: () => void; onDone: (message: string) => void };

interface PlanSection {
  source_section_id: string;
  source_title: string;
  section_number: number | null;
  target_section_id: string | null;
  target_title: string | null;
  status: 'create' | 'exists' | 'needs_number' | 'error';
  error: string | null;
  cases: { case_id: string; case_title: string; follows: string; version_label: string | null; open_date: string | null; had_dates: boolean; from_course: boolean }[];
}

interface Plan {
  course: { id: number; course_code: string; course_name: string };
  from: { semester_code: string; semester_name: string };
  to: { semester_code: string; semester_name: string };
  shift_days: number | null;
  sections: PlanSection[];
  copies: { label: string; case_id: string }[];
  to_create: number;
}

const STATUS_STYLE: Record<PlanSection['status'], string> = {
  create: 'bg-green-100 text-green-800',
  exists: 'bg-gray-100 text-gray-600',
  needs_number: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
};

const RolloverModal: React.FC<Props> = (props) => {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [fromId, setFromId] = useState<number | null>(props.fromSemesterId ?? null);
  const [toId, setToId] = useState<number | null>(null);
  const [copyTas, setCopyTas] = useState(false);
  // On by default: rollover writes many rows at once, and the backup is the undo button.
  const [backupFirst, setBackupFirst] = useState(true);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Semester[]>('/semesters').then(({ data }) => {
      const list = data || [];
      setSemesters(list);
      // Default target: the newest semester that is not the source.
      setToId((prev) => prev ?? list.find((s) => s.id !== (props.fromSemesterId ?? null))?.id ?? null);
    });
  }, [props.fromSemesterId]);

  const sectionNumbers = Object.fromEntries(Object.entries(numbers).filter(([, v]) => v).map(([k, v]) => [k, Number(v)]));
  const key = JSON.stringify({ fromId, toId, sectionNumbers });
  const previewCurrent = plans !== null && previewKey === key;

  // backup_first is only sent on execute; the server ignores it for previews anyway.
  const request = (preview: boolean) => {
    const backup_first = !preview && backupFirst;
    return props.mode === 'course'
      ? api.post<any>(`/courses/${props.courseId}/rollover`, {
          from_semester_id: fromId, to_semester_id: toId, section_numbers: sectionNumbers, copy_tas: copyTas, preview, backup_first,
        })
      : api.post<any>(`/semesters/${props.fromSemesterId}/rollover`, {
          into: toId, section_numbers: sectionNumbers, copy_tas: copyTas, preview, backup_first,
        });
  };

  const runPreview = async () => {
    if (!fromId || !toId) { setError('Choose both semesters.'); return; }
    setBusy(true);
    setError(null);
    const { data, error: previewError } = await request(true);
    setBusy(false);
    if (previewError) { setError(previewError.message); setPlans(null); return; }
    setPlans(props.mode === 'course' ? [data] : data.plans);
    setPreviewKey(key);
  };

  const totalToCreate = (plans || []).reduce((n, p) => n + p.to_create, 0);

  const execute = async () => {
    setBusy(true);
    setError(null);
    const { data, error: runError } = await request(false);
    setBusy(false);
    if (runError) { setError(runError.message); return; }
    const created = props.mode === 'course'
      ? data.created.length
      : data.results.reduce((n: number, r: any) => n + r.created.length, 0);
    const backupNote = data.backup ? ` Backup taken first: ${data.backup.name}.` : '';
    props.onDone(`Rolled over ${created} section(s) into ${semesters.find((s) => s.id === toId)?.semester_name}.${backupNote}`);
  };

  const title = props.mode === 'course' ? `Roll over ${props.courseName}` : `Roll over ${props.fromSemesterName}`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">Copies sections and their case setup. Students, chats and enrollment keys are not copied.</p>
          </div>
          <button onClick={props.onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="font-medium text-gray-700">From</span>
              <select value={fromId ?? ''} disabled={props.mode === 'semester'} onChange={(e) => setFromId(Number(e.target.value) || null)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100">
                <option value="">— Select —</option>
                {semesters.map((s) => <option key={s.id} value={s.id}>{s.semester_name} ({s.semester_code})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="font-medium text-gray-700">Into</span>
              <select value={toId ?? ''} onChange={(e) => setToId(Number(e.target.value) || null)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
                <option value="">— Select —</option>
                {semesters.filter((s) => s.id !== fromId).map((s) => <option key={s.id} value={s.id}>{s.semester_name} ({s.semester_code})</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="rounded" checked={copyTas} onChange={(e) => setCopyTas(e.target.checked)} />
                Also copy TA assignments
              </label>
              <label className="flex items-center gap-2 text-sm" title="A compressed copy of the whole database, kept on the server (Admin > Backup). If the backup fails, nothing is rolled over.">
                <input type="checkbox" className="rounded" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} />
                Take a database backup first
              </label>
            </div>
            <button onClick={runPreview} disabled={busy} className="px-4 py-1.5 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg disabled:opacity-50">
              {busy && !previewCurrent ? 'Loading…' : 'Preview'}
            </button>
          </div>

          {plans && plans.length === 0 && <p className="text-sm text-gray-500">No course sections in that semester.</p>}
          {plans?.map((plan) => (
            <div key={plan.course.id} className="border border-gray-200 rounded-lg">
              <div className="px-3 py-2 bg-gray-50 border-b text-sm flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-gray-800">{plan.course.course_name} <code className="text-xs text-gray-500">{plan.course.course_code}</code></span>
                <span className="text-xs text-gray-500">
                  {plan.shift_days == null
                    ? 'Case dates cleared (a semester has no start date)'
                    : `Case dates shift ${plan.shift_days >= 0 ? '+' : ''}${plan.shift_days} days`}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="px-3 py-1">From</th>
                      <th className="px-3 py-1">New section</th>
                      <th className="px-3 py-1">Cases</th>
                      <th className="px-3 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.sections.map((s) => (
                      <tr key={s.source_section_id} className="align-top">
                        <td className="px-3 py-1.5 font-mono text-xs">{s.source_section_id}</td>
                        <td className="px-3 py-1.5">
                          {s.status === 'needs_number' ? (
                            <label className="text-xs">Section #{' '}
                              <input type="number" min={1} value={numbers[s.source_section_id] ?? ''}
                                onChange={(e) => setNumbers({ ...numbers, [s.source_section_id]: e.target.value })}
                                className="w-16 px-1 py-0.5 border border-gray-300 rounded" />
                            </label>
                          ) : (
                            <>
                              <div className="font-mono text-xs">{s.target_section_id || '—'}</div>
                              {s.status === 'create' && <div className="text-xs text-gray-500">{s.target_title}</div>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-600">
                          {s.cases.length === 0 ? '—' : s.cases.map((c) => (
                            <div key={c.case_id}>
                              {c.case_title}{' '}
                              <span className="text-gray-400">
                                ({c.follows === 'main' ? (c.from_course ? 'Main, from course list' : 'Main') : c.follows === 'copy' ? `copy: ${c.version_label}` : 'Customized'}
                                {c.had_dates ? (c.open_date ? `, opens ${new Date(c.open_date).toLocaleDateString()}` : ', dates cleared') : ''})
                              </span>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_STYLE[s.status]}`}>
                            {s.status === 'create' ? 'Will create' : s.status === 'exists' ? 'Exists' : s.status === 'needs_number' ? 'Needs #' : 'Error'}
                          </span>
                          {s.error && <div className="text-xs text-red-600 mt-1 max-w-[14rem]">{s.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.copies.length > 0 && (
                <p className="px-3 py-2 text-xs text-gray-500 border-t">
                  Semester copies cloned into {plan.to.semester_name}: {plan.copies.map((c) => `"${c.label}"`).join(', ')}
                </p>
              )}
            </div>
          ))}
          {plans && !previewCurrent && <p className="text-xs text-amber-700">Choices changed — preview again before rolling over.</p>}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={props.onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg">Cancel</button>
          <button onClick={execute} disabled={busy || !previewCurrent || totalToCreate === 0}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg disabled:opacity-50"
            title={!previewCurrent ? 'Preview first' : totalToCreate === 0 ? 'Nothing to create' : ''}>
            {busy && previewCurrent ? (backupFirst ? 'Backing up, then rolling over…' : 'Rolling over…') : `Roll over ${totalToCreate} section${totalToCreate === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RolloverModal;
