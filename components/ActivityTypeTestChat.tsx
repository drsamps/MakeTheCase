import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, getApiBaseUrl, getAuthHeaders } from '../services/apiClient';
import { isAudiencePersonaId } from '../teachBack';

type Definition = Record<string, any>;

interface Turn { role: 'student' | 'protagonist'; content: string; signals?: { complete?: boolean; touchpoints?: string[] } | null }
interface Grade { criteria: { question?: string; score?: number; max_score?: number; feedback?: string; status?: string; evidence?: string }[]; totalScore?: number; summary?: string; touchpoints?: { key: string; label: string; hit: boolean; evidence?: string }[] }

async function post<T>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(`${getApiBaseUrl()}${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      const e = j.error || {};
      return { data: null, error: e.errors?.length ? `${e.message} ${e.errors.join('; ')}` : e.message || `Request failed (${r.status})` };
    }
    return { data: j.data as T, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

/**
 * Chat with a type as a student would, including an unsaved draft. Nothing is recorded as a student
 * chat: the conversation lives on this screen and is sent with each turn. Billed to the admin's own
 * AI budget (model_usage purpose `activity_type_test`). Signals, hidden from a real student, are
 * shown here so the author can see the AI using them.
 */
const ActivityTypeTestChat: React.FC<{ typeKey: string; definition: Definition }> = ({ typeKey, definition }) => {
  const [cases, setCases] = useState<{ case_id: string; case_title: string }[]>([]);
  const [scenarios, setScenarios] = useState<{ id: number; scenario_name: string }[]>([]);
  const [personas, setPersonas] = useState<{ persona_id: string; persona_name: string; enabled: number }[]>([]);
  const [caseId, setCaseId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [turns, grade]);
  const personaChoices = useMemo(() => personas.filter((p) => p.enabled && isAudiencePersonaId(p.persona_id) === audience), [personas, audience]);

  const target = () => ({ definition, case_id: caseId || null, scenario_id: scenarioId ? Number(scenarioId) : null, persona_id: personaId || null });
  const reset = () => { setTurns([]); setGrade(null); setError(null); };

  const start = async () => {
    reset();
    setBusy(true);
    const { data, error: e } = await post<{ greeting: string }>(`/activity-types/${typeKey}/preview`, target());
    setBusy(false);
    if (e) { setError(e); return; }
    setTurns([{ role: 'protagonist', content: data!.greeting }]);
  };

  const send = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await post<{ text: string; signals: Turn['signals'] }>(`/activity-types/${typeKey}/test-chat`, { ...target(), history: turns, message: text });
    setBusy(false);
    if (e) { setError(e); return; }
    setTurns([...turns, { role: 'student', content: text }, { role: 'protagonist', content: data!.text, signals: data!.signals }]);
    setMessage('');
  };

  const runGrade = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await post<Grade>(`/activity-types/${typeKey}/test-grade`, { ...target(), history: turns });
    setBusy(false);
    if (e) { setError(e); return; }
    setGrade(data);
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-gray-500">
        Chat with this definition (with your unsaved edits) as a student would. Nothing is recorded as a student chat. <strong>Each message costs real AI usage, billed to your AI budget</strong> (or the system key, for an admin not acting as an instructor).
      </p>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>Case<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={caseId} onChange={(e) => { setCaseId(e.target.value); reset(); }}>
            <option value="">Sample text</option>
            {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_title}</option>)}
          </select>
        </label>
        <label>Scenario<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={scenarioId} onChange={(e) => { setScenarioId(e.target.value); reset(); }} disabled={!scenarios.length}>
            <option value="">{scenarios.length ? 'Choose…' : 'None'}</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.scenario_name}</option>)}
          </select>
        </label>
        <label>{audience ? 'Audience' : 'Personality'}<br />
          <select className="rounded border border-gray-300 px-2 py-1" value={personaId} onChange={(e) => { setPersonaId(e.target.value); reset(); }}>
            <option value="">Default</option>
            {personaChoices.map((p) => <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={start} className="rounded bg-purple-600 px-3 py-1.5 font-medium text-white disabled:opacity-40">{turns.length ? 'Start over' : 'Start'}</button>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

      {turns.length > 0 && (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'student' ? 'text-right' : ''}>
              <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${t.role === 'student' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-900'}`}>{t.content}</div>
              {t.signals && (
                <div className="mt-0.5 font-mono text-[11px] text-green-700">signal (students never see this): {JSON.stringify(t.signals)}</div>
              )}
            </div>
          ))}
          {grade && (
            <div className="rounded border border-purple-200 bg-white p-3 text-xs">
              <div className="font-medium text-gray-900">Grade: {grade.totalScore ?? '?'}</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {grade.criteria?.map((c, i) => <li key={i}><strong>{c.question}</strong> {c.score}/{c.max_score}. {c.feedback}{c.evidence ? ` "${c.evidence}"` : ''}</li>)}
              </ul>
              {grade.summary && <p className="mt-2 whitespace-pre-wrap text-gray-700">{grade.summary}</p>}
              {grade.touchpoints && grade.touchpoints.length > 0 && (
                <p className="mt-2 text-gray-700">Touchpoints: {grade.touchpoints.map((t) => `${t.hit ? '✓' : '✗'} ${t.label}`).join(', ')}</p>
              )}
            </div>
          )}
          <div ref={logEnd} />
        </div>
      )}

      {turns.length > 0 && (
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            rows={2}
            maxLength={4000}
            value={message}
            placeholder="Type as the student…"
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="button" disabled={busy || !message.trim()} onClick={send} className="rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{busy ? 'Waiting…' : 'Send'}</button>
          <button type="button" disabled={busy || !turns.some((t) => t.role === 'student')} onClick={runGrade} className="rounded border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 disabled:opacity-40">Grade this</button>
        </div>
      )}
    </div>
  );
};

export default ActivityTypeTestChat;
