# Instructor Dashboard Updates — May 12, 2026

## Summary

Restructured the **Courses** and **Results** sections of the instructor dashboard, unified the Course Sections "Grouped" and "List" views, reworked the Edit Section modal, replaced the misleading "Students" column on Sections with an enrollment count, and added a new **Section Results** sub-tab under Results.

## 1. Sub-tab reordering and renames

### Courses sub-tabs

Old order: *Semesters · Course Setup · Sections · Students*
New order: **Sections · Students · Courses · Semesters**

- Renamed **Course Setup** → **Courses** (the internal `coursesSubTab` id `'course-setup'` is unchanged).

### Results sub-tabs

Old order: *Student Responses · Position Analytics*
New order: **Section Results · Student Results · Position Analytics**

- Added new **Section Results** sub-tab (see §5).
- Renamed **Student Responses** → **Student Results** (internal `resultsSubTab` id `'responses'` unchanged so deep-links still work).

**Files Modified**: `components/Dashboard.tsx`

## 2. Sections screen: Grouped view unified with List view

The **Grouped** view used to render small per-section cards with a weaker, different set of fields than the **List** view.

- Extracted `renderSectionTableHeader({ hideTermColumn })` and `renderSectionRow(section, { hideTermColumn })` helpers.
- The **Grouped** view now renders a `<table>` per Course group using the same helpers, with `hideTermColumn: true` (Term is redundant under a semester header).
- The **List** view uses the same helpers with `hideTermColumn: false`.
- Removed the inline course-reassignment dropdown from the Grouped view — its functionality moved into the Edit Section modal (see §4).
- Status, Active Cases, Edit, Duplicate, View Results, and Models behave identically in both views. Collapse/expand of Semester/Course headers in Grouped view is preserved.

**Files Modified**: `components/Dashboard.tsx`

## 3. Sections screen: "Students" column shows enrollment, not activity

The **Students** column previously showed `completions/started` (e.g. "4/10"), which doesn't answer "how many students are enrolled in this section?".

- The column now shows `student_count` (already returned by `GET /api/sections`) as a clickable button styled like the Active Cases button.
- Clicking the count navigates to **Courses → Students** with the section pre-filtered.
- The completions/started numbers moved entirely into the new **Section Results** sub-tab (see §5).

**Files Modified**:
- `components/Dashboard.tsx` — `SectionStat` interface gained `student_count`, `course_id_num`, `semester_is_current`; `handleNavigate` extended with a `'courses' → 'students'` deep-link path that sets `studentsInitialSectionId` from `options.section_id`.
- `components/StudentManager.tsx` — accepts a new optional `initialSectionFilter?: string` prop and applies it to the `sectionFilter` state when set.

## 4. Edit / Create Section modal: Semester + Course dropdowns

The free-text **Term** input was replaced with two dependent dropdowns:

- **Semester** `<select>` — populated from unique semesters within `allCourses`, sorted current-first then by name desc (matching `groupedSections` ordering). Required.
- **Course** `<select>` — filtered by selected semester. First option is **Unassigned** so a section can sit in a semester with no course (matching today's "Unassigned" bucket). Disabled until a Semester is chosen.

Behavior:
- Changing the Semester clears the Course if the previous course doesn't belong to the new semester.
- `sections.year_term` (free-text legacy column) is **derived** from the selected semester's `semester_name` on save — no migration required; existing UI consuming `year_term` keeps working.
- `course_id` is PATCH-ed after the section upsert (mirroring the now-removed inline `handleChangeSectionCourse`), folded into one `handleSaveSection` flow.

**Files Modified**: `components/Dashboard.tsx` — `sectionForm` gained `semester_id` and `course_id`; `handleCreateSection`, `handleEditSection`, and `handleSaveSection` updated; the modal Term input replaced with the two dropdowns; new `allSemesters` useMemo.

## 5. New "Section Results" sub-tab under Results

A new screen showing per-active-case Started, Completed, In Progress, and Avg Score for a chosen section.

### UI

- **Section** dropdown sourced from `GET /api/sections` (full list, then filtered client-side by the toggle below).
- **Enabled / All Sections** toggle next to the dropdown, mirroring the toggle on the Sections screen. Disabled sections are suffixed with `(Disabled)` in the dropdown when the toggle is set to All Sections.
- **Per-case table** with columns: Case · Started · Completed · In Progress · Avg Score · Action.
- **"View student responses →"** action button per row navigates to **Results → Student Results** with both Section and Case pre-filtered via `handleNavigate('results', 'responses', { section_id, case_id })`.
- Empty states:
  - No section selected → "Pick a section to see its results."
  - Section selected but no chat activity → "No case activity yet for this section."

### Backend

- No new endpoints. Reuses `GET /api/analytics/results` (which already returns `caseBreakdown` under `data.summary`).
- `caseBreakdown` query in `server/routes/analytics.js` extended to include `started_students` (`COUNT(DISTINCT s.id)`), so the per-case row can show Started in addition to the existing Completed.

### Wiring

- `handleNavigate('results', subTab, options)` now recognizes the three known sub-tab names (`'responses'`, `'positions'`, `'section-results'`) and seeds two new states: `resultsInitialSectionId`, `resultsInitialCaseId`. Legacy callers that passed `subTab` as a section_id directly still work via a fallback.
- `<Analytics>` accepts a new optional `initialCaseId?: string` prop so Section Results can deep-link to a specific case within Student Results — mirrors the existing `initialSectionId` auto-select effect.
- `ResultsSubTab` type extended with `'section-results'`.

**Files Added**:
- `components/SectionResultsSummary.tsx`

**Files Modified**:
- `components/Dashboard.tsx` — sub-tab button, conditional render, `handleNavigate` extension, two new initial-state passes.
- `components/Analytics.tsx` — `initialCaseId` prop and corresponding effect.
- `server/routes/analytics.js` — `started_students` added to caseBreakdown query and result mapping.

## Verification

1. `npm run dev:all`, log in as admin.
2. **Courses** — sub-tabs in the order Sections, Students, Courses, Semesters; "Course Setup" reads "Courses".
3. **Courses → Sections**, toggle Grouped ↔ List — same columns in both, except Grouped hides Term. Status / New Students / Active Cases / Edit / Duplicate / View Results behave identically. Models checkbox toggles the Chat Model column in both.
4. **Students column** shows enrollment count, not "x/y". Click → lands on Courses → Students with the section pre-filtered.
5. **Edit Section** on an existing section attached to a course — Semester pre-selected; Course pre-selected; changing Semester clears Course; Save → section appears under the new Semester/Course group; `year_term` reflects the selected semester's name; data round-trips after reload.
6. **Create Section** — must choose a Semester; "Unassigned" Course puts it in that semester's Unassigned bucket.
7. **Results** — sub-tabs in the order Section Results, Student Results, Position Analytics.
8. **Results → Section Results** —
   - Pick a section → per-case table with Started, Completed, In Progress, Avg Score.
   - Enabled / All Sections toggle filters the dropdown; disabled sections show a `(Disabled)` suffix when shown.
   - Click "View student responses →" on a case row → lands on Results → Student Results with both Section and Case pre-filtered.
