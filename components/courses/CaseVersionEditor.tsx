import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import HelpTooltip from '../ui/HelpTooltip';
import { ChatOptionsHelp } from '../../help/dashboard';
import { formatAllowedPersonas, personasForDefaultDropdown, resolveAllowedPersonasForForm, type PersonaRow } from '../../utils/personas';

/**
 * Edit one course case version ("Main" or a semester copy). Every save is written through to
 * the sections that follow the version (server/services/caseVersionSync.js), so the result
 * message reports how many sections changed.
 *
 * Same settings as the per-section editors on Assignments > By section, against /api/case-versions/:id.
 */

export type VersionEditorPart = 'options' | 'rubric' | 'scenarios' | 'positions';

/** Persona fields get the section form's "All enabled personas" control, not the generic renderer. */
const PERSONA_KEYS = new Set(['allowed_personas', 'default_persona']);

interface SchemaField {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'textarea' | 'select' | 'multiselect' | string;
  default: any;
  min?: number;
  max?: number;
  description?: string;
  category?: string;
  options?: { value: string; label: string }[];
}

interface Props {
  versionId: number;
  canEdit: boolean;
  followerCount: number;
  /** Scroll to this part when the editor opens. */
  initialPart?: VersionEditorPart;
  onClose: () => void;
  onChanged: () => void;
}

const CAPTURE_METHODS = [
  { value: 'explicit', label: 'Student states position' },
  { value: 'ai_inferred', label: 'AI infers position' },
  { value: 'instructor_manual', label: 'Instructor records position' },
  { value: 'none', label: 'Do not capture' },
];

const Section: React.FC<{ title: React.ReactNode; children: React.ReactNode; sectionRef?: React.Ref<HTMLDivElement> }> = ({ title, children, sectionRef }) => (
  <div ref={sectionRef} className="border border-gray-200 rounded-lg scroll-mt-2">
    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-700">{title}</div>
    <div className="p-3 space-y-3">{children}</div>
  </div>
);

const MoveButtons: React.FC<{ disabled: boolean; canUp: boolean; canDown: boolean; onMove: (delta: -1 | 1) => void }> = ({ disabled, canUp, canDown, onMove }) => (
  <span className="inline-flex">
    <button type="button" disabled={disabled || !canUp} onClick={() => onMove(-1)} aria-label="Move up" title="Move up"
      className="px-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30">▲</button>
    <button type="button" disabled={disabled || !canDown} onClick={() => onMove(1)} aria-label="Move down" title="Move down"
      className="px-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30">▼</button>
  </span>
);

const CaseVersionEditor: React.FC<Props> = ({ versionId, canEdit, followerCount, initialPart, onClose, onChanged }) => {
  const [version, setVersion] = useState<any>(null);
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [options, setOptions] = useState<Record<string, any> | null>(null);
  const [useDefaults, setUseDefaults] = useState(false);
  const [rubrics, setRubrics] = useState<any[]>([]);
  const [caseScenarios, setCaseScenarios] = useState<any[]>([]);
  const [assigned, setAssigned] = useState<any[]>([]);
  const [selectionMode, setSelectionMode] = useState('student_choice');
  const [requireOrder, setRequireOrder] = useState(false);
  const [positions, setPositions] = useState<any[]>([]);
  const [positionSettings, setPositionSettings] = useState({
    position_tracking_enabled: false,
    position_capture_method: 'explicit',
    track_position_change: true,
  });
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const partRefs = {
    options: useRef<HTMLDivElement>(null),
    rubric: useRef<HTMLDivElement>(null),
    scenarios: useRef<HTMLDivElement>(null),
    positions: useRef<HTMLDivElement>(null),
  };
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    const [vRes, schemaRes, rubricRes] = await Promise.all([
      api.get<any>(`/case-versions/${versionId}`),
      api.get<SchemaField[]>('/chat-options/schema'),
      api.get<any[]>('/rubrics'),
    ]);
    if (vRes.error || !vRes.data) { setError(vRes.error?.message || 'Failed to load version'); return; }
    const v = vRes.data;
    setVersion(v);
    setLabel(v.label);
    setSchema(schemaRes.data || []);
    setRubrics(rubricRes.data || []);
    setUseDefaults(v.chat_options == null);
    const defaults = Object.fromEntries((schemaRes.data || []).map((f) => [f.key, f.default]));
    setOptions({ ...defaults, ...(v.chat_options || {}) });
    setPositionSettings({
      position_tracking_enabled: Boolean(v.position_tracking_enabled),
      position_capture_method: v.position_capture_method || 'explicit',
      track_position_change: v.track_position_change == null ? true : Boolean(v.track_position_change),
    });

    const [allScen, verScen, verPos] = await Promise.all([
      api.get<any[]>(`/cases/${encodeURIComponent(v.case_id)}/scenarios`),
      api.get<any>(`/case-versions/${versionId}/scenarios`),
      api.get<any[]>(`/case-versions/${versionId}/positions`),
    ]);
    setCaseScenarios(allScen.data || []);
    setAssigned(verScen.data?.scenarios || []);
    setSelectionMode(verScen.data?.selection_mode || 'student_choice');
    setRequireOrder(Boolean(verScen.data?.require_order));
    setPositions(verPos.data || []);
  }, [versionId]);

  useEffect(() => { load(); }, [load]);

  // Once, after the first load renders: bring the requested part into view.
  const loaded = Boolean(version && options);
  useEffect(() => {
    if (!loaded || scrolled.current || !initialPart) return;
    scrolled.current = true;
    partRefs[initialPart].current?.scrollIntoView({ block: 'start' });
  }, [loaded, initialPart]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run a write, report how many following sections were updated, reload. */
  const write = async (method: 'patch' | 'post' | 'delete', path: string, body?: any, what = 'Saved') => {
    setBusy(true);
    setError(null);
    const result: any = method === 'delete'
      ? await api.delete(`/case-versions/${versionId}${path}`)
      : await api[method](`/case-versions/${versionId}${path}`, body);
    setBusy(false);
    if (result.error) { setError(result.error.message); return false; }
    const n = result.sections_updated ?? 0;
    setMessage(`${what}. ${n} following section${n === 1 ? '' : 's'} updated.`);
    setTimeout(() => setMessage(null), 5000);
    await load();
    onChanged();
    return true;
  };

  if (!version || !options) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">{error || 'Loading…'}</div>
      </div>
    );
  }

  const isMain = version.is_main;
  const assignedIds = new Set(assigned.map((s) => s.scenario_id));
  const disabled = !canEdit || busy;

  // Same semantics as the section form (Dashboard renderPersonaChatOptionsFields): an empty
  // allowed_personas means every enabled persona, including ones added later.
  const renderPersonaFields = () => {
    const fieldDisabled = disabled || useDefaults;
    const enabledPersonas: PersonaRow[] = (schema.find((f) => f.key === 'allowed_personas')?.options || [])
      .map((o) => ({ persona_id: o.value, persona_name: o.label }));
    const { allowAll, selectedIds } = resolveAllowedPersonasForForm(options.allowed_personas, enabledPersonas);
    const defaultChoices = personasForDefaultDropdown(enabledPersonas, options.allowed_personas);
    const updateAllowed = (nextAllowAll: boolean, nextSelected: string[]) => {
      const allowedSet = nextAllowAll ? enabledPersonas.map((p) => p.persona_id) : nextSelected;
      const default_persona = allowedSet.includes(options.default_persona) ? options.default_persona : (allowedSet[0] || options.default_persona);
      setOptions({ ...options, allowed_personas: nextAllowAll ? '' : formatAllowedPersonas(nextSelected), default_persona });
    };
    return (
      <>
        <div className="text-sm md:col-span-2">
          <span className="text-gray-700">Allowed Personas</span>
          <label className="flex items-center gap-2 mt-1">
            <input type="checkbox" className="rounded" checked={allowAll} disabled={fieldDisabled}
              onChange={(e) => e.target.checked
                ? updateAllowed(true, [])
                : updateAllowed(false, selectedIds.length ? selectedIds : enabledPersonas.map((p) => p.persona_id))} />
            All enabled personas
          </label>
          {!allowAll && (
            <div className="flex flex-wrap gap-3 mt-1 ml-5">
              {enabledPersonas.map((p) => (
                <label key={p.persona_id} className="flex items-center gap-1">
                  <input type="checkbox" className="rounded" disabled={fieldDisabled} checked={selectedIds.includes(p.persona_id)}
                    onChange={(e) => updateAllowed(false, e.target.checked
                      ? [...selectedIds, p.persona_id]
                      : selectedIds.filter((id) => id !== p.persona_id))} />
                  {p.persona_name}
                </label>
              ))}
            </div>
          )}
          <span className="block text-xs text-gray-500">Leave "All enabled personas" checked to allow every enabled persona, including new clones.</span>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Default Persona</span>
          <select value={options.default_persona ?? defaultChoices[0]?.persona_id ?? ''} disabled={fieldDisabled || defaultChoices.length === 0}
            onChange={(e) => setOptions({ ...options, default_persona: e.target.value })}
            className="mt-1 block w-full px-2 py-1 border border-gray-300 rounded bg-white disabled:bg-gray-100">
            {defaultChoices.map((p) => <option key={p.persona_id} value={p.persona_id}>{p.persona_name}</option>)}
          </select>
        </label>
      </>
    );
  };

  const assignedInOrder = [...assigned].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const moveScenario = (scenarioId: number, delta: -1 | 1) => {
    const order = assignedInOrder.map((s) => s.scenario_id);
    const i = order.indexOf(scenarioId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    write('patch', '/scenarios/reorder', { order }, 'Scenario order saved');
  };
  // Positions are ordered within their scenario.
  const movePosition = (positionId: number, delta: -1 | 1) => {
    const p = positions.find((x) => x.position_id === positionId);
    if (!p) return;
    const siblings = positions.filter((x) => x.scenario_id === p.scenario_id);
    const i = siblings.findIndex((x) => x.position_id === positionId);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    write('patch', '/positions/reorder', { positions: siblings.map((x, idx) => ({ position_id: x.position_id, sort_order: idx })) }, 'Position order saved');
  };

  const renderField = (field: SchemaField) => {
    const value = options[field.key];
    const set = (v: any) => setOptions({ ...options, [field.key]: v });
    const fieldDisabled = disabled || useDefaults;
    switch (field.type) {
      case 'boolean':
        return (
          <label key={field.key} className="flex items-start gap-2 text-sm" title={field.description}>
            <input type="checkbox" checked={Boolean(value)} disabled={fieldDisabled} onChange={(e) => set(e.target.checked)} className="mt-0.5 rounded" />
            <span>{field.label}{field.description && <span className="block text-xs text-gray-500">{field.description}</span>}</span>
          </label>
        );
      case 'number':
        return (
          <label key={field.key} className="block text-sm" title={field.description}>
            <span className="text-gray-700">{field.label}</span>
            <input type="number" min={field.min} max={field.max} value={value ?? 0} disabled={fieldDisabled}
              onChange={(e) => set(Number(e.target.value))}
              className="mt-1 w-24 px-2 py-1 border border-gray-300 rounded disabled:bg-gray-100" />
            {field.description && <span className="block text-xs text-gray-500">{field.description}</span>}
          </label>
        );
      case 'textarea':
        return (
          <label key={field.key} className="block text-sm md:col-span-2">
            <span className="text-gray-700">{field.label}</span>
            <textarea rows={3} value={value ?? ''} disabled={fieldDisabled} onChange={(e) => set(e.target.value)}
              className="mt-1 w-full px-2 py-1 border border-gray-300 rounded disabled:bg-gray-100" />
            {field.description && <span className="block text-xs text-gray-500">{field.description}</span>}
          </label>
        );
      case 'select':
        return (
          <label key={field.key} className="block text-sm">
            <span className="text-gray-700">{field.label}</span>
            <select value={value ?? ''} disabled={fieldDisabled} onChange={(e) => set(e.target.value)}
              className="mt-1 block w-full px-2 py-1 border border-gray-300 rounded bg-white disabled:bg-gray-100">
              {(field.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        );
      case 'multiselect': {
        const selected = new Set(String(value ?? '').split(',').filter(Boolean));
        return (
          <div key={field.key} className="text-sm md:col-span-2">
            <span className="text-gray-700">{field.label}</span>
            <div className="flex flex-wrap gap-3 mt-1">
              {(field.options || []).map((o) => (
                <label key={o.value} className="flex items-center gap-1">
                  <input type="checkbox" className="rounded" disabled={fieldDisabled} checked={selected.has(o.value)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(o.value); else next.delete(o.value);
                      set([...next].join(','));
                    }} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-start p-4 border-b">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900">{version.case_title}</h3>
            <p className="text-sm text-gray-600">
              {isMain ? 'Main settings' : `${version.semester_name} copy`}
              {' · '}
              {followerCount} section{followerCount === 1 ? '' : 's'} follow{followerCount === 1 ? 's' : ''} this version
            </p>
            {!canEdit && <p className="text-xs text-amber-700 mt-1">View only — the course owner or an admin can edit these settings.</p>}
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="Close">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {message && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-2">{message}</div>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{error}</div>}

          {!isMain && (
            <Section title="Label">
              <div className="flex gap-2">
                <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={disabled} maxLength={100}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded disabled:bg-gray-100" />
                <button disabled={disabled || !label.trim() || label === version.label}
                  onClick={() => write('patch', '', { label }, 'Label saved')}
                  className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded disabled:opacity-50">Save</button>
              </div>
            </Section>
          )}

          <Section
            sectionRef={partRefs.options}
            title={
              <span className="flex items-center gap-2">
                Chat options
                <HelpTooltip title="Chat Options Help"><ChatOptionsHelp /></HelpTooltip>
              </span>
            }
          >
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="rounded" checked={useDefaults} disabled={disabled} onChange={(e) => setUseDefaults(e.target.checked)} />
              Use the default chat options
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {schema.filter((f) => !PERSONA_KEYS.has(f.key)).map(renderField)}
              {schema.some((f) => f.key === 'allowed_personas') && renderPersonaFields()}
            </div>
            <div className="flex justify-end">
              <button disabled={disabled}
                onClick={() => write('patch', '/options', { chat_options: useDefaults ? null : options }, 'Chat options saved')}
                className="px-4 py-1.5 text-sm text-white bg-indigo-600 rounded disabled:opacity-50">Save chat options</button>
            </div>
          </Section>

          <Section title="Rubric" sectionRef={partRefs.rubric}>
            <select value={version.rubric_id ?? ''} disabled={disabled}
              onChange={(e) => write('patch', '/rubric', { rubric_id: e.target.value ? Number(e.target.value) : null }, 'Rubric saved')}
              className="w-full px-2 py-1.5 border border-gray-300 rounded bg-white disabled:bg-gray-100 text-sm">
              <option value="">System default rubric</option>
              {rubrics.map((r) => <option key={r.rubric_id} value={r.rubric_id}>{r.rubric_name}</option>)}
            </select>
          </Section>

          <Section title="Scenarios" sectionRef={partRefs.scenarios}>
            {caseScenarios.length === 0 ? (
              <p className="text-sm text-gray-500">This case has no scenarios.</p>
            ) : (
              <div className="space-y-1">
                {/* Assigned scenarios first, in their order; then the rest of the case's scenarios. */}
                {[
                  ...assignedInOrder.map((a) => caseScenarios.find((sc) => sc.id === a.scenario_id)).filter(Boolean),
                  ...caseScenarios.filter((sc) => !assignedIds.has(sc.id)),
                ].map((sc: any) => {
                  const a = assigned.find((x) => x.scenario_id === sc.id);
                  const index = assignedInOrder.findIndex((x) => x.scenario_id === sc.id);
                  return (
                    <div key={sc.id} className="flex items-center justify-between gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" className="rounded" disabled={disabled} checked={assignedIds.has(sc.id)}
                          onChange={(e) => e.target.checked
                            ? write('post', '/scenarios', { scenario_ids: [sc.id] }, 'Scenario added')
                            : write('delete', `/scenarios/${sc.id}`, undefined, 'Scenario removed')} />
                        <span className={sc.enabled ? '' : 'text-gray-400'}>{sc.scenario_name}</span>
                      </label>
                      {a && (
                        <span className="flex items-center gap-1">
                          {assignedInOrder.length > 1 && (
                            <MoveButtons disabled={disabled} canUp={index > 0} canDown={index < assignedInOrder.length - 1}
                              onMove={(delta) => moveScenario(sc.id, delta)} />
                          )}
                          <button disabled={disabled} onClick={() => write('patch', `/scenarios/${sc.id}/toggle`, undefined, 'Scenario updated')}
                            className={`px-2 py-0.5 text-xs rounded-full ${a.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                            {a.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {assigned.length > 1 && (
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100 text-sm">
                <select value={selectionMode} disabled={disabled} onChange={(e) => setSelectionMode(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded bg-white">
                  <option value="student_choice">Students choose a scenario</option>
                  <option value="all_required">All scenarios required</option>
                </select>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="rounded" disabled={disabled} checked={requireOrder} onChange={(e) => setRequireOrder(e.target.checked)} />
                  Require order
                </label>
                <button disabled={disabled}
                  onClick={() => write('patch', '/selection-mode', { selection_mode: selectionMode, require_order: requireOrder }, 'Selection mode saved')}
                  className="px-3 py-1 text-sm text-white bg-indigo-600 rounded disabled:opacity-50">Save</button>
              </div>
            )}
          </Section>

          <Section title="Position tracking" sectionRef={partRefs.positions}>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" className="rounded" disabled={disabled} checked={positionSettings.position_tracking_enabled}
                  onChange={(e) => setPositionSettings({ ...positionSettings, position_tracking_enabled: e.target.checked })} />
                Track positions
              </label>
              <select value={positionSettings.position_capture_method} disabled={disabled}
                onChange={(e) => setPositionSettings({ ...positionSettings, position_capture_method: e.target.value })}
                className="px-2 py-1 border border-gray-300 rounded bg-white">
                {CAPTURE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <label className="flex items-center gap-1">
                <input type="checkbox" className="rounded" disabled={disabled} checked={positionSettings.track_position_change}
                  onChange={(e) => setPositionSettings({ ...positionSettings, track_position_change: e.target.checked })} />
                Ask for final position
              </label>
              <button disabled={disabled} onClick={() => write('patch', '/position-settings', positionSettings, 'Position settings saved')}
                className="px-3 py-1 text-sm text-white bg-indigo-600 rounded disabled:opacity-50">Save</button>
            </div>
            {positions.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-gray-100">
                {positions.map((p) => {
                  const siblings = positions.filter((x) => x.scenario_id === p.scenario_id);
                  const index = siblings.findIndex((x) => x.position_id === p.position_id);
                  return (
                    <div key={p.position_id} className="flex items-center justify-between text-sm">
                      <span><span className="text-gray-400">{p.scenario_name}:</span> {p.position_name}</span>
                      <span className="flex items-center gap-1">
                        {siblings.length > 1 && (
                          <MoveButtons disabled={disabled} canUp={index > 0} canDown={index < siblings.length - 1}
                            onMove={(delta) => movePosition(p.position_id, delta)} />
                        )}
                        <button disabled={disabled} onClick={() => write('patch', `/positions/${p.position_id}/toggle`, undefined, 'Position updated')}
                          className={`px-2 py-0.5 text-xs rounded-full ${p.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {p.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <div className="flex justify-end p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Done</button>
        </div>
      </div>
    </div>
  );
};

export default CaseVersionEditor;
