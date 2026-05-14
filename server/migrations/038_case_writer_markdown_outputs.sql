-- Migration: 038_case_writer_markdown_outputs.sql
-- Date: 2026-05-13
-- Description: Switch the five Case Writer generation prompts (brief, scenarios,
--              blueprint, student-case, teaching-note) to markdown-first outputs,
--              and pipe approved source materials into every prompt via a shared
--              {source_materials} variable.

-- 1) Teaching Brief: markdown document
UPDATE `ai_prompts`
SET `prompt_template` =
'You are an instructional design assistant helping a business school instructor turn a teaching principle into a learning brief that will guide later case generation.

Instructor inputs:
- Teaching principle: {teaching_principle}
- Audience: {audience}
- Course context: {course_context}
- Difficulty: {difficulty}
- Case type: {case_type}

Approved source material (may be empty):
{source_materials}

Return ONLY a markdown document (no JSON, no code fences, no preamble) with the following second-level headings, in this order:

## Case Summary
A 2-3 sentence description of the kind of case this will become. Do NOT draft the case itself.

## Learning Objectives
- Primary objective: one bullet.
- 2-4 secondary objectives, each concrete and testable.

## Why This Principle
2-3 sentences explaining why this teaching principle is worth a case and what makes it pedagogically interesting at the specified difficulty.

## Anchor Decision Point
A 1-2 sentence description of the kind of decision the protagonist will face. This is the dramatic anchor of the case.

## Anticipated Difficulty
One paragraph: difficulty level, the main analytical demands on students, and any prerequisites (frameworks, concepts) they need to bring.

## Student Case Should Include
- Bullet list of content types (e.g. business context, stakeholder map, decision point, exhibit ideas).

## Reserved For Teaching Note
- Bullet list of content that must NOT appear in the student case (recommended answer, implementation plan, expected outcomes, etc.).

Guidance:
- Ground every section in the approved source material when source material is provided. Do not invent facts that contradict it.
- If an instructor input is missing, infer a reasonable value and proceed.
- If difficulty or case_type is missing, default difficulty to "intermediate" and case_type to "fictional".',
    `description` = 'Convert teaching principle + context (and approved source materials) into a markdown learning brief',
    `enabled` = 1
WHERE `use` = 'case_writer.teaching_brief' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.teaching_brief', 'default', 'Active version for case_writer.teaching_brief prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;

-- 2) Scenarios: JSON array, each item with a markdown body
UPDATE `ai_prompts`
SET `prompt_template` =
'You are an instructional design assistant generating alternative case scenarios for a business school instructor.

Inputs:
- Learning brief (markdown):
{learning_brief}

- Approved source material (may be empty):
{source_materials}

- Desired number of scenarios: {count}
- Industry preference (may be blank): {industry_preference}
- Revision hint (may be blank): {revision_hint}

Generate {count} substantively different scenarios that could each teach the principle in the learning brief. Each scenario should be distinct in industry, protagonist role, or core tension - not minor variations of the same story.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "scenarios": [
    {
      "title": "Short evocative title (max ~8 words)",
      "industry": "Industry or sector label",
      "markdown": "A markdown document describing the scenario - see required headings below."
    }
  ]
}

The "markdown" body for each scenario MUST use these third-level headings in this order:

### Protagonist
A 1-2 sentence sketch: name (or placeholder), role, and what they own as a decision.

### Company Context
2-4 sentences on the company - size, stage, market, situation.

### Central Tension
2-3 sentences on the conflict or trade-off at the heart of the case. This is what makes it teachable.

### Decision Point
2-3 sentences describing the specific decision the protagonist must make and the time pressure.

### Stakeholders
- Bullet list of 3-6 stakeholders the protagonist must consider, each with a one-line description of their stance or interest.

### Possible Exhibits
- Bullet list of 2-5 candidate exhibits (data tables, memos, market figures) that would support the case.

### Why It Teaches the Principle
2-3 sentences explicitly tying this scenario back to the teaching principle in the learning brief.

Guidance:
- If source material is provided, ground at least one scenario in it where natural; do not contradict the source.
- Do NOT write the full case prose. Each scenario should be a sketch a colleague could expand.
- The JSON wrapper exists so the UI can render a picker - keep ALL narrative inside the markdown field.',
    `description` = 'Generate alternative case scenarios as a JSON array of markdown-bodied cards',
    `enabled` = 1
WHERE `use` = 'case_writer.scenario_generation' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.scenario_generation', 'default', 'Active version for case_writer.scenario_generation prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;

-- 3) Blueprint: markdown document
UPDATE `ai_prompts`
SET `prompt_template` =
'You are an instructional design assistant turning a selected scenario into a detailed case blueprint - the plan a writer will use to draft the student case and teaching note.

Inputs:
- Learning brief (markdown):
{learning_brief}

- Selected scenario (markdown):
{selected_scenario}

- Approved source material (may be empty):
{source_materials}

- Revision hint (may be blank): {revision_hint}

Return ONLY a markdown document (no JSON, no code fences, no preamble) with these second-level headings, in this order:

## Working Title
One line.

## Protagonist
Name (placeholder is fine), role, age range, key personal traits relevant to the decision.

## Company Background
3-5 sentences: history, ownership, scale, current situation.

## Industry Context
3-5 sentences: market dynamics, competitive landscape, regulatory or technological pressures relevant to the decision.

## Timeline
- Bullet list of 4-8 dated milestones leading up to the decision point.

## Core Conflict
2-3 sentences naming the central trade-off or dilemma.

## Stakeholders
- Bullet list of 4-7 stakeholders, each with name/role, stance, leverage, and what they want.

## Evidence to Include
- Bullet list of 5-10 specific facts, quotes, or numbers the student case must contain.

## Exhibits
- Bullet list of 3-6 exhibits with a one-line description of what each shows (financials, market share table, internal memo, etc.).

## Decision Point
A focused 2-3 sentence description of the exact moment of decision: who, what, by when, with what information.

## Information to Withhold from Students
- Bullet list of facts that exist in the world of the case but should NOT appear in the student-facing document.

## Teaching-Note-Only Content
- Bullet list of analytical content (recommended answer hints, post-decision outcomes, alternative framings) reserved for the teaching note only.

Guidance:
- Use the source material to ground company and industry facts where possible; do not contradict it.
- The blueprint is a plan, not the prose. Keep each section dense and concrete - bullets and short paragraphs, not narrative.
- Be specific. "Revenue dropped" is bad; "Revenue fell 18% YoY in Q3" is good.',
    `description` = 'Turn the selected scenario into a detailed markdown case blueprint',
    `enabled` = 1
WHERE `use` = 'case_writer.case_blueprint' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.case_blueprint', 'default', 'Active version for case_writer.case_blueprint prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;

-- 4) Student Case Draft: pure markdown
UPDATE `ai_prompts`
SET `prompt_template` =
'You are a business case writer drafting a student-facing case document from a detailed blueprint.

Inputs:
- Learning brief (markdown):
{learning_brief}

- Case blueprint (markdown):
{case_blueprint}

- Approved source material (may be empty):
{source_materials}

- Target length: {length_target}
- Revision hint (may be blank): {revision_hint}

Return ONLY a markdown document - the student-facing case. No JSON, no code fences, no preamble, no meta commentary.

Structure (use second-level headings):

## [Working Title]
Use the blueprint working title.

## Background
The setup. Who the protagonist is, the company, the industry context. 2-4 short paragraphs.

## The Situation
What has happened recently. Timeline of relevant events leading to the present moment. Mix prose with named milestones.

## Key Players
Brief profiles of the stakeholders the protagonist must consider. Use a short paragraph or bullet per person.

## The Decision
The decision the protagonist must make. The options they are considering (do not recommend one). The constraints and the deadline.

(Optional) ## Exhibits
If the blueprint specifies exhibits, embed them inline using markdown tables or block quotes labeled "Exhibit 1: ...", "Exhibit 2: ...". Keep them realistic and specific.

End the case at the decision point. Do NOT include:
- Recommended answer or course of action
- Post-decision outcomes
- Analysis of options
- Any content marked "Information to Withhold from Students" or "Teaching-Note-Only Content" in the blueprint

Style:
- Third-person, present or past tense, consistent throughout.
- Concrete and specific. Real numbers, real-sounding names, vivid detail.
- Stay grounded in the blueprint - do not invent facts that contradict it. Use source material to enrich detail where natural.
- Length should be roughly {length_target} words; quality matters more than hitting the target exactly.',
    `description` = 'Draft the student-facing case as a markdown document',
    `enabled` = 1
WHERE `use` = 'case_writer.student_case_draft' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.student_case_draft', 'default', 'Active version for case_writer.student_case_draft prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;

-- 5) Teaching Note: pure markdown
UPDATE `ai_prompts`
SET `prompt_template` =
'You are an experienced case method instructor writing a teaching note for the case below.

Inputs:
- Learning brief (markdown):
{learning_brief}

- Case blueprint (markdown):
{case_blueprint}

- Student case (markdown):
{student_case_markdown}

- Approved source material (may be empty):
{source_materials}

- Format target: {format_target}
- Revision hint (may be blank): {revision_hint}

Return ONLY a markdown document - the instructor-only teaching note. No JSON, no code fences, no preamble.

Structure (use second-level headings, in this order):

## Synopsis
3-5 sentences summarizing the case for an instructor skimming before class.

## Teaching Objectives
- Bullet list mirroring the learning brief''s primary and secondary objectives, expressed as what students should be able to do or articulate by the end of discussion.

## Suggested Audience and Positioning
2-3 sentences on where this case fits in a course (week, module, prerequisites) and at what level.

## Analytical Framework
The framework or lens an instructor should use to lead the analysis. Name it, explain it briefly, and tie it to the teaching principle.

## Board Plan
A suggested chalkboard / whiteboard layout for the discussion. Use 3-5 columns or sections, each with a heading and bullet points of the kind of student input that should land there. Format as markdown sub-sections (### Column 1: ..., ### Column 2: ...) or a markdown table.

## Discussion Questions
Numbered list of 5-10 questions for class, in the order they should be asked. After each question, one line in italics on what the question is designed to surface.

## Alternative Approaches
2-4 short sub-sections (### ...) each describing a distinct way students might frame or solve the case, with the strengths and weaknesses of that framing.

## Recommended Resolution
The author''s recommended answer, with reasoning. 2-4 paragraphs. This is the instructor''s view, not the only view.

## What Actually Happened (Optional)
If the case is based on real or composite events, a short paragraph on the actual outcome and what students can learn from comparing their analysis to it. Omit the section entirely if not applicable.

## Common Student Pitfalls
- Bullet list of 4-8 ways students typically go wrong, with a one-line corrective.

## Grading and Assessment Notes
Brief guidance on what to look for in written submissions or chat transcripts. Include 3-6 evaluation criteria.

## Time Plan
A suggested time allocation for an 80-minute class (or {format_target} if specified) - rough minutes per section of discussion.

Style:
- Concrete and opinionated. The teaching note should make the instructor''s job easier, not present every possibility.
- Ground recommendations in the blueprint and source material; do not contradict the student case.
- Do NOT restate large chunks of the student case - reference it.',
    `description` = 'Draft the instructor-only teaching note as a markdown document',
    `enabled` = 1
WHERE `use` = 'case_writer.teaching_note' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.teaching_note', 'default', 'Active version for case_writer.teaching_note prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;

-- 6) Section revision: output shape depends on the step (markdown vs JSON)
UPDATE `ai_prompts`
SET `prompt_template` =
'You are revising one section of a business case authoring project.

Step being revised: {step}
Output format for this step: {output_format}
Revision command: {command}
Optional free-text instruction (may be empty): {instruction}

Current value of this step:
{current_value}

For context, here is the rest of the project (may be empty if earlier steps haven''t been generated yet):

Learning brief:
{learning_brief}

Selected scenario:
{selected_scenario}

Case blueprint:
{case_blueprint}

Student case (markdown form, may be empty):
{student_case_markdown}

Common revision commands and what they mean:
- rewrite: rewrite from scratch while keeping the same intent and structure
- shorten: cut length significantly while preserving meaning
- expand: add detail and depth
- tighten: keep the same content but make the writing crisper
- sharpen_decision: make the decision question more concrete and forced
- add_ambiguity: make the dilemma less obviously resolvable
- harden_evidence: add specific numbers, dates, or stakeholder quotes
- soften_tone: less editorial, more neutral and observational
- preserve_facts: do not introduce new facts; only revise wording and structure

Rules:
- Match the requested output format exactly:
  - If output_format = "markdown": return ONLY the revised markdown document. No JSON, no code fences, no preamble. Preserve the heading structure of the current value.
  - If output_format = "json_scenarios_array": return ONLY a JSON object of shape {"scenarios": [{"title": "...", "industry": "...", "markdown": "..."}]} - same length and order as the current value unless the command implies regeneration.
  - If output_format = "json_scenario_object": return ONLY a JSON object {"title": "...", "industry": "...", "markdown": "..."}.
- Honor the revision command first, then the free-text instruction (which may further refine the command).
- Stay consistent with the rest of the project context above. Do not contradict earlier approved steps.
- For step=student_case the boundary rules still apply: NO recommended answer, analysis, expected outcomes, lessons learned, discussion questions, or rubrics in the student case.',
    `description` = 'Revise a single project step in place; preserves the output format of the step',
    `enabled` = 1
WHERE `use` = 'case_writer.section_revision' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.section_revision', 'default', 'Active version for case_writer.section_revision prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
