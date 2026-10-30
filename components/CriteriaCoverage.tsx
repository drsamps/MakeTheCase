import React from 'react';
import { EvaluationCriterion } from '../types';
import { StudentActivityView, copyFor } from '../services/activityCopy';

/**
 * Criteria coverage strip — the retrospective version of Quizzer EXPLAIN's live progress
 * meter. EXPLAIN scores every turn and ratchets so a pip can never go dark mid-chat;
 * MakeTheCase scores once at the end, so we report the same information after the fact:
 * which rubric criteria the student actually conveyed.
 *
 * `status` and `evidence` are optional fields the grader fills in for activity types with
 * `traits.grading_extras.evidence` (utils/activityEngine/grading.js). Other evaluations never
 * set them, so this renders nothing at all for them — no branch needed at the call site. The
 * words are the activity's copy (coverage_heading, coverage_count, status_*).
 */

const STATUS_STYLES: Record<string, { pip: string; key: 'status_met' | 'status_partial' | 'status_not_met'; text: string }> = {
  met: { pip: 'bg-green-500', key: 'status_met', text: 'text-green-700' },
  partial: { pip: 'bg-yellow-400', key: 'status_partial', text: 'text-yellow-700' },
  not_met: { pip: 'bg-gray-300', key: 'status_not_met', text: 'text-gray-500' },
};

interface CriteriaCoverageProps {
  criteria: EvaluationCriterion[];
  activity?: StudentActivityView | null;
}

const CriteriaCoverage: React.FC<CriteriaCoverageProps> = ({ criteria, activity }) => {
  const scored = (criteria || []).filter((c) => c.status && STATUS_STYLES[c.status]);
  if (scored.length === 0) return null;

  const metCount = scored.filter((c) => c.status === 'met').length;

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-800">{copyFor(activity, 'coverage_heading')}</h3>
        <span className="text-sm text-gray-500">
          {copyFor(activity, 'coverage_count', { met: metCount, total: scored.length })}
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
                  <span className={`text-xs font-medium ${style.text}`}>{copyFor(activity, style.key)}</span>
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
