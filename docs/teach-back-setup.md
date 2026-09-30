# Setting Up a Teach-Back Assignment

A step-by-step click path. Everything is done in the instructor dashboard, apart from one
optional one-line command that creates the starter audiences for you. Nothing to install,
and no database migration.

**What teach-back is.** Every assignment runs one of two activities. In the usual **case
chat**, the student argues a position with the case protagonist, who knows the case and
pushes back. In **teach-back**, the roles reverse: the AI plays someone who does *not*
understand the reading, and the student has to make them understand it. The AI reflects
the student's words back, says when something lands, thanks them, and asks about whatever
still confuses it.

**Teach-back is a practice activity, not a high-stakes exam.** MakeTheCase shows the
student and the AI the same case text, so the audience has read the reading. It is
instructed not to fill in gaps and mostly will not, but that is a request rather than a
guarantee. Use teach-back for learning and light credit.

---

## Step 1 — Create the audiences (once per campus, not per course)

### The quick way

```bash
npm run seed-audiences               # create the eight starters below
npm run seed-audiences -- --dry-run  # show what it would do first
npm run seed-audiences -- --force    # also overwrite ones you have edited
```

It creates them as ordinary personas, public so every instructor can use them, and it
**never overwrites an audience that already exists** unless you pass `--force` — so your
edits are safe if you run it again. They appear in **Setup → Personas** with an
**Activity** of *Teach-back*, and you can edit, clone, disable or delete them like any
other persona.

### The manual way

**Setup → Personas → New Persona.** Tick **"Teach-back audience"**, which prefixes the id
with `audience-`. That prefix is how the system keeps the two activities apart: teach-back
offers only audiences, and case chat never offers them. Set **Visibility: public**.

### The eight starters

They vary *how much it takes to satisfy this listener*. The warmth, the reflecting-back and
the thanks come from the activity itself, so no audience has to carry them — every one of
them is courteous. `{studentName}` is replaced with the student's name at run time.

| Persona ID | Display Name | Description | Instructions |
|---|---|---|---|
| `audience-beginner` | Sam, a curious beginner | Has never studied this topic, and catches on quickly | You are Sam, a curious beginner who has never studied this topic. You catch on quickly: once something is clear, say so plainly and move to the next thing you do not follow. You have no background in this subject and you do not know its jargon. |
| `audience-grandmother` | Your grandmother | Warm and sharp, but has never studied this subject | You are {studentName}'s grandmother. Sharp and genuinely interested, but you have never studied this subject and you do not know any of its jargon. Ask what words mean in everyday terms, and ask how the idea shows up in ordinary life. When something finally clicks, be delighted about it and say which part did it. |
| `audience-classmate` | A classmate who skipped the reading | A friendly peer who needs it in plain terms | You are a classmate in the same course who did not do the reading. You follow plain reasoning easily, but you get lost the moment a term is assumed, and you say exactly where you lost the thread. You are grateful for the help and you say so. |
| `audience-mentee` | A first-year student you mentor | Eager and a little unsure; needs encouragement | You are a first-year student {studentName} is mentoring. Eager but unsure of yourself. Put each idea back in your own words and ask whether you have it right. You are easily encouraged, and you thank {studentName} warmly when something makes sense. |
| `audience-newhire` | A new hire on your team | Practical; wants to know what to actually do | You are a new hire on {studentName}'s team, taking notes. Practical and literal: you notice when a word is doing more work than it can carry, and you ask what a vague phrase means in concrete terms. When you understand, say what you would write down. |
| `audience-muddled` | Someone who mixes up similar ideas | Needs it said more than one way | You are a beginner who mixes up ideas that sound alike. Paraphrase what you were told slightly wrong and ask whether you have it right. You need things put more than one way before they stick. You are good-humoured about your own confusion and appreciative when a second explanation works. |
| `audience-skeptic` | A skeptical colleague | Wants the reasoning, not just the claim | You are a colleague who does not take things on trust. Ask how anyone knows that, and what would happen if it were not so. Never hostile — you genuinely want the reasoning. When you are convinced, concede graciously and say what convinced you. |
| `audience-reporter` | A reporter writing this up | Needs one clear sentence a stranger would get | You are a journalist writing a short piece for general readers. You need each idea in one clear sentence a stranger would understand, and you will ask {studentName} to say it again shorter. When a sentence is finally clean, tell them you are using that one. |

**`audience-beginner` is the one to default to.** It is the neutral starting point — no
relationship to manage, no particular quirk — and it is the same novice Quizzer's EXPLAIN
activity uses. Reach for the others once a class is comfortable with the format.

### Telling the two kinds apart

**Setup → Personas** has an **Activity** column: *Teach-back* (indigo) or *Case chat*
(amber). It is derived from the id — anything beginning `audience-` is a teach-back
audience — so it is never out of step with what students are actually offered. The same
rule is enforced in Chat Options: a teach-back assignment lists only audiences under
**Allowed Audiences**, and a case-chat assignment never lists them.

**Writing your own.** An audience says *who this listener is and how they react* — never
what they know, and never how strictly to mark. That rule is what makes letting students
choose fair: the AI that listens and the AI that marks are two separate calls, and the
marker is never told which audience was chosen. A warm, thankful audience cannot raise a
score, and a sceptical one cannot lower it.

## Step 2 — Add the reading as a case

**Cases → New Case**, then **Case Files** to upload the reading as the case document.

- Leave the **teaching note empty**. Teach-back does not send it.
- Do not bother with arguments for/against. Teach-back does not use them.
- Any PDF/DOCX is fine; the text is extracted once on upload.

## Step 3 — Add one scenario

**Cases → Scenarios → New Scenario.**

| Field | What to put |
|---|---|
| Scenario Name | e.g. "Explain safety stock" |
| Protagonist / Initials | Anything — in teach-back the on-screen name comes from the audience the student picks, so this is only a fallback |
| **Chat Question** | **What the audience needs explained.** A topic, not a decision: "why safety stock rises with demand variability", never "should we raise safety stock" |
| Additional Prompt Instructions | Optional. Anything specific to this topic, e.g. "the student should get as far as the square-root relationship" |
| Chat Time Limit | 20 minutes is a good start (see the table below) |
| Positions | Leave empty |

## Step 4 — Write the rubric (the step that matters most)

**Setup → Rubrics.** The default rubric was written for case chat ("did the student study
the reading", "did they justify their answer from it"), and it does not measure explaining.
Build criteria shaped like teaching:

- **Plain definitions** — did they put the key terms in language a newcomer could follow?
- **The mechanism** — did they explain *why* one thing leads to another, not just that it does?
- **A concrete example** — did they make it picturable?
- **The consequence** — did they say what follows, or what someone should do about it?
- **Answering the confusion** — did they address what the listener actually did not get, and correct its misunderstandings?

Four or five criteria at 5 points each works well. You do not need all of the above.

## Step 5 — Assign it

**Assignments → pick the section → assign the case**, then open **Chat Options** and set:

| Setting | Recommended | Why |
|---|---|---|
| **Activity Mode** | **Teach-back** | This is the switch. Everything else follows from it. |
| **Allowed Audiences** | all eight, or "All enabled" | Students pick; the grade is unaffected either way |
| **Default Audience** | `audience-beginner` | The neutral starting point. `audience-mentee` is the gentlest if your class needs encouraging |
| **Minimum Words (opening)** | 15 | Stops "idk" from burning a chat. Refused before any AI call, so it costs nothing |
| **Hints Allowed / Free Hints** | 1–2 / 1 | Students new to the activity often cannot tell what is being asked. The audience cannot hint about the content — it rephrases its own question |
| **Require Minimum Exchanges** | 4 | Stops a student ending after one turn |
| **Show Case Content** | On, at least for the first run | The audience has read it anyway |
| **Run Evaluation** | On, with Show Evaluation Details on | The coverage strip is the feedback |
| **Show Timer** + **Auto-End on Timeout** | On | The time limit is set on the scenario, and it is your main cost control |
| **Rubric** | your teach-back rubric | Set on the assignment row, next to the case |
| **Allow Finish Button** | On | Lets a student stop when they have said everything they can |

Save. The assignment now carries a **Teach-back** badge wherever it is listed.

## What the student sees

1. They pick their audience on the start screen ("Choose Your Audience").
2. The audience opens by saying it does not understand the topic and asking them to explain.
3. Each turn it reflects their words back, says when something lands and thanks them, then
   asks one question about what still confuses it.
4. When it genuinely understands, it says so and invites them to finish with "time is up".
5. At the end: the score, a two-part summary (*What you explained well* / *What would have
   made it clearer*), and a **coverage strip** showing which rubric criteria they got across,
   with a quote from their own words where the marker found one.

## What you get afterwards

Everything Results already gives you, plus one thing worth knowing about:
**Results → Issue Analytics** reads the transcripts and reports the themes across a whole
section. On a teach-back assignment that answers "what could my class not explain?", which
is usually the most useful thing on the screen.

## Several topics in one assignment

Add several scenarios to the case and set the assignment's **Selection Mode** to *all
required*. The student teaches each topic in turn. No extra setup.

## If something looks wrong

| Symptom | Cause |
|---|---|
| You cannot tell which personas are which | Setup &rarr; Personas, **Activity** column: *Teach-back* or *Case chat* |
| Student is offered "Strict" or "Sycophantic" | The assignment is still in Case chat mode, or Allowed Audiences names case-chat personalities — the panel warns about this |
| "No audience set up yet" on the start screen | No `audience-` personas exist, or none are enabled |
| The audience lectures instead of asking | Check the audience's own instructions — if they grant it knowledge, remove that. It should describe who the listener is, not what they know |
| The audience's name is not the one you expected | In teach-back the name comes from the audience the student picked, not from the scenario's protagonist |
| Feedback is graded oddly | Check you selected your teach-back rubric on the assignment row and not the default one |
