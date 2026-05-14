import React, { useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import { ScenarioCard } from '../../services/caseWriter/api';
import { useGenerationTimer } from './useGenerationTimer';

interface ModelOption {
  model_id: string;
  display_name?: string;
}

interface Props {
  scenarios: ScenarioCard[];
  selectedScenario: ScenarioCard | null;
  onScenariosChange: (next: ScenarioCard[]) => void;
  onSelectScenario: (card: ScenarioCard) => Promise<{ ok: boolean; message?: string }>;
  onSaveScenarios: () => Promise<{ ok: boolean; message?: string }>;
  onGenerate: (overrideModelId?: string, count?: number) => Promise<void>;
  generating: boolean;
  generateDisabledReason: string | null;
  models?: ModelOption[];
  projectDefaultModelId?: string | null;
  dirty: boolean;
}

const ScenariosList: React.FC<Props> = ({
  scenarios,
  selectedScenario,
  onScenariosChange,
  onSelectScenario,
  onSaveScenarios,
  onGenerate,
  generating,
  generateDisabledReason,
  models = [],
  projectDefaultModelId = null,
  dirty
}) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [overrideModelId, setOverrideModelId] = useState<string>('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [count, setCount] = useState<number>(4);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const timerText = useGenerationTimer(generating);

  const generateLabel = generating ? `Generating… ${timerText}` : 'Generate scenarios';
  const generateClasses = generating
    ? 'bg-green-500 text-white animate-pulse cursor-wait'
    : 'bg-blue-600 hover:bg-blue-700 text-white';

  function patchCard(idx: number, patch: Partial<ScenarioCard>) {
    const next = scenarios.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onScenariosChange(next);
  }

  function deleteCard(idx: number) {
    if (!confirm('Delete this scenario card?')) return;
    onScenariosChange(scenarios.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={generating || !!generateDisabledReason}
          onClick={() => onGenerate(overrideModelId || undefined, count)}
          title={generateDisabledReason || ''}
          className={`px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${generateClasses}`}
        >
          {generateLabel}
        </button>
        <label className="text-sm text-gray-700">
          Count:
          <input
            type="number"
            min={3}
            max={5}
            value={count}
            onChange={(e) => setCount(Math.max(3, Math.min(5, Number(e.target.value) || 4)))}
            className="ml-1 w-14 px-1 py-0.5 border border-gray-300 rounded text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowModelPicker(s => !s)}
          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
        >
          ⚙ {overrideModelId || (projectDefaultModelId ? `default: ${projectDefaultModelId}` : 'model')}
        </button>
        {showModelPicker && (
          <select
            value={overrideModelId}
            onChange={(e) => setOverrideModelId(e.target.value)}
            className="text-xs px-2 py-1 border border-gray-300 rounded"
          >
            <option value="">(use project default)</option>
            {models.map(m => (
              <option key={m.model_id} value={m.model_id}>{m.display_name || m.model_id}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={!dirty}
          onClick={onSaveScenarios}
          className={`px-3 py-1.5 text-sm font-semibold rounded-md disabled:opacity-50 ${
            dirty ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'
          }`}
        >
          {dirty ? 'Save edits' : 'Saved'}
        </button>
      </div>

      {selectedScenario && (
        <div className="border-2 border-green-300 bg-green-50 rounded-md p-3">
          <div className="text-xs font-semibold text-green-700 uppercase mb-1">Selected scenario</div>
          <div className="text-base font-semibold text-gray-900">{selectedScenario.title}</div>
          <div className="text-xs text-gray-600">{selectedScenario.industry}</div>
          <MarkdownPreview markdown={selectedScenario.markdown || ''} className="mt-2" />
        </div>
      )}

      {scenarios.length === 0 && !generating && (
        <div className="text-sm text-gray-500 italic">
          No scenarios generated yet. Click Generate scenarios above.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {scenarios.map((card, idx) => {
          const isEditing = editingIdx === idx;
          const isSelected =
            selectedScenario
            && selectedScenario.title === card.title
            && selectedScenario.industry === card.industry;
          const isExpanded = expandedIdx === idx;
          return (
            <div
              key={idx}
              className={`border rounded-md ${isSelected ? 'border-green-400' : 'border-gray-200 bg-white'}`}
            >
              <div
                className="flex items-start justify-between gap-2 p-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                    {isEditing
                      ? (
                        <input
                          value={card.title}
                          onChange={(e) => patchCard(idx, { title: e.target.value })}
                          onClick={e => e.stopPropagation()}
                          className="text-base font-semibold flex-1 px-2 py-1 border border-gray-300 rounded"
                        />
                      )
                      : <div className="text-base font-semibold text-gray-900">{card.title}</div>
                    }
                  </div>
                  {isEditing
                    ? (
                      <input
                        value={card.industry}
                        onChange={(e) => patchCard(idx, { industry: e.target.value })}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-gray-600 mt-1 ml-5 w-full px-2 py-1 border border-gray-300 rounded"
                      />
                    )
                    : <div className="text-xs text-gray-600 ml-5">{card.industry}</div>
                  }
                </div>
                <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIdx(isEditing ? null : idx);
                      if (!isExpanded) setExpandedIdx(idx);
                    }}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    {isEditing ? 'Done' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    disabled={savingIdx === idx}
                    onClick={async () => {
                      setSavingIdx(idx);
                      try { await onSelectScenario(card); } finally { setSavingIdx(null); }
                    }}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                  >
                    {isSelected ? 'Selected ✓' : (savingIdx === idx ? 'Selecting…' : 'Select')}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCard(idx)}
                    className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-gray-100 p-3">
                  {isEditing
                    ? (
                      <textarea
                        value={card.markdown || ''}
                        onChange={(e) => patchCard(idx, { markdown: e.target.value })}
                        className="w-full min-h-[200px] p-2 font-mono text-sm border border-gray-300 rounded"
                      />
                    )
                    : <MarkdownPreview markdown={card.markdown || ''} />
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScenariosList;
