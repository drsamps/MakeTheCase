## Simplifying Instuctor Dashboard Case Assignments (2026-01-09-simplified-case-assignments.md)

The "Case Assignments" list is cumbersome with all of the active course sections being listed at once. Instead, it would be better to provide the instructor with a dropdown list at the top where the instructor can select from among the enabled course sections. Upon selecting a course section the "Case Assignments" screen will show the "+ Assign a case to this section..." dropdown followed by all of the cases assign to the section as currently showing in the list (with buttons for Options, Scenarios, Scheduling, and (Set) Active). However, the "Options" button should navigate to a separate "Chat Options" tab as described below. At the bottom of the list add a "Copy case assignments from course section..." with a list of enabled course sections, so that the instructor can easily copy all case assignments from a different section into this course section. If the instructor selects an option from that dropdown list, options for "also copy options" "also copy scenarios" "also copy scheduling" show up below and a "Copy cases from the section" button appears followed by the title of the other section a list of cases assigned to that other section (with a list of scenarios selected and scheduling for each case). If the instructor clicks that "Copy..." button a confirmation popup shows "Are you sure you want to copy...". If the instructor answers in the affirmative, proceed with the copying and provide a summary of what was copied.


It is cumbersome having the many "Chat Options" be managed on the "Case Assignments" screen with everything else.  The "Options" button next to each case should navigate to a separate "Chat Options" tab to the right of the "Assignments" tab.

The "Chat Options" screen has a course section dropdown selector at the top (from among the active course sections) and a case selector (from among the cases assigned to this section), which would come from which "Options" button was clicked in the "Case Assignment" tab, or others could be selected. Based on those selections, show the "Chat Options" that were previously on the "Case Assignment" screen allowing the instructor to change and save any chat option settings (and get acknowledgement as current happens). At the bottom of the "Chat Options" screen, add features for:
* "Make these chat option settings the default for new case assignments in this course section"
* "Make these chat option settings the default for new case assignments in all sections"
* "Copy these chat option settings to all cases assigned to this course section"
* "Copy these chat option settings to all cases assigned to all course sections"
This of course requires keeping track of chat_option_defaults (new table?) by course section (section_id) or for all sections (maybe a wildcard section_id). The "Chat Options" selector list at the top might have an option for showing and managing those defaults, or perhaps a separate "Chat Option Defaults" tab (to the right of the new "Chat Options" tab).

When you are done planning, post the plan details on the end of this file (2026-01-09-simplified-case-assignments.md).

---

## Implementation Plan (Claude Code - 2026-01-09)

### Overview

Implementing the requirements in 5 phases:
1. Refactor Assignments tab with section selector dropdown
2. Create new "Chat Options" sub-tab under Courses
3. Database migration for chat options defaults system
4. Copy case assignments between sections feature
5. Bulk copy chat options to multiple cases

---

### Phase 1: Refactor Assignments Tab with Section Selector

**File: `components/Dashboard.tsx`**

Changes:
- Add `selectedAssignmentSection: string | null` state
- Add dropdown at top populated from `assignmentsSectionsList` (enabled sections only)
- When a section is selected, show only that section's case assignments
- Remove accordion/expand pattern (show flat list for selected section)
- Keep: Scenarios, Scheduling, Set Active, Delete buttons
- **Change**: "Options" button navigates to Chat Options tab instead of inline expansion

---

### Phase 2: New Chat Options Tab

**New sub-tab under Courses**: Sections | Students | Assignments | **Chat Options**

**Create `renderChatOptionsTab()` function:**
- Section dropdown (from enabled sections)
- Case dropdown (from cases assigned to selected section)
- All existing chat option controls (hints, personas, etc.)
- Save/Reset buttons
- Navigation from Assignments tab pre-populates selectors

**Bottom section features:**
- "Make default for this section" button
- "Make default for all sections" button
- "Copy to all cases in this section" button
- "Copy to all cases in all sections" button

---

### Phase 3: Chat Options Defaults System

**New Migration: `server/migrations/006_chat_options_defaults.sql`**

```sql
CREATE TABLE chat_options_defaults (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_id VARCHAR(20) NULL,  -- NULL = global default for all sections
  chat_options JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_section_default (section_id),
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
);
```

**API Endpoints (extend `server/routes/chatOptions.js`):**
- `GET /api/chat-options/defaults` - Get defaults (query: ?section_id=X or omit for global)
- `POST /api/chat-options/defaults` - Create/update defaults
- `POST /api/chat-options/defaults/apply` - Copy defaults to all cases

**Defaults hierarchy:** section-specific → global → hardcoded

---

### Phase 4: Copy Case Assignments Feature

**UI at bottom of Assignments tab:**
```
┌─────────────────────────────────────────────────────────────┐
│ Copy case assignments from course section...  [Dropdown ▼] │
└─────────────────────────────────────────────────────────────┘

When a source section is selected:
┌─────────────────────────────────────────────────────────────┐
│ ☑ Also copy chat options                                    │
│ ☑ Also copy scenarios                                       │
│ ☑ Also copy scheduling                                      │
│                                                             │
│ [Copy cases from "Section Name"]                            │
│                                                             │
│ Cases in source section:                                    │
│ • Case A (3 scenarios, open: Jan 15 - Feb 1)               │
│ • Case B (2 scenarios, no scheduling)                       │
└─────────────────────────────────────────────────────────────┘
```

**Backend API (extend `server/routes/sectionCases.js`):**
```javascript
POST /api/sections/:targetSectionId/cases/copy-from/:sourceSectionId
Body: { copy_options: boolean, copy_scenarios: boolean, copy_scheduling: boolean }
Response: { copied: number, skipped: number, details: [...] }
```

**Copy logic:** Skip cases already assigned to target section (doesn't overwrite)

---

### Phase 5: Bulk Copy Chat Options

**API Endpoint (extend `server/routes/chatOptions.js`):**
```javascript
POST /api/chat-options/bulk-copy
Body: {
  source_section_id: string,
  source_case_id: string,
  target: 'section' | 'all',
  target_section_id?: string  // only if target='section'
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `components/Dashboard.tsx` | Major UI changes - section selector, new tab, copy UI |
| `server/routes/sectionCases.js` | Add copy-from endpoint, modify assignment to use defaults |
| `server/routes/chatOptions.js` | Add defaults CRUD, bulk copy endpoints |
| `server/migrations/006_chat_options_defaults.sql` | New migration file |
| `types.ts` | Add types for defaults, copy operations |

---

### Key Decisions

1. **Tab placement**: Chat Options tab placed after Assignments tab in Courses sub-navigation
2. **Defaults hierarchy**: Section-specific defaults override global defaults, which override hardcoded defaults
3. **Copy behavior**: Skips cases already assigned to target (doesn't overwrite)
4. **No "Chat Option Defaults" separate tab**: Defaults managed within Chat Options tab via buttons (simpler)

