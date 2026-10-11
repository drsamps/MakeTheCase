import React, { useCallback, useEffect, useState } from 'react';
import { api, getApiBaseUrl, getAuthHeaders } from '../services/apiClient';
import { getActivityType } from '../utils/activityTypes.js';

/**
 * Activity packages on the Cases screen: download cases as a package, install a package from
 * another MakeTheCase server. Server: routes/activityPacks.js, services/activityPack/.
 *
 * Install is two requests, like course rollover: inspect returns a plan and writes nothing;
 * install sends the same file with the plan's hash, and the server refuses if what it would do
 * has changed since. Every choice on the review screen re-inspects, so the hash always belongs
 * to what is on screen.
 *
 * Text from a package is shown as plain text only. It is someone else's content until it is
 * installed, and some of it becomes AI instructions.
 */

const overlay = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
const panel = 'bg-white rounded-xl shadow-2xl w-full max-h-[92vh] flex flex-col';
const primaryButton = 'px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50';
const plainButton = 'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50';

const CloseButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="Close">✕</button>
);

const formatBytes = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ROLE_LABELS: Record<string, string> = {
  case: 'Case',
  teaching_note: 'Teaching note',
  chapter: 'Chapter',
  reading: 'Reading',
  article: 'Article',
  instructor_notes: 'Instructor notes',
  outline: 'Outline',
};
const roleLabel = (role: string) => ROLE_LABELS[role] || (role.startsWith('other:') ? role.slice(6) : role);

const OMITTED_REASONS: Record<string, string> = {
  proprietary: 'marked proprietary',
  no_text: 'no text could be read from it',
  text_too_large: 'its text is too long',
  unknown_type: 'its document type is not known',
};

/** Auth headers for a multipart request: the browser must set Content-Type itself. */
function uploadHeaders(): HeadersInit {
  const { 'Content-Type': _contentType, ...headers } = getAuthHeaders() as Record<string, string>;
  return headers;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

interface ExportDocument { title: string; role: string; bytes: number | null; proprietary: boolean; is_outline: boolean; has_text: boolean; has_original: boolean }
interface SettingsSource { source: 'defaults' | 'version' | 'section' | 'none'; id: number | string | null; label: string }
interface ExportCase { case_id: string; case_title: string; activity_type: string; documents: ExportDocument[]; settings_sources: SettingsSource[] }
interface OmittedDocument { activity: string; title: string; role: string; reason: string }
interface DownloadSummary { filename: string; activities: number; omitted?: OmittedDocument[]; warnings?: { activity: string; message: string }[]; omitted_count?: number; warnings_count?: number }

export const DownloadCasesModal: React.FC<{ caseIds: string[]; onClose: () => void }> = ({ caseIds, onClose }) => {
  const [cases, setCases] = useState<ExportCase[] | null>(null);
  const [sourceIndex, setSourceIndex] = useState<Record<string, number>>({});
  const [includeOriginals, setIncludeOriginals] = useState(false);
  const [includeProprietary, setIncludeProprietary] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DownloadSummary | null>(null);

  useEffect(() => {
    api.get<ExportCase[]>(`/activity-packs/export-options?case_ids=${caseIds.map(encodeURIComponent).join(',')}`).then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      setCases(data || []);
    });
  }, [caseIds]);

  const hasProprietary = (cases || []).some((c) => c.documents.some((d) => d.proprietary));

  // A plain link cannot carry the Bearer token, so fetch the file and hand the browser a blob URL.
  const download = async () => {
    if (!cases) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${getApiBaseUrl()}/activity-packs/export`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          items: cases.map((c) => {
            const chosen = c.settings_sources[sourceIndex[c.case_id] ?? 0];
            return { case_id: c.case_id, settings: { source: chosen.source, id: chosen.id } };
          }),
          include_originals: includeOriginals,
          include_proprietary: includeProprietary,
          note: note.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `Download failed (${response.status})`);
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'activities.mtc.zip';
      let details: Partial<DownloadSummary> = {};
      try {
        details = JSON.parse(decodeURIComponent(response.headers.get('X-Activity-Pack-Summary') || '{}'));
      } catch {
        details = {};
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSummary({ filename, activities: cases.length, ...details });
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={overlay}>
      <div className={`${panel} max-w-2xl`}>
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">Download {caseIds.length === 1 ? 'case' : `${caseIds.length} cases`} as a package</h3>
          <CloseButton onClick={onClose} />
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{error}</div>}

          {summary ? (
            <div className="space-y-3 text-sm">
              <div className="bg-green-50 border border-green-200 text-green-800 rounded p-2">
                Saved <strong>{summary.filename}</strong> with {summary.activities} case{summary.activities === 1 ? '' : 's'}.
              </div>
              {(summary.omitted?.length || summary.omitted_count) ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-2">
                  <p className="font-medium">Left out of the package:</p>
                  {summary.omitted ? (
                    <ul className="list-disc ml-5 mt-1">
                      {summary.omitted.map((o, i) => (
                        <li key={i}>{o.title} ({roleLabel(o.role)}): {OMITTED_REASONS[o.reason] || o.reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{summary.omitted_count} documents. The package lists them when it is installed.</p>
                  )}
                </div>
              ) : null}
              {(summary.warnings?.length || summary.warnings_count) ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-2">
                  {summary.warnings
                    ? <ul className="list-disc ml-5">{summary.warnings.map((w, i) => <li key={i}><strong>{w.activity}:</strong> {w.message}</li>)}</ul>
                    : <p>{summary.warnings_count} notes about personas or rubrics. The package lists them when it is installed.</p>}
                </div>
              ) : null}
              <p className="text-gray-600">
                To use it on another MakeTheCase server, open <strong>Content &gt; Cases</strong> there and choose <strong>Install from file</strong>.
              </p>
            </div>
          ) : cases === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-gray-500">You do not have access to {caseIds.length === 1 ? 'this case' : 'these cases'}.</p>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded p-2">
                A package holds the teaching notes, argument notes and rubric as well as the reading. Share it with instructors only.
              </div>

              {cases.map((c) => (
                <div key={c.case_id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="text-sm">
                    <span className="font-medium text-gray-900">{c.case_title}</span>
                    <span className="ml-2 text-gray-500">({c.case_id}) · {getActivityType(c.activity_type).label}</span>
                  </div>
                  <label className="block text-sm">
                    <span className="text-gray-700">Settings to include</span>
                    <select
                      value={sourceIndex[c.case_id] ?? 0}
                      onChange={(e) => setSourceIndex({ ...sourceIndex, [c.case_id]: Number(e.target.value) })}
                      className="mt-1 block w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-sm"
                    >
                      {c.settings_sources.map((s, i) => <option key={`${s.source}:${s.id}`} value={i}>{s.label}</option>)}
                    </select>
                    <span className="block text-xs text-gray-500 mt-0.5">Chat options, rubric, personas and which scenarios are offered.</span>
                  </label>
                  {c.documents.length === 0 ? (
                    <p className="text-xs text-amber-700">This case has no documents.</p>
                  ) : (
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      {c.documents.map((d, i) => (
                        <li key={i}>
                          {roleLabel(d.is_outline ? 'outline' : d.role)}: {d.title}
                          {d.proprietary && <span className="ml-1 px-1 rounded bg-red-100 text-red-800">proprietary</span>}
                          {!d.has_text && !d.is_outline && <span className="ml-1 text-gray-400">(text is read when the package is made)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 rounded" checked={includeOriginals} onChange={(e) => setIncludeOriginals(e.target.checked)} />
                <span>
                  Include original files (PDF, Word)
                  <span className="block text-xs text-gray-500">
                    The package always holds the text that students and the AI read. Tick this to send the original files too, for example when moving a case between your own servers.
                  </span>
                </span>
              </label>
              {hasProprietary && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 rounded" checked={includeProprietary} onChange={(e) => setIncludeProprietary(e.target.checked)} />
                  <span>
                    Include documents marked proprietary
                    <span className="block text-xs text-red-700">
                      Left out unless you tick this. Only include them if you are allowed to pass them on. An AI outline of a proprietary document is included either way.
                    </span>
                  </span>
                </label>
              )}
              <label className="block text-sm">
                <span className="text-gray-700">Note for whoever installs it (optional)</span>
                <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full px-2 py-1 border border-gray-300 rounded text-sm" />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className={plainButton}>{summary ? 'Done' : 'Cancel'}</button>
          {!summary && (
            <button onClick={download} disabled={busy || !cases || cases.length === 0} className={primaryButton}>
              {busy ? 'Preparing…' : 'Download'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

type ActivityAction = 'install' | 'skip' | 'copy';
type PersonaChoice = 'install_copy' | 'use_server';

interface PlanActivity {
  key: string;
  title: string;
  package_title: string;
  activity_type_label: string;
  status: 'new' | 'installed' | 'installed_same' | 'installed_different';
  existing: { case_id: string; case_title: string } | null;
  action: ActivityAction;
  case_id: string | null;
  has_settings: boolean;
  has_reading: boolean;
  counts: { documents: number; originals: number; scenarios: number; positions: number };
  documents: { title: string; role: string; chars: number; original_bytes: number; proprietary: boolean }[];
  omitted: OmittedDocument[];
}
interface PlanPersona { key: string; suggested_id: string; name: string; kind: string; action: string; target_id: string; choices: PersonaChoice[] | null; note: string | null }
interface PlanItem { key: string; name: string; suggested_id?: string; action: string; target_id: string | number | null; note?: string | null }
interface InstallPlan {
  package: { exported_at: string | null; exported_from: { app_version?: string } | null; note: string | null; includes_originals: boolean; warnings: { activity: string; message: string }[] };
  activities: PlanActivity[];
  personas: PlanPersona[];
  criteria: PlanItem[];
  rubrics: PlanItem[];
  course: { course_id: number; course_name: string } | null;
  review: { where: string; kind: string; name: string; text: string }[];
  plan_hash: string;
}
interface InstallResult { installed: { case_id: string; case_title: string }[]; personas_created: string[]; rubrics_created: { rubric_name: string }[]; course: { course_name: string } | null }

const ACTION_LABELS: Record<string, string> = {
  create: 'will be added',
  install_copy: 'will be added under a new id',
  reuse: 'already here, identical',
  use_server: "this server's is used",
  not_needed: 'not needed',
};

export const InstallCasesModal: React.FC<{ isAdmin: boolean; userId: string | null; onClose: () => void; onInstalled: () => void }> = ({ isAdmin, userId, onClose, onInstalled }) => {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [activityChoices, setActivityChoices] = useState<Record<string, ActivityAction>>({});
  const [personaChoices, setPersonaChoices] = useState<Record<string, PersonaChoice>>({});
  const [courseId, setCourseId] = useState<number | ''>('');
  const [courses, setCourses] = useState<{ id: number; course_code?: string; course_name: string; primary_instructor_id?: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  // Adding to a course needs course ownership (the server checks it again), so offer only those.
  useEffect(() => {
    api.get<any[]>('/courses').then(({ data }) =>
      setCourses((data || []).filter((c) => isAdmin || (userId && c.primary_instructor_id === userId))));
  }, [isAdmin, userId]);

  const send = useCallback(async (path: 'inspect' | 'install', packFile: File, options: object) => {
    const body = new FormData();
    body.append('file', packFile);
    body.append('options', JSON.stringify(options));
    const response = await fetch(`${getApiBaseUrl()}/activity-packs/${path}`, { method: 'POST', headers: uploadHeaders(), body });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.error) throw new Error(json?.error?.message || `The server answered ${response.status}`);
    return json.data;
  }, []);

  // Every choice re-inspects, so the plan (and its hash) on screen is what Install will do.
  // False when the server refused: the setters below then put their choice back, so the plan
  // still on screen matches the choices again and the person can pick something else.
  const inspect = async (packFile: File, next: { activities: Record<string, ActivityAction>; personas: Record<string, PersonaChoice>; course: number | '' }) => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await send('inspect', packFile, { activities: next.activities, personas: next.personas, add_to_course_id: next.course || null }));
      return true;
    } catch (err: any) {
      setError(err.message || 'The package could not be read');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (packFile: File | null) => {
    setFile(packFile);
    setPlan(null);
    setActivityChoices({});
    setPersonaChoices({});
    setCourseId('');
    if (packFile) inspect(packFile, { activities: {}, personas: {}, course: '' });
  };

  const setActivity = async (key: string, action: ActivityAction) => {
    if (!file) return;
    const next = { ...activityChoices, [key]: action };
    setActivityChoices(next);
    if (!(await inspect(file, { activities: next, personas: personaChoices, course: courseId }))) setActivityChoices(activityChoices);
  };
  const setPersona = async (key: string, choice: PersonaChoice) => {
    if (!file) return;
    const next = { ...personaChoices, [key]: choice };
    setPersonaChoices(next);
    if (!(await inspect(file, { activities: activityChoices, personas: next, course: courseId }))) setPersonaChoices(personaChoices);
  };
  const setCourse = async (value: number | '') => {
    if (!file) return;
    setCourseId(value);
    if (!(await inspect(file, { activities: activityChoices, personas: personaChoices, course: value }))) setCourseId(courseId);
  };

  const install = async () => {
    if (!file || !plan) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await send('install', file, {
        activities: activityChoices,
        personas: personaChoices,
        add_to_course_id: courseId || null,
        plan_hash: plan.plan_hash,
      }));
      onInstalled();
    } catch (err: any) {
      setError(err.message || 'The package could not be installed');
    } finally {
      setBusy(false);
    }
  };

  const installCount = plan ? plan.activities.filter((a) => a.action !== 'skip').length : 0;

  const renderActivity = (a: PlanActivity) => (
    <div key={a.key} className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{a.package_title}</span>
        <span className="px-1.5 py-0.5 text-xs rounded bg-indigo-50 text-indigo-700 border border-indigo-200">{a.activity_type_label}</span>
      </div>

      {a.status === 'new' ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="rounded" checked={a.action === 'install'} disabled={busy}
            onChange={(e) => setActivity(a.key, e.target.checked ? 'install' : 'skip')} />
          Install as <code>{a.case_id || '…'}</code>
        </label>
      ) : (
        <div className="space-y-1">
          <p className="text-amber-800">
            {a.status === 'installed_same' ? 'Already installed here'
              : a.status === 'installed_different' ? 'A different version of this activity is already here'
              : 'This activity is already here'}
            {a.existing ? <> as <strong>{a.existing.case_title}</strong> (<code>{a.existing.case_id}</code>).</> : '.'} It is left as it is.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" checked={a.action === 'copy'} disabled={busy}
              onChange={(e) => setActivity(a.key, e.target.checked ? 'copy' : 'skip')} />
            Install this one too, as a separate case{a.action === 'copy' && a.case_id ? <> (<code>{a.case_id}</code>, titled &quot;{a.title}&quot;)</> : ''}
          </label>
        </div>
      )}

      {a.action !== 'skip' && (
        <>
          <p className="text-xs text-gray-600">
            {a.counts.documents} document{a.counts.documents === 1 ? '' : 's'}
            {a.counts.originals > 0 ? ` (${a.counts.originals} with the original file)` : ' (text only)'}
            {' · '}{a.counts.scenarios} scenario{a.counts.scenarios === 1 ? '' : 's'}
            {a.counts.positions > 0 ? ` · ${a.counts.positions} positions` : ''}
            {' · '}{a.has_settings ? 'comes with settings (saved as the case defaults)' : 'no settings (uses this server’s defaults)'}
          </p>
          <ul className="text-xs text-gray-600 space-y-0.5">
            {a.documents.map((d, i) => (
              <li key={i}>
                {roleLabel(d.role)}: {d.title}
                {d.chars > 0 ? ` · ${d.chars.toLocaleString()} characters` : ''}
                {d.original_bytes > 0 ? ` · original ${formatBytes(d.original_bytes)}` : ''}
                {d.proprietary && <span className="ml-1 px-1 rounded bg-red-100 text-red-800" title="Stays out of AI prompts until it is confirmed in Case Files on this server">proprietary, needs confirming here</span>}
              </li>
            ))}
          </ul>
          {a.omitted.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded p-2">
              Not in the package (add {a.omitted.length === 1 ? 'it' : 'them'} in Content &gt; Case Files after installing):
              <ul className="list-disc ml-5 mt-1">
                {a.omitted.map((o, i) => <li key={i}>{o.title} ({roleLabel(o.role)}): {OMITTED_REASONS[o.reason] || o.reason}</li>)}
              </ul>
            </div>
          )}
          {!a.has_reading && (
            <p className="text-xs text-red-700">This activity arrives with nothing for students to read. Add the document in Content &gt; Case Files before assigning it.</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={overlay}>
      <div className={`${panel} max-w-3xl`}>
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">Install cases from a package</h3>
          <CloseButton onClick={onClose} />
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2 whitespace-pre-wrap">{error}</div>}

          {result ? (
            <div className="space-y-2 text-sm">
              <div className="bg-green-50 border border-green-200 text-green-800 rounded p-2">
                Installed {result.installed.length} case{result.installed.length === 1 ? '' : 's'}:
                <ul className="list-disc ml-5 mt-1">
                  {result.installed.map((c) => <li key={c.case_id}>{c.case_title} (<code>{c.case_id}</code>)</li>)}
                </ul>
              </div>
              {result.personas_created.length > 0 && <p className="text-gray-700">Personas added: {result.personas_created.join(', ')}.</p>}
              {result.rubrics_created.length > 0 && <p className="text-gray-700">Rubrics added: {result.rubrics_created.map((r) => r.rubric_name).join(', ')}.</p>}
              <p className="text-gray-600">
                {result.course
                  ? <>They are on the case list of <strong>{result.course.course_name}</strong>, not yet given to any section.</>
                  : 'They are private to you and not assigned anywhere. Add them to a course under Assignments.'}
              </p>
            </div>
          ) : (
            <>
              <label className="block text-sm">
                <span className="text-gray-700">Package file (<code>.mtc.zip</code>) downloaded from a MakeTheCase server</span>
                <input type="file" accept=".zip,application/zip" disabled={busy}
                  onChange={(e) => chooseFile(e.target.files?.[0] || null)}
                  className="mt-1 block w-full text-sm" />
              </label>
              {busy && !plan && <p className="text-sm text-gray-500">Reading the package…</p>}

              {plan && (
                <>
                  <p className="text-xs text-gray-500">
                    {plan.package.exported_from?.app_version ? `Made with MakeTheCase ${plan.package.exported_from.app_version}` : 'Made with MakeTheCase'}
                    {plan.package.exported_at ? ` on ${new Date(plan.package.exported_at).toLocaleDateString()}` : ''}.
                    {' '}Nothing is installed until you choose Install.
                  </p>
                  {plan.package.note && (
                    <div className="bg-gray-50 border border-gray-200 rounded p-2 text-sm">
                      <span className="text-xs font-semibold text-gray-500 uppercase">Note from the author</span>
                      <p className="whitespace-pre-wrap text-gray-800">{plan.package.note}</p>
                    </div>
                  )}
                  {plan.package.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded p-2">
                      <ul className="list-disc ml-5">{plan.package.warnings.map((w, i) => <li key={i}><strong>{w.activity}:</strong> {w.message}</li>)}</ul>
                    </div>
                  )}

                  <div className="space-y-2">{plan.activities.map(renderActivity)}</div>

                  {plan.personas.length > 0 && (
                    <div className="text-sm">
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Personas</div>
                      <ul className="space-y-1">
                        {plan.personas.map((p) => (
                          <li key={p.key}>
                            <span className="text-gray-900">{p.name}</span>
                            <span className="text-gray-500"> (<code>{p.target_id}</code>): {ACTION_LABELS[p.action] || p.action}</span>
                            {p.choices && (
                              <select value={p.action} disabled={busy} onChange={(e) => setPersona(p.key, e.target.value as PersonaChoice)}
                                className="ml-2 px-1 py-0.5 text-xs border border-gray-300 rounded bg-white">
                                <option value="install_copy">Add the package&apos;s as a copy</option>
                                <option value="use_server">Use this server&apos;s</option>
                              </select>
                            )}
                            {p.note && <span className="block text-xs text-gray-500">{p.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.rubrics.length > 0 && (
                    <div className="text-sm">
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Rubric</div>
                      <ul className="space-y-1">
                        {plan.rubrics.map((r) => <li key={r.key}>{r.name}: {ACTION_LABELS[r.action] || r.action}</li>)}
                        {plan.criteria.map((c) => (
                          <li key={c.key} className="ml-4 text-gray-600">
                            {c.name} (<code>{c.target_id}</code>): {ACTION_LABELS[c.action] || c.action}
                            {c.note && <span className="block text-xs text-gray-500">{c.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {installCount > 0 && courses.length > 0 && (
                    <label className="block text-sm">
                      <span className="text-gray-700">Also add to a course (optional)</span>
                      <select value={courseId} disabled={busy} onChange={(e) => setCourse(e.target.value ? Number(e.target.value) : '')}
                        className="mt-1 block w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-sm">
                        <option value="">No, just install</option>
                        {courses.map((c) => <option key={c.id} value={c.id}>{c.course_code ? `${c.course_code}: ` : ''}{c.course_name}</option>)}
                      </select>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Puts the case on the course&apos;s case list with these settings. It is not given to any section and nothing becomes active. Needs course ownership.
                      </span>
                    </label>
                  )}

                  {plan.review.length > 0 && (
                    <details className="border border-gray-200 rounded-lg">
                      <summary className="px-3 py-2 text-sm font-medium text-gray-800 cursor-pointer">
                        Read the AI instructions in this package ({plan.review.length})
                      </summary>
                      <div className="px-3 pb-3 space-y-2">
                        <p className="text-xs text-gray-500">
                          These are sent to the AI as written, in chats and in grading. Read them if the package is not from someone you know.
                        </p>
                        {plan.review.map((item, i) => (
                          <div key={i}>
                            <div className="text-xs font-semibold text-gray-600">{item.where} · {item.kind} · {item.name}</div>
                            <pre className="whitespace-pre-wrap text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded p-2 max-h-40 overflow-y-auto">{item.text}</pre>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <p className="text-xs text-gray-500">
                    Installed cases are private to you. Nothing here replaces or changes a case, persona or rubric you already have.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className={plainButton}>{result ? 'Done' : 'Cancel'}</button>
          {!result && (
            <button onClick={install} disabled={busy || !plan || installCount === 0} className={primaryButton}>
              {busy && plan ? 'Working…' : `Install${installCount > 0 ? ` ${installCount} case${installCount === 1 ? '' : 's'}` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
