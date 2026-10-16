import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/apiClient';
import InlineStatus from './ui/InlineStatus';
import { isAudiencePersonaId } from '../teachBack';
import { STUDENT_NAME_TOKEN, STUDENT_SETTINGS_LIMITS, fillOpening } from '../utils/scenarioSettings.js';

/** The `student` subtree of a scenario's settings (utils/scenarioSettings.js). */
export interface ScenarioStudentSettings {
  situation: string;
  personas: Record<string, { intro?: string; opening?: string }>;
}

interface AudienceRow {
  persona_id: string;
  persona_name: string;
}

interface Props {
  caseId: string;
  scenarioName: string;
  topic: string;
  value: ScenarioStudentSettings;
  // A state setter: drafts arrive after a slow AI call and are merged into the latest text
  // (a functional update), so anything typed while they were drafting is kept.
  onChange: React.Dispatch<React.SetStateAction<ScenarioStudentSettings>>;
}

const SAMPLE_NAME = 'Alex';

/**
 * Teach-back scenario editor: the audience's situation, and for each audience the playful intro
 * line (shown in the bar above the chat) and the opening message. "Draft with AI" fills them in;
 * the instructor edits and saves them with the scenario. Every student who picks an audience
 * reads the same saved opening; an audience with none gets a fixed template.
 */
const ScenarioStudentText: React.FC<Props> = ({ caseId, scenarioName, topic, value, onChange }) => {
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null); // 'all' or a persona id
  const [draftError, setDraftError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // set again on mount: StrictMode runs the cleanup once in development
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get<AudienceRow[]>('/personas?enabled=true').then(({ data, error }) => {
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setAudiences((data || []).filter((p) => isAudiencePersonaId(p.persona_id)));
    });
    return () => { cancelled = true; };
  }, []);

  // Audiences you can see, plus any saved entry for one you cannot (kept, shown by id).
  const rows = useMemo(() => {
    const known = new Set(audiences.map((a) => a.persona_id));
    const extra = Object.keys(value.personas)
      .filter((id) => !known.has(id))
      .map((id) => ({ persona_id: id, persona_name: id }));
    return [...audiences, ...extra];
  }, [audiences, value.personas]);

  const setPersonaText = (id: string, key: 'intro' | 'opening', text: string) => {
    onChange((prev) => ({
      ...prev,
      personas: { ...prev.personas, [id]: { ...(prev.personas[id] || {}), [key]: text } },
    }));
  };

  const draft = async (ids: string[], scope: string) => {
    if (!topic.trim()) {
      setDraftError('Enter the Chat Question (the topic) first.');
      return;
    }
    setDrafting(scope);
    setDraftError(null);
    const { data, error } = await api.post<{ personas: ScenarioStudentSettings['personas']; incomplete?: boolean; cap_reached?: boolean }>(
      `/cases/${caseId}/scenario-drafts`,
      { scenario_name: scenarioName, chat_question: topic, situation: value.situation, persona_ids: ids }
    );
    if (!mounted.current) return; // the editor was closed while drafting
    setDrafting(null);
    if (error) {
      setDraftError(error.message);
      return;
    }
    const drafted = data?.personas || {};
    // Merge into the text as it is now, not as it was when the request was sent, and keep a
    // saved line the reply left empty.
    onChange((prev) => {
      const personas = { ...prev.personas };
      for (const [id, entry] of Object.entries(drafted)) {
        const next = { ...personas[id] };
        if (entry.intro?.trim()) next.intro = entry.intro;
        if (entry.opening?.trim()) next.opening = entry.opening;
        personas[id] = next;
      }
      return { ...prev, personas };
    });
    if (Object.keys(drafted).length === 0) setDraftError('The AI returned no drafts. Try again.');
    else if (data?.cap_reached) setDraftError('You reached your weekly AI usage cap, so some audiences were not drafted. You can still type them yourself.');
    else if (data?.incomplete) setDraftError('Some audiences could not be drafted. Use Draft on those rows to try again.');
  };

  // Only audiences in your list can be drafted; a saved entry for one you cannot see is kept
  // as it is and not counted.
  const allIds = audiences.map((a) => a.persona_id);
  const emptyIds = allIds.filter((id) => !value.personas[id]?.opening?.trim());
  const draftTargets = emptyIds.length > 0 ? emptyIds : allIds;

  return (
    <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div>
        <h4 className="text-sm font-semibold text-indigo-950">Teach-back: what students see first</h4>
        <p className="text-xs text-gray-600 mt-1">
          Students see an instruction panel and then the audience&apos;s opening message. Every student who
          picks the same audience reads the same opening, with their own name. An audience with no
          opening gets a standard one.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          The audience&apos;s situation <span className="text-gray-400 font-normal">(optional, shown to students)</span>
        </label>
        <div className="flex items-start gap-2">
          <span className="pt-2 text-sm text-gray-500">I&nbsp;…</span>
          <textarea
            value={value.situation}
            onChange={(e) => { const situation = e.target.value; onChange((prev) => ({ ...prev, situation })); }}
            maxLength={STUDENT_SETTINGS_LIMITS.situation}
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="am about to take over the store's ordering, and the supplier keeps talking about safety stock"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Why the audience needs to understand the topic. Write it to follow &quot;I …&quot;. The audience
          describes it in the opening and keeps it in mind for the whole chat.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => draft(draftTargets, 'all')}
          disabled={drafting !== null || draftTargets.length === 0}
          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {drafting === 'all'
            ? 'Drafting…'
            : emptyIds.length === 0
              ? 'Redraft all with AI'
              : emptyIds.length < allIds.length
                ? `Draft the ${emptyIds.length} empty with AI`
                : 'Draft all with AI'}
        </button>
        <span className="text-xs text-gray-500">
          Uses your AI allowance. Drafts replace nothing until you save; read and edit each one.
        </span>
        {draftError && <InlineStatus kind="error" text={draftError} />}
        {loadError && <InlineStatus kind="error" text={`Could not load audiences: ${loadError}`} />}
      </div>

      {rows.length === 0 && !loadError && (
        <p className="text-sm text-gray-500">No enabled audiences yet. Create them in Setup → Personas.</p>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const entry = value.personas[row.persona_id] || {};
          const opening = entry.opening || '';
          const missingToken = opening.trim() !== '' && !opening.includes(STUDENT_NAME_TOKEN);
          const canDraft = allIds.includes(row.persona_id);
          return (
            <div key={row.persona_id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {row.persona_name}
                  {!canDraft && <span className="ml-2 text-xs font-normal text-gray-500">(not in your audience list)</span>}
                </span>
                <div className="flex items-center gap-3 text-xs">
                  {!opening.trim() && <span className="text-gray-500">No opening yet: the standard one is used</span>}
                  {canDraft && (
                    <button
                      type="button"
                      onClick={() => draft([row.persona_id], row.persona_id)}
                      disabled={drafting !== null}
                      className="text-indigo-700 hover:underline disabled:opacity-50"
                    >
                      {drafting === row.persona_id ? 'Drafting…' : opening.trim() ? 'Redraft' : 'Draft'}
                    </button>
                  )}
                  {opening.trim() && (
                    <button
                      type="button"
                      onClick={() => setPreviewId(previewId === row.persona_id ? null : row.persona_id)}
                      className="text-indigo-700 hover:underline"
                    >
                      {previewId === row.persona_id ? 'Hide preview' : 'Preview'}
                    </button>
                  )}
                </div>
              </div>
              <label className="block text-xs font-medium text-gray-600 mt-2">Intro line (in the instruction panel)</label>
              <input
                type="text"
                value={entry.intro || ''}
                onChange={(e) => setPersonaText(row.persona_id, 'intro', e.target.value)}
                maxLength={STUDENT_SETTINGS_LIMITS.intro}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
                placeholder="e.g. Your grandmother is sharp as a tack and will ask what every bit of jargon means."
              />
              <label className="block text-xs font-medium text-gray-600 mt-2">
                Opening message <span className="font-normal text-gray-400">({STUDENT_NAME_TOKEN} becomes the student&apos;s first name)</span>
              </label>
              <textarea
                value={opening}
                onChange={(e) => setPersonaText(row.persona_id, 'opening', e.target.value)}
                maxLength={STUDENT_SETTINGS_LIMITS.opening}
                rows={3}
                className={`w-full border rounded-lg px-3 py-1.5 text-sm ${missingToken ? 'border-red-400' : ''}`}
                placeholder={`Hi, ${STUDENT_NAME_TOKEN}! …`}
              />
              {missingToken && (
                <p className="text-xs text-red-600 mt-1">Put {STUDENT_NAME_TOKEN} where the student&apos;s name goes, e.g. &quot;Hi, {STUDENT_NAME_TOKEN}!&quot;.</p>
              )}
              {previewId === row.persona_id && opening.trim() && (
                <div className="mt-2 rounded-lg bg-gray-100 p-3 text-sm space-y-2">
                  {entry.intro && <p className="text-indigo-950"><em>{entry.intro}</em></p>}
                  <p className="rounded-2xl rounded-bl-none bg-white p-3 shadow-sm whitespace-pre-wrap">
                    {fillOpening(opening, SAMPLE_NAME).split(/(\*\*.*?\*\*)/g).map((part, i) =>
                      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
                    )}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScenarioStudentText;
