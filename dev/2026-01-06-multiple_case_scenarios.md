## Multiple case scenarios proposal

I have come to realize that a given case can have multiple chat scenarios, each potentially involving a different protagonist, chat topic, and chat question. That information was stored in the “cases” data table, but needs to be split out into a separate “case\_scenarios” data table that links to a given case. The “case\_scenarios” data table might have columns for (some of which override “cases” values):

* case\_id (the case this scenario has to do with)  
* protagonist  
* protagonist\_initials  
* protagonist\_role:varchar(200) \- the protagonist’s position, such as “CEO of Malawi’s Pizza”  
* chat\_topic  
* chat\_question  
* chat\_options:json \- a list of chat options to potentially override the chat\_options set with the case (in the “section\_cases” file  
* chat\_time\_limit \- the maximum amount of time students are allowed to chat with the case (probably in minutes) (or 0 for unlimited time)  
* chat\_time\_warning \- the time in which to warn the student that the chat is about to conclude  
* arguments\_for:text \- a list of arguments in favor of the topic of the question  
* arguments\_against:text \- a list of arguments against the topic of the question  
* enabled \- whether this scenario is available to be assigned to a course

With case\_scenarios, the admin instructor will first set up a case (with teaching note) and default values then define case scenarios that might use the case default values or other values. Then the admin instructor can assign cases to course sections, indicating which of the case scenarios to make available to the students. The admin instructor can indicate if the students can choose a case scenario to chat with or if they need to complete each of the assigned case scenarios for that case. Be sure and make this reasonable and logical for both the student workflow and the admin instructor workflow.

Note that this change will require implementing a timing system to potentially limit the duration of the chats and let students know how much time they have remaining in a way that is subtle and not annoying.

Develop a plan then after implementation append a summary of the changes onto the end of this "2026-01-06-multiple\_case\_scenarios.md" file.

---

## Implementation Summary (Completed 2026-01-07)

### Database Changes

**New Tables:**
- `case_scenarios` - Stores scenario definitions with columns: id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role, chat_topic, chat_question, chat_time_limit, chat_time_warning, arguments_for, arguments_against, chat_options_override, sort_order, enabled, created_at, updated_at
- `section_case_scenarios` - Junction table for assigning scenarios to section-cases: id, section_case_id, scenario_id, enabled, sort_order, created_at

**Modified Tables:**
- `section_cases` - Added columns: use_scenarios (boolean), selection_mode (enum: 'student_choice', 'all_required'), require_order (boolean)
- `case_chats` - Added columns: scenario_id (FK to case_scenarios), time_limit_minutes, time_started

**Data Migration:**
- Auto-created default scenarios from existing case data (protagonist, question, etc.)

### API Endpoints

**New Routes (`server/routes/scenarios.js`):**
- `GET /api/cases/:caseId/scenarios` - List scenarios for a case
- `GET /api/cases/:caseId/scenarios/:id` - Get single scenario
- `POST /api/cases/:caseId/scenarios` - Create scenario (admin)
- `PATCH /api/cases/:caseId/scenarios/:id` - Update scenario (admin)
- `DELETE /api/cases/:caseId/scenarios/:id` - Delete scenario (admin)
- `PATCH /api/cases/:caseId/scenarios/reorder` - Reorder scenarios (admin)
- `PATCH /api/cases/:caseId/scenarios/:id/toggle` - Enable/disable scenario

**Extended `server/routes/sectionCases.js`:**
- `GET /api/sections/:sectionId/cases/:caseId/scenarios` - List assigned scenarios
- `POST /api/sections/:sectionId/cases/:caseId/scenarios` - Assign scenarios
- `DELETE /api/sections/:sectionId/cases/:caseId/scenarios/:scenarioId` - Remove scenario
- `PATCH /api/sections/:sectionId/cases/:caseId/selection-mode` - Update mode settings
- `PATCH /api/sections/:sectionId/cases/:caseId/scenarios/reorder` - Reorder assigned scenarios
- Active-case endpoint updated to include scenarios with completion status

**Extended `server/routes/caseChats.js`:**
- POST now accepts `scenario_id` and sets `time_limit_minutes` from scenario
- `POST /api/case-chats/:id/start-timer` - Start timer on first message
- `GET /api/case-chats/:id/time-remaining` - Get remaining time
- `GET /api/case-chats/check-scenario-completion/:studentId/:caseId` - Check scenario completions

### Frontend Components

**New Components:**
- `components/ScenarioManager.tsx` - Admin modal for managing scenarios per case (CRUD, reorder, enable/disable)
- `components/ScenarioSelector.tsx` - Student UI for selecting scenarios (supports student_choice and all_required modes with optional order requirement)
- `components/ChatTimer.tsx` - Subtle countdown timer with color changes at warning threshold

**Modified Components:**
- `components/Dashboard.tsx` - Added "Scenarios" button in Cases tab, integrated ScenarioManager modal
- `App.tsx` - Added scenario state management, ScenarioSelector integration in pre-chat UI, ChatTimer integration in chat interface

### Prompt Building (`constants.ts`)

- Extended `CaseData` interface with `protagonist_role`, `arguments_for`, `arguments_against`
- Updated `buildSystemPrompt` to include argument framework in AI prompt cache (not shown to students)
- Arguments guide AI to provide challenging questions and counter-arguments

### Key Features

1. **Scenario Management**: Admins can create multiple scenarios per case with different protagonists, questions, and timing
2. **Flexible Assignment**: Admins assign which scenarios are available per section-case
3. **Selection Modes**:
   - `student_choice` - Students pick which scenario to chat with
   - `all_required` - Students must complete all assigned scenarios (optional order requirement)
4. **Timer System**: Server-enforced timing with client-side countdown display, auto-submits "time is up" when timer expires
5. **Argument Framework**: Hidden arguments_for/against improve AI response quality through prompt caching

### Files Modified/Created

| File | Change |
|------|--------|
| `server/migrations/005_add_case_scenarios.sql` | New migration file |
| `server/scripts/run-migration-005.js` | Migration runner script |
| `server/routes/scenarios.js` | New API routes |
| `server/routes/sectionCases.js` | Extended with scenario endpoints |
| `server/routes/caseChats.js` | Timer endpoints, scenario support |
| `server/index.js` | Registered new routes |
| `components/ScenarioManager.tsx` | New admin component |
| `components/ScenarioSelector.tsx` | New student component |
| `components/ChatTimer.tsx` | New timer component |
| `components/Dashboard.tsx` | ScenarioManager integration |
| `App.tsx` | Scenario selection flow, timer integration |
| `constants.ts` | Prompt building with arguments |
| `types.ts` | New TypeScript interfaces |