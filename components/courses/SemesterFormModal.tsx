import React, { useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import {
  TERMS,
  approxTermStart,
  buildSemesterCode,
  deriveSemesterName,
  normalizeCode,
  parseSemesterCode,
  semesterCodeError,
} from '../../utils/academicIds.js';
import type { Semester } from '../../types';

interface Props {
  /** null = create */
  semester: Semester | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const dateOnly = (value: string | null | undefined) => (value ? String(value).split('T')[0] : '');

/** Approximate last day: the day before the next term's approximate start. Editable. */
function approxTermEnd(termCode: string, year: number): string {
  const idx = TERMS.findIndex((t) => t.code === termCode);
  if (idx < 0) return '';
  const next = TERMS[idx + 1];
  const start = next
    ? new Date(Date.UTC(year, next.month - 1, next.day))
    : new Date(Date.UTC(year + 1, TERMS[0].month - 1, TERMS[0].day));
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
}

const SemesterFormModal: React.FC<Props> = ({ semester, onClose, onSaved }) => {
  const parsed = semester ? parseSemesterCode(semester.semester_code) : null;
  const thisYear = new Date().getFullYear();

  const [termCode, setTermCode] = useState<string>(semester ? (parsed?.term.code ?? 'other') : 'f');
  const [year, setYear] = useState<string>(String(parsed?.year ?? thisYear));
  const [otherCode, setOtherCode] = useState(semester && !parsed ? semester.semester_code : '');
  const [otherName, setOtherName] = useState(semester && !parsed ? semester.semester_name : '');
  const [startDate, setStartDate] = useState(dateOnly(semester?.start_date));
  const [endDate, setEndDate] = useState(dateOnly(semester?.end_date));
  const [datesTouched, setDatesTouched] = useState(Boolean(semester));
  const [isCurrent, setIsCurrent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOther = termCode === 'other';
  const code = isOther ? normalizeCode(otherCode) : buildSemesterCode(termCode, Number(year));
  const name = isOther ? otherName.trim() : deriveSemesterName(code);
  const codeError = code ? semesterCodeError(code) : 'Semester ID is required.';

  // Suggested dates follow Term/Year until the user edits a date.
  const suggested = useMemo(() => {
    if (isOther || !code) return { start: '', end: '' };
    return { start: approxTermStart(code) ?? '', end: approxTermEnd(termCode, Number(year)) };
  }, [isOther, code, termCode, year]);
  const effectiveStart = datesTouched ? startDate : suggested.start;
  const effectiveEnd = datesTouched ? endDate : suggested.end;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codeError) { setError(codeError); return; }
    if (!name) { setError('Semester name is required.'); return; }
    setSaving(true);
    setError(null);
    const body = {
      semester_code: code,
      semester_name: name,
      start_date: effectiveStart || null,
      end_date: effectiveEnd || null,
      ...(semester ? {} : { is_current: isCurrent }),
    };
    const { error: saveError } = semester
      ? await api.put(`/semesters/${semester.id}`, body)
      : await api.post('/semesters', body);
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    onSaved(semester ? `Semester "${name}" updated` : `Semester "${name}" (${code}) created`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">{semester ? 'Edit Semester' : 'Create Semester'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Term *</label>
                <select
                  value={termCode}
                  onChange={(e) => setTermCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  {TERMS.map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
                  <option value="other">Other…</option>
                </select>
              </div>
              {!isOther && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              )}
            </div>

            {isOther ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester ID *</label>
                  <p className="text-xs text-gray-500 mb-1">Short id used in section IDs. Lowercase letters, numbers, underscores.</p>
                  <input
                    value={otherCode}
                    onChange={(e) => setOtherCode(e.target.value)}
                    placeholder="e.g., ongoing"
                    maxLength={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Semester Name *</label>
                  <input
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder="e.g., Ongoing"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-500">Semester ID:</span>{' '}
                <code className="font-mono text-gray-900">{code || '—'}</code>
                <span className="text-gray-400 mx-2">•</span>
                <span className="text-gray-500">Name:</span>{' '}
                <span className="text-gray-900">{name || '—'}</span>
              </div>
            )}
            {code && codeError && <p className="text-xs text-red-600">{codeError}</p>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={effectiveStart}
                  onChange={(e) => { setDatesTouched(true); setStartDate(e.target.value); setEndDate(effectiveEnd); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={effectiveEnd}
                  onChange={(e) => { setDatesTouched(true); setEndDate(e.target.value); setStartDate(effectiveStart); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              Semesters are listed newest first by start date. Rollover shifts case dates by the difference between start dates.
            </p>

            {!semester && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-700">Set as current semester</span>
              </label>
            )}
            {semester && semester.semester_code !== code && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Changing the Semester ID affects only sections created from now on. Existing section IDs are not renamed.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : semester ? 'Save Changes' : 'Create Semester'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SemesterFormModal;
