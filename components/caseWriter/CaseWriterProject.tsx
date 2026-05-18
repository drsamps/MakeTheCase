import React, { useEffect, useMemo, useState } from 'react';
import {
  caseWriterApi,
  CaseWriterProject as ProjectData,
  ScenarioCard,
  BoundaryValidationResult,
  CaseVersion,
  CaseSize,
  coerceMarkdown
} from '../../services/caseWriter/api';
import { getApiBaseUrl } from '../../services/apiClient';
import VisibilityPicker, { Visibility, TeamShare } from '../ui/VisibilityPicker';
import ErrorBanner from './ErrorBanner';
import StepRail, { RailItem, RailStatus } from './StepRail';
import MarkdownStepEditor from './MarkdownStepEditor';
import ScenariosList from './ScenariosList';
import SourceMaterial from './SourceMaterial';
import CaseVersionsPanel from './CaseVersionsPanel';
import PromptInfoButton from './PromptInfoButton';
import { useGenerationTimer } from './useGenerationTimer';

interface Props {
  projectId: string;
  onBack: () => void;
  user?: { full_name?: string; email?: string; role?: string } | null;
}

interface ModelOption {
  model_id: string;
  display_name?: string;
  vendor?: string;
}

type PaneKey =
  | 'overview' | 'source' | 'brief' | 'scenarios' | 'blueprint'
  | 'student' | 'teaching' | 'publish' | 'export';

const PANE_ORDER: PaneKey[] = [
  'overview', 'source', 'brief', 'scenarios', 'blueprint',
  'student', 'teaching', 'publish', 'export'
];

const PANE_LABELS: Record<PaneKey, string> = {
  overview: 'Overview',
  source: 'Source Material',
  brief: '1. Learning Brief',
  scenarios: '2. Scenarios',
  blueprint: '3. Blueprint',
  student: '4. Student Case',
  teaching: '5. Teaching Note',
  publish: 'Publish',
  export: 'Export'
};

const STEP_DESCRIPTIONS: Record<PaneKey, string> = {
  overview: 'Project metadata: title, teaching principle, audience, course context, and default AI model.',
  source: 'Optional reference material. Approved references are passed to every generation step.',
  brief: 'The teaching summary: what students should learn and how this case teaches it.',
  scenarios: 'Alternative case storylines to choose from — pick one to develop into a full case.',
  blueprint: 'Detailed case design: protagonist, timeline, evidence, exhibits, before any prose.',
  student: 'The case document students will read; no analysis or answers.',
  teaching: 'Instructor-only analysis, recommended approach, and grading materials.',
  publish: 'Set the four publish-time fields (protagonist, opening question, arguments) and publish to the chat tool.',
  export: 'Download case + teaching note as Markdown, Word, or PDF.'
};

const CaseWriterProject: React.FC<Props> = ({ projectId, onBack, user }) => {
  const isAdmin = user?.role === 'admin';
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [activePane, setActivePane] = useState<PaneKey>('overview');

  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [briefDraft, setBriefDraft] = useState('');
  const [blueprintDraft, setBlueprintDraft] = useState('');
  const [studentDraft, setStudentDraft] = useState('');
  const [teachingDraft, setTeachingDraft] = useState('');
  const [scenariosDraft, setScenariosDraft] = useState<ScenarioCard[]>([]);

  const [titleDraft, setTitleDraft] = useState('');
  const [principleDraft, setPrincipleDraft] = useState('');
  const [audienceDraft, setAudienceDraft] = useState('');
  const [courseContextDraft, setCourseContextDraft] = useState('');
  const [difficultyDraft, setDifficultyDraft] = useState('');
  const [caseTypeDraft, setCaseTypeDraft] = useState('');
  const [defaultModelDraft, setDefaultModelDraft] = useState('');
  const [visibilityDraft, setVisibilityDraft] = useState<Visibility>('private');
  const [teamSharesDraft, setTeamSharesDraft] = useState<TeamShare[]>([]);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const [pubProtagonist, setPubProtagonist] = useState('');
  const [pubQuestion, setPubQuestion] = useState('');
  const [pubFor, setPubFor] = useState('');
  const [pubAgainst, setPubAgainst] = useState('');
  const [extractingPublish, setExtractingPublish] = useState(false);
  const [extractModelOverride, setExtractModelOverride] = useState<string>('');
  const [showExtractModelPicker, setShowExtractModelPicker] = useState(false);
  const extractTimerText = useGenerationTimer(extractingPublish);

  const [validation, setValidation] = useState<BoundaryValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [versions, setVersions] = useState<CaseVersion[]>([]);
  // The most recent size used when generating the student case. Defaults to
  // 'regular'; pre-fills the "Save as version" modal.
  const [lastStudentSize, setLastStudentSize] = useState<CaseSize>('regular');

  async function reload() {
    setLoading(true);
    const { data, error } = await caseWriterApi.getProject(projectId);
    setLoading(false);
    if (error || !data) { setErr(error?.message || 'Failed to load project'); return; }
    setProject(data);
    setBriefDraft(coerceMarkdown(data.learning_brief));
    setBlueprintDraft(coerceMarkdown(data.case_blueprint));
    setStudentDraft(coerceMarkdown(data.student_case));
    setTeachingDraft(coerceMarkdown(data.teaching_note));
    setScenariosDraft(Array.isArray(data.scenario_options) ? data.scenario_options : []);
    setTitleDraft(data.title || '');
    setPrincipleDraft(data.teaching_principle || '');
    setAudienceDraft(data.audience || '');
    setCourseContextDraft(data.course_context || '');
    setDifficultyDraft(data.difficulty || '');
    setCaseTypeDraft(data.case_type || '');
    setDefaultModelDraft(data.default_model_id || '');
    setVisibilityDraft((data.visibility as Visibility) || 'private');
    // The list endpoint doesn't return team_shares, so we leave the
    // editor's selection empty until the user picks Team and chooses teams.
    setPubProtagonist(data.publish_protagonist || '');
    setPubQuestion(data.publish_chat_question || '');
    setPubFor(data.publish_arguments_for || '');
    setPubAgainst(data.publish_arguments_against || '');
  }

  useEffect(() => { reload(); reloadVersions(); }, [projectId]);

  useEffect(() => {
    (async () => {
      try {
        const t = localStorage.getItem('admin_auth_token');
        const res = await fetch(`${getApiBaseUrl()}/models?enabled=true`, {
          headers: t ? { Authorization: `Bearer ${t}` } : {}
        });
        if (!res.ok) return;
        const json = await res.json();
        const list: any[] = json?.data || json || [];
        setModels(list.map(m => ({
          model_id: m.model_id,
          display_name: m.model_name || m.display_name || m.model_id,
          vendor: m.vendor
        })));
      } catch { /* non-fatal */ }
    })();
  }, []);

  const briefDirty = useMemo(() => coerceMarkdown(project?.learning_brief) !== briefDraft, [project, briefDraft]);
  const blueprintDirty = useMemo(() => coerceMarkdown(project?.case_blueprint) !== blueprintDraft, [project, blueprintDraft]);
  const studentDirty = useMemo(() => coerceMarkdown(project?.student_case) !== studentDraft, [project, studentDraft]);
  const teachingDirty = useMemo(() => coerceMarkdown(project?.teaching_note) !== teachingDraft, [project, teachingDraft]);
  const scenariosDirty = useMemo(() => {
    try { return JSON.stringify(project?.scenario_options || []) !== JSON.stringify(scenariosDraft); }
    catch { return false; }
  }, [project, scenariosDraft]);
  const overviewDirty = useMemo(() => (
    (project?.title || '') !== titleDraft
    || (project?.teaching_principle || '') !== principleDraft
    || (project?.audience || '') !== audienceDraft
    || (project?.course_context || '') !== courseContextDraft
    || (project?.difficulty || '') !== difficultyDraft
    || (project?.case_type || '') !== caseTypeDraft
    || (project?.default_model_id || '') !== defaultModelDraft
  ), [project, titleDraft, principleDraft, audienceDraft, courseContextDraft, difficultyDraft, caseTypeDraft, defaultModelDraft]);
  const publishDirty = useMemo(() => (
    (project?.publish_protagonist || '') !== pubProtagonist
    || (project?.publish_chat_question || '') !== pubQuestion
    || (project?.publish_arguments_for || '') !== pubFor
    || (project?.publish_arguments_against || '') !== pubAgainst
  ), [project, pubProtagonist, pubQuestion, pubFor, pubAgainst]);

  function dirtyForPane(p: PaneKey): boolean {
    switch (p) {
      case 'overview': return overviewDirty;
      case 'brief': return briefDirty;
      case 'scenarios': return scenariosDirty;
      case 'blueprint': return blueprintDirty;
      case 'student': return studentDirty;
      case 'teaching': return teachingDirty;
      case 'publish': return publishDirty;
      default: return false;
    }
  }

  function trySelectPane(next: PaneKey) {
    if (next === activePane) return;
    if (dirtyForPane(activePane)) {
      if (!confirm('You have unsaved edits on this section. Discard them?')) return;
    }
    setActivePane(next);
  }

  function railStatusFor(p: PaneKey): RailStatus {
    if (!project) return 'empty';
    switch (p) {
      case 'overview': return project.teaching_principle ? 'approved' : 'empty';
      case 'source': return 'empty';
      case 'brief': return project.learning_brief ? 'approved' : 'empty';
      case 'scenarios':
        if (project.selected_scenario) return 'approved';
        if (project.scenario_options && (project.scenario_options as any[]).length > 0) return 'draft';
        return 'empty';
      case 'blueprint': return project.case_blueprint ? 'approved' : 'empty';
      case 'student': return project.student_case ? 'approved' : 'empty';
      case 'teaching': return project.teaching_note ? 'approved' : 'empty';
      case 'publish': return project.published_case_id ? 'approved' : (project.publish_protagonist ? 'draft' : 'empty');
      case 'export': return 'empty';
      default: return 'empty';
    }
  }

  const railItems: RailItem[] = [
    { key: 'overview', label: 'Overview', status: railStatusFor('overview') },
    { key: 'source', label: 'Source Material', status: railStatusFor('source') },
    { key: 'd1', label: '', divider: true },
    { key: 'brief', label: '1. Learning Brief', status: railStatusFor('brief') },
    { key: 'scenarios', label: '2. Scenarios', status: railStatusFor('scenarios') },
    { key: 'blueprint', label: '3. Blueprint', status: railStatusFor('blueprint') },
    { key: 'student', label: '4. Student Case', status: railStatusFor('student') },
    { key: 'teaching', label: '5. Teaching Note', status: railStatusFor('teaching') },
    { key: 'd2', label: '', divider: true },
    { key: 'publish', label: 'Publish', status: railStatusFor('publish') },
    { key: 'export', label: 'Export', status: 'empty' }
  ];

  function setBusyFor(key: string, value: boolean) {
    setBusy(prev => ({ ...prev, [key]: value }));
  }

  async function patchProject(patch: Partial<ProjectData>): Promise<{ ok: boolean; message?: string }> {
    const { data, error } = await caseWriterApi.updateProject(projectId, patch);
    if (error || !data) return { ok: false, message: error?.message || 'Save failed' };
    setProject(data);
    return { ok: true };
  }

  async function generateBrief(overrideModelId?: string) {
    if (!project?.teaching_principle) { setErr('Set a teaching principle in Overview first'); return; }
    setBusyFor('brief', true); setErr(null);
    const { data, error } = await caseWriterApi.generateBrief(projectId, { model_id: overrideModelId });
    setBusyFor('brief', false);
    if (error || !data) { setErr(error?.message || 'Brief generation failed'); return; }
    setBriefDraft(data.markdown);
    await reload();
  }

  async function generateScenarios(overrideModelId?: string, count?: number) {
    if (!project?.learning_brief) { setErr('Generate the learning brief first'); return; }
    setBusyFor('scenarios', true); setErr(null);
    const { data, error } = await caseWriterApi.generateScenarios(projectId, { model_id: overrideModelId, count });
    setBusyFor('scenarios', false);
    if (error || !data) { setErr(error?.message || 'Scenario generation failed'); return; }
    setScenariosDraft(data.scenarios);
    await reload();
  }

  async function generateBlueprint(overrideModelId?: string) {
    if (!project?.selected_scenario) { setErr('Select a scenario first'); return; }
    setBusyFor('blueprint', true); setErr(null);
    const { data, error } = await caseWriterApi.generateBlueprint(projectId, { model_id: overrideModelId });
    setBusyFor('blueprint', false);
    if (error || !data) { setErr(error?.message || 'Blueprint generation failed'); return; }
    setBlueprintDraft(data.markdown);
    await reload();
  }

  async function generateStudent(overrideModelId?: string, opts?: Record<string, string>) {
    if (!project?.case_blueprint) { setErr('Generate the blueprint first'); return; }
    const length = (opts?.length as CaseSize | undefined) || 'regular';
    setBusyFor('student', true); setErr(null);
    const { data, error } = await caseWriterApi.generateStudentCase(projectId, { model_id: overrideModelId, length });
    setBusyFor('student', false);
    if (error || !data) { setErr(error?.message || 'Student case generation failed'); return; }
    setStudentDraft(data.markdown);
    setLastStudentSize(length);
    await reload();
  }

  async function generateTeaching(overrideModelId?: string, opts?: Record<string, string>) {
    if (!project?.student_case) { setErr('Generate the student case first'); return; }
    const format = (opts?.format as 'brief' | 'standard' | 'detailed' | undefined) || 'standard';
    setBusyFor('teaching', true); setErr(null);
    const { data, error } = await caseWriterApi.generateTeachingNote(projectId, { model_id: overrideModelId, format });
    setBusyFor('teaching', false);
    if (error || !data) { setErr(error?.message || 'Teaching note generation failed'); return; }
    setTeachingDraft(data.markdown);
    await reload();
  }

  async function reloadVersions() {
    const { data } = await caseWriterApi.listVersions(projectId);
    if (data) setVersions(data);
  }

  async function runValidate() {
    setValidating(true); setErr(null);
    const { data, error } = await caseWriterApi.validate(projectId);
    setValidating(false);
    if (error || !data) { setErr(error?.message || 'Validation failed'); return; }
    setValidation(data);
  }

  async function autoFillPublish() {
    if (!project?.student_case || !project?.teaching_note) {
      setErr('Generate the student case and teaching note first');
      return;
    }
    setExtractingPublish(true); setErr(null);
    const { data, error } = await caseWriterApi.extractPublishFields(projectId, {
      model_id: extractModelOverride || undefined
    });
    setExtractingPublish(false);
    if (error || !data) { setErr(error?.message || 'Extract failed'); return; }
    setPubProtagonist(data.protagonist || '');
    setPubQuestion(data.chat_question || '');
    setPubFor(data.arguments_for || '');
    setPubAgainst(data.arguments_against || '');
  }

  async function doPublish() {
    if (publishDirty) {
      const save = await patchProject({
        publish_protagonist: pubProtagonist,
        publish_chat_question: pubQuestion,
        publish_arguments_for: pubFor,
        publish_arguments_against: pubAgainst
      } as any);
      if (!save.ok) { setErr(save.message || 'Save publish fields failed'); return; }
    }
    setPublishing(true); setErr(null);
    const { data, error } = await caseWriterApi.publish(projectId);
    setPublishing(false);
    if (error || !data) {
      const valErr = (error as any)?.validation as BoundaryValidationResult | undefined;
      if (valErr) setValidation(valErr);
      setErr(error?.message || 'Publish failed');
      return;
    }
    await reload();
  }

  async function doExport(format: 'md' | 'docx' | 'pdf', doc: 'case' | 'teaching_note' | 'combined') {
    const { blob, filename, error } = await caseWriterApi.export(projectId, { format, doc });
    if (error || !blob) { setErr(error || 'Export failed'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `case-writer-${doc}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-6 text-gray-500">Loading project…</div>;
  if (!project) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="text-blue-600 hover:underline text-sm">← Back to projects</button>
        <p className="mt-4 text-red-700">Project not found.</p>
      </div>
    );
  }

  const publishedBanner = project.published_case_id && (
    <div className="bg-green-50 border border-green-200 text-green-900 text-sm rounded-md p-3 mb-3">
      Published as <span className="font-mono font-semibold">{project.published_case_id}</span>
    </div>
  );

  return (
    <div>
      <div className="px-6 py-3 border-b border-gray-200 bg-white flex items-center gap-4">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">← Projects</button>
        <h2 className="text-lg font-semibold text-gray-900 flex-1 truncate">
          {project.title || 'Untitled project'}
          {project.teaching_principle && (
            <span className="ml-2 text-sm font-normal text-gray-500">— {project.teaching_principle}</span>
          )}
        </h2>
        <span className="text-xs text-gray-500">{project.status}</span>
      </div>

      <div className="flex">
        <StepRail
          items={railItems}
          activeKey={activePane}
          onSelect={(k) => trySelectPane(k as PaneKey)}
        />
        <div className="flex-1 p-6 min-w-0">
          {publishedBanner}
          <ErrorBanner message={err} onDismiss={() => setErr(null)} />
          {(() => {
            const idx = PANE_ORDER.indexOf(activePane);
            const prev = idx > 0 ? PANE_ORDER[idx - 1] : null;
            const next = idx >= 0 && idx < PANE_ORDER.length - 1 ? PANE_ORDER[idx + 1] : null;
            return (
              <div className="flex items-center justify-between mb-3 text-sm">
                {prev ? (
                  <button
                    type="button"
                    onClick={() => trySelectPane(prev)}
                    className="text-blue-600 hover:underline"
                  >← Prior step: {PANE_LABELS[prev]}</button>
                ) : <span />}
                {next ? (
                  <button
                    type="button"
                    onClick={() => trySelectPane(next)}
                    className="text-blue-600 hover:underline"
                  >Next step: {PANE_LABELS[next]} →</button>
                ) : <span />}
              </div>
            );
          })()}

          {activePane === 'overview' && (
            <div className="space-y-4 max-w-3xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Overview</h2>
                <p className="text-sm text-gray-600 mt-1">{STEP_DESCRIPTIONS.overview}</p>
              </div>
              <Field label="Title">
                <input type="text" value={titleDraft} onChange={e => setTitleDraft(e.target.value)} className="cw-input" />
              </Field>
              <Field label="Teaching principle">
                <textarea
                  value={principleDraft}
                  onChange={e => setPrincipleDraft(e.target.value)}
                  className="cw-input"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: 60 }}
                  placeholder="e.g. Channel conflict; Sunk cost fallacy; Pricing strategy"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Audience">
                  <input type="text" value={audienceDraft} onChange={e => setAudienceDraft(e.target.value)} className="cw-input" placeholder="MBA, undergrad, executive…" />
                </Field>
                <Field label="Course context">
                  <input type="text" value={courseContextDraft} onChange={e => setCourseContextDraft(e.target.value)} className="cw-input" placeholder="Strategy 401, Week 6…" />
                </Field>
                <Field label="Difficulty">
                  <select value={difficultyDraft} onChange={e => setDifficultyDraft(e.target.value)} className="cw-input">
                    <option value="">(unspecified)</option>
                    <option value="introductory">Introductory</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="executive">Executive</option>
                  </select>
                </Field>
                <Field label="Case type">
                  <select value={caseTypeDraft} onChange={e => setCaseTypeDraft(e.target.value)} className="cw-input">
                    <option value="">(unspecified)</option>
                    <option value="fictional">Fictional</option>
                    <option value="disguised">Disguised</option>
                    <option value="composite">Composite</option>
                    <option value="real_company_inspired">Real-company inspired</option>
                    <option value="real_company_verified">Real-company verified</option>
                  </select>
                </Field>
                <Field label="Default AI model">
                  <select value={defaultModelDraft} onChange={e => setDefaultModelDraft(e.target.value)} className="cw-input">
                    <option value="">(first enabled model)</option>
                    {models.map(m => <option key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</option>)}
                  </select>
                </Field>
              </div>
              <div className="border-t pt-4">
                <VisibilityPicker
                  value={visibilityDraft}
                  onChange={setVisibilityDraft}
                  teamShares={teamSharesDraft}
                  onTeamSharesChange={setTeamSharesDraft}
                  canPublish={isAdmin || Boolean((user as any)?.can_publish)}
                />
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={savingVisibility || (visibilityDraft === (project?.visibility || 'private') && teamSharesDraft.length === 0)}
                    onClick={async () => {
                      setSavingVisibility(true);
                      try {
                        const token = localStorage.getItem('admin_auth_token');
                        const res = await fetch(`${getApiBaseUrl()}/case-writer/projects/${projectId}/visibility`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                          body: JSON.stringify({ visibility: visibilityDraft, team_ids: teamSharesDraft })
                        });
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          setErr(j?.error?.message || 'Failed to set visibility');
                        } else {
                          await reload();
                        }
                      } finally {
                        setSavingVisibility(false);
                      }
                    }}
                    className="px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingVisibility ? 'Saving…' : 'Save visibility'}
                  </button>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  disabled={!overviewDirty}
                  onClick={async () => {
                    const r = await patchProject({
                      title: titleDraft || null,
                      teaching_principle: principleDraft || null,
                      audience: audienceDraft || null,
                      course_context: courseContextDraft || null,
                      difficulty: difficultyDraft || null,
                      case_type: caseTypeDraft || null,
                      default_model_id: defaultModelDraft || null
                    } as any);
                    if (!r.ok) setErr(r.message || 'Save failed');
                  }}
                  className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 ${
                    overviewDirty ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {overviewDirty ? 'Save' : 'Saved'}
                </button>
              </div>
            </div>
          )}

          {activePane === 'source' && (
            <div className="space-y-3 max-w-3xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Source Material</h2>
                <p className="text-sm text-gray-600 mt-1">{STEP_DESCRIPTIONS.source}</p>
              </div>
              <SourceMaterial
                projectId={projectId}
                onError={setErr}
                models={models}
                projectDefaultModelId={project.default_model_id}
                isAdmin={isAdmin}
              />
            </div>
          )}

          {activePane === 'brief' && (
            <MarkdownStepEditor
              label="1. Learning Brief"
              description={STEP_DESCRIPTIONS.brief}
              loadedValue={coerceMarkdown(project.learning_brief)}
              currentValue={briefDraft}
              onChange={setBriefDraft}
              onSave={() => patchProject({ learning_brief: briefDraft } as any)}
              onGenerate={generateBrief}
              generating={!!busy.brief}
              generateDisabledReason={project.teaching_principle ? null : 'Set teaching principle in Overview'}
              models={models}
              projectDefaultModelId={project.default_model_id}
              promptUse="case_writer.teaching_brief"
              isAdmin={isAdmin}
              tweakStep="brief"
              projectId={projectId}
            />
          )}

          {activePane === 'scenarios' && (
            <div>
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-gray-900">2. Scenarios</h2>
                <p className="text-sm text-gray-600 mt-1">{STEP_DESCRIPTIONS.scenarios}</p>
              </div>
              <ScenariosList
                scenarios={scenariosDraft}
                selectedScenario={project.selected_scenario}
                onScenariosChange={setScenariosDraft}
                onSaveScenarios={async () => {
                  const r = await patchProject({ scenario_options: scenariosDraft } as any);
                  if (!r.ok) setErr(r.message || 'Save failed');
                  return r;
                }}
                onSelectScenario={async (card) => {
                  const r = await patchProject({ selected_scenario: card } as any);
                  if (!r.ok) setErr(r.message || 'Select failed');
                  return r;
                }}
                onGenerate={generateScenarios}
                generating={!!busy.scenarios}
                generateDisabledReason={project.learning_brief ? null : 'Generate the learning brief first'}
                models={models}
                projectDefaultModelId={project.default_model_id}
                dirty={scenariosDirty}
                isAdmin={isAdmin}
              />
            </div>
          )}

          {activePane === 'blueprint' && (
            <MarkdownStepEditor
              label="3. Blueprint"
              description={STEP_DESCRIPTIONS.blueprint}
              loadedValue={coerceMarkdown(project.case_blueprint)}
              currentValue={blueprintDraft}
              onChange={setBlueprintDraft}
              onSave={() => patchProject({ case_blueprint: blueprintDraft } as any)}
              onGenerate={generateBlueprint}
              generating={!!busy.blueprint}
              generateDisabledReason={project.selected_scenario ? null : 'Select a scenario first'}
              models={models}
              projectDefaultModelId={project.default_model_id}
              promptUse="case_writer.case_blueprint"
              isAdmin={isAdmin}
              tweakStep="blueprint"
              projectId={projectId}
            />
          )}

          {activePane === 'student' && (
            <MarkdownStepEditor
              label="4. Student Case"
              description={STEP_DESCRIPTIONS.student}
              loadedValue={coerceMarkdown(project.student_case)}
              currentValue={studentDraft}
              onChange={setStudentDraft}
              onSave={() => patchProject({ student_case: studentDraft } as any)}
              onGenerate={generateStudent}
              generating={!!busy.student}
              generateDisabledReason={project.case_blueprint ? null : 'Generate the blueprint first'}
              models={models}
              projectDefaultModelId={project.default_model_id}
              generateOptions={[{
                key: 'length',
                label: 'Size',
                defaultValue: 'regular',
                options: [
                  { value: 'story_problem', label: 'Story-problem' },
                  { value: 'mini',          label: 'Mini-Case' },
                  { value: 'abridged',      label: 'Abridged Case' },
                  { value: 'regular',       label: 'Regular Case' },
                  { value: 'expanded',      label: 'Expanded Case' }
                ]
              }]}
              promptUse="case_writer.student_case_draft"
              isAdmin={isAdmin}
              tweakStep="student_case"
              projectId={projectId}
              topAccessory={
                <CaseVersionsPanel
                  projectId={projectId}
                  versions={versions}
                  workingDraft={studentDraft}
                  currentSize={lastStudentSize}
                  onReload={reloadVersions}
                  onLoadedFromVersion={(text) => { setStudentDraft(text); reload(); }}
                />
              }
            />
          )}

          {activePane === 'teaching' && (
            <MarkdownStepEditor
              label="5. Teaching Note"
              description={STEP_DESCRIPTIONS.teaching}
              loadedValue={coerceMarkdown(project.teaching_note)}
              currentValue={teachingDraft}
              onChange={setTeachingDraft}
              onSave={() => patchProject({ teaching_note: teachingDraft } as any)}
              onGenerate={generateTeaching}
              generating={!!busy.teaching}
              generateDisabledReason={project.student_case ? null : 'Generate the student case first'}
              models={models}
              projectDefaultModelId={project.default_model_id}
              generateOptions={[{
                key: 'format',
                label: 'Format',
                defaultValue: 'standard',
                options: [
                  { value: 'brief',    label: 'Brief (1–2 pages)' },
                  { value: 'standard', label: 'Standard (4–6 pages)' },
                  { value: 'detailed', label: 'Detailed (8+ pages)' }
                ]
              }]}
              promptUse="case_writer.teaching_note"
              isAdmin={isAdmin}
              tweakStep="teaching_note"
              projectId={projectId}
            />
          )}

          {activePane === 'publish' && (
            <div className="space-y-4 max-w-3xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Publish</h2>
                <p className="text-sm text-gray-600 mt-1">{STEP_DESCRIPTIONS.publish}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={autoFillPublish}
                  disabled={extractingPublish || !project.student_case || !project.teaching_note}
                  className={`px-3 py-1.5 text-sm font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                    extractingPublish
                      ? 'bg-green-500 text-white animate-pulse cursor-wait'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {extractingPublish
                    ? `Extracting… ${extractTimerText}`
                    : 'Auto-fill from case & teaching note'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowExtractModelPicker(s => !s)}
                  title="Choose a different model for this extraction"
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                >
                  ⚙ {extractModelOverride
                    ? extractModelOverride
                    : (project.default_model_id ? `default: ${project.default_model_id}` : 'model')}
                </button>
                {showExtractModelPicker && models.length > 0 && (
                  <select
                    value={extractModelOverride}
                    onChange={(e) => setExtractModelOverride(e.target.value)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded"
                  >
                    <option value="">(use project default)</option>
                    {models.map(m => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.display_name || m.model_id}
                      </option>
                    ))}
                  </select>
                )}
                <PromptInfoButton use="case_writer.publish_field_extraction" isAdmin={isAdmin} />
                <button
                  onClick={runValidate}
                  disabled={validating || !project.student_case}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {validating ? 'Validating…' : 'Run boundary validation'}
                </button>
              </div>

              {validation && (
                <div className={`text-sm p-3 rounded border ${validation.passes ? 'bg-green-50 border-green-200 text-green-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                  <div className="font-semibold">
                    {validation.passes ? 'Validation passed' : `${validation.violations.length} violation(s) found`}
                  </div>
                  {validation.summary && <div className="mt-1">{validation.summary}</div>}
                  {!validation.passes && (
                    <ul className="mt-2 list-disc list-inside space-y-1">
                      {validation.violations.map((v, i) => (
                        <li key={i}><span className="font-mono text-xs">[{v.severity}/{v.category}]</span> {v.explanation}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <Field label="Protagonist (name and role)">
                  <input type="text" value={pubProtagonist} onChange={e => setPubProtagonist(e.target.value)} className="cw-input" placeholder="e.g. Maya Chen, CEO of Northwind Robotics" />
                </Field>
                <Field label="Opening chat question to student">
                  <textarea value={pubQuestion} onChange={e => setPubQuestion(e.target.value)} className="cw-input min-h-[60px]" />
                </Field>
                <Field label="Arguments for">
                  <textarea value={pubFor} onChange={e => setPubFor(e.target.value)} className="cw-input min-h-[100px]" />
                </Field>
                <Field label="Arguments against">
                  <textarea value={pubAgainst} onChange={e => setPubAgainst(e.target.value)} className="cw-input min-h-[100px]" />
                </Field>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const r = await patchProject({
                      publish_protagonist: pubProtagonist,
                      publish_chat_question: pubQuestion,
                      publish_arguments_for: pubFor,
                      publish_arguments_against: pubAgainst
                    } as any);
                    if (!r.ok) setErr(r.message || 'Save failed');
                  }}
                  disabled={!publishDirty}
                  className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 ${
                    publishDirty ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {publishDirty ? 'Save' : 'Saved'}
                </button>
                <button
                  onClick={doPublish}
                  disabled={publishing || !!project.published_case_id || !pubProtagonist.trim() || !pubQuestion.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50"
                >
                  {publishing ? 'Publishing…' : (project.published_case_id ? 'Published ✓' : 'Publish')}
                </button>
              </div>
            </div>
          )}

          {activePane === 'export' && (
            <div className="space-y-3 max-w-3xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Export</h2>
                <p className="text-sm text-gray-600 mt-1">{STEP_DESCRIPTIONS.export}</p>
              </div>
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Document</th>
                    <th className="px-3 py-2 font-semibold">Markdown</th>
                    <th className="px-3 py-2 font-semibold">Word</th>
                    <th className="px-3 py-2 font-semibold">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { key: 'case', label: 'Student case' },
                    { key: 'teaching_note', label: 'Teaching note' },
                    { key: 'combined', label: 'Combined' }
                  ] as const).map(row => (
                    <tr key={row.key} className="border-t border-gray-100">
                      <td className="px-3 py-2">{row.label}</td>
                      {(['md', 'docx', 'pdf'] as const).map(fmt => (
                        <td key={fmt} className="px-3 py-2 text-center">
                          <button
                            onClick={() => doExport(fmt, row.key)}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            Download
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .cw-input {
          width: 100%;
          padding: 0.4rem 0.6rem;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          background: white;
        }
        .cw-input:focus { outline: 2px solid #3b82f6; outline-offset: 0; border-color: transparent; }
      `}</style>
    </div>
  );
};

interface FieldProps {
  label: string;
  children: React.ReactNode;
}
const Field: React.FC<FieldProps> = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
    {children}
  </label>
);

export default CaseWriterProject;
