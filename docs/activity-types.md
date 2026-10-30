# Activity types

An activity type is a definition (validated JSON) that the activity engine renders into a chat prompt, greeting, grading prompt and student wording. A case fills it in with documents, scenarios and positions. The plan and its reasoning are in `dev/StudyChat-plan.md`.

## The three tiers

| Tier | Where the definition lives | Editable | Version tag |
|---|---|---|---|
| builtin (`case_chat`, `teach_back`) | `utils/activityEngine/builtins/*.json` | no; clone it | `case_chat@<sha12>` |
| system (`debate`, `apply`, `liken_to_me`, `pitch`, `roleplay`, `defend`) | `activity_type_versions`, seeded from `server/scripts/seeds/systemActivityTypes.js` | no; clone it | `debate@v1` |
| custom (`c_<slug>_<8 hex>`) | `activity_type_versions` | draft, then publish | `c_x_1a2b3c4d@v3` |

Seed the system types with `npm run seed-activity-types`, then restart the server: the registry is in memory. It never overwrites; `--force` publishes a changed definition as a new version.

## What a definition holds

| Part | What it is |
|---|---|
| `traits` | What the platform does: `character`, `persona_kind`, `positions`, `capture_methods`, `material`, `ai_sees`, `signals`, `grading_extras`, `opening_word_floor`, and optional `personal`, `two_sided`. Fixed once published |
| `prompt` | Document headings, the `role` template, optional wrappers, hint wording, per-turn notes |
| `greeting` | Turn 0: `resolver` plus templates |
| `grading` | Framing, default criteria, headings. The task list and JSON contract are platform code |
| `labels`, `copy` | Student wording. Every key in `COPY_KEYS` is required; `OPTIONAL_COPY_KEYS` and `OPTIONAL_INTRO_KEYS` are not |
| `chat_options` | Partial `defaults`, and `hidden` keys |

## Features, and what uses them

| Feature | Trait or data | Where |
|---|---|---|
| Assigned sides | `capture_methods` has `assigned`, optional `two_sided` | `services/sideAssignment.js`, `positionRules.js` |
| Goal | `cases.goal`, slot `{goal}`, intro line `goal` | shown to students only through an intro line |
| Personal content | `traits.personal`, `copy.personal_notice` | `services/personalActivity.js` |
| Signals | `traits.signals` | `utils/activityEngine/signals.js`, `routes/llm.js` |
| Touchpoints | scenario settings, `ai` subtree | graded on every type; in the chat prompt only with `ai_sees.touchpoints` |
| Student submission | `traits.material: student_submission` | `services/studentSubmissions.js` |
| Own criteria | `grading_extras.eval_inputs: type_criteria` | `teachBack.js#typeCriteriaInputs` |

## Adding an engine feature

1. Add the trait or key to `validate.js`. **If it can appear on a built-in, keep it optional and absent from the built-in JSON**: the built-in's version tag is the hash of its definition.
2. Render it only when present, so `check-activity-engine.js` stays byte-for-byte unchanged.
3. Add a token to `activityPack/capabilities.js#FEATURE_TOKENS`, so an older server refuses the package with a clear message.
4. Add refusal cases to `check-activity-definitions.js`.

## Checks

```bash
node server/scripts/check-activity-engine.js --db
```

```bash
node server/scripts/check-activity-definitions.js
```

```bash
node server/scripts/check-activity-pack.js --db
```
