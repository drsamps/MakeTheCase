import React, { useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { useGenerationTimer } from './useGenerationTimer';
import { useSaveState, saveButtonLabel, SaveStateApi } from './useSaveState';
import PromptInfoButton, { logKeyFor } from './PromptInfoButton';
import TweakDiffViewer from './TweakDiffViewer';
import { caseWriterApi } from '../../services/caseWriter/api';

interface ModelOption {
  model_id: string;
  display_name?: string;
  vendor?: string;
}

// One dropdown injected into the Generate row (e.g. case size on Student Case,
// format on Teaching Note). The value is reported back via `onGenerate(modelId, { [key]: value })`.
export interface GenerateOption {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

interface Props {
  label: string;
  description?: string;
  loadedValue: string;
  currentValue: string;
  onChange: (value: string) => void;
  onSave: () => Promise<{ ok: boolean; message?: string }>;
  // Generate is optional — pane can omit it (e.g. the Source Material pane).
  // Second arg carries the values from any `generateOptions` dropdowns.
  onGenerate?: (overrideModelId?: string, options?: Record<string, string>) => Promise<void>;
  generating?: boolean;
  generateDisabledReason?: string | null;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
  saveStateOverride?: SaveStateApi;
  generateOptions?: GenerateOption[];
  // Optional content that renders above the editor (e.g. CaseVersionsPanel on Step 4).
  topAccessory?: React.ReactNode;
  // Admin-only ⓘ icon shows the live prompt template for this step.
  promptUse?: string;
  isAdmin?: boolean;
  // When set, surfaces the "Tweak content" affordance that calls
  // POST /projects/:id/tweak. The diff viewer renders below the editor.
  tweakStep?: 'brief' | 'blueprint' | 'student_case' | 'teaching_note';
  projectId?: string;
}

const MarkdownStepEditor: React.FC<Props> = ({
  label,
  description,
  loadedValue,
  currentValue,
  onChange,
  onSave,
  onGenerate,
  generating = false,
  generateDisabledReason = null,
  models = [],
  projectDefaultModelId = null,
  saveStateOverride,
  generateOptions,
  topAccessory,
  promptUse,
  isAdmin = false,
  tweakStep,
  projectId
}) => {
  const localSaveState = useSaveState(loadedValue, currentValue);
  const saveState = saveStateOverride ?? localSaveState;
  const [showPreview, setShowPreview] = useState(true);
  const [overrideModelId, setOverrideModelId] = useState<string>('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [optionValues, setOptionValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (generateOptions || []).forEach(o => { init[o.key] = o.defaultValue; });
    return init;
  });
  const [hintOpen, setHintOpen] = useState(false);
  const [hintText, setHintText] = useState('');
  const timerText = useGenerationTimer(generating);

  async function runGenerate() {
    if (!onGenerate) return;
    const opts: Record<string, string> = { ...optionValues };
    const trimmedHint = hintText.trim();
    if (trimmedHint) opts.revision_hint = trimmedHint;

    // One-shot "log this prompt with data" — set in PromptInfoButton modal.
    // Cleared after the Generate call returns (success or failure) so the
    // badge disappears and the next click won't log unless the admin re-checks.
    const logKey = promptUse ? logKeyFor(promptUse) : null;
    let logged = false;
    try {
      if (logKey && localStorage.getItem(logKey) === '1') {
        opts.log_this_prompt = '1';
        logged = true;
      }
    } catch { /* ignore */ }

    try {
      await onGenerate(overrideModelId || undefined, opts);
    } finally {
      if (logged && logKey) {
        try {
          localStorage.removeItem(logKey);
          // Notify the PromptInfoButton in this tab (storage event only fires
          // in *other* tabs); pass newValue=null to indicate removal.
          window.dispatchEvent(new StorageEvent('storage', { key: logKey, newValue: null }));
        } catch { /* ignore */ }
      }
    }
  }

  // ---- Tweak (free-form revise + diff preview) state ----
  const tweakEnabled = !!tweakStep && !!projectId;
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakInstruction, setTweakInstruction] = useState('');
  const [tweakModelOverride, setTweakModelOverride] = useState('');
  const [tweaking, setTweaking] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);
  // When set, the diff viewer is shown below the editor.
  const [tweakResult, setTweakResult] = useState<{ original: string; tweaked: string } | null>(null);
  const tweakTimerText = useGenerationTimer(tweaking);

  async function runTweak() {
    if (!tweakStep || !projectId) return;
    if (!tweakInstruction.trim() || !currentValue.trim()) return;
    setTweaking(true);
    setTweakError(null);
    const { data, error } = await caseWriterApi.tweakContent(projectId, {
      step: tweakStep,
      current_value: currentValue,
      instruction: tweakInstruction.trim(),
      model_id: tweakModelOverride || undefined
    });
    setTweaking(false);
    if (error || !data) {
      setTweakError(error?.message || 'Tweak failed');
      return;
    }
    setTweakResult({ original: currentValue, tweaked: data.revised });
    setTweakOpen(false);
  }

  function acceptTweak(merged: string) {
    onChange(merged);
    setTweakResult(null);
    setTweakInstruction('');
  }

  function cancelTweak() {
    setTweakResult(null);
  }

  const generateLabel = generating ? `Generating… ${timerText}` : 'Generate';
  const generateClasses = generating
    ? 'bg-green-500 text-white animate-pulse cursor-wait'
    : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
          {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowPreview(p => !p)}
            className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onGenerate && (
          <>
            <button
              type="button"
              disabled={generating || !!generateDisabledReason}
              onClick={runGenerate}
              title={generateDisabledReason || ''}
              className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${generateClasses}`}
            >
              {generateLabel}
            </button>
            {(generateOptions || []).map(opt => (
              <label key={opt.key} className="text-xs text-gray-700 flex items-center gap-1">
                {opt.label}:
                <select
                  value={optionValues[opt.key] ?? opt.defaultValue}
                  onChange={(e) => setOptionValues(prev => ({ ...prev, [opt.key]: e.target.value }))}
                  className="text-xs px-2 py-1 border border-gray-300 rounded"
                >
                  {opt.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="button"
              onClick={() => setShowModelPicker(s => !s)}
              title="Choose a different model for this generation"
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
            >
              ⚙ {overrideModelId
                ? overrideModelId
                : (projectDefaultModelId ? `default: ${projectDefaultModelId}` : 'model')}
            </button>
            {showModelPicker && models.length > 0 && (
              <select
                value={overrideModelId}
                onChange={(e) => setOverrideModelId(e.target.value)}
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
            {promptUse && isAdmin && (
              <PromptInfoButton use={promptUse} isAdmin={isAdmin} />
            )}
            <button
              type="button"
              onClick={() => setHintOpen(o => !o)}
              title="click to provide a hint for AI generation"
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
            >
              💡 Hint{hintText.trim() ? ' •' : ''}
            </button>
          </>
        )}

        <button
          type="button"
          disabled={saveState.status === 'saving' || !saveState.dirty}
          onClick={() => saveState.run(onSave)}
          className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
            saveState.status === 'saved'
              ? 'bg-green-100 text-green-800 border border-green-300'
              : saveState.dirty
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-gray-200 text-gray-600'
          }`}
        >
          {saveButtonLabel(saveState.status)}
        </button>
        {saveState.errorMessage && (
          <span className="text-xs text-red-600">{saveState.errorMessage}</span>
        )}

        {tweakEnabled && !tweakResult && (
          <button
            type="button"
            onClick={() => setTweakOpen(o => !o)}
            disabled={!currentValue.trim()}
            title={currentValue.trim() ? 'Describe a change and apply it to this section' : 'Generate or paste content first'}
            className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            ✎ Tweak content {tweakOpen ? '▴' : '▾'}
          </button>
        )}
        {tweakEnabled && tweakOpen && isAdmin && (
          <PromptInfoButton use="case_writer.content_tweak" isAdmin={isAdmin} />
        )}
      </div>

      {onGenerate && hintOpen && (
        <div className="border border-amber-200 bg-amber-50 rounded-md p-3 space-y-2">
          <div className="text-sm font-semibold text-amber-900">
            Provide the AI model with hints for Generating this output
          </div>
          <textarea
            value={hintText}
            onChange={(e) => setHintText(e.target.value)}
            placeholder="Use or nonuse of technical language, gender of protagonist, etc. Note that hints can also be added to the Learning Brief or Case Blueprint."
            className="w-full min-h-[80px] p-2 text-sm border border-amber-300 rounded bg-white resize-y"
          />
        </div>
      )}

      {tweakEnabled && tweakOpen && !tweakResult && (
        <div className="border border-purple-200 bg-purple-50 rounded-md p-3 space-y-2">
          <p className="text-xs text-purple-900">
            Describe a change for this section (e.g. "make the protagonist female", "shorten the opening", "add a paragraph on regulatory pressure"). The AI will rewrite the current content and show a side-by-side diff before anything is saved.
          </p>
          <textarea
            value={tweakInstruction}
            onChange={e => setTweakInstruction(e.target.value)}
            placeholder="Describe the changes you want…"
            className="w-full min-h-[80px] p-2 text-sm border border-gray-300 rounded bg-white"
            disabled={tweaking}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runTweak}
              disabled={tweaking || !tweakInstruction.trim() || !currentValue.trim()}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md disabled:opacity-50 ${
                tweaking ? 'bg-green-500 text-white animate-pulse cursor-wait' : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              {tweaking ? `Tweaking… ${tweakTimerText}` : 'Tweak'}
            </button>
            {models.length > 0 && (
              <select
                value={tweakModelOverride}
                onChange={e => setTweakModelOverride(e.target.value)}
                disabled={tweaking}
                className="text-xs px-2 py-1 border border-gray-300 rounded"
                title="Choose a different model for this tweak"
              >
                <option value="">(use project default)</option>
                {models.map(m => (
                  <option key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => { setTweakOpen(false); setTweakInstruction(''); setTweakError(null); }}
              disabled={tweaking}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>
            {tweakError && <span className="text-xs text-red-700">{tweakError}</span>}
          </div>
        </div>
      )}

      {topAccessory && <div>{topAccessory}</div>}

      {tweakResult ? (
        <TweakDiffViewer
          original={tweakResult.original}
          tweaked={tweakResult.tweaked}
          onApply={acceptTweak}
          onCancel={cancelTweak}
        />
      ) : (
        <div className={`grid gap-3 ${showPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <textarea
            value={currentValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-h-[420px] p-3 font-mono text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={onGenerate ? 'Click Generate to draft this section…' : ''}
            spellCheck={false}
          />
          {showPreview && (
            <MarkdownPreview
              markdown={currentValue}
              className="min-h-[420px] p-3 border border-gray-200 rounded-md bg-white overflow-y-auto"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default MarkdownStepEditor;
