/**
 * Prompt Builder Service
 * Backend version of buildCoachPrompt from constants.ts
 * Used for re-evaluation functionality
 */

// Default criteria prompt for backward compatibility (when no rubric is provided)
const DEFAULT_CRITERIA_PROMPT = `**Evaluation Criteria:**

*   **Q1. Did the student appear to have studied the reading material?**
    *   1 point = student answers were inconsistent with reading material.
    *   2 points = student answers were loosely related to reading material
    *   3 points = student answers were somewhat consistent with reading material.
    *   4 points = student answers were quite consistent with reading material.
    *   5 points = student answers were very consistent with reading material.
*   **Q2. Did the student provide solid answers to chatbot questions?**
    *   1 = weak answers that are missing common sense.
    *   2 = fair answers that were just okay.
    *   3 = good answers, but lacking in some areas and could be better.
    *   4 = great answers, but not perfect.
    *   5 = excellent answers, well articulated and sufficiently complete.
*   **Q3. Did the student justify the answer using relevant reading information?**
    *   1 = answer not justified using the reading material.
    *   2 = answer mildly justified by the reading material.
    *   3 = okay justification that superficially references the reading material.
    *   4 = good justification based on the reading material.
    *   5 = solid justification that draws on relevant points from the reading material.`;

/**
 * Build coach/evaluation prompt with CACHE-OPTIMIZED structure.
 * Static content (case, rubric) comes FIRST for LLM prompt caching.
 *
 * @param {string} chatHistory - The conversation transcript
 * @param {string} studentName - Name of the student being evaluated
 * @param {Object} caseData - Case document data with case_content, protagonist, case_title
 * @param {number} freeHints - Number of free hints before penalty (default 1)
 * @param {Object|null} rubric - Optional rubric with criteria_prompt, additional_prompt, total_points
 * @returns {string} - The complete evaluation prompt
 */
export function buildCoachPrompt(chatHistory, studentName, caseData = {}, freeHints = 1, rubric = null) {
  // Use rubric's cached prompt or fall back to default
  const criteriaPrompt = rubric?.criteria_prompt || DEFAULT_CRITERIA_PROMPT;
  const totalPoints = rubric?.total_points ?? 15;
  const numCriteria = rubric ? (criteriaPrompt.match(/\*\*Q\d+\./g) || []).length || 3 : 3;

  // Additional instructor-specified instructions
  const additionalInstructions = rubric?.additional_prompt
    ? `\n**Additional Evaluation Instructions:**\n${rubric.additional_prompt}\n`
    : '';

  // Default values for case data
  const protagonist = caseData.protagonist || 'the case protagonist';
  const caseTitle = caseData.case_title || 'the business case';
  const caseContent = caseData.case_content || '';

  // STATIC CONTENT FIRST (for caching)
  const staticContent = `
=== BUSINESS CASE DOCUMENT ===
<context type="case" file="case.md">
${caseContent}
</context>
=== END BUSINESS CASE ===

=== EVALUATION RUBRIC ===

You are a professional business school Coach. Your task is to provide a performance review for a student based on a simulated conversation they had with ${protagonist}, the protagonist of the "${caseTitle}" case.

Your evaluation MUST be based ONLY on the information within the transcript and the business case.

${criteriaPrompt}
${additionalInstructions}
**Your Task:**
1.  Read the Business Case and the Conversation Transcript.
2.  For each of the ${numCriteria} criteria, provide a score and brief, constructive feedback explaining your reasoning.
  * Be generous in scores, giving a higher score if it can be justified. But do not give a score that is undeserved.
  * Be kind in your feedback, providing compliments when justified, and presenting criticisms with dignity.
3.  Calculate the total score (maximum ${totalPoints} points before hint penalties).
4.  Tally how many times the student asked for a hint. A "hint" is counted ONLY when a message from the student (e.g., "Student: ...") explicitly contains the word "hint". Do NOT count hints based on other words like "help" or "clue". Ignore any use of the word "help" or "helpful" from the protagonist. Every student gets ${freeHints} free hint${freeHints !== 1 ? 's' : ''}, and forfeits a point for every additional hint beyond that. Your calculated total score should reflect this penalty.
5.  Write a concise overall summary of the student's performance.
6.  You MUST respond in a valid JSON format. Do not include any text, markdown, or code fences before or after the JSON object.
7.  Your JSON response must include a 'hints' field with the total number of hints the student requested.
8.  Your JSON response MUST use this EXACT schema (use these exact field names and types):
\`\`\`
{
  "criteria": [
    { "question": "<criterion text>", "score": <integer>, "max_score": <integer>, "feedback": "<feedback text>" }
  ],
  "totalScore": <integer, sum of criteria scores after hint penalties>,
  "summary": "<overall performance summary>",
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
