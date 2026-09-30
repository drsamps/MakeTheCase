/**
 * Teach-Back evaluation prompt.
 *
 * Same signature, same cache-optimized layout and same output contract as
 * `promptBuilder.js#buildCoachPrompt`, so `/run`, `/re-evaluate`, `/preview-prompt` and
 * the whole validation cascade (`buildCorrectionPrompt`, `trimEvaluationResult`) work
 * unchanged. Only the framing differs.
 *
 * (!) THE "ONLY THE STUDENT'S OWN WORDS" RULE IS LOAD-BEARING, not hygiene. Teach-Back
 * audiences reflect the student's idea back to confirm they understood it, and the
 * `audience-muddled` persona paraphrases it deliberately WRONG so the student has to
 * correct it. If the judge credited the listener's turns, a warm audience would inflate
 * the score and a muddled one would be scored against the student. Ported in spirit from
 * `../quizzer/explain/prompts.py#build_scoring_system_prompt`, which states the same rule
 * for the same reason.
 *
 * The two optional per-criterion fields (`status`, `evidence`) drive the coverage strip in
 * `components/CriteriaCoverage.tsx`. They are optional and additive so the shared
 * evaluation validator keeps accepting both modes.
 */

// Fallback when no rubric resolves. Case chat's default rubric asks whether the student
// studied the reading and justified their answers from it; the Teach-Back equivalent asks
// whether they made someone else understand it.
const DEFAULT_CRITERIA_PROMPT = `**Evaluation Criteria:**

*   **Q1. Did the student explain the key ideas in plain, accurate language?**
    *   1 point = key ideas were absent or misstated.
    *   2 points = key ideas were mentioned but left undefined or partly wrong.
    *   3 points = key ideas were stated accurately but in jargon or too briefly to land.
    *   4 points = key ideas were explained clearly, with minor gaps.
    *   5 points = key ideas were explained accurately and in terms a newcomer could follow.
*   **Q2. Did the student explain WHY, not just WHAT?**
    *   1 = asserted conclusions with no reasoning.
    *   2 = gestured at reasons without connecting them.
    *   3 = gave reasoning for some claims but not the central one.
    *   4 = explained the mechanism behind the main idea.
    *   5 = explained the mechanism and how the pieces depend on each other.
*   **Q3. Did the student respond to what the listener actually did not understand?**
    *   1 = ignored the listener's questions or repeated the same wording.
    *   2 = answered loosely, without addressing the confusion.
    *   3 = answered the questions but did not check whether they landed.
    *   4 = addressed the confusion directly, and rephrased where needed.
    *   5 = addressed the confusion, corrected the listener's misunderstandings, and confirmed understanding.`;

/**
 * Build the Teach-Back evaluation prompt with CACHE-OPTIMIZED structure.
 * Static content (source document, rubric) comes FIRST for LLM prompt caching.
 *
 * @param {string} chatHistory - The conversation transcript
 * @param {string} studentName - Name of the student being evaluated
 * @param {Object} caseData - Source document data with case_content, protagonist, case_title
 * @param {number} freeHints - Number of free hints before penalty (default 1)
 * @param {Object|null} rubric - Optional rubric with criteria_prompt, additional_prompt, total_points
 * @returns {string} - The complete evaluation prompt
 */
export function buildTeachBackCoachPrompt(chatHistory, studentName, caseData = {}, freeHints = 1, rubric = null) {
  const criteriaPrompt = rubric?.criteria_prompt || DEFAULT_CRITERIA_PROMPT;
  const totalPoints = rubric?.total_points ?? 15;
  const numCriteria = rubric ? (criteriaPrompt.match(/Q\d+\./g) || []).length || 3 : 3;

  const additionalInstructions = rubric?.additional_prompt
    ? `\n**Additional Evaluation Instructions:**\n${rubric.additional_prompt}\n`
    : '';

  const listener = caseData.protagonist || 'the listener';
  const topicTitle = caseData.case_title || 'the assigned reading';
  const caseContent = caseData.case_content || '';

  // STATIC CONTENT FIRST (for caching)
  const staticContent = `
=== SOURCE DOCUMENT ===
<context type="case" file="case.md">
${caseContent}
</context>
=== END SOURCE DOCUMENT ===

=== EVALUATION RUBRIC ===

You are a professional teaching Coach. Your task is to provide a performance review for a student who was asked to EXPLAIN the "${topicTitle}" material to ${listener}, someone who did not understand it. The student was teaching; the listener was learning.

Your evaluation MUST be based ONLY on the information within the transcript and the source document.

**Judge ONLY the student's own words.** The listener's questions and paraphrases are prompts, not content: nothing the listener said counts in the student's favour, and a listener's misunderstanding is not the student's error unless the student left it uncorrected. Judge substance only — never length, grammar, or tone.

${criteriaPrompt}
${additionalInstructions}**Your Task:**
1.  Read the Source Document and the Conversation Transcript.
2.  For each of the ${numCriteria} criteria listed above, provide a score and brief, constructive feedback explaining your reasoning. You MUST return exactly ${numCriteria} criteria entries — no more, no fewer.
  * Also report a "status" for each criterion: "met" if the student conveyed it, "partial" if they partly conveyed it, "not_met" if they did not.
  * Where you can, include "evidence": a short quote taken VERBATIM from one of the student's own messages. Never quote the listener. If you have no student quote for a criterion, omit the field.
  * Be generous in scores, giving a higher score if it can be justified. But do not give a score that is undeserved.
  * Be kind in your feedback, providing compliments when justified, and presenting criticisms with dignity.
3.  Calculate the total score (maximum ${totalPoints} points before hint penalties).
4.  Tally how many times the student asked for a hint. A "hint" is counted ONLY when a message from the student (e.g., "Student: ...") explicitly contains the word "hint". Do NOT count hints based on other words like "help" or "clue". Ignore any use of the word "help" or "helpful" from the listener. Every student gets ${freeHints} free hint${freeHints !== 1 ? 's' : ''}, and forfeits a point for every additional hint beyond that. Your calculated total score should reflect this penalty.
5.  Write the overall summary as exactly two short sections, in the past tense, under these two headings:
  * **What you explained well**
  * **What would have made it clearer**
6.  You MUST respond in a valid JSON format. Do not include any text, markdown, or code fences before or after the JSON object.
7.  Your JSON response must include a 'hints' field with the total number of hints the student requested.
8.  Your JSON response MUST use this EXACT schema (use these exact field names and types):
\`\`\`
{
  "criteria": [
    { "question": "<criterion text>", "score": <integer>, "max_score": <integer>, "status": "met" | "partial" | "not_met", "evidence": "<verbatim student quote, or omit>", "feedback": "<feedback text>" }
  ],
  "totalScore": <integer, sum of criteria scores after hint penalties>,
  "summary": "<the two headed sections above>",
  "hints": <integer, number of hints requested>
}
\`\`\`
IMPORTANT: "score" and "totalScore" MUST be integers (not strings, not "4/5", not null). Each criterion in the "criteria" array MUST have numeric "score" and "max_score" fields.

=== END EVALUATION RUBRIC ===
`;

  // DYNAMIC CONTENT (per-request)
  const dynamicContent = `
**Student Being Evaluated:** ${studentName}

**Conversation Transcript:**
---
${chatHistory}
---
`;

  // Static content FIRST, then dynamic content
  return staticContent + dynamicContent;
}
