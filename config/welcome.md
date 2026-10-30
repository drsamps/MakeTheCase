<!--
  Instructor Welcome (Home → Welcome). Editable copy + optional sanitized HTML.
  Full guide: docs/welcome-screen.md
  Floated logo example (place early, before paragraphs you want to wrap):
  <img src="/MTC-student-256x256.jpg" alt="Make The Case" class="hidden sm:block float-right ml-4 mb-4 w-36 h-36 object-contain" />
-->

# Welcome to Make The Case

<img src="/MTC-student-256x256.jpg" alt="Make The Case" class="hidden sm:block float-right ml-4 mb-4 w-36 h-36 object-contain" title="Students learn to weigh the tradeoffs in making difficult decisions." />

**Make The Case** runs *StudyChat activities*: a student studies something, chats with an AI to accomplish a learning goal, and then an AI supervisor reads the conversation and gives feedback and a grade against your rubric. You see the results, and the analytics, before class.

Chatting with an AI-simulated case protagonist is one such activity. It is no longer the only one.

## The activity types

Each case is one activity, and its **activity type** is the rules: who the AI plays, what it is allowed to see, how the chat is graded, and what the student reads. You supply the reading and the scenarios.

- **Case chat** — the student argues a position with the case protagonist, who knows the case and pushes back.
- **Teach-back** — the roles reverse: the AI does *not* understand the reading, and the student has to make them understand it.
- **Debate** — the student argues one side of a question against an opponent who holds the other.
- **Apply** — the student acts as a consultant, applying a concept to a client's new situation.
- **Liken to Me** — the student applies what they studied to their own life, with a reflective mentor.
- **Pitch** — the student pitches an idea to a skeptical investor or buyer, who decides.
- **Role Play** — the student practises a professional conversation with a difficult counterpart.
- **Defend** — the student defends their own submitted work to an AI examiner.

If a type is missing from the picker on **Content → Cases**, it has not been seeded on this server yet; ask your administrator.

## Typical instructor actions

- **Install activities that are already written.** Use cases from the shared library, or import your own.
- **Create new cases using [Case Writer](#/case-writer).** Case Writer is an AI-assisted authoring tool that turns a teaching principle and source material into a published case and scenario.
- **Choose the activity type** when you create the case. It is fixed once the case is assigned, so to run a second activity on the same reading, make a **Copy** of the case.
- **Set up the scenarios students will address.** A *scenario* defines the situation a student engages with — the AI's character, the question they must answer, and optionally the positions they can take and the *touchpoints* you want to know whether they raised.
- **Set the chat options**, including:
  - the scenarios that will be used
  - the personality or audience of the conversation (chatbot personas)
  - how many messages students may send, and the minimum before they may finish
  - whether and how many hints are available
  - whether students see the reading
  - whether their work is evaluated automatically
- **Assign the activity to students** in your course sections.
- **Evaluate the results** in preparation for class discussion — review transcripts, evaluations, student positions and touchpoint coverage.

## Where to start (menu items above)

- **Setup → Personas** lets you preview and customize the AI personalities, both protagonists and teach-back audiences.
- **Setup → Rubrics** is where the criteria your activities are graded against live.
- **Content → Cases** is where cases, their activity type and their case files live.
- **Courses → Sections** is where you organize semesters, courses, and student rosters.
- **Assignments** is where you publish an activity to a section with specific options.
- **Monitor** lets you follow chats live and see student progress.
- **Results** lets you review completed chats, evaluations and analytics.

Administrators will also see **Admin → Activity Types**, where new activity types are authored. A full guide to designing activities is in the project documentation at `docs/studychat-guide.md`.

When you're ready to see what's happening right now, switch to the **Dashboard** sub-tab above.
