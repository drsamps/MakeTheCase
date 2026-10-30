import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getApiBaseUrl, getAuthHeaders } from '../services/apiClient';
import { loadActivityTypeList } from '../services/activityTypeList';
import { isAudiencePersonaId } from '../teachBack';
import { quote } from '../utils/confirmLabels';
import HelpTooltip from './ui/HelpTooltip';
import { ActivityTypesHelp } from '../help/dashboard';
import ActivityTypeTestChat from './ActivityTypeTestChat';

/**
 * Admin > Activity Types (StudyChat Phase 2, minimal editor): list the types, clone one, edit the
 * clone's draft (a form over every text field, or the raw JSON), preview its prompts on a real
 * case, publish it, enable or disable it, and restore an old version into the draft.
 *
 * Rules are the server's (server/services/activityTypeStore.js): built-in and system types are
 * locked (clone them); a draft is validated on save and publish (utils/activityEngine/validate.js);
 * traits are fixed once a type has been published; a chat keeps the version it started on.
 * Permission: activity_types.
 */

type Definition = Record<string, any>;

interface TypeRow {
  key: string; label: string; summary: string; tier: 'builtin' | 'system' | 'custom'; enabled: boolean;
  version: string | null; locked: boolean; based_on: string | null;
  draft: { version_no: number; updated_at: string } | null;
  usage: { cases: number; sections: number; chats: number };
}

interface VersionRow { version_no: number; version: string; status: string; notes: string | null; published_at: string | null; created_at: string; definition: Definition }

interface Detail {
  key: string; tier: TypeRow['tier']; enabled: boolean; locked: boolean; based_on: string | null;
  current: { definition: Definition; version: string } | null;
  draft: (VersionRow & { updated_at: string }) | null;
  versions: VersionRow[];
  usage: TypeRow['usage'];
}

interface Preview { system_prompt: string; greeting: string; coach_prompt: string; final_turn_note: string; position_pick_note: string; student_view: unknown }

/** fetch that keeps the server's error details (the validator's list of problems). */
async function call<T>(method: string, path: string, body?: unknown): Promise<{ data: T | null; error: { message: string; code?: string; errors?: string[] } | null }> {
  try {
    const r = await fetch(`${getApiBaseUrl()}${path}`, { method, headers: getAuthHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { data: null, error: typeof j.error === 'object' && j.error ? j.error : { message: j.error || `Request failed (${r.status})` } };
    return { data: j.data as T, error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

const SECTIONS: { id: string; title: string; path: string[]; note?: string }[] = [
  { id: 'identity', title: 'Name', path: [] },
  { id: 'copy', title: 'Student wording', path: ['copy'], note: 'Everything the student reads that differs by activity type. **bold** works. {slots} are filled by the page.' },
  { id: 'labels', title: 'Labels', path: ['labels'] },
  { id: 'greeting', title: 'Opening message', path: ['greeting'] },
  { id: 'prompt', title: 'Chat prompt (AI only)', path: ['prompt'], note: 'Never shown to students. Document wrapping is fixed; you edit headings, the role template, optional blocks and hint wording.' },
  { id: 'grading', title: 'Grading (AI only)', path: ['grading'], note: 'The grader\'s task list and JSON format are fixed; you edit the framing, default criteria and a few words.' },
];

/** Every text value in a definition by its path, for comparing two versions. */
function flatten(value: unknown, path = '', out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) out[path] = value.join('\n');
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else out[path] = String(value ?? '');
  return out;
}

/** The fields that differ between two definitions, in a readable order. */
function diffDefinitions(from: Definition, to: Definition): { path: string; from: string | null; to: string | null }[] {
  const a = flatten(from);
  const b = flatten(to);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((p) => a[p] !== b[p])
    .sort()
    .map((p) => ({ path: p, from: a[p] ?? null, to: b[p] ?? null }));
}

const DiffView: React.FC<{ title: string; from: Definition; to: Definition; onClose: () => void }> = ({ title, from, to, onClose }) => {
  const changes = useMemo(() => diffDefinitions(from, to), [from, to]);
  return (
    <div className="rounded border border-purple-200 bg-purple-50/40 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-gray-900">{title}: {changes.length === 0 ? 'no differences' : `${changes.length} field${changes.length === 1 ? '' : 's'} changed`}</span>
        <button type="button" onClick={onClose} className="text-purple-700 hover:underline">Close</button>
      </div>
      <div className="space-y-2">
        {changes.map((c) => (
          <div key={c.path} className="rounded border border-gray-200 bg-white p-2">
            <div className="mb-1 font-mono text-gray-600">{c.path}</div>
            {c.from !== null && <pre className="whitespace-pre-wrap rounded bg-red-50 p-1.5 font-mono text-red-900">{c.from || '(empty)'}</pre>}
            {c.to !== null && <pre className="mt-1 whitespace-pre-wrap rounded bg-green-50 p-1.5 font-mono text-green-900">{c.to || '(empty)'}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
};

const isTextLike = (v: unknown) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const asText = (v: unknown) => (Array.isArray(v) ? v.join('\n') : String(v ?? ''));
const humanise = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function setAt(obj: Definition, path: (string | number)[], value: unknown): Definition {
  const copy = structuredClone(obj);
  let node: any = copy;
  for (const p of path.slice(0, -1)) node = node[p];
  node[path[path.length - 1]] = value;
  return copy;
}

/** Every text field under `value`, as textareas; other values are shown and edited in the JSON tab. */
const Fields: React.FC<{ value: any; path: (string | number)[]; readOnly: boolean; onChange: (path: (string | number)[], v: unknown) => void; depth?: number }> = ({ value, path, readOnly, onChange, depth = 0 }) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return (
    <div className={depth ? 'pl-3 border-l border-gray-200 space-y-3' : 'space-y-3'}>
      {Object.entries(value).map(([k, v]) => {
        const p = [...path, k];
        if (isTextLike(v)) {
          const text = asText(v);
          return (
            <label key={k} className="block">
              <span className="block text-xs font-medium text-gray-700">{humanise(k)}</span>
              <textarea
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs disabled:bg-gray-50"
                rows={Math.min(14, Math.max(1, text.split('\n').length + (text.length > 120 ? 1 : 0)))}
                value={text}
                disabled={readOnly}
                onChange={(e) => onChange(p, Array.isArray(v) ? e.target.value.split('\n') : e.target.value)}
              />
            </label>
          );
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return (
            <div key={k}>
              <div className="text-xs font-semibold text-gray-600 mb-1">{humanise(k)}</div>
              <Fields value={v} path={p} readOnly={readOnly} onChange={onChange} depth={depth + 1} />
            </div>
          );
        }
        return (
          <div key={k} className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">{humanise(k)}:</span> <code>{JSON.stringify(v)}</code> <span className="italic">(edit in JSON)</span>
          </div>
        );
      })}
    </div>
  );
};

const ActivityTypeManager: React.FC = () => {
  const [rows, setRows] = useState<TypeRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [working, setWorking] = useState<Definition | null>(null);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'form' | 'json' | 'preview' | 'test' | 'history'>('form');
  const [compare, setCompare] = useState<{ title: string; from: Definition; to: Definition } | null>(null);
  const [section, setSection] = useState('copy');
  const [jsonText, setJsonText] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; errors?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRows = useCallback(async () => {
    const { data, error } = await call<TypeRow[]>('GET', '/activity-types?all=1');
    if (error) setMessage({ kind: 'error', text: error.message });
    else setRows(data);
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const openType = useCallback(async (key: string) => {
    const { data, error } = await call<Detail>('GET', `/activity-types/${key}`);
    if (error || !data) { setMessage({ kind: 'error', text: error?.message || 'Could not load the type' }); return; }
    setSelected(key);
    setDetail(data);
    const def = data.draft?.definition || data.current?.definition || null;
    setWorking(def ? structuredClone(def) : null);
    setJsonText(def ? JSON.stringify(def, null, 2) : '');
    setNotes(data.draft?.notes || '');
    setDirty(false);
    setMessage(null);
  }, []);

  const refreshAll = async (key: string | null = selected) => {
    await loadRows();
    if (key) await openType(key);
    loadActivityTypeList(true);
  };

  const readOnly = !detail || detail.locked;
  const publishedOnce = Boolean(detail?.current);

  const onField = (path: (string | number)[], v: unknown) => {
    if (!working) return;
    const next = setAt(working, path, v);
    setWorking(next);
    setJsonText(JSON.stringify(next, null, 2));
    setDirty(true);
  };

  const definitionToSave = (): Definition | null => {
    if (tab !== 'json') return working;
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      setMessage({ kind: 'error', text: `The JSON is not valid: ${(e as Error).message}` });
      return null;
    }
  };

  const saveDraft = async () => {
    if (!detail) return;
    const definition = definitionToSave();
    if (!definition) return;
    setBusy(true);
    const { error } = await call('PUT', `/activity-types/${detail.key}/draft`, { definition, notes: notes || null });
    setBusy(false);
    if (error) { setMessage({ kind: 'error', text: error.message, errors: error.errors }); return; }
    await refreshAll(detail.key);
    setMessage({ kind: 'ok', text: 'Draft saved.' });
  };

  const publish = async () => {
    if (!detail) return;
    if (dirty) { setMessage({ kind: 'error', text: 'Save the draft before publishing.' }); return; }
    const u = detail.usage;
    if (!window.confirm(`Publish the draft of ${quote(working?.label || detail.key)}?\n\nUsed by ${u.cases} activit${u.cases === 1 ? 'y' : 'ies'} in ${u.sections} section${u.sections === 1 ? '' : 's'}. Chats started after this use the new version; chats already running keep theirs.`)) return;
    setBusy(true);
    const { data, error } = await call<{ version: string }>('POST', `/activity-types/${detail.key}/publish`);
    setBusy(false);
    if (error) { setMessage({ kind: 'error', text: error.message, errors: error.errors }); return; }
    await refreshAll(detail.key);
    setMessage({ kind: 'ok', text: `Published ${data?.version}.${detail.enabled ? '' : ' Enable the type to let cases use it.'}` });
  };

  const simple = async (method: string, path: string, body: unknown, done: string, key: string | null = selected) => {
    setBusy(true);
    const { error } = await call(method, path, body);
    setBusy(false);
    if (error) { setMessage({ kind: 'error', text: error.message, errors: error.errors }); return false; }
    await refreshAll(key);
    setMessage({ kind: 'ok', text: done });
    return true;
  };

  const cloneType = async (row: { key: string; label: string }) => {
    const label = window.prompt(`Name for the copy of ${quote(row.label)}:`, `${row.label} (copy)`);
    if (!label) return;
    const { data, error } = await call<{ key: string }>('POST', `/activity-types/${row.key}/clone`, { label });
    if (error || !data) { setMessage({ kind: 'error', text: error?.message || 'Clone failed' }); return; }
    await loadRows();
    await openType(data.key);
    setMessage({ kind: 'ok', text: `Created ${quote(label)} as a draft. Edit it, preview it, then publish and enable it.` });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          Activity types
          <HelpTooltip title="Activity types"><ActivityTypesHelp /></HelpTooltip>
        </h2>
        <p className="text-sm text-gray-600">
          What students do in an activity: who the AI plays, what it is told, how the chat is graded and what the student reads.
          Built-in types are locked: clone one to make your own. Chats keep the version they started on.
        </p>
      </div>

      {message && (
        <div className={`rounded border px-3 py-2 text-sm ${message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {message.text}
          {message.errors && message.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">{message.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Used by</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.key} className={`border-t border-gray-100 ${selected === r.key ? 'bg-purple-50' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" className="font-medium text-purple-700 hover:underline" onClick={() => openType(r.key)}>{r.label}</button>
                  <div className="text-xs text-gray-500">{r.summary}</div>
                  <div className="text-xs text-gray-400 font-mono">{r.key}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.tier === 'builtin' ? 'Built-in' : r.tier === 'system' ? 'System' : 'Custom'}{r.based_on ? <div className="text-gray-400">from {r.based_on}</div> : null}</td>
                <td className="px-3 py-2 text-xs">
                  {r.version ? (r.enabled ? <span className="text-green-700">Enabled</span> : <span className="text-gray-500">Disabled</span>) : <span className="text-amber-700">Not published</span>}
                  {r.version && <div className="text-gray-400 font-mono">{r.version.split('@')[1]}</div>}
                  {r.draft && <div className="text-amber-700">Draft v{r.draft.version_no}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{r.usage.cases} case{r.usage.cases === 1 ? '' : 's'}, {r.usage.sections} section{r.usage.sections === 1 ? '' : 's'}, {r.usage.chats} chat{r.usage.chats === 1 ? '' : 's'}</td>
                <td className="px-3 py-2 text-right">
                  {r.version && <button type="button" className="text-xs text-purple-700 hover:underline" onClick={() => cloneType(r)}>Clone</button>}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td className="px-3 py-4 text-sm text-gray-500" colSpan={5}>No types.</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && working && (
        <div className="rounded border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
            <div>
              <div className="font-semibold text-gray-900">{working.label} <span className="font-mono text-xs text-gray-400">{detail.key}</span></div>
              <div className="text-xs text-gray-500">
                {detail.locked ? 'Locked: clone it to make your own.' : detail.draft ? `Editing draft v${detail.draft.version_no}${detail.current ? ` (current: ${detail.current.version.split('@')[1]})` : ''}.` : detail.current ? `Showing ${detail.current.version.split('@')[1]}. Saving creates a draft.` : ''}
                {dirty && <span className="ml-2 text-amber-700">Unsaved changes</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!detail.locked && (
                <>
                  <button type="button" disabled={busy || !dirty} onClick={saveDraft} className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Save draft</button>
                  <button type="button" disabled={busy || !detail.draft} onClick={publish} className="rounded border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 disabled:opacity-40">Publish</button>
                  {detail.draft && <button type="button" disabled={busy} onClick={() => window.confirm('Throw away the draft?') && simple('DELETE', `/activity-types/${detail.key}/draft`, undefined, 'Draft discarded.')} className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Discard draft</button>}
                  {detail.current && (
                    <button type="button" disabled={busy} onClick={() => simple('PATCH', `/activity-types/${detail.key}`, { enabled: !detail.enabled }, detail.enabled ? 'Disabled. Chats already running continue; no new ones start.' : 'Enabled. Cases can now use this type.')} className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700">
                      {detail.enabled ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  {detail.usage.cases === 0 && detail.usage.chats === 0 && (
                    <button type="button" disabled={busy} onClick={async () => {
                      if (!window.confirm(`Delete ${quote(working.label)}? This cannot be undone.`)) return;
                      if (await simple('DELETE', `/activity-types/${detail.key}`, undefined, 'Deleted.', null)) { setSelected(null); setDetail(null); setWorking(null); }
                    }} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700">Delete</button>
                  )}
                </>
              )}
              {detail.current && <button type="button" onClick={() => cloneType({ key: detail.key, label: working.label })} className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Clone</button>}
            </div>
          </div>

          <div className="flex gap-1 border-b border-gray-200 px-4 pt-2 text-xs">
            {(['form', 'json', 'preview', 'test', 'history'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-t px-3 py-1.5 ${tab === t ? 'bg-purple-100 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t === 'form' ? 'Edit' : t === 'json' ? 'JSON' : t === 'preview' ? 'Preview' : t === 'test' ? 'Test chat' : 'History'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'form' && (
              <div className="flex gap-4">
                <nav className="w-44 shrink-0 space-y-1 text-xs">
                  {SECTIONS.map((s) => (
                    <button key={s.id} type="button" onClick={() => setSection(s.id)} className={`block w-full rounded px-2 py-1 text-left ${section === s.id ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>{s.title}</button>
                  ))}
                  <button type="button" onClick={() => setSection('traits')} className={`block w-full rounded px-2 py-1 text-left ${section === 'traits' ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>Traits</button>
                </nav>
                <div className="min-w-0 flex-1 space-y-3">
                  {(() => {
                    if (section === 'traits') {
                      return (
                        <div className="space-y-2 text-xs">
                          <p className="text-gray-600">{publishedOnce ? 'Traits are fixed for this type now that it has been published: chats already ran on them. Clone the type to change them.' : 'Traits can be changed in the JSON tab until the type is first published; after that they are fixed.'}</p>
                          <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono">{JSON.stringify(working.traits, null, 2)}</pre>
                          <div className="text-gray-600">Chat options: <code>{JSON.stringify(working.chat_options)}</code></div>
                        </div>
                      );
                    }
                    const s = SECTIONS.find((x) => x.id === section)!;
                    const value = s.path.length ? s.path.reduce((n: any, k) => n?.[k], working) : { label: working.label, summary: working.summary };
                    return (
                      <>
                        {s.note && <p className="text-xs text-gray-500">{s.note}</p>}
                        <Fields
                          value={value}
                          path={s.path}
                          readOnly={readOnly}
                          onChange={(p, v) => onField(p, v)}
                        />
                        {s.id === 'copy' && working.copy?.intro === null && <p className="text-xs text-gray-500 italic">No intro bar (set "intro" in the JSON tab to add one).</p>}
                      </>
                    );
                  })()}
                  {!readOnly && (
                    <label className="block pt-2">
                      <span className="block text-xs font-medium text-gray-700">Notes for this draft</span>
                      <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs" value={notes} maxLength={500} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
                    </label>
                  )}
                </div>
              </div>
            )}

            {tab === 'json' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">The whole definition. Saving validates it: unknown keys, slots not allowed in a field and oversized text are refused.</p>
                <textarea
                  className="h-[32rem] w-full rounded border border-gray-300 p-2 font-mono text-xs disabled:bg-gray-50"
                  value={jsonText}
                  disabled={readOnly}
                  onChange={(e) => { setJsonText(e.target.value); setDirty(true); try { setWorking(JSON.parse(e.target.value)); } catch { /* keep the last valid object for the form */ } }}
                />
              </div>
            )}

            {tab === 'preview' && <PreviewPanel typeKey={detail.key} definition={working} />}

            {tab === 'test' && <ActivityTypeTestChat typeKey={detail.key} definition={working} />}

            {tab === 'history' && (
              <div className="space-y-2 text-sm">
                {detail.versions.length === 0 && <p className="text-gray-500 text-xs">{detail.locked ? 'Built-in types are versioned by their text in code.' : 'No published versions yet.'}</p>}
                {compare && <DiffView title={compare.title} from={compare.from} to={compare.to} onClose={() => setCompare(null)} />}
                {detail.draft && detail.current && (
                  <button type="button" onClick={() => setCompare({ title: 'Draft compared with the current version', from: detail.current!.definition, to: detail.draft!.definition })} className="text-xs text-purple-700 hover:underline">Compare the draft with the current version</button>
                )}
                {detail.versions.map((v, i) => (
                  <div key={v.version} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
                    <div>
                      <span className="font-mono text-xs">v{v.version_no}</span>{' '}
                      <span className={`text-xs ${v.status === 'published' ? 'text-green-700' : 'text-gray-500'}`}>{v.status === 'published' ? 'current' : 'retired'}</span>
                      <span className="ml-2 text-xs text-gray-500">{v.published_at ? new Date(v.published_at).toLocaleString() : ''}</span>
                      {v.notes && <div className="text-xs text-gray-500">{v.notes}</div>}
                    </div>
                    <div className="flex gap-3">
                    {detail.versions[i + 1] && (
                      <button type="button" onClick={() => setCompare({ title: `v${v.version_no} compared with v${detail.versions[i + 1].version_no}`, from: detail.versions[i + 1].definition, to: v.definition })} className="text-xs text-purple-700 hover:underline">Compare with previous</button>
                    )}
                    {!detail.locked && v.status !== 'published' && (
                      <button type="button" disabled={busy} onClick={() => simple('POST', `/activity-types/${detail.key}/restore`, { version_no: v.version_no }, `v${v.version_no} copied into the draft. Publish it to make it current.`)} className="text-xs text-purple-700 hover:underline">Restore into draft</button>
                    )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** The prompts a definition produces on a real case, scenario and persona (POST /:key/preview). */
const PreviewPanel: React.FC<{ typeKey: string; definition: Definition }> = ({ typeKey, definition }) => {
  const [cases, setCases] = useState<{ case_id: string; case_title: string }[]>([]);
  const [scenarios, setScenarios] = useState<{ id: number; scenario_name: string }[]>([]);
  const [personas, setPersonas] = useState<{ persona_id: string; persona_name: string; enabled: number }[]>([]);
  const [caseId, setCaseId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audience = definition?.traits?.persona_kind === 'audience';

  useEffect(() => {
    api.get<{ case_id: string; case_title: string }[]>('/cases').then(({ data }) => setCases(data || []));
    api.get<{ persona_id: string; persona_name: string; enabled: number }[]>('/personas').then(({ data }) => setPersonas(data || []));
  }, []);
  useEffect(() => {
    setScenarios([]);
    setScenarioId('');
    if (caseId) api.get<{ id: number; scenario_name: string }[]>(`/cases/${caseId}/scenarios`).then(({ data }) => setScenarios(data || []));
  }, [caseId]);
  const personaChoices = useMemo(() => personas.filter((p) => p.enabled && isAudiencePersonaId(p.persona_id) === audience), [personas, audience]);

  const run = async () => {
    setError(null);
    const { data, error: e } = await call<Preview>('POST', `/activity-types/${typeKey}/preview`, {
      definition, case_id: caseId || null, scenario_id: scenarioId ? Number(scenarioId) : null, persona_id: personaId || null,
    });
    if (e) { setError(e.errors?.length ? `${e.message} ${e.errors.join('; ')}` : e.message); setResult(null); return; }
    setResult(data);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Builds the prompts this definition (with your unsaved edits) would send, on sample text or a real case. No AI call is made.</p>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>Case<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">Sample text</option>
            {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_title}</option>)}
          </select>
        </label>
        <label>Scenario<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} disabled={!scenarios.length}>
            <option value="">{scenarios.length ? 'Choose…' : 'None'}</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.scenario_name}</option>)}
          </select>
        </label>
        <label>{audience ? 'Audience' : 'Personality'}<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Default</option>
            {personaChoices.map((p) => <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>)}
          </select>
        </label>
        <button type="button" onClick={run} className="rounded bg-purple-600 px-3 py-1.5 font-medium text-white disabled:opacity-40">Preview</button>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
      {result && (
        <div className="space-y-2">
          {([
            ['Opening message (students see this)', result.greeting],
            ['Chat system prompt (AI only)', result.system_prompt],
            ['Grading prompt on a sample transcript (AI only)', result.coach_prompt],
            ['Note added to the last allowed message (AI only)', result.final_turn_note],
            ['Note added to a clicked position (AI only)', result.position_pick_note],
            ['What the student page receives', JSON.stringify(result.student_view, null, 2)],
          ] as [string, string][]).map(([title, text]) => (
            <details key={title} className="rounded border border-gray-200" open={title.startsWith('Opening')}>
              <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-gray-700">{title} <span className="text-gray-400">({text.length.toLocaleString()} characters)</span></summary>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-gray-100 bg-gray-50 p-2 font-mono text-xs">{text || '(none)'}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActivityTypeManager;
