# Designing StudyChat Activities: a guide for TAs

> **Not live yet.** These activities arrive with the StudyChat release (pull request #51). On a
> server where it has not been deployed, Content → Cases still offers only Case chat and
> Teach-back. Delete this note once it is live.

For a teaching assistant or instructor who has edit access to a case. Everything here is in the
instructor dashboard (Ctrl+click the header, or open `#/admin`). The deeper reference, with
every type's prompt and grading in full, is [studychat-activity-design.md](studychat-activity-design.md).

---

## What a StudyChat is

A StudyChat is an activity in which a student studies something, then **chats with an AI to
accomplish a learning goal**. Afterwards an AI supervisor reads the conversation and gives
feedback and a score against a rubric.

Six steps, every time:

1. The student studies the document you uploaded.
2. They chat about it, within a scenario you wrote — perhaps taking a position.
3. The chat ends: a message limit, a timer, a Finish button, or the AI judging the goal met.
4. Optionally, the student tells you what they thought of the activity.
5. They get feedback and a grade.
6. You read the results, and the analytics, before class.

MakeTheCase began with one activity — study a business case, then get questioned by its
protagonist. That is now **one of eight**, and the shape above is what they all share.

## The one idea that makes it general

> "A type is the rules of an activity: who the AI plays, what it is told, how the chat is graded
> and what the student reads. A case then fills in the reading and scenarios."

Three layers, and you own the middle two:

| Layer | What it holds | Who sets it |
|---|---|---|
| **Activity type** | The rules: who the AI plays, what it may see, how it grades, what students read | Comes with the system; an admin can author new ones |
| **The case** (the activity) | The reading, the goal, the scenarios, positions, touchpoints | **You** |
| **The assignment** | Which section, which dates, message limits, hints, personas | **You** |

So you are not writing a chatbot. You are choosing a set of rules, then filling them with your
material. Nearly all the craft is in the scenario.

---

## The eight types: which one?

| Type | The AI plays | The student | Reach for it when | The grade measures |
|---|---|---|---|---|
| **Case chat** | The case protagonist, who knows the case and pushes back | An analyst defending a decision | Students must commit to a recommendation and hold it up under pressure | Use of case facts, quality of answers, justification |
| **Teach-back** | Someone who does *not* understand the reading | The teacher | You want to know whether they can explain it, not recognise it | Plain accurate language, WHY not just WHAT, answering the real confusion |
| **Debate** | An opponent who holds the other side | An advocate for one side | The question has two defensible sides and you want them argued | A clear case, evidence from the reading, answering the opponent |
| **Apply** | A client with a new situation and no knowledge of the concept | A consultant | Students know the concept and you want to see transfer, not recall | Accurate use of the concept, fit to this client, trade-offs and next steps |
| **Liken to Me** | A reflective mentor | Themselves | The material is meant to change how they see their own life | Understanding, the connection they made, whether the reflection went somewhere |
| **Pitch** | A skeptical investor or buyer who decides | The pitcher | Students must persuade, and handle objections, not just explain | A clear value case, evidence, handling objections |
| **Role Play** | A difficult counterpart — an upset customer, a defensive colleague | The professional | The skill is interpersonal, and practice beats description | Listening, applying what they studied, reaching a workable resolution |
| **Defend** | An examiner who read their submission | The author of the work | You want to know the submitted work is really theirs, and understood | Understanding of their own work, justifying choices, handling challenge |

The dashboard's type picker shows each type's one-line summary; this table is the same list with
room to say when to pick it.

**Case chat** and **Teach-back** are built in. The other six are seeded by an admin
(`npm run seed-activity-types`), so if a type is missing from the picker, that is why.

---

## Five questions that design an activity

Everything the eight types differ in comes down to five choices. Learn these and you can see what
a type will do to a classroom before you build anything — and you can describe a type nobody has
built yet.

### 1. Does the AI know the material?

This is the biggest lever, and the least obvious.

- **The AI has the answer key** — Case chat, Debate, Pitch, Role Play, Defend. It can see the
  teaching note. It can catch an error, cite a fact back, and press. The student is being
  *tested*.
- **The AI is deliberately ignorant** — Teach-back, Apply, Liken to Me. It cannot see the
  teaching note at all, and is instructed never to supply the missing idea. The student has to do
  all the explaining.

Teach-back tells its AI: never supply an idea — if you are about to name the thing they are
missing, ask about it instead. Apply tells its client: never name the concept's terms, and if the
student uses jargon, ask what it means for you. Same move, two costumes. If your learning
objective is "they can explain it", you need a type from the second group.

### 2. Who is doing the thinking, and which kind?

Recall and defence (Case chat, Defend) · explanation (Teach-back) · transfer to a new case
(Apply) · adversarial reasoning (Debate) · persuasion (Pitch) · an interpersonal skill
(Role Play) · personal reflection (Liken to Me). Pick the one your class period needs next, not
the one that sounds most impressive.

### 3. Does the student take a side, and who picks it?

Positions can be off, optional, or required. When they are on, there are several ways the side
gets recorded:

| How | What happens |
|---|---|
| Student selects | They click a position before or during the chat |
| **Assigned** | **The server picks the side**, balancing across the section. The student cannot change it |
| AI inferred | The grader works out which side they argued |
| Instructor records | You enter it yourself afterwards |
| None | Not tracked |

**Assigned** is worth knowing about: it is the steelman exercise. Half the section argues the
side they do not hold, the server keeps the split even, and the same student always gets the same
side on a retry. Debate's grading already says to judge how well they argued it and never
whether the grader agrees. Debate is the type built for this, and it needs exactly two positions
on every scenario.

### 4. How does the chat end?

- A **message limit** (Maximum Responses), counting only messages the student sends.
- A **timer** on the scenario, with Auto-End on Timeout to stop it there.
- The **Finish button**, or the student typing "time is up".
- **The AI judging that the goal is met** — only Pitch and Role Play do this. The investor
  decides; the counterpart is satisfied. The student then gets a bar offering **Finish now** or
  **Keep talking**, and the option *End When the Goal Is Reached* makes it wrap up at once
  instead.

A goal signal never overrides your floor: Minimum Exchanges still applies first.

### 5. What gets measured?

- **A rubric** you pick on the assignment — or **none**, in which case the type's own criteria
  grade the chat. The six new types each ship sensible criteria, so leaving the rubric empty is a
  real choice, not a mistake. (Case chat is the exception: it always uses its own three default
  questions unless you give it a rubric.)
- **Evidence.** Every type except Case chat and Liken to Me asks the grader to mark each
  criterion met / partly met / not met and quote the student's own words for it. That is what
  fills the coverage strip on the student's feedback screen.
- **Touchpoints** — your own checklist of things you hope get raised (carrying cost, culture,
  the ethics angle). They are reported in Results and never affect the score.

---

## Build one, start to finish

A worked example: a **Debate** activity, because it exercises positions, assigned sides and a
rubric. Every other type is the same path with fewer fields.

### 1. Content → Cases → New Case

| Field | What to put |
|---|---|
| Case Title | What students will see in the list |
| **Activity type** | **Debate.** Read the next paragraph before you save |
| Goal | Optional. The learning objective, in one line: *students can argue both sides of vertical integration from the reading*. It goes to the AI and the grader. Some types also show it to students |

**The activity type is fixed.** You can change it only while the case has no assignments, no
course listing and no chats. To run a second activity on the same reading — a Teach-back as well
as a Debate — make a **Copy** of the case and set the copy's type. This is the one decision in
this guide that is awkward to undo, so get it right before you assign.

### 2. Content → Case Files: upload the reading

Upload the document students will study. Debate's AI also reads the **teaching note** and the
**argument framework** if you provide them, which is what lets it push back with real facts.
Nothing marked as a teaching note or instructor notes ever reaches a student.

### 3. Content → Cases → your case → Scenarios → New Scenario

| Field | What to put |
|---|---|
| Scenario Name | Short; students see it in the heading |
| **Debate question** | The motion, as a question with two defensible answers. The field is labelled differently per type — *Topic* for Teach-back, *Client situation* for Apply, *What is pitched* for Pitch, *Focus of the defence* for Defend |
| The character fields | Who the opponent is. Debate's AI is a named opponent from the scenario, not a persona the student picks |
| Additional Prompt Instructions | Optional, **never shown to students**. Guidance for the AI only |
| The situation | Optional, **shown to students** |
| Time Limit (minutes) | 0 for none |
| **Positions** | **Exactly two** for Debate — the two sides. A third enabled position is refused |
| **Touchpoints** *(not shown to student; optional)* | Up to 20. Each is a label (*Carrying cost*) and optionally "what counts". Grading reports which were raised, with a quote |

Save with **Update Scenario**. Nothing is stored until you do.

### 4. The rubric

Either pick one on the assignment, or leave it empty and let Debate's own three criteria grade
the chat (a clear case / evidence from the reading / answering the opponent). An admin can seed
three starter rubrics — Debate, Apply and Liken to Me — if you would rather start from those and
edit.

### 5. Assignments → your section → assign the case → Chat Options

The settings that change what students actually read:

| Setting | Why it matters here |
|---|---|
| **Maximum Responses** | How many messages the student may send. The opponent's replies do not count |
| **At the Response Limit** | End there, or ask whether they want to keep going |
| **Minimum Exchanges** | A floor before they may finish. Grading **refuses** a chat below it |
| **Auto-End on Timeout** | With a time limit, ends the chat when it expires |
| **Show Timer** | The countdown in the corner |
| **Allow Finish Button** | Lets them stop when they are done |
| **Show Case Content** | Whether the reading sits beside the chat |
| **Hints Allowed / Free Hints** | Hints past the free ones cost marks |
| **Position tracking and capture method** | Set it to **assigned** for the steelman version, or let students choose |
| **End When the Goal Is Reached** | Only appears on Pitch and Role Play. Ignore it here |

Then make the assignment **Active**, with the right open and close dates.

---

## Four more, in brief

**Teach-back.** The full click path is its own guide: [ta-guide-teach-back.md](ta-guide-teach-back.md).
Two things it adds that no other type has: students pick their **audience** from a persona list
(Sam the curious beginner, your grandmother, a classmate who skipped the reading), and you write
and approve each audience's **opening message** in the scenario editor so every student reads the
same words. Note that guide was written when there were only two types; the rest of it still
holds.

**Apply.** The AI is a client with a situation of its own and no knowledge of your concept. Write
the *Client situation* field as the client's problem, not as a question about the concept. Give
it a situation genuinely different from the reading's — the point is transfer. The client may
invent details about its own business, but never about the concept.

**Defend.** The chat is about **the student's own work**. On the start screen they paste or upload
it (PDF, Word, Markdown or text, up to 10 MB); you can also upload one for a student from
Courses → Students. No submission, no chat. The chat pins the submission it started with, so
replacing a file later never changes a running chat or a past grade, and the examiner is told to
ignore any instructions inside the submission. It defaults to 8 responses and one hint.

**Liken to Me.** Students write about their own lives, so this type is handled differently:
they see a notice before the chat, and their **names are hidden by default** in Results, Position
Analytics, Monitor and transcripts, with a "Show names" box to reveal them. Issue Analytics will
not run on it until you turn that on for the run. Its mentor is told not to judge or advise, not
to press for private detail, and its grading judges the depth of the connection and never the
student's life or how much they chose to share. Treat the hiding as a courteous default, not a
security boundary.

---

## What students never see, and what the AI never sees

Worth knowing before you type into a box.

| | Reaches the AI | Reaches the student |
|---|---|---|
| The reading, supplementary files | Yes | Yes |
| Teaching note, argument framework | Only on types whose rules allow it | **Never** |
| Instructor notes files | Yes | **Never** |
| Additional Prompt Instructions (scenario) | Yes | **Never** |
| Persona instructions | Yes | **Never** |
| Touchpoints | Only on Pitch and Role Play, as the shape of the conversation | **Never** |
| The Goal | Yes | Only through a type's intro bar |
| The student's own messages | Yes, as data — never as instructions | — |

The AI also has a private channel for telling the platform that the goal is met. It is stripped
out before anything is stored or shown, so it never appears in a transcript or a grade. And
because a student could talk the model into producing one, that signal only ever *offers* to
finish — it never grades anything and never gets past your minimum.

---

## Test it before class

Ask for a test student account if you do not have one. Then, as that student:

1. Start the activity. Check the intro bar — the heading, the topic, the length line — and the
   opening message.
2. Send one real message. The AI should answer in character, and the counter should move.
3. If the activity uses positions, check the pick works and, for assigned sides, that you were
   given one.
4. Finish the chat and read the feedback screen.

Then, as staff: open the chat in Results and check the score, the per-criterion evidence and the
touchpoint coverage.

**Also read the type's actual prompts** before you assign a type for the first time. Admin →
Activity Types → Preview shows the exact wording the AI and grader receive, with no AI call and
no cost. If you do not have that permission, ask your admin to look with you. The six new types
were written and tested on a toy case, not on real course material — read them against your
subject before a class of students meets them.

---

## Reading the results

| Where | What you get |
|---|---|
| **Monitor → Live** | Chats in progress, and for Pitch and Role Play a live touchpoint checklist. Treat this as a hint; the model is noisy about it mid-chat |
| **Results → Student Results** | The record: scores, per-criterion feedback with the student's own quote, the coverage strip, touchpoint coverage across everything you have filtered to, and for Defend the submission above the transcript |
| **Results → Position Analytics** | How the section split, one case and scenario at a time |
| **Results → Issue Analytics** | AI themes across the transcripts. Your touchpoints are seeded into it as themes you can scan for |

---

## Guardrails and gotchas

| What | Why it matters |
|---|---|
| The activity type is **fixed** once the case is assigned, listed on a course, or has chats | Plan the type before you assign. A second activity on the same reading is a **Copy** of the case |
| Grading **refuses** a chat below Minimum Exchanges | True for every type, Case chat included. A chat that ended too early needs a recorded reason before it can be graded |
| A goal signal only **offers** Finish | A student can talk a model into emitting one, so it never grades and never beats your minimum |
| Name hiding on Liken to Me is a **default, not an access rule** | It covers Results, Position Analytics, Monitor, transcripts and Issue Analytics. Sorting by name still uses the real name, and a nickname inside a transcript stays |
| Monitor's touchpoints are a live hint; **Results is the record** | Re-evaluating a chat does not update its saved touchpoints |
| A Defend submission is sent to the AI **every turn** | A very long submission costs more per message |
| A student cannot resume a chat after a browser refresh | Tell students to finish in one sitting |
| The six new types have no Disable button | They are system types. To hold one back, ask your admin not to seed it yet |
| Editing a scenario opening while students are chatting | Chats already running keep what they got; new chats get the new version |

---

## Sharing an activity

On **Content → Cases**:

- **Download** builds a package file of a case — its documents, scenarios, positions, settings.
- **Install from file** reads one and shows you exactly what it would add before anything is
  written.
- **Copy** makes a second case on the same server, which is how you run a different activity type
  on the same reading.

An installed case is private to you and assigned nowhere until you assign it. A package that
would create a brand-new activity type needs an admin to install it. More in
[activity-packages.md](activity-packages.md).

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The type you want is missing from Activity type | The six new types need seeding. Ask your admin to run `npm run seed-activity-types` and restart |
| Activity type is greyed out when editing a case | The case already has an assignment, a course listing or chats. Make a Copy instead |
| Students are offered "Strict" or "Sycophantic" on a teach-back | The case's Activity type is Case chat, not Teach-back |
| No audience or persona offered on the start screen | None is enabled for the assignment. Check Allowed Personas in Chat Options |
| A Debate assignment refuses to start | It needs exactly two positions on every scenario. Add or disable one |
| A Defend activity will not start | The student has not submitted their work yet |
| A chat cannot be graded | It is below Minimum Exchanges with no recorded reason. Lower the minimum, or have the student redo it |
| Position buttons do not appear | Position tracking is off, the scenario has no positions, or the side was assigned |
| "End When the Goal Is Reached" is not in Chat Options | Only Pitch and Role Play can signal a goal |
| An activity type shows as "not available" | It was disabled. Chats in progress continue; no new ones start |

---

## Want a type that does not exist yet?

That is the point of the new system: a type is data, not code, so an admin can create one in an
afternoon without a developer. What they need from you is the design, not the wording — write
down the answers to the five questions:

1. **Who does the AI play**, and what is its attitude?
2. **What may it see?** In particular, may it read the teaching note — is it an expert or is it
   ignorant on purpose?
3. **Does the student take a side**, and who chooses it?
4. **How does the chat end?**
5. **What should the grade reward**, in three criteria?

Then say which of the eight existing types is closest. Your admin clones that one and edits it
rather than starting from nothing, previews the prompts, test-chats it as a student, and
publishes it. Chats keep the version they started on, so publishing a fix never disturbs a chat
in progress.

The detail behind all of this — every type's prompt and grading, the full trait grid, and what is
configurable where — is in [studychat-activity-design.md](studychat-activity-design.md).
