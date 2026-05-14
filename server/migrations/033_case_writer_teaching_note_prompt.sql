-- Migration: 033_case_writer_teaching_note_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable the case_writer.teaching_note prompt template,
--              and set 'default' as the active version.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are writing the INSTRUCTOR-ONLY teaching note for a business case that has already been drafted for students.

Approved learning brief:
{learning_brief}

Approved case blueprint:
{case_blueprint}

Student-facing case draft (this is what students will read):
{student_case_markdown}

Format target: {format_target}

Additional instructor guidance (optional, may be empty): {revision_hint}

The teaching note is instructor-only. Unlike the student case, the teaching note SHOULD contain:
- Alternatives available to the protagonist and how to evaluate them
- Recommended analysis (including frameworks)
- Quantitative solution where applicable
- Implementation considerations
- Expected outcomes and what actually happened or would happen
- Lessons learned and key takeaways
- Discussion questions, assignment questions, and grading guidance
- Anticipated student misconceptions and how to surface them
- A class-flow / board plan

The teaching note MUST be consistent with the student case (same protagonist, facts, exhibits, decision point). Do NOT introduce contradictions. Where the student case withholds information from students (the blueprint lists this under information_to_withhold_from_students), the teaching note CAN reveal that information here.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "case_synopsis": "string",
  "target_audience": "string",
  "learning_objectives": ["string", "string", "string"],
  "teaching_plan": "string",
  "board_plan": "string",
  "alternatives": [
    { "name": "string", "description": "string", "pros": ["string"], "cons": ["string"] }
  ],
  "analysis_guidance": "string",
  "quantitative_solution": "string",
  "implementation_considerations": "string",
  "expected_outcomes": "string",
  "lessons_learned": ["string", "string"],
  "discussion_questions": ["string", "string"],
  "assignment_questions": ["string", "string"],
  "rubric": [
    { "criterion": "string", "levels": [ { "label": "string", "descriptor": "string" } ] }
  ],
  "student_misconceptions": [
    { "misconception": "string", "how_to_address": "string" }
  ],
  "note_markdown": "string"
}

Field requirements:
- case_synopsis: 1 paragraph (4 to 8 sentences) summarizing the case as the instructor sees it.
- target_audience: copy or refine from the brief.
- learning_objectives: 3 to 6 items, action-verb phrased, observable.
- teaching_plan: a narrative class plan (2 to 5 paragraphs) describing how the instructor opens, develops, and closes the discussion.
- board_plan: a short outline (5 to 12 bullet-style lines) of what to write on the board or whiteboard during class, in roughly the order it would appear.
- alternatives: 2 to 5 realistic options the protagonist could take, each with 2 to 5 pros and 2 to 5 cons.
- analysis_guidance: how to lead the analytical discussion; frameworks to apply; what a strong analysis looks like. 2 to 5 paragraphs.
- quantitative_solution: if the case includes numbers, show the calculation a strong student would perform. If the case is purely qualitative, set this to "Not applicable for this case." and explain briefly.
- implementation_considerations: practical considerations a student must surface for their recommendation to be credible. 1 to 3 paragraphs.
- expected_outcomes: how the leading recommendation is expected to play out (instructor-only). 1 to 3 paragraphs.
- lessons_learned: 3 to 6 transferable takeaways students should leave class with.
- discussion_questions: 4 to 8 questions sequenced from easy/factual to harder/strategic.
- assignment_questions: 2 to 5 prompts suitable for a written assignment or short paper.
- rubric: 3 to 6 criteria, each with 3 to 5 levels (e.g., Exemplary / Proficient / Developing / Beginning).
- student_misconceptions: 3 to 6 common wrong moves students make on this kind of case, each paired with how the instructor can surface and correct it.
- note_markdown: the COMPLETE teaching note as a single Markdown document, with these top-level sections in order: "# Teaching Note — {Case Title}", "## Case Synopsis", "## Learning Objectives", "## Teaching Plan", "## Board Plan", "## Alternatives", "## Recommended Analysis", "## Quantitative Solution", "## Implementation Considerations", "## Expected Outcomes", "## Lessons Learned", "## Discussion Questions", "## Assignment Questions", "## Grading Rubric", "## Anticipated Student Misconceptions". The note_markdown must reflect the same content as the structured fields above.

The note_markdown must begin with the literal heading "# Teaching Note —" so it can be clearly identified as instructor-only material in any later export.',
    `description` = 'Draft the instructor-only teaching note from the case (JSON, instructor-only)',
    `enabled` = 1
WHERE `use` = 'case_writer.teaching_note' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.teaching_note', 'default', 'Active version for case_writer.teaching_note prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
