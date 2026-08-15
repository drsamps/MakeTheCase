import React, { useState } from 'react';
import {
  CaseWriterReference,
  SelectionStep,
  SELECTION_STEP_LABEL
} from '../../services/caseWriter/api';
import ReferenceContentViewer from './ReferenceContentViewer';

interface Props {
  projectId: string;
  step: SelectionStep;
  /** Approved references only — the ones that actually reach the prompt. */
  references: CaseWriterReference[];
  charCap: number;
  onChanged: () => void;
  onError: (message: string) => void;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * One line under a step's Generate row saying which source material that step
 * will use, plus a way to give the step its own selection.
 *
 * This exists so a per-step override is visible where it takes effect. An
 * override that only shows up inside a modal in another pane is very hard to
 * debug when a step's output is unexpectedly narrow.
 */
const StepSourceScope: React.FC<Props> = ({
  projectId, step, references, charCap, onChanged, onError
}) => {
  const [editingRefId, setEditingRefId] = useState<string | null>(null);

  const approved = references.filter(r => !!r.approved_by_user);
  if (approved.length === 0) return null;

  const overridden = approved.filter(r => (r.override_steps || []).includes(step));

  return (
    <div className="text-xs text-gray-600 border border-gray-200 bg-gray-50 rounded px-3 py-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="font-medium text-gray-700">Source material for {SELECTION_STEP_LABEL[step]}:</span>{' '}
          {approved.length} approved reference{approved.length === 1 ? '' : 's'}
          {overridden.length > 0 && (
            <span className="ml-1 text-blue-700 font-medium">
              · {overridden.length} customized for this step
            </span>
          )}
        </div>
      </div>

      <ul className="mt-1 space-y-0.5">
        {approved.map(r => {
          const isOverridden = (r.override_steps || []).includes(step);
          const hasDefaultSelection = (r.selected_section_count || 0) > 0 || (r.excerpt_count || 0) > 0;
          const scope = isOverridden
            ? 'custom selection for this step'
            : hasDefaultSelection
              ? `${r.selected_section_count} of ${r.section_count} sections · ${fmt(r.selected_chars || 0)} chars`
              : `whole document · ${fmt(r.content_length || 0)} chars`;

          return (
            <li key={r.reference_id} className="flex items-center gap-2">
              <span className={isOverridden ? 'text-blue-700' : 'text-gray-500'}>
                {isOverridden ? '◈' : '·'}
              </span>
              <span className="truncate max-w-[280px] text-gray-700" title={r.title || ''}>
                {r.title || '(untitled)'}
              </span>
              <span className="text-gray-400">— {scope}</span>
              {r.type !== 'link' && !!r.content_length && (
                <button
                  onClick={() => setEditingRefId(r.reference_id)}
                  className="text-blue-600 hover:underline"
                >
                  {isOverridden ? 'Edit' : 'Customize'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {editingRefId && (
        <ReferenceContentViewer
          projectId={projectId}
          referenceId={editingRefId}
          charCap={charCap}
          step={step}
          onClose={() => setEditingRefId(null)}
          onSaved={onChanged}
          onError={onError}
        />
      )}
    </div>
  );
};

export default StepSourceScope;
