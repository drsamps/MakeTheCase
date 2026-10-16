# Setting Up a Teach-Back Activity: TA Guide

For a teaching assistant who has **edit access to the case**. Everything here is in the
instructor dashboard (Ctrl+click the header, or open `#/admin`). The full reference, with the
reasons behind each setting, is `docs/teach-back-setup.md`.

**In a teach-back activity the roles reverse.** Students don't argue with a case protagonist.
Instead they explain a topic from the reading to an AI *audience* who doesn't understand it yet
(a curious beginner, "your grandmother", a skeptical colleague…). The audience asks questions
until it understands; then the student finishes and gets feedback.

---

## What students will see

Picture this before you start, so you can tell when your setup is right.

**On the start screen** they pick the activity and choose an audience. The choice doesn't affect
their score.

**In the chat**, the first thing they see is an instruction bar (amber, across the full width
of the chat, so it doesn't look like a message), above the first message:

> **Welcome to this "Inventory Basics" activity on: Explain safety stock!**
>
> You'll teach your grandmother about:
> **why safety stock rises with demand variability**
> Grandma has outlived three ordering systems and trusts none of them. Underneath it all, they
> really want to understand it and are eager for you to explain.
>
> **INSTRUCTIONS**
> - You should review the reading on the left before you start, and refer to it throughout the conversation.
> - You can send them up to **6 messages** or use **10 minutes**, whichever comes first.
> - The clock starts when you send your first message.
> - Send at least **2 messages** before you finish.
> - When you think they've got it, click **Finish Chat** (or type "time is up").
>
> **Good luck!**

A *message* is one the student sends; the audience's replies don't count. The counter in the
corner starts at "0 of 6 messages sent".

Then the audience's opening message, in its own voice:

> Hi, Scott! It's Grandma. The store wants me to take over the ordering, and the supplier keeps
> saying "safety stock". Why does it go up when demand bounces around? Will you help me understand?

The bar's wording comes from the settings below. The intro line and the opening are text you
write (with AI help) and approve. Every student who picks the same audience gets the same
opening, with their own name.

---

## Checklist

### 1. Audiences exist: Setup → Personas

Look for rows whose **Activity** column says *Teach-back*. There should be eight starters (Sam,
your grandmother, a classmate who skipped the reading, and so on). If there are none, ask the
instructor; one command creates them.

### 2. The case: Content → Cases

- The case's **Activity type** must be **Teach-back**. It is set when the case is created and
  can't be changed once the case is assigned.
- Upload the reading under **Case Files**. Leave the teaching note empty; teach-back doesn't use it.

### 3. The scenario: Content → Cases → *your case* → Scenarios → Edit (or New Scenario)

| Field | What to put |
|---|---|
| Scenario Name | Shown to students in the bar's heading ("… activity on: **Explain safety stock**"). Keep it short. |
| Chat Question | **The topic, as a phrase, not a question.** Students read "you'll teach … about: *this*". ✅ "why safety stock rises with demand variability" ❌ "Should we raise safety stock?" |
| Additional Prompt Instructions | Optional. **Never shown to students.** Guidance for the AI only, e.g. "the student should get as far as the square-root relationship". |
| **The audience's situation** | Optional, **shown to students**. Why the audience needs this, written to follow "I …": *am about to take over the store's ordering, and the supplier keeps talking about safety stock*. |
| Time Limit (minutes) | E.g. 15–20. 0 = no time limit. |

**Openings & introductions** (the purple box in the same form):

1. Click **Draft with AI**. It writes, for every audience, a playful **intro line** (shown in the
   instruction bar) and an **opening message**. This takes 10–30 seconds.
2. **Read every row.** Edit anything off-tone or wrong. Use **Preview** to see it as a student
   would (with a sample name).
3. Each opening must contain `{studentName}` exactly as written; that is where the student's
   first name goes. The form warns you if it is missing.
4. If one row is weak, click **Redraft** on that row only.
5. Click **Update Scenario** to save. Nothing is saved until you do.

An audience with no opening still works: students get a standard one ("Hi, Scott! I'm your
grandmother, and I am about to take over the store's ordering. To do that, I need to
understand…"). It's fine, just less lively.

### 4. The rubric

Teach-back needs its own rubric (plain definitions, the mechanism, an example, the
consequence…). The default rubric is written for case chat. Check with the instructor which
rubric to select.

### 5. Assign it: Assignments → *your section* → assign the case → Chat Options

| Setting | Suggested | How it shows in the instruction bar |
|---|---|---|
| Allowed Audiences | All, or the ones you drafted | The start-screen choice |
| Default Audience | Sam, a curious beginner | Pre-selected choice |
| **Maximum Responses** | e.g. 6–8 | "You can send them up to **N messages**". It counts only the student's messages. |
| **Require Minimum Exchanges** | e.g. 2–4 | "Send at least **N messages** before you finish" |
| **Auto-End on Timeout** | On | With a time limit: "up to N messages or M minutes, whichever comes first". Off: "Aim to finish in about M minutes" |
| Show Timer | On | The countdown in the corner |
| **Allow Finish Button** | On | "click **Finish Chat** (or type "time is up")" |
| Show Case Content | On | "You should review the reading on the left". Off: "Draw on the reading you studied" |
| Hints Allowed / Free Hints | 1–2 / 1 | (not in the bar) |
| Position Tracking | Off, unless the scenario has positions | If on with *Student selects position*: "The clock starts when you pick your position", and the pick counts as their first message |
| Rubric (on the assignment row) | The teach-back rubric | (not in the bar) |

Save, and make sure the assignment is **Active** with the right open/close dates.

---

## How the length settings read to students

| Maximum Responses | Time limit | Auto-End | The bar says |
|---|---|---|---|
| 6 | 10 min | On | You can send them up to **6 messages** or use **10 minutes**, whichever comes first. |
| 6 | 10 min | Off | You can send them up to **6 messages**. Aim to finish in about **10 minutes**. |
| 6 | none | – | You can send them up to **6 messages**. |
| 0 (none) | 10 min | On | You can take up to **10 minutes**. |
| 0 (none) | 10 min | Off | Aim to finish in about **10 minutes**. |
| 0 (none) | none | – | (no length line) |

If Maximum Responses is set to *ask* at the limit, it adds "…and you can choose to keep going
after that".

---

## Test before class

Ask the instructor for a test student account if you don't have one. Then:

1. Start the activity as the student and pick one audience. Check the bar (heading, topic,
   intro line, length) and the opening (your edited text, with the test name in it).
2. Send one real explanation (at least 15 words). The audience should reply in character and
   remember its situation, and the counter should read "1 of N messages sent".
3. Repeat with a second audience, ideally one you didn't draft, to see the standard opening.
4. Finish the chat and check the feedback screen.

---

## On the day: quick fixes

| What you see | What to do |
|---|---|
| **Draft with AI** fails with "weekly AI usage cap" | Drafting uses the editor's weekly AI allowance. Type the openings yourself, or ask the instructor. |
| Draft fails with "not in the expected format" | Click it again, or use **Redraft** on the empty rows. |
| "The opening … must include {studentName}" when saving | Put `{studentName}` back where the name goes, e.g. "Hi, {studentName}!". |
| An audience shows the standard opening | It has no saved opening (maybe it was added later). Draft that row and save. |
| You edit an opening while students are chatting | Chats already started keep the opening they got; new chats get the new one. |
| The bar says "on the left" but the student's screen is narrow | On narrow screens it says "above", matching where the reading sits. |
| Students are offered "Strict" or "Sycophantic" | The case's Activity type is Case chat, not Teach-back (step 2). |
| "No audience set up yet" on the start screen | No audiences are enabled (step 1). |
| Position buttons don't appear | Position tracking is off, or the scenario has no positions. |
