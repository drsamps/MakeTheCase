# Scenario prompt instructions and chat-options labeling (2026-04)

This document records instructor-facing and technical changes for per-scenario AI prompt text, clarifies how that differs from section-case **Chat Options**, and notes the status of `case_scenarios.chat_options_override`.

## Per-scenario `prompt_instructions`

### Purpose

Instructors can attach **Additional Prompt Instructions** on each scenario (Cases → Scenarios → edit scenario). This text is **not shown to students**. It is included in the chat system prompt immediately after **The Question You Are Exploring**, under the heading **Instructions for this Scenario:**, so the model can follow scenario-specific guidance without duplicating that content in section-case Chat Options.

### Database

- **Table:** `case_scenarios`
- **Column:** `prompt_instructions` (`TEXT`, nullable), added after `chat_question`
- **Migration:** `server/migrations/026_add_scenario_prompt_instructions.sql`

Run on a database (dev example from project docs):

```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u USER -pPASSWORD DBNAME -e "source server/migrations/026_add_scenario_prompt_instructions.sql"
```

### Application wiring (summary)

- **API:** `server/routes/scenarios.js` — create/read/update return `prompt_instructions`; PATCH allows updating it (empty string stored as `NULL`).
- **Assignments / student payloads:** `server/routes/sectionCases.js` — scenario rows in section-case and active-case responses include `prompt_instructions`.
- **Student app:** `App.tsx` merges selected scenario fields into `CaseData`, including `prompt_instructions`.
- **System prompt:** `constants.ts` — `buildSystemPrompt()` reads `caseData.prompt_instructions` and appends the scenario block when present.
- **Types:** `types.ts` — `CaseScenario.prompt_instructions`
- **Admin UI:** `components/ScenarioManager.tsx` — textarea below Chat Question

## Chat Options labeling (section-case)

These apply to **`section_cases.chat_options`**, configured under Assignments → Chat Options (not per scenario).

- **Dashboard:** The Custom Instructions field subtitle now describes broader use: personality *or* other response guidance.
- **System prompt:** The block from `chatbot_personality` is headed **Additional Instructions:** (formerly “Additional Personality Instructions”).
- **Help:** `help/dashboard/ChatOptionsHelp.tsx` updated to match.

For a full list of chat option keys, see [chat-options-reference.md](./chat-options-reference.md).

## Legacy: `case_scenarios.chat_options_override`

The `chat_options_override` column on `case_scenarios` is **legacy / partially orphaned**:

- **Original intent:** JSON blob for scenario-level overrides of `section_cases.chat_options`, per early multi-scenario design.
- **Current UI:** No instructor screen reads or writes this field for scenarios. Scenario editing does not expose it.
- **API:** `server/routes/scenarios.js` still accepts and persists `chat_options_override` on create/patch.
- **Runtime usage:** Section-case endpoints still **select** it on scenario rows, but the student app does **not** merge it into chat options (students use resolved `section_cases.chat_options` only). One remaining server path is **`server/routes/evaluations.js`**, which parses `chat_options_override` for **legacy position-inference** flags (`position_tracking_enabled`, `position_capture_method`, etc.). Active position tracking and `ai_inferred` completion flow are driven primarily by **`section_cases`** (see `server/services/positionInference.js` and related migrations).

**Decision needed:** Either **(1)** formally support `chat_options_override` again (UI + clear merge rules with `section_cases.chat_options` and evaluations), or **(2)** **remove** it after an audit: migrate any still-needed keys, drop the column, and delete dead code paths that read it.

Until that decision is implemented, treat the column as **do not rely on** for new features—prefer explicit columns (e.g. `prompt_instructions`) or `section_cases` fields.
