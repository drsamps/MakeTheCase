## Streamline Results section of Instructor Dashboard

The Courses \- Sections ("Course Sections") screen lists the sections and lets the instructor add/enable/edit/duplicate/delete sections, which is great. When you click on a section title it displays results for the section (including stats and a beautiful histogram) which is great and a carryover from the early version of this app that only had one case. Now that we have a more organized Instructor Dashboard, it seems that that section results report should instead show up under the "Results" tab "Sections" subheading. Currently that Results Sections screen displays the list of "All Sections Performance" and if you click on a section title it reverts back to that wonderful report under Courses \- Sections list but the wonderful report should be in the Results Sections tab.  
That "Results" tab is useful but could stand being reorganized.  
The Results tabs (Overview, Sections, Cases, Responses, Positions) could be consolidated into one tab with two types of result display: summary and details (as described below).  
The top of the Results screen would have the heading "Results (Analytics & Reports)" with subheading "Performance insights from completed case chats".  
Then there would be drop-down multi-selectors for "Course sections", "Cases". The selectors should include "ALL sections" "ALL cases" options at the top.  
After identifying section(s) and case(s) the instructor can select (or unselect) "Show summary statistics" and/or "Show student details".  
The summary statistics are the statistics and "Score Distribution" histogram currently showing under the "Overview" tab. If there is more than one selected section or more than one selected case, the summary statistics should show a table of performance breakdown by section/case.  
The student details is like the lists that show up in the current Results list the following details and options (fields marked with \+ are columns that can be added to the report or "x" removed from the report):

* Student (name)  
* Section  
* Case  
* Status+ (completed, started, whatever)  
* Position+ (if the case tracks positions, as reported in the "Results" "Responses" report)  
  * Initial position+  
  * Final position+ (show one or both)  
* Persona+  
* Score+ (like "3/15")  
* Hints+ (number of hints requested)  
* Helpful+ (the helpfulness score)  
* Time+  
* Actions: (icons and actions from the current results lis)  
  * view transcript (icon to view the student results in a third "student details" tab and possibly set the position as allowed in the Results \- Responses report)  
  * view evaluation (icon to view the case chat evaluation)  
  * allow re-chat (if you want to allow a re-chat) Provide any additional suggestions for making results reporting more intuitive.

It would be good to also have features current used in other Instructor Dashboard reports, such as…

1. allow sorting by any of these displayed columns  
2. indicate how many records to show (10, 20, 50, 100\)  
3. have an “Export CSV” to export the selected rows and columns

Provide any additional suggestions for making results reporting more intuitive.

---

## Implementation Plan

### Overview
Consolidate the 5-tab Analytics view (Overview, Sections, Cases, Positions, Responses) into a single unified "Results (Analytics & Reports)" screen with multi-select filters and display toggles.

### Current State
- **Analytics.tsx** (1105 lines): Contains 5 separate tabs for results
- **Dashboard.tsx** (lines 5261-5567): Duplicate section results view when clicking a section in Courses-Sections
- This duplication causes confusion about where to find results

### Implementation Approach

#### Phase 1: Backend - New Consolidated API Endpoint
**File: `server/routes/analytics.js` (new)**

Create `GET /api/analytics/results` endpoint that:
- Accepts `section_ids` and `case_ids` (comma-separated or "all")
- Accepts `limit`, `offset`, `sort_by`, `sort_dir` for pagination/sorting
- Returns:
  - Summary statistics (completions, avg score, hints, helpful, completion rate)
  - Score distribution histogram data
  - Breakdown by section/case when multiple selected
  - Student details array with all fields (name, section, case, status, positions, persona, score, hints, helpful, time, actions)

Register route in `server/index.js`.

#### Phase 2: Extract Reusable UI Components
Extract from Dashboard.tsx to `components/ui/`:

| New File | Source Lines | Purpose |
|----------|--------------|---------|
| `SortableHeader.tsx` | 2274-2289 | Clickable column headers with sort indicator |
| `StatusBadge.tsx` | 2222-2246 | Status display (completed/in_progress/not_started) |
| `ScoreChart.tsx` | 2249-2272 | Score distribution histogram |
| `Pagination.tsx` | (new) | Page size selector + navigation |
| `MultiSelect.tsx` | (new) | Multi-select dropdown with "ALL" option |

#### Phase 3: Refactor Analytics.tsx

**Remove:** Tab navigation (activeView state and tab buttons)

**Add new state:**
```typescript
// Filters
selectedSections: string[]  // ['all'] or specific section_ids
selectedCases: string[]     // ['all'] or specific case_ids

// Display toggles
showSummaryStats: boolean   // true by default
showStudentDetails: boolean // true by default

// Column visibility
visibleColumns: Set<string> // toggleable: status, initial_position, final_position, persona, score, hints, helpful, time

// Table controls
pageSize: 10 | 20 | 50 | 100
currentPage: number
sortKey: string
sortDirection: 'asc' | 'desc'
```

**New UI Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Results (Analytics & Reports)                                   │
│ Performance insights from completed case chats                  │
├─────────────────────────────────────────────────────────────────┤
│ Sections: [Multi-select ▼]    Cases: [Multi-select ▼]          │
│ ☑ Show summary statistics     ☑ Show student details           │
├─────────────────────────────────────────────────────────────────┤
│ SUMMARY STATS (if enabled)                                      │
│ ┌───────┬───────┬───────┬───────┐                              │
│ │Complet│ Score │ Hints │ Rate  │  + Score Distribution Chart  │
│ └───────┴───────┴───────┴───────┘                              │
│ + Performance breakdown table (if multiple sections/cases)      │
├─────────────────────────────────────────────────────────────────┤
│ STUDENT DETAILS (if enabled)                                    │
│ Columns: [+Status] [+Position] [+Persona] [+Score]...          │
│ Show: [20 ▼]                               [Export CSV]         │
│ ┌──────────┬─────────┬──────┬────────────────────┬─────────────┐│
│ │ Student  │ Section │ Case │ [optional cols...] │ Actions     ││
│ ├──────────┼─────────┼──────┼────────────────────┼─────────────┤│
│ │ (data)   │         │      │                    │ 📄 📊 🔄    ││
│ └──────────┴─────────┴──────┴────────────────────┴─────────────┘│
│ [< 1 2 3 4 5 >]                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Phase 4: Remove Duplicate Results from Dashboard.tsx

**Remove:** Section Results view (lines 5261-5567)

**Update:** Section click behavior in Courses-Sections to navigate to Results tab with that section pre-selected:
```typescript
// Instead of showing results inline, navigate to Results tab
onNavigate?.('results', selectedSectionId);
```

#### Phase 5: Add Help Content
**File: `help/dashboard/ResultsHelp.tsx` (new)**

Document the consolidated Results features for instructors.

### Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `server/routes/analytics.js` | Create | New consolidated API endpoint |
| `server/index.js` | Modify | Register analytics route |
| `components/ui/SortableHeader.tsx` | Create | Extracted component |
| `components/ui/StatusBadge.tsx` | Create | Extracted component |
| `components/ui/ScoreChart.tsx` | Create | Extracted component |
| `components/ui/Pagination.tsx` | Create | New pagination component |
| `components/ui/MultiSelect.tsx` | Create | New multi-select component |
| `components/Analytics.tsx` | Refactor | Consolidate 5 tabs into unified view |
| `components/Dashboard.tsx` | Modify | Remove duplicate results, update navigation |
| `help/dashboard/ResultsHelp.tsx` | Create | Help content |
| `help/dashboard/index.ts` | Modify | Export new help |

### Additional Suggestions

1. **Column Visibility Persistence:** Store column preferences in localStorage so instructors don't need to reconfigure each visit

2. **Smart Position Column Display:** Auto-hide position columns when viewing cases that don't track positions

3. **Quick Filters:** Add preset filter buttons like "This Week", "Incomplete Only" for common use cases

4. **Bulk Actions:** Support bulk "Allow Re-chat" for multiple students at once

5. **Search:** Add a search box to filter the student details table by student name

### Verification Plan

1. **API Testing:** Test `/api/analytics/results` with various filter combinations
2. **Filter Testing:** Verify multi-select for sections and cases works correctly
3. **Display Toggles:** Confirm summary stats and student details can be shown/hidden independently
4. **Column Visibility:** Verify column toggles persist and export respects visible columns
5. **Sorting/Pagination:** Test all sortable columns and page navigation
6. **CSV Export:** Verify export includes selected columns and respects filters
7. **Navigation:** Confirm Courses-Sections click navigates to pre-filtered Results
8. **Regression:** Ensure no functionality lost from original 5 tabs