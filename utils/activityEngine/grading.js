/**
 * The grading (coach) prompt for any activity type definition.
 *
 * The task list, the hint tally and the JSON output contract are PLATFORM text, never template
 * text: evaluationNormalizer.js (parseEvaluationResponse, buildCorrectionPrompt) depends on them,
 * and an admin edit must not be able to break grading. A definition supplies the framing, its
 * default criteria, a few words, and the summary headings; `traits.grading_extras.evidence`
 * adds the per-criterion status and verbatim-evidence fields.
 *
 * Byte-for-byte what promptBuilder.js#buildCoachPrompt and teachBackCoachPrompt.js produced for
 * the built-ins (the goldens in check-activity-engine.js). Do not tidy the blank lines.
 */

import { renderOnce, withWrappers, templateText } from './render.js';
import { numCriteria, numberWord } from './resolvers.js';

function summaryInstruction(headings) {
  if (!headings?.length) return "5.  Write a concise overall summary of the student's performance.";
  const n = headings.length;
  const lead = n === 1
    ? '5.  Write the overall summary as exactly one short section, in the past tense, under this heading:'
    : `5.  Write the overall summary as exactly ${numberWord(n)} short sections, in the past tense, under these ${numberWord(n)} headings:`;
  return [lead, ...headings.map((h) => `  * **${h}**`)].join('\n');
}

/**
 * @param {object} def - a validated definition
 * @param {string} chatHistory - the transcript (stripTurnTiming already applied by the caller)
 * @param {string} studentName
 * @param {object} caseData - grading case data (prepareEvalInputs may have set the listener's
 *   name and `picked_position`)
 * @param {number} freeHints
 * @param {object|null} rubric - { criteria_prompt, additional_prompt, total_points }
 */
export function buildCoachPrompt(def, chatHistory, studentName, caseData = {}, freeHints = 1, rubric = null) {
  const g = def.grading;
  const evidence = Boolean(def.traits.grading_extras?.evidence);
  const criteriaPrompt = rubric?.criteria_prompt || templateText(g.default_criteria);
  const totalPoints = rubric?.total_points ?? 15;
  const count = numCriteria(rubric, criteriaPrompt);
  const doc = def.prompt.documents.case;

  const values = withWrappers(
    {
      ai_name: caseData.protagonist || g.fallbacks?.ai_name || '',
      case_title: caseData.case_title || g.fallbacks?.case_title || '',
      criteria: criteriaPrompt,
      additional_evaluation: rubric?.additional_prompt || '',
      position: caseData.picked_position || '',
      question: caseData.chat_question || '',
      goal: caseData.goal || '',
      student_position: caseData.position || '',
      opposing_position: caseData.opposing_position || '',
    },
    {
      additional_evaluation: '\n**Additional Evaluation Instructions:**\n{additional_evaluation}\n',
      position: g.picked_position_note || '',
    },
    {
      additional_evaluation: Boolean(rubric?.additional_prompt),
      position: Boolean(caseData.picked_position && g.picked_position_note),
    }
  );

  const evidenceBullets = evidence
    ? `\n  * Also report a "status" for each criterion: "met" if the student conveyed it, "partial" if they partly conveyed it, "not_met" if they did not.
  * Where you can, include "evidence": a short quote taken VERBATIM from one of the student's own messages. Never quote the ${g.ai_word}. If you have no student quote for a criterion, omit the field.`
    : '';
  const criterionSchema = evidence
    ? '{ "question": "<criterion text>", "score": <integer>, "max_score": <integer>, "status": "met" | "partial" | "not_met", "evidence": "<verbatim student quote, or omit>", "feedback": "<feedback text>" }'
    : '{ "question": "<criterion text>", "score": <integer>, "max_score": <integer>, "feedback": "<feedback text>" }';
  const headingCount = g.summary_headings?.length || 0;
  const summarySchema = headingCount === 0 ? '<overall performance summary>'
    : headingCount === 1 ? '<the headed section above>'
      : `<the ${numberWord(headingCount)} headed sections above>`;

  const staticContent = `
=== ${doc.heading} ===
<context type="case" file="case.md">
${caseData.case_content || ''}
</context>
=== ${doc.end} ===

=== EVALUATION RUBRIC ===

${renderOnce(g.framing, values)}

${renderOnce(g.criteria_block, values)}**Your Task:**
1.  ${g.read_line}
2.  For each of the ${count} criteria listed above, provide a score and brief, constructive feedback explaining your reasoning. You MUST return exactly ${count} criteria entries — no more, no fewer.${evidenceBullets}
  * Be generous in scores, giving a higher score if it can be justified. But do not give a score that is undeserved.
  * Be kind in your feedback, providing compliments when justified, and presenting criticisms with dignity.
3.  Calculate the total score (maximum ${totalPoints} points before hint penalties).
4.  Tally how many times the student asked for a hint. A "hint" is counted ONLY when a message from the student (e.g., "Student: ...") explicitly contains the word "hint". Do NOT count hints based on other words like "help" or "clue". Ignore any use of the word "help" or "helpful" from the ${g.ai_word}. Every student gets ${freeHints} free hint${freeHints !== 1 ? 's' : ''}, and forfeits a point for every additional hint beyond that. Your calculated total score should reflect this penalty.
${summaryInstruction(g.summary_headings)}
6.  You MUST respond in a valid JSON format. Do not include any text, markdown, or code fences before or after the JSON object.
7.  Your JSON response must include a 'hints' field with the total number of hints the student requested.
8.  Your JSON response MUST use this EXACT schema (use these exact field names and types):
\`\`\`
{
  "criteria": [
    ${criterionSchema}
  ],
  "totalScore": <integer, sum of criteria scores after hint penalties>,
  "summary": "${summarySchema}",
  "hints": <integer, number of hints requested>
}
\`\`\`
IMPORTANT: "score" and "totalScore" MUST be integers (not strings, not "4/5", not null). Each criterion in the "criteria" array MUST have numeric "score" and "max_score" fields.

=== END EVALUATION RUBRIC ===
`;

  const dynamicContent = `
**Student Being Evaluated:** ${studentName}
${values.position}
**Conversation Transcript:**
---
${chatHistory}
---
`;
  return staticContent + dynamicContent;
}
