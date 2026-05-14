-- Migration: 030_case_writer_scenarios_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable the case_writer.scenario_generation prompt template,
--              and set 'default' as the active version.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are an instructional design assistant generating business case scenario alternatives for a faculty member.

Learning brief (approved by the instructor):
{learning_brief}

Other constraints:
- Number of scenarios to produce: {count}
- Industry preference (optional, may be empty): {industry_preference}
- Additional guidance from the instructor (optional, may be empty): {revision_hint}

Generate {count} distinct case scenario alternatives. Each scenario must clearly teach the stated principle and must be MEANINGFULLY DIFFERENT from the others in industry, protagonist type, decision type, or stakeholder tension.

Do NOT write the full case. Do NOT include analysis, recommendations, or a "right answer".

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "scenarios": [
    {
      "title": "string",
      "industry": "string",
      "protagonist": "string",
      "company_context": "string",
      "central_tension": "string",
      "decision_point": "string",
      "stakeholders": ["string", "string", "string"],
      "possible_exhibits": ["string", "string"],
      "why_it_teaches_the_principle": "string",
      "estimated_difficulty": "introductory|intermediate|advanced|executive"
    }
  ]
}

Requirements per scenario:
- title: a short evocative title (e.g., "The Big-Box Opportunity"). Not just the principle name.
- protagonist: include role + a concrete identity (e.g., "Founder/CEO of a regional premium salsa brand"). Avoid generic "the manager".
- decision_point: state the actual choice as a question the protagonist must answer.
- central_tension: the structural tradeoff or conflict that makes the decision hard. Should NOT have an obvious answer.
- stakeholders: 3 to 6 named groups or roles.
- possible_exhibits: 2 to 5 plausible data tables / artifacts that would support student analysis.
- why_it_teaches_the_principle: connect the scenario explicitly back to the principle from the brief.
- estimated_difficulty: pick one of the four enum values; default to the brief''s difficulty if unsure.

Cross-scenario requirements:
- Produce exactly {count} scenarios.
- No two scenarios should share both industry AND decision type.
- If industry_preference is provided and non-empty, the FIRST scenario must use that industry; remaining scenarios may vary.',
    `description` = 'Generate distinct business case scenario alternatives from a learning brief (JSON)',
    `enabled` = 1
WHERE `use` = 'case_writer.scenario_generation' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.scenario_generation', 'default', 'Active version for case_writer.scenario_generation prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
