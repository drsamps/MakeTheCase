# MakeTheCase WORKFLOWS

Relevant data files for each step are listed in \[brackets\].

# Instructor workflows

## Setting up a case

The instructor might set up a case once and use it for multiple course sections across multiple semesters.

1. Instructor logs in to the “Instructor Dashboard”  
2. Instructor creates a new case \[cases\]  
3. Instructor uploads case documents, such as the case and a teaching note, possibly converting from PDF to plain text or markdown \[case\_files\]. The case files are stored in the “cases/{case\_id}” directory.  
4. (optional) Instructor can use the “AI Case Prep” tools to create a detailed outline of any or all case documents \[case\_files\].  
5. Instructor selects which case documents to include in the prompt \[case\_files.include\_in\_chat\_prompt\]  
6. Instructor defines a scenario \[case scenarios\] including the AI simulated protagonist students will chat with and the question to be addressed by the students.  
7. If desired, instructor can define positions the student might take in their response to the chat question \[scenario positions\]. Standard types of positions can be selected if desired \[position templates\].

## Setting up a course section

This typically happens at the beginning of a semester.

1. Instructor logs into the “Instructor Dashboard”  
2. Instructor creates a course section \[sections\].  
3. Instructor sets the course to “Accept” new students so that student can log in and register as being in that course section.  
4. When students first log in to the app they are asked to indicate which course section they are in, which is stored with student information \[students\].

## Setting up chat options

1. Instructor logs into the “Instructor Dashboard”  
2. Instructor can set default chat options for all course sections, for all cases assigned to a specific course section, or for a specific case assigned to a specific course section.  
3. The chat options indicate how the chat conversation between an AI simulated protagonist and a student operates.

## Assigning a case to a section

1. Instructor logs into the “Instructor Dashboard”  
2. Instructor selects a course section (“Case Assignments”).  
3. Instructor selects which case to assign to the course section (“+ Assign a case to this section”)  
4. (optional) Instructor schedules the case for a specific day-time range.  
5. (optional) Instructor can adjust the “Chat Options” for the specific case assigned to the course section.

# Student workflow

## Student engaging in a Case Chat

1. Student logs in to the case chat tool (MakeTheCase).  
2. The first time the student logs in, the student will need to indicate which of the “Accept” new students sections the student is in.  
3. Student selects from the currently enabled cases and scenarios.  
4. Student optionally selects a chatbot persona, if the instructor has enabled multiple personas \[personas\].  
5. Student engages in a chat with the AI-simulated protagonist…  
   1. The simulated protagonist welcomes the student and asks the scenario question \[case\_scenarios\]  
   2. If the instructor enabled position tracking for this case, with “Position Capture Method” of “Student selects position” the chatbot provides the student with buttons for each of the defined and enabled positions \[scenario\_positions\] and the student must select one of the positions. Otherwise, the student simply responds to the scenario question. If position tracking is “AI infers from conversation” then an AI model determines which of the defined positions the student indicated. If the student waffles or is vague in their answer to the scenario question, the simulated protagonist asks the student to more clearly take a position.  
   3. The simulated protagonist asks questions to have the student defend their position based on information from the case files included in the prompt.  
   4. This interaction between the student and the simulated protagonist continue until the simulated protagonist is satisfied with the students arguments, or until time is up (a case “Chat Option”), or until the student indicates “time is up”.  
6. If the instructor set the “Chat Option” to “Ask for feedback at end of chat” then the student is asked for feedback.  
7. If the instructor set the “Chat Option” to “Ask to save anonymized transcript” then the student is asked about saving the transcript and saves the transcript.  
8. If the instructor set the “Chat Option” to “Run evaluation after chat” then the student is given a button that has the AI supervisor generate feedback based on the chat transcript, stores the evaluation \[evaluations\], and reports the evaluation to the student.  
9. Student can then log out or return to the “Welcome…” screen to choose a different case scenario.

## Instructor monitoring chat progress

During and after the students engage in a case chat, the instructor needs to monitor the student progress and in some cases track the positions they take on the scenarios. In addition, the instructor needs to see reports about how the students did on the assigned case chats in order to assess student critical thinking and in some cases to determine a grade for the assignment.

# Suggestions for reorganizing the app to facilitate these workflows more simply.

*Analysis date: January 2026*

## Part 1: Workflow Improvement Suggestions

### 1.1 Case Setup Workflow - Add Guided Setup

**Current friction:** Instructors must navigate between multiple tabs (Content → Cases, Content → Case Files, Content → Case Prep) to complete case setup. The relationship between cases, scenarios, and positions isn't immediately clear.

**Suggestion:** Add a "Case Setup Wizard" that guides instructors through the complete setup:
1. Create case (name, description)
2. Upload documents (with immediate conversion preview)
3. Select documents for prompt inclusion
4. Create scenario(s) with protagonist and question
5. Define positions (with templates available)
6. Summary/review screen

This keeps the existing modular approach but adds an optional guided path for new users.

### 1.2 Case Setup Workflow - Clarify Document Selection

**Current friction:** Step 5 mentions selecting which case documents to include in the prompt, but the relationship between uploaded files and what the AI "sees" isn't always obvious.

**Suggestion:**
- Add visual indicators on the Case Files screen showing which files are included in the chat prompt vs. teaching note vs. evaluation
- Consider a dedicated "Prompt Builder" view that shows instructors exactly what content will be sent to the AI

### 1.3 Course Section Workflow - Streamline Student Enrollment

**Current friction:** The workflow mentions students self-enrolling when they first log in, but the process of finding/selecting from "Accept" sections could be confusing if there are many sections.

**Suggestions:**
- Add section search/filter by instructor name or course code
- Allow instructors to generate enrollment links/codes that pre-select the section
- Show section enrollment status on the instructor's Courses tab (e.g., "15/30 students enrolled")

### 1.4 Chat Options Workflow - Clarify Inheritance Hierarchy

**Current friction:** Chat options can be set at three levels (default, section-level, assignment-level) but it's not always clear which settings apply and where they come from.

**Suggestions:**
- Add visual indication of inherited vs. overridden settings (e.g., italicize inherited values)
- Show "Inherited from: [source]" next to each option
- Add a "Reset to default" button for overridden options
- Consider a "Preview effective options" mode that shows what students will experience

### 1.5 Case Assignment Workflow - Improve Scheduling UX

**Current friction:** Scheduling is mentioned as optional but the relationship between open_date, close_date, and manual_status isn't always clear.

**Suggestions:**
- Add a visual timeline/calendar showing when cases are available for each section
- Add "Open now" and "Close now" quick actions
- Show countdown or status badge on student view ("Opens in 2 hours" or "Closes in 30 minutes")

### 1.6 Student Workflow - Clarify Position Tracking Modes

**Current friction:** The workflow describes multiple position capture methods (Student selects, AI infers, etc.) but students may not understand what mode is active or what's expected.

**Suggestions:**
- Add brief contextual help when position tracking is active ("Your instructor has asked you to take a clear position on this question")
- For AI-inferred mode, consider showing the inferred position to the student after a few exchanges with option to confirm/correct
- Add visual indicator of current position during chat (if explicit selection was made)

### 1.7 Student Workflow - Improve Case Availability Feedback

**Current friction:** When a case isn't available (wrong date, already completed, etc.), students may not understand why.

**Suggestions:**
- Show upcoming cases with "Opens [date]" messaging
- Show completed cases with completion status and option to review (if enabled)
- If repeats are disabled, show clear message explaining why case isn't available

### 1.8 Instructor Monitoring Workflow - Real-Time Progress Dashboard

**Current friction:** The Monitor tab shows chat history but doesn't provide a live "classroom" view during an in-class case session. Instructors need to piece together information from multiple screens.

**Suggestions:**
- **Live Session View**: Add a "Live Monitor" mode showing real-time status of all students in a section during an active case:
  - Student name | Status (not started / chatting / completed) | Duration | Position taken | Evaluation score
  - Auto-refresh every 30 seconds or live WebSocket updates
  - Color-coded rows (green = completed, yellow = in progress, red = not started or abandoned)

- **Quick Completion Stats**: Show summary bar at top: "15/30 completed • 10 in progress • 5 not started"

- **Alert System**: Optional alerts for:
  - Students who haven't started after X minutes
  - Students who appear stuck (no messages for extended period)
  - Chats that exceed expected duration

- **Position Distribution Live View**: If position tracking is enabled, show live pie chart or bar graph of position selections updating as students complete

### 1.9 Instructor Monitoring Workflow - Results and Grading

**Current friction:** Results are available in the Results tab, but connecting evaluations to grades and exporting for LMS integration requires manual work.

**Suggestions:**
- **Grading Integration**:
  - Add optional "Points" field to case assignments
  - Map evaluation scores to point values (configurable rubric)
  - Export grades in CSV format compatible with common LMS systems (Canvas, Blackboard)

- **Batch Review Mode**:
  - View evaluations in sequence with "Previous/Next" navigation
  - Quick approve/adjust scores
  - Add instructor notes per student

- **Aggregate Reports**:
  - Class average scores by evaluation criteria
  - Score distribution histogram
  - Position vs. score correlation (do certain positions correlate with better arguments?)
  - Comparison across sections (if same case assigned to multiple sections)

- **Individual Student Drill-Down**:
  - View all of a student's chats across cases
  - Track improvement over semester
  - Export individual student report (for advising or grade disputes)

### 1.10 Instructor Monitoring Workflow - Transcript Review

**Current friction:** Instructors may want to review chat transcripts for quality assurance, identifying common misconceptions, or finding exemplary student work.

**Suggestions:**
- **Transcript Browser**:
  - Filter by case, section, date range, position taken, evaluation score
  - Search within transcripts for keywords
  - Mark transcripts as "exemplary" or "needs review"

- **Anonymized Transcript Library**:
  - Collect anonymized transcripts for future teaching use
  - Categorize by case and position
  - Use as examples in class or for training future AI models

- **Common Themes Analysis**:
  - AI-assisted summary of common arguments students made
  - Identify misconceptions that appeared frequently
  - Suggest case document or scenario adjustments based on student confusion patterns

---

## Part 2: App Reorganization Suggestions

### 2.1 Align Navigation Terminology with Workflow Language

**Current state:** Dashboard uses tabs like "Content" and "Courses" with sub-tabs, but the workflow documentation uses terms like "Case Assignments" which maps to Courses → Assignments.

**Suggestion:** Review all navigation labels and align with workflow terminology:
- "Content" tab could be renamed "Case Library" or keep "Content" but ensure sub-tabs match workflow
- Ensure help text and tooltips reference the same terms used in workflows

### 2.2 Consolidate the Dual Tab System

**Current state:** Dashboard.tsx uses both `primaryTab` (home/courses/content/monitor/results/admin) and legacy `activeTab` systems, creating confusion in the codebase.

**Suggestion:** Migrate fully to the primaryTab/subTab pattern and remove legacy activeTab references. This simplifies code and URL routing.

### 2.3 Reorganize Case Files Location

**Current state:** Case documents are stored both in the database (`case_files` table) and filesystem (`case_files/{case_id}/`). This dual storage can lead to sync issues.

**Suggestions:**
- Option A: Make filesystem authoritative, use database only for metadata
- Option B: Make database authoritative, use filesystem only for serving
- Add automatic sync/reconciliation and show warnings for inconsistencies

### 2.4 Consolidate Analytics and Results

**Current state:** Analytics data is spread across multiple components (Analytics.tsx, PositionAnalytics.tsx) and API routes (/api/analytics, /api/llm-metrics).

**Suggestion:** Create unified Results/Analytics experience:
- Single "Results" tab with sub-views for: Student Responses, Position Analysis, Cost/Usage Metrics
- Unified filtering (by section, case, date range) that applies across all views
- Consider downloadable reports (CSV/PDF)

### 2.5 Simplify Position Management

**Current state:** Positions are managed at the scenario level, but can be overridden per section-case assignment. The data model has evolved through multiple migrations creating complexity.

**Suggestions:**
- Add clear UI for "position overrides" per assignment (show inherited vs. custom)
- Consider deprecating per-assignment position overrides if rarely used, OR make it a prominent feature with clear UI
- Document which fields in scenario_positions vs section_case_positions are canonical

### 2.6 Create Instructor Onboarding Flow

**Current state:** New instructors must figure out the app through exploration.

**Suggestion:** Add first-time instructor experience:
- Show "Getting Started" checklist on Dashboard Home
- Link to quick-start guide for each major task
- Consider in-app tooltips for key features (dismissible, one-time)

### 2.7 Separate Teaching Note from Case Files

**Current state:** Teaching notes are stored in case_files alongside student-visible documents, differentiated by include_in_chat_prompt and other flags.

**Suggestion:** Consider dedicated teaching_notes table or explicit teaching_note_id on cases table to make the distinction clearer in both UI and data model.

### 2.8 Improve Scenario-Position Visual Hierarchy

**Current state:** In ScenarioManager, scenarios and their positions are shown, but the hierarchy (Case → Scenario → Positions) could be clearer.

**Suggestion:** Use visual nesting or tree view to show:
```
Case: [Case Name]
├── Scenario 1: [Protagonist] - [Question]
│   ├── Position A
│   ├── Position B
│   └── Position C
└── Scenario 2: [Different setup]
    └── ...
```

### 2.9 Add "Clone/Copy" Features

**Current state:** Instructors must manually recreate cases, scenarios, and settings for new semesters.

**Suggestions:**
- "Clone Case" - copies case with all scenarios and positions
- "Clone Section" - copies section settings and case assignments to new semester
- "Copy Chat Options" - already exists (bulk-copy), but make more discoverable

### 2.10 Simplify Model Selection

**Current state:** Models can be set at system default, section-level, and potentially elsewhere. The precedence isn't always clear.

**Suggestions:**
- Document model selection hierarchy clearly in UI
- Show "Using model: [model_name] (from: section settings)" to make source clear
- Consider removing model selection from sections if it's rarely used differently per-section

---

## Part 3: Technical Debt / Schema Suggestions

### 3.1 Remove Deprecated Fields

**Current state:** Multiple migrations have added and removed fields, leaving some ambiguity about which fields are canonical.

**Suggestion:** Audit schema for:
- Columns that are always NULL (can be dropped)
- Redundant columns from pre-migration state
- Document canonical vs. deprecated fields in CLAUDE.md

### 3.2 Standardize JSON Configuration Storage

**Current state:** chat_options stored as JSON in section_cases. This works but makes querying and validation harder.

**Suggestions:**
- Consider TypeScript validation for chat_options JSON shape
- Document all possible chat_options fields in one place (currently in schema route)
- Ensure defaults are applied consistently

### 3.3 Clarify Student Multi-Section Support

**Current state:** Students have both a primary `section_id` and can appear in `student_sections` junction table for multiple sections.

**Suggestion:** Decide on one pattern:
- If students can be in multiple sections: make student_sections authoritative, deprecate students.section_id
- If students are in one section: remove student_sections table or document its use case clearly

---

## Priority Ranking (by user impact)

**High Impact:**
1. Live Session Monitor for real-time progress tracking (1.8)
2. Results and Grading integration with LMS export (1.9)
3. Chat Options inheritance visualization (1.4)
4. Case Setup Wizard (1.1)

**Medium Impact:**
5. Instructor onboarding flow (2.6)
6. Navigation terminology alignment (2.1)
7. Case availability feedback for students (1.7)
8. Position tracking mode clarification (1.6)
9. Clone/copy features (2.9)
10. Transcript review and search (1.10)

**Lower Priority (Technical):**
11. Analytics consolidation (2.4)
12. Dual tab system consolidation (2.2)
13. Case files location reorganization (2.3)
14. Schema cleanup (3.1-3.3)

============= RESULTS =====================

Yes, Phase 2 is complete. Here's a summary of all changes made:

  UI Changes:
  - Removed separate "Positions" button from case assignment button row
  - Renamed "Scenarios" button → "Scenarios and Positions"
  - Renamed "Selection Mode" → "Scenario Selection Mode"
  - Removed duplicate position display (was showing under each scenario AND in Position Tracking)
  - Consolidated Position Tracking Settings into the Scenarios panel
  - Changed terminology from "on/off" → "Available/Disabled" with tooltips
  - Added drag-and-drop reordering for positions (with drag handle)

  Backend Changes:
  - Added PATCH /api/sections/:sectionId/cases/:caseId/positions/reorder endpoint
  - Updated GET positions endpoint to include and use sort_order from section_case_positions

  Bug Fixes:
  - Fixed position toggle not working (JavaScript strict equality issue with MySQL 0/1 values)
  - Added type="button" to prevent form submission issues
  - Used Boolean() for proper truthy/falsy evaluation of enabled state

  Files Modified:
  - components/Dashboard.tsx - Main UI changes, SortablePositionItem component, dnd-kit integration
  - server/routes/sectionCases.js - New reorder endpoint, updated GET positions query
