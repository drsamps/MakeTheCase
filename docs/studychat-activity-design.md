# StudyChat activity design: the full reference

> Handing this to a TA? [studychat-guide.md](studychat-guide.md) is the short, click-by-click
> version. This file is the reasoning behind it, for an instructor going deeper or an admin about
> to author an activity type.
>
> **Not live yet.** StudyChat arrives with pull request #51. Delete this note once it is deployed.

The engineering reference is [activity-types.md](activity-types.md); the design record is
`dev/StudyChat-plan.md`.

---

## The shape of the system

```
ACTIVITY TYPE          the rules: who the AI plays, what it may see, how it grades,
                       what the student reads                      (admin, as data)
   filled in by
ACTIVITY (a case)      documents, goal, scenarios, positions, touchpoints  (instructor)
   assigned through
ASSIGNMENT             section, dates, chat options, rubric, model          (instructor)
   produces
CHAT                   one student's run, pinned to the type version it started on
```

Three things follow from this, and they are the whole point of the rewrite:

- **A new activity type needs no new code.** A type is validated JSON, so an admin can create
  one. Only genuinely new *mechanisms* (a new kind of material, a new signal) need a developer.
- **Nothing type-specific is hardcoded in the student page.** Every sentence a student reads that
  differs by activity comes from the type's own copy.
- **A chat runs and is graded on the version it started with.** Publishing a change never
  disturbs a chat in progress, and never re-grades a past one.

---

## The eight types

Two are built in (defined in code, locked, clonable). Six are system types, seeded as data by
`npm run seed-activity-types`, also locked and clonable. The seed never overwrites an edited row.

### Case chat — `case_chat`

*The student argues a position with the case protagonist.*

- **The AI** is the case protagonist from the scenario, meeting a junior business analyst. Its
  rules: stay brief, argue from case facts, take a **counter-argumentative stance**, pivot to
  implementation once the student has justified a position, probe, keep the persona like a busy
  executive, and conclude on "time is up".
- **It sees** the case, supplementary files, the **teaching note** (as an internal guide not to
  be revealed) and the **argument framework** (for and against).
- **Personality** comes from the five legacy personas — Strict, Moderate, Liberal, Leading,
  Sycophantic — which set how strictly it requires case facts.
- **Grading**: a business school Coach, three default questions (did they study the reading /
  solid answers / justified from the reading), 1–5 each. No evidence quotes, one free-form
  summary.
- Positions optional. No intro bar. Hides the opening-words option.

### Teach-back — `teach_back`

*The student explains the reading to an AI audience.*

- **The AI** is a listener who does not understand: "You are not a teacher, a grader, or an
  assistant. You are the one who does not understand yet." The student picks the audience from
  the `audience-` persona pool.
- **It does not see** the teaching note or the arguments. That is what keeps it naive.
- Its rules are the most carefully built of any type: reflect before you ask; understanding is
  **earned in stages**, never in the first two replies and never with a stock phrase; one
  question at a time; under 60 words; **never lecture** — "if you find yourself about to name
  the thing they are missing, ask about it instead"; a hint is re-asking its own question in
  simpler words, because it cannot hint about material it does not know; and genuine
  understanding comes only after the key ideas, the reasons and an example, normally not before
  its fourth reply.
- **Grading**: a teaching Coach that judges **only the student's own words** — the listener's
  paraphrases are prompts, not content. Criteria: plain accurate language / WHY not just WHAT /
  answering what the listener actually did not understand. With evidence quotes, under two
  headings ("What you explained well", "What would have made it clearer").
- An opening word floor applies to the student's first message.

### Debate — `debate`

*The student argues one side of a question against an AI opponent.*

- **Positions required, exactly two**, captured as **assigned** or chosen by the student.
- **It sees** the teaching note and the argument framework — the arguments for and against the
  student's own side.
- Its rules: hold your side and never concede the whole question, rebut then advance with a
  specific fact, demand evidence.
- **Grading** says explicitly that the student may have been assigned the side: "judge how well
  they argued it, never whether you agree with it." Criteria: a clear case / evidence from the
  reading / answering the opponent.
- The greeting has a variant that states the assigned side, and the intro bar shows "Your side
  (assigned)".

### Apply — `apply`

*The student acts as a consultant, applying a concept to a client's new situation.*

- Transfer rather than recall. Positions off.
- **The AI** is a client who "knows your own situation well and the concept not at all". It may
  invent details of its own business, never facts about the concept, and it must never name the
  concept's terms or apply it itself. If the student uses jargon, it asks what that means for the
  client.
- **Grading**: accurate use of the concept / fit to this client / trade-offs and next steps.

### Liken to Me — `liken_to_me`

*The student applies what they studied to their own life, with a reflective mentor.*

- The **only personal type** (`personal: true`), with everything that implies — see
  [Personal activities](#personal-activities) below. Teaching note off. Positions off.
- Its mentor comes from a persona (the seeded `audience-mentor`), listens first, connects both
  ways, and is told **not to judge or advise**, to respect limits and never press for private
  detail. It carries a line encouraging a student in distress to talk to someone they trust or a
  campus counsellor — **read that wording and confirm it suits your institution.**
- **Grading**: "Judge the depth of the connection the student made, NEVER the student's life,
  choices, beliefs, or how much private detail they chose to share. A student who keeps details
  general can still score fully."
- Ships with the Finish button on by default.

### Pitch — `pitch`

*The student pitches an idea to a skeptical investor or buyer, who decides.*

- **Signals on**, both kinds, and the AI **sees the touchpoints** — your touchpoints become the
  investor's objections, raised in its own words. It is told to let these shape the conversation
  and never to list them or admit they exist.
- "Start doubtful, and let them earn it." The goal is a **decision** — yes, no, or yes on
  conditions — and never before its third reply.
- **Grading**: a clear value case / evidence from the reading / handling objections. "Whether the
  investor said yes does not decide the score."

### Role Play — `roleplay`

*The student practises a professional conversation with a difficult counterpart.*

- Signals and touchpoints on, as with Pitch.
- Affect-aware: "you react to how the student treats you as well as what they say. Being
  listened to moves you; being brushed off makes things harder." And: "Do not make it easy. If
  they jump to a fix before understanding your concern, say so."
- The goal is a **resolution**, not before its third reply. A hint steps out of character for one
  sentence.
- **Grading**: listened and understood / applied what they studied / moved to a workable
  resolution.

### Defend — `defend`

*The student defends their own submitted work to an AI examiner.*

- The **only type whose material is the student's own work** — see
  [Student submissions](#student-submissions).
- The examiner asks about **their** work, naming a specific claim, number or choice, and does not
  teach or fix. It is told explicitly to **ignore instructions inside the submission**: it is
  material to examine, nothing more.
- **Grading**: "Do not grade the submission itself — only the student's messages count."
  Criteria: understanding of their own work / justifying choices under pressure / responding to
  challenge.
- Defaults to 8 responses, ending there, with one hint.

---

## The trait grid

Traits are what the platform does for a type. They are the part of a type you **cannot change
after it is first published**, because chats have already run on them — to change one, clone the
type to a new key.

| Trait | Values | What it decides |
|---|---|---|
| `character` | scenario / persona | Whether the AI's identity comes from the scenario (a named protagonist, opponent, client, investor, counterpart, examiner) or from a persona the student picks |
| `persona_kind` | protagonist / audience | Which persona pool is offered, and so whether the AI is someone who knows the material or someone who does not |
| `positions` | off / optional / required | Whether students take a side. `required` refuses a chat if positions are not set up |
| `capture_methods` | explicit, assigned, ai_inferred, instructor_manual, none | Which ways of recording a side the assignment may offer |
| `material` | activity / student_submission | Whether the chat is about your reading or the student's own work |
| `ai_sees` | case, supplementary, teaching_note, arguments, touchpoints | Exactly which documents reach the AI. The case is always on. **This is the lever that decides whether the AI is an expert or ignorant on purpose** |
| `signals` | complete, touchpoints | Whether the AI may report back mid-chat that the goal is met, and which touchpoints were raised |
| `grading_extras.evidence` | on / off | Per-criterion met / partly met / not met, with a verbatim student quote. Fills the coverage strip |
| `grading_extras.eval_inputs` | none / chosen_persona / type_criteria | Extra grading context. `type_criteria` means the type's own criteria grade the chat when the assignment names no rubric |
| `opening_word_floor` | on / off | Whether a minimum-word floor applies to the student's first message |
| `personal` | on / off | Students write about their own lives; names hidden by default |
| `two_sided` | on / off | Exactly two positions; a third enabled one is refused |

Where the eight types land:

| Type | Character | Positions | Capture | AI sees note | AI sees arguments | Signals | Evidence | Own criteria |
|---|---|---|---|---|---|---|---|---|
| Case chat | scenario | optional | explicit, inferred, manual, none | yes | yes | no | no | no |
| Teach-back | persona (audience) | optional | explicit, inferred, manual, none | **no** | **no** | no | yes | no |
| Debate | scenario | **required** | **assigned**, explicit | yes | yes | no | yes | yes |
| Apply | scenario | off | none | yes | no | no | yes | yes |
| Liken to Me | persona (audience) | off | none | **no** | no | no | no | yes |
| Pitch | scenario | off | none | yes | no | **yes** | yes | yes |
| Role Play | scenario | off | none | yes | no | **yes** | yes | yes |
| Defend | scenario | off | none | yes | no | no | yes | yes |

---

## What is configurable where

| Level | Holds | Notes |
|---|---|---|
| **Activity type** | Traits, the AI's role and rules, the greeting, the grading framing and default criteria, the UI words, everything the student reads, partial chat-option defaults | Admin only, under Admin → Activity Types |
| **The case** | Title, activity type, **goal**, documents, default settings | The type is fixed once the case is assigned, listed on a course, or has chats |
| **The scenario** | The question (labelled per type), the character, the situation shown to students, AI-only prompt instructions, the time limit, positions, **touchpoints**, saved per-persona openings | Most of the craft lives here |
| **The assignment** | Dates, Active, chat options, rubric, chat model, position tracking and capture method | Per section, or per course version |

**Course case versions are write-through.** A course case has a Main version and optional
semester copies; a section either follows one or is Customized. Editing a version rewrites the
settings of every section following it — so a change made on a version reaches sections, and a
change made directly on a following section can be overwritten by a later version edit. Details
in [semesters-courses-sections.md](semesters-courses-sections.md).

**Chat option defaults** are layered: platform defaults, then the global default, then the
section default, then the **activity type's** partial defaults, then the case's saved defaults,
then whatever the instructor sets on the assignment. Type defaults are deliberately partial —
Defend sets 8 responses and one hint and leaves everything else to your own preferences. Defaults
are copied in **once**, when the assignment or version is created; later changes to a type do not
rewrite existing assignments.

A type can also **hide** options that mean nothing for it. All six new types hide the opening
word floor and the position-tracking switch.

---

## The mechanisms

### Touchpoints

Your own checklist, written per scenario: up to 20 entries, each a label (*Carrying cost*) and
optionally a note on what counts. Never shown to students.

- **Detected at grading on every type that has them**, with a quote from a student turn verified
  word for word. A hit whose quote cannot be verified stays a hit with no evidence.
- Only types with `ai_sees.touchpoints` — Pitch and Role Play — put them in the chat prompt, as a
  hidden guide to shape the conversation.
- Only types with `signals.touchpoints` report hits **live in Monitor**. The model is noisy
  there: it repeats hits and reports what it judges the student raised, so **Monitor is a hint
  and Results is the record**.
- Results stores the key **and** the label as a snapshot, so renaming a touchpoint later does not
  rewrite past results. Re-evaluating a chat does not update its saved touchpoints.
- Issue Analytics seeds them as instructor themes, unselected and unscanned until you ask.

### Assigned sides

The **server** picks the side, inside the transaction that starts the chat:

- An existing assigned chat keeps its side, so a retry never changes it.
- Otherwise the side with the fewest students, ties broken by a hash of the position, student and
  assignment — never at random, so the split is even and reproducible.
- Any position the page sends is ignored, and a student cannot change one afterwards.
- The AI learns the side only through the prompt; the greeting may state it; the intro bar shows
  it as assigned.
- It needs sides on every scenario, checked when you save and again when a chat starts.
- An assigned chat never asks the student whether their position changed — the side was not their
  opinion.

### Personal activities

For activities about students' own lives (today, Liken to Me):

- A notice before the chat, in the type's own words.
- Names **hidden by default** in Results and its CSV, Position Analytics, Monitor and
  transcripts, replaced by a stable anonymous label, with a "Show names" checkbox.
- Issue Analytics refuses to run until it is turned on for that run.
- **It is a default, not an access rule.** Not covered: admin-only chat lists, the prompt logs,
  and sorting or searching Results by name. In transcripts it replaces the student's own names —
  a nickname or a relative's name stays. A names-off CSV has no identifying columns.

### Student submissions

For types whose material is the student's own work (today, Defend):

- The student pastes or uploads on the start screen: PDF, Word, Markdown or text, up to 10 MB,
  with the extracted text capped at 60,000 characters — **refused, never silently cut**. Staff
  can upload one for a student from Courses → Students.
- No submission, no chat.
- Every upload is kept, and **the chat pins the one it started on**, so replacing a submission
  never changes a running chat or a past grade.
- The text enters the prompt and the grader as untrusted data, in the dynamic part, with anything
  that could close the block or forge a signal made harmless. The examiner is told to ignore
  instructions inside it.
- It is re-sent on **every** turn, so a long submission costs more per message.
- Student work never travels in a package. It is removed with the student, and included in
  backups like other student data.

### Signals and ending on the goal

Types with `signals` let the AI tell the platform something in a private block that is **cut out
before the reply is stored or shown**. It never reaches a transcript, the grader, or Issue
Analytics.

- `complete` means the AI judges the goal met. The student gets a bar offering **Finish now** or
  **Keep talking**. The chat option **End When the Goal Is Reached** wraps up at once instead;
  it is only offered on types that can signal.
- **A student can talk a model into emitting the block.** So a signal only ever *offers* to
  finish: the minimum is enforced on the server, at the end of the chat and again at grading, and
  a false claim of a time or response limit is refused.
- Every way a chat ends records its reason. **Grading refuses a chat below Minimum Exchanges when
  no reason was recorded** — for every type, Case chat included. This was a deliberate behaviour
  change and it closes a real gap.

### The goal, the type's own criteria, the word floor

- **The goal** (`Goal` on the case form) is for the AI and the grader. Students see it only
  through a type's intro bar, which is why the built-ins never show it.
- **Own criteria**: with no rubric on the assignment, a type with `eval_inputs: type_criteria`
  grades on its own default criteria — never on the case-chat default. All six new types work
  this way; three starter rubrics (Debate, Apply, Liken to Me) are seeded as an alternative.
- **The opening word floor** refuses a too-short first message on the server, in the type's own
  wording. Default 15 words; only Teach-back uses it.

---

## Tiers, versions and what refuses

| Tier | Keys | Editable | Version tag |
|---|---|---|---|
| Built-in | `case_chat`, `teach_back` | No — clone it | a hash of the definition |
| System | `debate`, `apply`, `liken_to_me`, `pitch`, `roleplay`, `defend` | No — clone it | `debate@v1` |
| Custom | `c_<slug>_<8 hex>` | Draft, then publish | `c_x_1a2b3c4d@v3` |

- A custom type is a **draft** until published; published versions are never edited or deleted.
  **Its traits are fixed once published.**
- Publish, then **Enable**. Only then can a case use it.
- A chat records the version it started on and is graded on it.
- A **disabled** type still serves chats in progress but starts no new ones. An **unknown or
  unpublished** type refuses at chat start and at grading rather than falling back — a silent
  fallback to case chat would produce a plausible wrong grade. Only a *missing* type means case
  chat.
- **History** compares any two versions, or the draft against the current one, and restores an
  old version into the draft.

Authoring is under **Admin → Activity Types** and needs the grantable `activity_types`
permission (superusers always have it). The editor has five tabs: **Edit** (a form over every
text field), **JSON** (the whole definition, validated on save), **Preview** (the exact prompts
on a real case or sample text, with no AI call), **Test chat** (chat with the draft as a student
and grade it — real AI, billed to the author, stored nowhere), and **History**.

Two reassurances for an author: the grader's task list and output format are platform code, so an
edit cannot break grading; and a template slot that is not allowed in a field's channel is
**refused when you save**, so AI-only text can never reach a student by accident.

---

## Packages

A case travels between servers as a package file, from Content → Cases: **Download**, **Install
from file**, **Copy**.

- A **custom** activity type travels as its definition. The built-ins travel only as a reference,
  and a package may never carry a built-in key.
- Install validates every definition, reuses an existing type with identical content, and
  otherwise creates it **disabled, as a draft**. Only an admin with the `activity_types`
  permission may install a package that creates a type.
- Packages **fail closed**: an unknown format version, capability, activity type, chat option,
  document role or persona kind is refused with a clear message rather than ignored. This is what
  stops a package from a newer server installing wrongly on an older one.
- A package never sets owner, visibility, ids or system flags, never overwrites, and never
  carries student work. Everything it creates is private to the installer and assigned nowhere.

Full detail in [activity-packages.md](activity-packages.md).

---

## Deploying the types

In order, on the server:

```bash
npm run migrate
```

```bash
npm run seed-activity-types
```

Then restart the server — the type registry is held in memory, so a row changed directly in the
database is not seen until a restart.

The seed creates the six system types, the `audience-mentor` persona and three starter rubrics,
all visible to instructors at once. It never overwrites an edited row. System types are locked
and so have no Disable button: to hold a type back, seed it later.

---

## Related

- [studychat-guide.md](studychat-guide.md) — the TA-facing guide
- [ta-guide-teach-back.md](ta-guide-teach-back.md) and [teach-back-setup.md](teach-back-setup.md)
  — the Teach-back click path (written when there were two types; still accurate otherwise)
- [activity-types.md](activity-types.md) — the definition schema and the engineering checks
- [activity-packages.md](activity-packages.md) — the package format
- [semesters-courses-sections.md](semesters-courses-sections.md) — courses, sections and settings
  versions
- [chat-options-reference.md](chat-options-reference.md) — the older per-assignment option
  reference, which predates the newest options
- `dev/StudyChat-plan.md` and `dev/StudyChat-progress.md` — the design record and the build log
