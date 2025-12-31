# Chat Options Configuration

This file documents the valid chat options for section-case assignments. It serves as both documentation and a schema reference for the admin UI.

When a section-case assignment has `chat_options` set to NULL in the database, the system uses the default values defined here.

## Options Schema

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hints_allowed` | int | 3 | Maximum number of hints a student can request during the chat. Set to 0 to disable hints entirely. |
| `free_hints` | int | 1 | Number of hints that don't penalize the student's score. After using free hints, each additional hint costs 1 point. |
| `ask_for_feedback` | boolean | false | Whether to ask the student for feedback at the end of the chat (helpfulness rating, what they liked, suggestions for improvement). |
| `ask_save_transcript` | boolean | false | Whether to ask the student for permission to save an anonymized version of the chat transcript for research/improvement purposes. |
| `allowed_personas` | string | "moderate,strict,liberal,leading,sycophantic" | Comma-separated list of protagonist persona options available to students. Valid values: moderate, strict, liberal, leading, sycophantic. |
| `default_persona` | string | "moderate" | The pre-selected persona when a student starts a new chat session. Must be one of the allowed_personas. |

## Example JSON

When stored in the database `section_cases.chat_options` column:

```json
{
  "hints_allowed": 3,
  "free_hints": 1,
  "ask_for_feedback": true,
  "ask_save_transcript": true,
  "allowed_personas": "moderate,strict",
  "default_persona": "moderate"
}
```

## Persona Descriptions

| Persona | Behavior |
|---------|----------|
| `moderate` | Balanced approach - acknowledges good points while probing for deeper justification. Recommended for most use cases. |
| `strict` | Requires explicit case facts for every assertion. Challenges students who mention information not in the case. |
| `liberal` | Supportive brainstorming mode - helps students connect ideas back to the case rather than strictly testing recall. |
| `leading` | Confidence-building mode - praises liberally, provides overt hints, avoids counter-arguments. |
| `sycophantic` | Agrees with everything (for demonstration/testing purposes). Not recommended for actual student assessment. |

## Future Options

Additional options may be added in future versions:

- `time_limit_minutes` - Maximum chat duration
- `min_exchanges` - Minimum number of student-AI exchanges before "time is up"
- `require_case_citations` - Number of case facts student must cite
- `evaluation_rubric_id` - Custom evaluation rubric per section-case
