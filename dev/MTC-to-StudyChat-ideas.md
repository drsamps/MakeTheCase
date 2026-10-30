# StudyChats

## What is a StudyChat

A “StudyChat” is a type of learning (and student learning assessment) activity in which the student studies something then chats with an AI chatbot to accomplish some learning goal. After the chat, an AI supervisor evaluates the chat conversation and provides feedback and possibly a score based on a defined rubric.

### StudyChat workflow

1. student study document(s)  
2. student chats on topic based on a scenario, perhaps taking a position  
3. the chat somehow concludes (time limit or student request)  
4. (chat option) student provides feedback about the StudyChat activity  
5. students get feedback and a grade based on a rubric  
6. instructor views results (including analytics) in preparation for class

## StudyChat elements (defined by the instructor)

1. Goal \- Learning objective of the StudyChat activity.  
2. Content \- What students study, such as an article, a business case, or the student’s homework.  
3. Scenarios \- What chat is about, how the chat unfolds.  
   1. (feature to be added later) Stages/Phases/Acts/Parts \- A sequence of scenarios, like the acts of a play or the levels of a video game.  
4. Positions \- Alternative direction each student might go in the chat, such as being for or against a proposal.  
5. Touchpoints \- Elements that students might touch on in the chat, that the instructor desires to track, such as cost issues, culture issues, expansion, etc.  
6. Persona \- The attitude and communication style of the chatbot, such as strictness or helpfulness. Persona includes the presumed name/title of the chatbot and perhaps some background information, such as being a beginner or being an expert.  
7. Completion \- The stopping condition (for each stage) of a chat, which could be time, conversation turns, answering some question, etc.  
8. Rubric \- The set of criteria by which the StudyChat (transcript) is evaluated by the AI supervisor, for feedback and possibly a score.

Each assigned StudyChat has “Chat Options” similar to what is defined in MakeTheCase. Some StudyChat activities will come with predefined default Chat Options.

## StudyChat examples

The following are StudyChat examples that we have come up with thus far:

* CASECHAT \- study a case then chat with the case protagonist.  
* EXPLAIN \- the Feynman Technique: explain concepts to a beginner.  
* APPLY \- learn a concept then apply it to a different situation.  
* LIKEN2ME \- apply a studied concept (such as a scriptural passage) or experience to my life.  
* DEBATE \- take a position on an issue, defend, provide counter-argument.  
* PITCH \- pitch an idea or product, explaining it is good.  
* INTERVIEW \- practice interviewing for discovery and proposal.  
* ROLEPLAY \- role play interaction to practice communication and problem solving skills.  
* DEFEND \- students are asked about their assignment submission and have to defend their main ideas.

The MakeTheCase tool was originally designed to do CASECHAT activities. Later we added EXPLAIN type of activities, but that modification did not go very well since the MakeTheCase code was designed for CASECHAT.

How could we modify MakeTheCase to allow for various StudyChat activities, including activities that we have not yet thought of? Start out by giving me a high level conceptualization, perhaps including some helpful diagrams and features to consider.


=== here is a preliminary high-level plan ===


# StudyChats: generalizing MakeTheCase beyond CASECHAT

## Context

MakeTheCase was built for one activity, CASECHAT: study a case, then get questioned by its protagonist. When EXPLAIN was added, it went poorly because the CASECHAT assumptions are hardcoded in code rather than stored as configuration. The code shows where:

| Where | What is hardcoded |
| :---- | :---- |
| `constants.ts#buildSystemPrompt` | "You are … the protagonist of the … business case", "meeting with a junior business analyst", the 8 Rules of Engagement (counter-argue, cite case facts, pivot to implementation), the "time is up" conclusion rule, the `=== BUSINESS CASE DOCUMENT ===` framing |
| `App.tsx:839` | Opener: "Hello X, I am {protagonist}… let's get straight to my question" |
| `App.tsx:907` | Completion is string matching on "time is up" / "time's up" |
| `server/services/promptBuilder.js#buildCoachPrompt` | "You are a professional business school Coach…", the default Q1–Q3 rubric about "reading material", hint penalties |
| `types.ts` | `CEOPersona` enum; `CaseScenario` has `protagonist`, `chat_question`, `arguments_for/against` as fixed columns |
| `server/services/positionInference.js`, Issue Analytics | Assume a for/against position on a proposal |

Today an EXPLAIN activity has to live inside `prompt_instructions` and fight the CASECHAT rules that come before it in the prompt. A new kind of activity should be data that an instructor or admin writes, not a code fork.

**A prerequisite the code exposed:** the chat system prompt is assembled **in the browser** (`services/llmService.ts` → `buildSystemPrompt`) and posted to `/api/llm/chat` as `systemPrompt`. As a result, the teaching note and the argument framework that are labeled "DO NOT REVEAL TO THE STUDENT" reach the student's browser, and a student can send any system prompt they like on the instructor's budget. Moving prompt assembly to the server is step 0 of this design, and it fixes that leak too.

---

## 1\. The core idea: an Activity Type is a template, and an Activity is a filled-in template

                ┌──────────────────────────────────────────┐

                │  ACTIVITY TYPE  (reusable "game rules")  │   CASECHAT, EXPLAIN, DEBATE,

                │  \- roles: AI plays \_\_, student plays \_\_  │   PITCH, DEFEND, … plus

                │  \- chat prompt template (with {slots})   │   types nobody has thought of

                │  \- opener template                       │   yet (admins clone and edit)

                │  \- which elements it uses                │

                │  \- default completion rules              │

                │  \- evaluator prompt template \+ default   │

                │    rubric                                │

                │  \- UI vocabulary ("Case"/"Protagonist"   │

                │    vs "Concept"/"Beginner")              │

                └───────────────────┬──────────────────────┘

                                    │ instance of

                ┌───────────────────▼──────────────────────┐

                │  ACTIVITY  (today: a "case")             │

                │  Goal · Content · Scenarios · Positions ·│

                │  Touchpoints · Persona · Completion ·    │

                │  Rubric                                  │

                └───────────────────┬──────────────────────┘

                                    │ assigned to (unchanged machinery)

                ┌───────────────────▼──────────────────────┐

                │  SECTION ASSIGNMENT (section\_cases)      │

                │  dates, chat options, versions, model    │

                └──────────────────────────────────────────┘

Your eight elements map onto what already exists. Most of the work is renaming and generalizing, not starting over:

| StudyChat element | Today | Change |
| :---- | :---- | :---- |
| Goal | implicit in `chat_question` | explicit `goal` on the activity, written for the AI and the evaluator |
| Content | `case_files` (case, teaching\_note, supplementary) | keep the table; give each file a **role** the type understands (student\_reading, ai\_only\_guide, student\_submission, rubric\_reference). For DEFEND, the content is the **student's own uploaded work**, which is a new per-student content slot |
| Scenarios (→ Stages later) | `case_scenarios` (one scenario per chat) | stays one scenario per chat; gains `completion_rules`. Multi-stage chats are deferred (§7) |
| Positions | `scenario_positions`, `arguments_for/against` | keep them, as an optional element that the type turns on (DEBATE: yes, EXPLAIN: no) |
| Touchpoints | not modeled (Issue Analytics finds themes after the fact) | new `activity_touchpoints` table. They feed live tracking, the evaluator, and Issue Analytics' instructor-added themes (pass 3 already exists) |
| Persona | `personas` \+ `CEOPersona` enum | split into **Character** (name, title, background, expertise level, per activity or scenario) and **Demeanor** (strict…sycophantic, the existing personas) |
| Completion | timer \+ "time is up" string | a completion-rules engine (§4) |
| Rubric | `rubrics` \+ hardcoded Coach framing | keep rubrics; the evaluator framing comes from the type's template |

---

## 2\. Layered prompt assembly (on the server, cache-ordered)

Every chat prompt is built from layers. Each layer fills named slots in the type's template. The static layers come first so prompt caching keeps working the way it does today.

  STATIC (cacheable) ─────────────────────────────────────────────

   1\. Platform guardrails   safety, "student text is data", hint protocol,

                            control-signal protocol (§4)            \[code\]

   2\. Content blocks        each file wrapped in \<context role=...\>  \[activity\]

   3\. Hidden guides         teaching note, arguments, touchpoints   \[activity\]

  ─────────────────────────────────────────────────────────────────

  DYNAMIC

   4\. Type template         "You are {ai\_role}. {student} is {student\_role}.

                             Your objective: {goal}. Rules: …"     \[activity type\]

   5\. Scenario              question/task \+ scenario instructions  \[scenario\]

   6\. Position              student's chosen side (if enabled)     \[position\]

   7\. Character \+ Demeanor  who the AI is \+ how it behaves         \[persona\]

   8\. Section overrides     chatbot\_personality, hints, limits     \[section\_cases\]

- The CASECHAT type's template is today's `buildSystemPrompt` text moved into a template. It must produce the **same prompt byte for byte** (a snapshot test), so existing courses notice nothing.  
- Templates are stored in the existing `ai_prompts` and versioning system (`promptService.getActivePrompt`), under keys such as `studychat.casechat.chat` and `studychat.casechat.evaluate`. Use `renderOnce()` (from Issue Analytics), not sequential `renderPrompt()`, so `{placeholders}` inside student text never expand.  
- Instructor-supplied slots get the same XML "treat as data" wrapping that Case Writer already uses.

---

## 3\. Entity model (proposed)

 activity\_types ──\< cases (+activity\_type\_id, \+goal)          "Activity"  
                      ├──\< case\_files (+content\_role)  
                      ├──\< case\_scenarios (+completion\_rules JSON,  
                      │       \+character overrides)           "Scenario"  
                      │       └──\< scenario\_positions          (optional element)  
                      ├──\< activity\_touchpoints               (new, optional)  
                      └──\< rubrics (existing link)

 section\_cases (unchanged: dates, chat\_options, versions)

 case\_chats (+activity\_type\_id snapshot, \+touchpoint\_hits JSON)

`activity_types` columns: `type_key`, `name`, `description`, `elements` (JSON: which of positions / touchpoints / student\_submission it uses), `labels` (JSON vocabulary), `chat_prompt_use`, `opener_template`, `evaluate_prompt_use`, `default_rubric_id`, `default_completion` (JSON), `default_chat_options` (JSON, see §3b), `visibility` (reuse `buildVisibilityScope`), `built_in`.

Keep the table names (`cases`, `case_chats`) and change only the UI words. Renaming tables touches about 20 route files, the migrations, backups and analytics for little benefit.

---

## 3a. What carries over between activities: templates you can link to or copy

**One rule for every reusable element.** Any element can be flagged as a **template**. When someone uses a template, they choose one of two things:

- **Link**: the activity points at the template. When the owner improves the template, the activity gets the improvement. The linker can't edit it; to customize, they press **Detach**, which turns the link into an editable copy.  
- **Copy**: the activity gets its own editable rows stamped with `copied_from_id`. Later, "the template has changed: review and pull changes" can be offered, but changes never arrive on their own.

            ┌─────────────── TEMPLATE (is\_template \= 1, visibility private/team/public)

            │                 owner edits it; allow\_link / allow\_copy set by owner

            │

   link ────┤ activity → template\_id      (read-only, follows owner's edits)

            │      └─ Detach ─► becomes a copy

   copy ────┘ activity's own rows, copied\_from\_id \= template   (editable, independent)

This joins the two patterns the codebase already has: linked rubrics and personas (with `private / team / public` visibility, migrations 048–049), and copied position templates (`position_templates` → `scenario_positions`, migration 016).

**Template, visibility and permission are separate settings.** `visibility` (already exists) decides *who can see* a template. `is_template` decides whether it *appears in the template pickers*, so a one-off rubric doesn't clutter everyone's list. The owner can turn off `allow_link` or `allow_copy`, e.g. "copy only" for something the owner expects to revise heavily, or "link only" for a department-standard rubric. A template's owner can edit it. Admins can mark system templates, which is today's `is_system_default` / `is_system_template`.

**Guardrails for linking (the part that fails silently if skipped):**

1. **Results freeze what they used.** A linked template can change after students have chatted, so every result must save a snapshot of what it was graded or tracked against. Evaluations already do this: `evaluations.criteria` saves the scored criteria text along with `rubric_id`. Touchpoint hits must do the same: save the key *and* the label in `case_chats.touchpoint_hits`, and never only an id that points at an editable row. Touchpoint keys stay stable; renaming a label is fine; deleting a touchpoint that results already reference only hides it.  
2. **Linkers see changes, not surprises.** Editing a linked template shows the owner "used by N activities in M sections", and each linked activity shows "updated by owner on …".  
3. **Deleting a linked template doesn't break anyone.** Either it is blocked while links exist, or each linker is detached to a copy first. I recommend detaching.  
4. **Mid-semester changes respect versions.** A linked template change reaches a section the same way a course case version edit does, through the existing write-through. So `guardFollowedCaseSettings` still applies wherever a template link is stored on `section_cases`.

**Each element gets a suggested default action** (the picker opens with this choice selected, and the instructor can switch):

| Element | Template library | Default action | Why that default |
| :---- | :---- | :---- | :---- |
| Persona: demeanor (strict…sycophantic) | `personas` (exists) | Link | Behavior with no content-specific meaning |
| Persona: character (name, title, background) | new `character_templates` | Copy | Usually tailored (the CEO of *this* company) |
| Rubric | `rubrics` \+ `rubric_criteria` (exist) | Link | Standard rubrics keep scores comparable |
| Touchpoints | new `touchpoint_sets` | Copy | Usually tailored to the content. Linking is safe because of guardrail 1 |
| Positions | `position_templates` (exists) | Copy | Unchanged from today |
| Completion rules | new `completion_presets` | Copy | Small, almost always tweaked |
| Chat Options | new `chat_option_presets` (optional) | Copy | Seeded once per assignment (§3b) |
| Content | any activity's content, flagged as a template | Copy | Keeps per-case files and access checks. Licensed material may be marked copy-off / link-off by the owner |
| Whole activity | `cases` (exists) | Copy (clone) | Unchanged from today |
| Activity type | `activity_types` | Link (always) | A fix to the EXPLAIN template should reach every EXPLAIN activity. `ai_prompts` versioning gives you rollback. |

**Schema pattern, the same for each library table:** add `is_template`, `allow_link`, `allow_copy` to the template table. On the consuming side, store either a `<x>_template_id` link or the activity's own rows with `copied_from_id`. For JSON-only elements (completion presets, chat-option presets), a link is a preset id and a copy is inline JSON. One shared helper module, `server/services/templateLibrary.js`, provides `listTemplates(kind, req)` using `buildVisibilityScope`, plus `linkTemplate`, `copyTemplate` and `detach`, so every element behaves the same.

## 3b. Chat Options with activity-type defaults

Each assignment (`section_cases.chat_options`) still has its own full Chat Options, set on the Assignments screen as today. What changes is where the starting values come from. Today the chain is hardcoded `DEFAULT_CHAT_OPTIONS` → global default → section default (`chat_options_defaults`, read in `server/routes/chatOptions.js` and `server/routes/sectionCases.js`), and the result is **seeded once** when an assignment is created.

New merge, key by key, with later layers winning:

 hardcoded defaults ─► global default ─► section default ─► ACTIVITY TYPE defaults ─► ACTIVITY defaults ─► assignment (instructor edits)

   (code)              (admin)           (instructor)       (type author)             (activity author)     section\_cases.chat\_options

- **Type defaults set only the keys the activity needs.** EXPLAIN might set `hints_allowed: 0`, `timeout_chat: false`, `allow_finish_button: true` and `default_persona: <curious beginner>`, and leave timer display and transcript settings to the section default. Because type defaults are partial, they override the instructor's general section preferences only where the activity requires it.  
- **Types can add and hide keys.** The Chat Options UI is already schema-driven (`GET /api/chat-options/schema`). A type can add keys (EXPLAIN: `beginner_level`; DEBATE: `assigned_side_mode`) and mark irrelevant keys as hidden (EXPLAIN hides `disable_position_tracking`), so instructors only see options that mean something for the activity.  
- **Keep the seed-once rule.** Defaults copy into the assignment when it is created, as they do today. Later changes to type defaults don't rewrite existing assignments, so a course's settings never change underneath it. A "Reset to activity defaults" button applies them on purpose. For course case versions, the seed goes into the Main version, and the write-through (`caseVersionSync.js`, `guardFollowedCaseSettings`) handles the rest.  
- **Optional named presets** ("Graded exam", "Practice, unlimited hints") are copied-template rows that an instructor applies on the Assignments screen. They are a later convenience, not required.

---

## 4\. Chat lifecycle: a completion engine instead of string matching

 PRE\_CHAT ─► CHATTING ──(any completion rule fires)──────────────────────────►

            │      ▲                                                      │

            └──────┘ completion rules checked after every turn            ▼

                       (optional) FEEDBACK phases ─► EVALUATING ─► RESULTS

Completion rules are declarative and set per scenario. The type provides defaults, and the scenario or section can override them:

| Rule | Example | Who detects it |
| :---- | :---- | :---- |
| `time` | 15 min | client timer \+ server check |
| `turns` | 10 student turns | server |
| `student_request` | Finish button / "I'm done" | client |
| `goal_reached` | the beginner says "now I get it"; a question was answered; a pitch was accepted | **the AI**, through a structured control signal |
| `instructor_end` | live monitor kill | existing |

**Control signals.** The AI ends each reply with a small machine-readable block, for example `<studychat-control>{"complete":true,"touchpoints":["cost"]}</studychat-control>`. The server strips the block before the student sees the reply. The same channel carries touchpoint hits and position changes (and, if multi-stage is adopted later, stage transitions), so the special-case position inference flow goes away. Keep `time is up` working as an alias for `student_request`.

---

## 5\. How each example becomes configuration (the test of the design)

| Type | AI role | Student role | Elements | Default completion | Evaluator focus |
| :---- | :---- | :---- | :---- | :---- | :---- |
| CASECHAT | case protagonist | analyst | positions, touchpoints | time | use of case facts, defense |
| EXPLAIN | curious novice | teacher | touchpoints \= concepts to cover | goal\_reached ("I understand") or time | accuracy, clarity, coverage |
| APPLY | client with a new situation | consultant | touchpoints | turns or goal | transfer of the concept |
| LIKEN2ME | reflective mentor | self | none or light | student\_request | personal relevance, depth |
| DEBATE | opponent | advocate | positions (required) | turns | arguments, rebuttals |
| PITCH | skeptical investor or buyer | pitcher | touchpoints \= objections | goal\_reached (buy/pass) | persuasion, handling objections |
| INTERVIEW | interviewee or client | interviewer | touchpoints \= facts to discover | time | discovery coverage, question quality |
| ROLEPLAY | counterpart (upset customer…) | professional | touchpoints | goal\_reached | the communication skill |
| DEFEND | examiner | author | **student\_submission** content | turns | understanding of own work |

When a row needs a new code feature, that is a sign the engine is missing a primitive. DEFEND, for example, needs per-student content. The primitive is worth building because it unlocks every activity of that shape.

---

## 6\. Features to consider

1. **Activity Type gallery and editor** (Setup tab): clone a built-in type, edit its templates, labels and default rubric, and preview the assembled prompt (the Preview prompt feature already exists).  
2. **Type-aware student UI**: labels, the "show content" pane, a position picker only when positions are on, and an upload step for DEFEND.  
3. **Type-aware Case Writer → "Activity Writer"**: the same pipeline, with generation prompts chosen by type (EXPLAIN generates a concept brief and a beginner profile instead of a case).  
4. **Touchpoint analytics**: a live checklist in Monitor, a heatmap in Results, and a direct feed into Issue Analytics as seeded themes.  
5. **Multi-stage chats (deferred)**: "Act 1: diagnose. Act 2: recommend. Act 3: handle the board's pushback" in one chat. For now, use sequenced required scenarios; see §7.  
6. **AI-simulated student test runs**: an instructor runs a fake student, weak or strong, through a new type before assigning it. This is the cheapest way to catch a broken template.  
7. **Per-type evaluation framing** with the same JSON schema, so `evaluationNormalizer.js` and Results stay unchanged.

---

## 7\. Phased path (each phase can ship on its own, and CASECHAT never breaks)

0. **Server-side prompt assembly.** The client sends `case_chat_id` plus the message, and the server builds the prompt with the existing `loadCaseData()` in `server/routes/llm.js`. This removes `systemPrompt` from the request body. Add a snapshot test against today's `buildSystemPrompt` output.  
1. **`activity_types` table \+ CASECHAT as type \#1.** Move the hardcoded prompt, opener and evaluator text into `ai_prompts` templates. Existing cases default to CASECHAT. The snapshot test must still pass. Add the activity-type layer to the chat options merge (§3b). CASECHAT's type defaults are empty, so existing seeding is unchanged.  
2. **EXPLAIN as type \#2.** Rebuild the current EXPLAIN activities on the new type, and add `labels` support in the student UI. This proves the abstraction works.  
3. **Completion engine \+ control signals** (replaces "time is up" matching and folds in position inference).  
4. **Template library \+ touchpoints.** Add `templateLibrary.js` and the `is_template`/`allow_link`/`allow_copy` flags. Retrofit rubrics, personas and position templates to it first (they already exist), then add `touchpoint_sets` with key+label snapshots in `touchpoint_hits`, control-signal hits, analytics and Issue Analytics seeding.  
5. **Type editor UI** (including type default chat options and schema add/hide), **`character_templates` and completion presets**, Activity Writer, student\_submission content (unlocks DEFEND).

**Deferred: multi-stage chats (one continuous chat with several stages).** The decision is single-stage for now. Run sequenced activities with the existing `all_required` \+ `require_order` scenario sequencing (separate chats in order), and judge from classroom use whether a continuous multi-stage chat is worth building. The single-stage phases must keep that path open:

- `completion_rules` lives on `case_scenarios`, not on the chat.  
- The control signal is a generic `{"complete": true}`. A later multi-stage engine can read it as "advance to the next stage".  
- Don't add `stage_order`, `current_stage` or stage markers in `formatTranscript` until multi-stage is approved. Adding them later is cheap; removing unused columns is not.

Critical files across the phases: `constants.ts`, `services/llmService.ts`, `App.tsx`, `server/routes/llm.js`, `server/services/promptBuilder.js`, `server/services/promptService.js`, `server/routes/scenarios.js`, `server/routes/sectionCases.js`, `server/services/caseVersionSync.js` (new touchpoint rows and scenario completion rules must go through `guardFollowedCaseSettings` and the version write-through), `utils/transcriptFormat.js`, `types.ts`.

## Verification (when implementation begins)

- Prompt snapshot tests: for a fixture case, scenario and persona, the CASECHAT prompt from the server equals today's client output.  
- Run `npm run migrate:dry`, then `npm run migrate` on dev `ceochat`. Every existing case shows type \= CASECHAT.  
- End to end with `npm run dev:all`: one CASECHAT chat and one EXPLAIN chat, each through evaluation. Check that Results, Issue Analytics and the transcript markers are unchanged for CASECHAT.  
- Check that the network tab no longer shows the teaching note or the argument framework in any student request or response.