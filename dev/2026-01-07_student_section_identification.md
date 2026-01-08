# Student section identification

Normally each student is in one section, but sometimes the same student will be in more than one section. Currently, the "students" table has a "section\_id" field that only allows students to be in one and only one section. It would be good to allow a student to potentially be in more than one section. What would be the best way to safely allow students to be in more than one section\_id without harming performance or breaking the code? Note that the vast majority of students will be in one and only one section, and a potentially small percentage of students will be in multiple sections.
Also, we need to improve the way admin instructors control which students are in which sections. The following workflows are one idea (and you should tell me alternatives that might be improvements on these ideas).

---

## Implementation Summary (2026-01-07)

### Database Changes
- **New junction table** `student_sections` for many-to-many student-section relationships
  - Includes `enrolled_at`, `enrolled_by` (self/instructor/cas), and `is_primary` fields
  - Foreign key constraints with CASCADE delete
- **New column** `accept_new_students` (TINYINT) added to `sections` table
  - 0 = locked (default), 1 = accept
- **Backward compatibility**: `students.section_id` retained and synced with primary section
- **Migration**: `server/migrations/007_multi_section_support.sql`

### Instructor Dashboard
- **New Students toggle** replaces Chat Model column in section list (bright pink = Accept, gray = Locked)
- **Show Models checkbox** in header to optionally display model column
- **Student Manager** now uses checkbox list for multi-section assignment
- Instructors can add/remove students from multiple sections
- **Student Manager search/filter/sort/pagination**:
  - Search by ID, name, or email
  - Filter by section dropdown (All sections, Unassigned, or specific section)
  - Click column headers to sort (ID, Name, Email, Section)
  - Page size selector (Show 10, 20, 50, 100, All)
  - Navigation buttons (First, Previous, Page X of Y, Next, Last)
  - Shows result count (e.g., "Showing 1-20 of 234 students")

### Student Workflow
- Students see **enrolled sections** (marked with ✓) plus **accepting sections**
- Students can **switch between enrolled sections** during their session
- **Section dropdown is disabled** once a student has selected a section (instructor must reset)
- **"Click here to remember your course section" button** (prominent pink button) appears above case list when section selected but not yet enrolled
- **Updated disclosure text** about sharing conversations with instructors

### API Endpoints
- `GET /api/students/:id/sections` - Get student's enrolled sections
- `POST /api/students/:id/sections` - Enroll student (instructor)
- `DELETE /api/students/:id/sections/:sectionId` - Remove from section
- `POST /api/student-sections/enroll` - Student self-enrollment (checks accept_new_students)
- `GET /api/student-sections/my-sections` - Get current student's sections

---

## Instructor workflow

In the Instructor Dashboard the admin instructor selects “Courses” which displays a list of “Course Sections” which lists the “STATUS” (from sections.enabled) and also lists the chat\_model. Rather than listing the chat\_model it would be more beneficial to provide a column for “New Students” with toggle options for “accept” or “locked” where:

* accept \= allow students to indicate this is their section at login (bright pink)  
* locked \= do not allow students to indicate this is their section (gray button)

That “New Students” status might be stored in a “new\_students” column of the “students” data table.  
The idea is that the first day of the semester the instructor will accept new students while students are logging in, then in subsequent class sessions will leave it “locked” so that other students may not arbitrarily log in to that section.  If a student needs to be added to a section later the instructor could temporarily “accept” new students, or the instructor could manually add the student.  
If we want to display models in the “Course Sections” list there might be a small “show models” checkbox next to the Course Sections header to toggle showing or hiding of models.

## Student workflow

The student logs in using their BYU NetID (using CAS). Once logged in the student sees the "Welcome..." screen indicating that the student has signed in. They can select their course section from among the sections set to “accept” new students if they have not previously indicated their course section. If they have previously indicated their course section (as recorded in the "students" data table) and that section is still valid then the welcome screen "Your Course Section" should just indicate what section the student is in.  
One problem is that if a student logs in and selects a section they can only save that section assignment by selecting an active case chat. If there are no active case chats they still need the ability to save their section assignment, such as with a “Remember your course section” button that appears.  
Below that selection it says “You can optionally and anonymously share your chat conversation with the developers to improve the dialog for future students. You will be asked about this later.” It would be better to say “Disclosure: Some courses and cases allow you to share your chat conversation with the instructor to track progress and improve the dialog for future students.”

## Adjusting student assignments

Again, we need to think about what to do if a student happens to be in more than one course section. One approach is to allow the admin instructor to edit the “Students” record and right-clicking the select list to select more than one section; as such students can only select one section but multiple sections need to be handled by the instructor admin.  
If a student accidentally puts themself in the wrong section, the admin instructor can change their section using the Instructor Dashboard “Students” screen, or delete their section (by selecting “No section”) which would allow the student to re-select which section they are in.  
After the start of the semester the sections will typically be “locked” to prevent additional students from arbitrarily putting them in course sections. However, the admin instructor can change student assignments to sections at any time using the Instructor Dashboard.