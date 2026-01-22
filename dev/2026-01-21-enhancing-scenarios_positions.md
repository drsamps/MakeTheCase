## Enhancing scenarios

Originally each case had the scenario details stored in the “cases” data table fields: protagonist, protagonist\_initials, chat\_topic, chat\_question. Then we decided it would be better to allow multiple scenarios, which are stored in the “case\_scenarios” data table. This makes storing scenario details in the “cases” table redundant. It would be better to only keep case scenario details in the “case\_scenarios” data table and perhaps identify one of the case\_scenarios for a given record as the base scenario in the cases table (maybe in a “base\_scenario\_id” or some other pointer).

The “Instructor Dashboard” Content \- Cases tab lists the cases and allows adding new cases.  
The cases table should only contain:

* case\_id  
* case\_title  
* case\_version:varchar(10) \- a new column that optionally indicates “the year of the case or version”  
* created\_at  
* enabled

The “Business Cases” list should be titled “Installed Cases” and include the following columns:

* Title (no need to show case\_id in this list)  
* Version (case\_version0  
* Status (Enabled or Disabled, with mouseover “click to enable/disable”)  
* Scenarios, that shows scenarios\_name in the format: 1\. first scenario\_name\<br\>2. second scenario\_name\<br\>3. third scenario\_name\<br\>etc.  If there are no scenarios defined indicate “no scenarios defined” and the user can click “Scenarios” to define scenarios for that case. Scenario\_name can be long, so only show the first 20 characters with “...” and mouseover to see the full name.

The “+ New Case” button should continue to open the “Create New Case” popup but only ask for 

* case\_id same \- required  
* case\_title same \- required  
* case\_version (with label “version (such as the year of the case)”)  
* enabled same \- checkbox  
* same “Cancel” button  
* the blue “Create Case and go to Scenarios” which creates the case but instead of returning to the list it goes to the Scenarios popup for that case, so that the user can define a scenario.

Then we are going to change Scenarios to make them more useful.  Currently each scenario has a chat\_question with two positions: for and against, with arguments\_for and arguments\_against specified. We need the ability to have more than two positions that can be instructor specified. On the “New Scenario” (same as “Edit Scenario”) screen we still ask for:

* Scenario Name  
* Enabled  
* Protagonist Name  
* Initials  
* Role/Title  
* Chat Topic  
* Chat Question  
* Time Limit  
* Warning Time  
* a list of defined positions (showing position\_order, position\_name,position\_enabled and edit/delete buttons  
* a button to “Define a possible student position on this Chat Question” with a note “Defining positions is optional, but necessary if you want to track student positions on the chat question”

If the instructor/user edits or enters a new position a “Define Position” window will pop up with arguments\_for and arguments\_against, stored in a new **scenario\_positions** data table with fields:

1. position\_id  
2. scenario\_id (key pointing to the case\_scenarios data table, renamed from “id” to “scenario\_id”)  
3. position\_name:varchar(100) \- a name given to the position (such as “agree” or “disagree”)  
4. position:varchar(255) \- the position description that might be presented to the student to choose from (such as “I recommend you close the factory” or “I recommend your remodel the factory”)  
5. position\_order:int \- number for the order in which the positions are presented in the list and to the students  
6. arguments\_for:text \- arguments for this position that will be used in the chatbot prompt to help guide the chat with the student  
7. arguments\_against:text \- arguments against this position that will be used in the chatbot prompt  
8. position\_enabled \- boolean (tinyint(1)) whether this position is available (default enabled)

As you can see, the arguments\_for and arguments\_against field have been moved out of the “case\_scenarios” data table and into the “scenario\_positions” data table. All cases should have at least one scenario before assigned to the students, but case scenarios only need to have positions if the instructor wants to do position tracking (which is now to be moved to the Assignments screen).

It would be nice to have a convenient way to specify and change the order of positions (like drag and drop if that is easily done, otherwise some other method).

Previously, position tracking was specified when the instructor was defining a Scenario (an “Enable position tracking for this scenario” checkbox) but now position tracking will be enabled or disabled when the instructor is Assigning a case to a course section.

If the instructor does elect to do position tracking when Assigning a case to a course section, the various positions are presented to the student **after** the student selects a given case scenario and is given the Chat Question by the simulated protagonist. (Currently the student is asked for the position on the “Welcome…” screen just after login, which is too early.)

## Case Assignments

In the “Case Assignments” screen the instructor can “+ Assign case to this section…” or can modify the assigned cases. Currently, there is a checkbox for “Enable scenarios for this section-case” which should be selected by default since without a scenario the chatbot has nothing in particular to chat about. Un-checking that “Enable…” box should warn “Without a scenario the chat will not have a topic to discuss” implying that the chat with the student will start with something like “What about this case do you want to talk about?”.

If there is only one scenario, the “Selection Mode” should be a “Only one scenario” option that the instructor cannot change. and it should list that scenario.  
If there is more than one scenario defined for that case the scenarios should be listed with checkboxes (as currently done) followed by the “Selection Mode” radio buttons (not drop-down) if more than one scenario is selected (otherwise “Only one scenario selected”).

If there are positions defined for a given case scenario, the positions should be listed under the scenario (position\_order, position\_name, position\_enabled clickable, “view/edit details” button to display/edit the position using the “Define Position” window described above. At this point if the instructor wants to add a new position to the scenario they might be advised to go to the “Edit Scenario” screen described above. Below the list of positions is where the admin instructor is given the “Enable position tracking checkbox” with “Capture Method” options. Instead of typing “Position Options” it will just use all positions enabled from the list the default being all enabled positions in the list, but maybe let the instructor override which positions to allow just for this case assignment to a section (with other positions available to other sections). And we retain the “Track if position changes during chat” here on the Case Assignment screen (not on the “Manage Scenarios” screen).

## Functions of these changes

The above defined improvements to managing scenarios and positions should impact how the chat with the students is managed through prompting. Include some description of how the selecting of scenarios and position tracking would be implemented in the student experience engaging in a case chat.

Does all of this make sense?  Provide any other good suggestions about how to improve scenario and position management, appending the suggestions to this markdown file.

---

## Implementation Plan (2026-01-21)

### Core Database Changes

1. **New `scenario_positions` table** with fields: position_id, scenario_id, position_name, position (description), position_order, arguments_for, arguments_against, position_enabled

2. **Modified `cases` table:** Add case_version VARCHAR(10), base_scenario_id INT

3. **Modified `section_cases` table:** Add position_tracking_enabled, position_capture_method, track_position_change (moved from scenario-level)

4. **New `section_case_positions` junction table** for per-assignment position overrides

5. **Modified `case_chats` table:** Add initial_position_id, final_position_id (FKs to scenario_positions)

### Migration Strategy

- Existing scenarios with arguments_for/against will NOT auto-create positions
- Instructors will be prompted to define positions manually
- Position tracking settings will be migrated from scenario chat_options_override to section_cases table
- Existing case_chats position text values preserved; new FK columns added for future use

### Core UI Implementation

1. **Cases Tab ("Installed Cases"):** Title, Version, Status, Scenarios columns
2. **Create Case Modal:** Simplified to case_id, case_title, case_version, enabled; "Create Case and go to Scenarios" button
3. **Scenario Manager:** Adds positions list with drag-and-drop reordering, "Define Position" popup
4. **Assignments Tab:** Positions listed under each scenario with enable/disable toggles; position tracking settings moved here

### Student Experience

Position selection happens AFTER scenario selection and viewing the chat question:
1. Student selects scenario (if multiple)
2. Student sees protagonist's chat question
3. Student clicks "Start Chat"
4. Position selection modal appears (if tracking enabled)
5. Student selects position
6. Chat begins

---

## Additional Features

### 1. Position Templates

**Database:** New `position_templates` and `position_template_items` tables with system templates seeded:
- Agree/Disagree
- Support/Oppose
- Yes/No/Undecided
- Strong/Weak Support (4-level scale)

**UI:** "Apply Template" dropdown in Scenario Manager that populates positions from selected template. Instructors can also create custom templates.

**API:**
- `GET /api/position-templates` - List all templates
- `POST /api/cases/:caseId/scenarios/:scenarioId/apply-template/:templateId` - Apply template

### 2. AI Position Detection

For `ai_inferred` capture method, enhance the AI system prompt to track student positions throughout conversation.

**Database:** Add columns to case_chats: position_inferred_at, position_inference_confidence, position_inference_reasoning

**Service:** `server/services/positionInference.js` - Called automatically when chat completes with `ai_inferred` method. Analyzes transcript and updates position fields.

**Prompt Enhancement:** Include position options and their descriptions in system prompt, instructing AI to identify student's implicit position based on arguments made.

### 3. Bulk Position Management

**Copy Positions:** Allow copying positions from one scenario to another:
- "Copy from Scenario" dropdown in ScenarioManager
- Option to include or exclude arguments_for/against
- Bulk operations for copying to multiple scenarios

**API:**
- `POST /api/cases/:caseId/scenarios/:scenarioId/copy-positions` - Copy from another scenario
- `POST /api/cases/:caseId/bulk-copy-positions` - Copy to multiple scenarios

### 4. Position Analytics Dashboard

New "Position Analytics" tab in Dashboard showing:

**Summary Metrics:**
- Total chats with positions
- Position change rate

**Distribution Charts:**
- Initial vs Final position distribution (bar chart)
- Net change per position

**Change Matrix:**
- From/To table showing position transitions

**Correlation Analysis:**
- Average evaluation score by position
- Score comparison: changed vs unchanged positions

**Student Details Table:**
- Sortable list: Student, Initial Position, Final Position, Changed, Score

**API:**
- `GET /api/analytics/positions` - Summary and distribution data
- `GET /api/analytics/positions/correlation` - Score correlations

### 5. Position-Based Chat Prompts

Enhance AI chat by including student's selected position in system prompt:

**When student selects a position, AI receives:**
- The student's stated position
- Arguments FOR that position (to acknowledge valid points)
- Arguments AGAINST that position (to challenge with)

**Interaction Guidelines:**
- Acknowledge strong arguments aligned with position
- Challenge with counter-arguments
- Probe weaknesses without simply agreeing/disagreeing

This makes chats more tailored and challenging based on the student's stated position.

---

## Implementation Phases

### Phase 1: Database & Core API
- scenario_positions table, section_case_positions table
- Position CRUD endpoints
- Assignment-level position settings

### Phase 2: Position Templates
- Template tables and seed data
- Template API and UI integration

### Phase 3: Admin UI - Cases & Scenarios
- "Installed Cases" tab with new columns
- ScenarioManager with positions list (drag-drop)
- PositionEditor component

### Phase 4: Admin UI - Assignments
- Position tracking settings
- Per-assignment position toggles

### Phase 5: Student Experience
- Position selection after chat question
- Position-based prompt building

### Phase 6: AI Position Inference
- Inference service
- Auto-trigger on chat completion

### Phase 7: Position Analytics
- Analytics API
- PositionAnalytics dashboard component

---

## Critical Files

**Migrations:**
- 014_scenario_positions.sql
- 015_migrate_position_settings.sql
- 016_position_templates.sql
- 017_position_analytics_views.sql

**API Routes:**
- server/routes/scenarioPositions.js (new)
- server/routes/sectionCases.js (modified)
- server/routes/analytics.js (modified)
- server/routes/caseChats.js (modified)

**Services:**
- server/services/positionInference.js (new)
- server/services/llmRouter.js (modified)

**Components:**
- components/Dashboard.tsx (modified)
- components/ScenarioManager.tsx (modified)
- components/PositionEditor.tsx (new)
- components/PositionAnalytics.tsx (new)
- App.tsx (modified)

