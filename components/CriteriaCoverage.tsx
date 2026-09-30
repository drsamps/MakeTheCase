import React from 'react';
import { EvaluationCriterion } from '../types';

/**
 * Criteria coverage strip — the retrospective version of Quizzer EXPLAIN's live progress
 * meter. EXPLAIN scores every turn and ratchets so a pip can never go dark mid-chat;
 * MakeTheCase scores once at the end, so we report the same information after the fact:
 * which rubric criteria the student actually conveyed.
 *
 * `status` and `evidence` are optional fields the Teach-Back judge fills in
 * (`server/services/teachBackCoachPrompt.js`). Case-chat evaluations never set them, so
 * this renders nothing at all for them — no branch needed at the call site.
 */

const STATUS_STYLES: Record<string, { pip: string; label: string; text: string }> = {
  met: { pip: 'bg-green-500', label: 'Conveyed', text: 'text-green-700' },
  partial: { pip: 'bg-yellow-400', label: 'Partly conveyed', text: 'text-yellow-700' },
  not_met: { pip: 'bg-gray-300', label: 'Not conveyed', text: 'text-gray-500' },
};

interface CriteriaCoverageProps {
  criteria: EvaluationCriterion[];
}

const CriteriaCoverage: React.FC<CriteriaCoverageProps> = ({ criteria }) => {
  const scored = (criteria || []).filter((c) => c.status && STATUS_STYLES[c.status]);
  if (scored.length === 0) return null;

  const metCount = scored.filter((c) => c.status === 'met').length;

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-800">What You Got Across</h3>
        <span className="text-sm text-gray-500">
          {metCount} of {scored.length} fully conveyed
        </span>
      </div>
      <ul className="space-y-2">
        {scored.map((criterion, index) => {
          const style = STATUS_STYLES[criterion.status as string];
          return (
            <li key={index} className="flex items-start gap-3">
              <span
                className={`mt-1.5 w-3 h-3 rounded-full flex-shrink-0 ${style.pip}`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-gray-800">{criterion.question}</span>
                  <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
                </div>
                {criterion.evidence && (
                  <p className="text-xs text-gray-500 italic mt-0.5 break-words">
                    &ldquo;{criterion.evidence}&rdquo;
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CriteriaCoverage;
