import React, { useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { useGenerationTimer } from './useGenerationTimer';
import { useSaveState, saveButtonLabel, SaveStateApi } from './useSaveState';

interface ModelOption {
  model_id: string;
  display_name?: string;
  vendor?: string;
}

interface Props {
  label: string;
  description?: string;
  loadedValue: string;
  currentValue: string;
  onChange: (value: string) => void;
  onSave: () => Promise<{ ok: boolean; message?: string }>;
  // Generate is optional — pane can omit it (e.g. the Source Material pane).
  onGenerate?: (overrideModelId?: string) => Promise<void>;
  generating?: boolean;
  generateDisabledReason?: string | null;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
  saveStateOverride?: SaveStateApi;
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
  saveStateOverride
}) => {
  const localSaveState = useSaveState(loadedValue, currentValue);
  const saveState = saveStateOverride ?? localSaveState;
  const [showPreview, setShowPreview] = useState(true);
  const [overrideModelId, setOverrideModelId] = useState<string>('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const timerText = useGenerationTimer(generating);

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
              onClick={() => onGenerate(overrideModelId || undefined)}
              title={generateDisabledReason || ''}
              className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${generateClasses}`}
            >
              {generateLabel}
            </button>
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
      </div>

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
    </div>
  );
};

export default MarkdownStepEditor;
