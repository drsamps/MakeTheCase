-- Migration: 035_case_writer_boundary_validation_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable the case_writer.boundary_validation prompt.
--              This prompt audits the student-facing case draft to ensure it
--              does not contain instructor-only content (recommendations,
--              analysis, expected outcomes, etc.). Publish must gate on this.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are auditing a STUDENT-FACING business case draft to make sure it does NOT leak instructor-only content.

A correct student case contains ONLY:
  1. Business context (company, industry, market)
  2. Problem or opportunity (the dilemma)
  3. Stakeholders and their interests
  4. Data and evidence (facts, metrics, exhibits)
  5. Decision point (the question)

A correct student case MUST NOT contain ANY of:
  - recommended_answer: the recommended choice, "best" option, or any indication of which option is right
  - analysis_of_alternatives: weighing pros and cons, ranking options, evaluating alternatives
  - implementation_plan: how the decision would be executed step by step
  - expected_outcomes: what happens after the decision, results, projections of the chosen path
  - lessons_learned: takeaways, "the moral of the story", what students should conclude
  - theory_or_framework: explanation of a framework, theory, or model the student should apply
  - discussion_questions: questions for the student or class to answer
  - assignment_questions: prompts for a written assignment
  - rubric_or_grading: any grading criteria or assessment guidance
  - hint_at_answer: language that nudges the reader toward a particular choice (e.g., "clearly", "obviously the right move", "the data strongly favors")

Student case draft to audit:
{student_case_markdown}

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "passes": true,
  "summary": "string (1 to 3 sentences)",
  "violations": [
    {
      "category": "recommended_answer|analysis_of_alternatives|implementation_plan|expected_outcomes|lessons_learned|theory_or_framework|discussion_questions|assignment_questions|rubric_or_grading|hint_at_answer",
      "snippet": "string (the offending text, <= 300 chars)",
      "explanation": "string (why this violates the boundary, 1 to 2 sentences)",
      "severity": "high|medium|low"
    }
  ]
}

Rules:
- passes is true ONLY if violations is an empty array. If you list any violation, passes MUST be false.
- A neutral statement of a stakeholder''s position ("the CFO believes X") is NOT a violation. A claim that one position is correct IS a violation.
- Naming the alternatives the protagonist could take is allowed; weighing them is not.
- Describing the protagonist''s uncertainty, pressure, or constraints is allowed; resolving the uncertainty is not.
- Be precise. Do not flag stylistic issues, grammar, or factual concerns — only boundary violations.
- If the draft is clean, return {"passes": true, "summary": "...", "violations": []}.',
    `description` = 'Audit student-case draft for boundary violations (instructor-only content leaks)',
    `enabled` = 1
WHERE `use` = 'case_writer.boundary_validation' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.boundary_validation', 'default', 'Active version for case_writer.boundary_validation prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
