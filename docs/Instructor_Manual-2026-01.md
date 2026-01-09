# Instructor Manual
## MakeTheCase - January 2026

**MakeTheCase** is an AI-powered teaching tool that allows students to practice business case analysis by chatting with AI-simulated case protagonists (e.g., a CEO making strategic decisions). This manual outlines common workflows for instructors.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Quick Start Workflow](#quick-start-workflow)
3. [Common Tasks](#common-tasks)
   - [Managing Sections](#managing-sections)
   - [Creating and Managing Cases](#creating-and-managing-cases)
   - [Assigning Cases to Sections](#assigning-cases-to-sections)
   - [Configuring Chat Options](#configuring-chat-options)
   - [Monitoring Student Progress](#monitoring-student-progress)
   - [Viewing Results](#viewing-results)
   - [Managing Personas](#managing-personas)
4. [Tips and Best Practices](#tips-and-best-practices)
5. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Accessing the Instructor Dashboard

1. **From Student View**: Navigate to `http://localhost:3000/#/admin` (or your production URL)
   - Or **Ctrl+Click** (Windows/Linux) or **Cmd+Click** (Mac) on the "MakeTheCase" header
2. **Login**: Enter your admin credentials
3. **Dashboard**: You'll see the Home tab with an overview of your sections and recent activity

### Dashboard Navigation

The dashboard is organized into workflow-focused tabs:

- **Home**: Overview, alerts, and quick actions
- **Courses**: Manage sections, students, and case assignments
- **Content**: Create and manage cases, case files, and preparation materials
- **Monitor**: View live chat activity and system metrics
- **Results**: View analytics and evaluation data
- **Admin**: Configure personas, prompts, models, and system settings

---

## Quick Start Workflow

Follow these steps to set up your first case assignment:

### 1. Create a Section
**Navigation**: Courses → Sections → + Add Section

Fill in:
- **Section ID**: Unique identifier (e.g., `mba-501-f2026`)
- **Section Title**: Display name (e.g., "MBA 501 - Fall 2026")
- **Year/Term**: Academic term (e.g., "2026 Fall")
- **Chat Model**: AI model for the protagonist (default: gemini-2.0-flash-thinking)
- **Supervisor Model**: AI model for evaluation (default: gemini-2.0-flash-thinking)
- **Enabled**: Toggle on to activate the section

### 2. Create and Upload a Case
**Navigation**: Content → Cases → + Add Case

**Step A: Create Case Entry**
- **Case ID**: Lowercase with hyphens (e.g., `walmart-supply-chain`)
- **Case Title**: Display name (e.g., "Walmart Supply Chain Strategy")
- **Protagonist Name**: Full name (e.g., "Doug McMillon")
- **Protagonist Initials**: 2-3 letters (e.g., "DM")
- **Chat Question**: The strategic question students will discuss

**Step B: Upload Files**
- **Case Document** (PDF or Markdown): The case students will read
- **Teaching Note** (PDF or Markdown): AI-only content with key facts, analysis framework, and counter-arguments

**Step C: Enable the Case**
- Toggle the case to **Enabled** status

### 3. Assign Case to Section
**Navigation**: Courses → Assignments → Select Section → + Assign Case

1. Choose the case from the dropdown
2. Click **Assign**
3. Click **Activate** to make it the active case for that section
   - Only one case can be active per section at a time

### 4. Configure Chat Options
**Navigation**: Courses → Assignments → Select Section → ⚙ Configure Options**

Key settings:
- **Hints Allowed** (0-10): Maximum hints students can request
- **Free Hints** (0-5): Hints that don't penalize score
- **Show Case** (checkbox): Display case document during chat
- **Do Evaluation** (checkbox): Run AI evaluation after chat
- **Allowed Personas**: Which protagonist personalities students can choose
- **Default Persona**: Pre-selected personality

**Click Save Options** when done.

### 5. Monitor and Review
**Navigation**: Monitor → Chats (live view) or Results → Analytics (completed chats)

- View student progress in real-time
- Review scores, hints used, and feedback
- Read transcripts to assess student performance

---

## Common Tasks

### Managing Sections

#### Create a New Section
**Courses → Sections → + Add Section**

Fill in section details and click **Create Section**.

#### Edit Section Settings
**Courses → Sections → Click Section Card → Edit**

Update any field and click **Save**.

#### Disable a Section
Toggle **Enabled** to off. Students will no longer see this section.

#### Change AI Models
Edit the section and select different models from the **Chat Model** or **Supervisor Model** dropdowns.

---

### Creating and Managing Cases

#### Case Document Guidelines
Your **Case Document** (for students) should include:
- Company background and industry context
- Key stakeholders and decision-makers
- Financial data and metrics
- Strategic challenges or opportunities
- Relevant facts for decision-making

#### Teaching Note Guidelines
Your **Teaching Note** (for AI only) should include:
- Analysis framework (e.g., Porter's Five Forces, SWOT)
- Key decision factors and trade-offs
- Important case facts the AI should reference
- Counter-arguments to test student knowledge
- Common misconceptions to address

#### Uploading Files
**Content → Cases → Select Case → Upload Files**

- Accepts **PDF** or **Markdown** (.md) files
- PDFs are automatically converted to Markdown
- Files are stored in `case_files/{case_id}/`

#### Editing Case Metadata
**Content → Cases → Select Case → Edit**

Update title, protagonist, or chat question.

#### Deleting a Case
**Content → Cases → Select Case → Delete**

Warning: This removes all associated assignments and student data.

---

### Assigning Cases to Sections

#### Assign a Case
**Courses → Assignments → Select Section → + Assign Case**

1. Choose case from dropdown
2. Click **Assign**
3. Case is now assigned but not yet active

#### Activate a Case
**Courses → Assignments → Select Section → Activate Button**

- Only one case can be active per section
- Students only see active cases
- Previously active case is automatically deactivated

#### Remove a Case Assignment
**Courses → Assignments → Select Section → × Icon**

Warning: This removes the assignment and all associated student data for this section-case combination.

---

### Configuring Chat Options

Chat options control the student experience for each section-case assignment.

**Access**: Courses → Assignments → Select Section → ⚙ Configure Options

#### Hints Configuration
- **Hints Allowed** (0-10, default: 3): Maximum hints students can request
  - Students type "hint" in their message to request one
  - Set to 0 to disable hints entirely
- **Free Hints** (0-5, default: 1): Hints that don't penalize score
  - Additional hints cost 1 point each

#### Display Options
- **Show Case** (checkbox, default: on): Display case document in left panel during chat
  - When off, students must rely on their preparation

#### Evaluation Options
- **Do Evaluation** (checkbox, default: on): Run AI evaluation after chat
  - When off, students skip scoring and go directly to finish screen

#### Feedback Collection
- **Ask for Feedback** (checkbox, default: off): Collect student feedback
  - Asks for helpfulness rating, likes, and improvements
- **Ask to Save Transcript** (checkbox, default: off): Request permission to save anonymized transcript

#### Persona Configuration
- **Allowed Personas** (multiselect): Which personalities students can choose
  - **Moderate**: Balanced, recommended default
  - **Strict**: Requires explicit case facts and rigorous analysis
  - **Liberal**: Supportive brainstorming partner
  - **Leading**: Confidence-building with hints
  - **Sycophantic**: Agrees with everything (testing only)
- **Default Persona** (dropdown): Pre-selected personality
  - Must be one of the allowed personas

#### Custom Personality
- **Chatbot Personality** (text, optional): Additional AI instructions
  - Example: "Be more encouraging when the student struggles"
  - Example: "Focus heavily on financial analysis aspects"
  - Appended to the selected persona's instructions

**Don't forget to click Save Options!**

For detailed descriptions of all options, see [chat-options-reference.md](chat-options-reference.md).

---

### Monitoring Student Progress

#### Real-Time Chat Monitoring
**Monitor → Chats**

- View all active chats across all sections
- Filter by section or case
- Enable **Auto-refresh** for live updates
- See student names, progress phase, and time elapsed

#### Student List View
**Courses → Students**

- View all students across all sections
- Filter by section or completion status
- See scores, hints used, and completion times
- Enable/disable re-chat permission per student

#### Section Overview
**Home** or **Courses → Sections**

- Summary statistics per section
- Active case displayed
- Total students, completed, and in-progress counts
- Average scores

---

### Viewing Results

#### Analytics Dashboard
**Results → Analytics**

- Overall statistics across all sections
- Score distributions and trends
- Hints usage patterns
- Feedback ratings

#### Individual Student Results
**Courses → Students → Click Student → View Details**

- Completion time and score
- Hints used and helpfulness rating
- AI evaluation summary
- Rubric criteria scores
- Full chat transcript
- Student feedback (if collected)

#### Evaluation Details
**Courses → Students → Click Student → View Evaluation**

- AI-generated summary of student performance
- Criteria-based scoring (if configured)
- Transcript with timestamps
- Hints requested during chat

#### Exporting Data
**Courses → Students → Export CSV** (if available)

Export student results for analysis in Excel or other tools.

---

### Managing Personas

Personas define the protagonist's conversational style and behavior.

**Access**: Admin → Personas

#### Built-in Personas
Five personas are included by default:
- Moderate
- Strict
- Liberal
- Leading
- Sycophantic

#### Create a Custom Persona
**Admin → Personas → + Add Persona**

1. **Persona ID**: Unique identifier (e.g., `encouraging-mentor`)
2. **Persona Title**: Display name (e.g., "Encouraging Mentor")
3. **Instructions**: AI system prompt defining the personality
4. **Display Order**: Position in persona selector
5. **Enabled**: Toggle on to make available

#### Edit or Disable a Persona
**Admin → Personas → Select Persona → Edit**

Update instructions or disable to hide from students.

---

## Tips and Best Practices

### Before the Semester

1. **Set Up Sections Early**: Create sections and test them before students arrive
2. **Test Cases Yourself**: Complete a case as a student to verify the experience
3. **Configure Default Options**: Set standard chat options for all assignments
4. **Create Custom Personas**: If needed, tailor personas to your teaching style

### During the Semester

1. **Activate One Case at a Time**: Change the active case for each class session
2. **Monitor in Real-Time**: Use auto-refresh during class to watch progress
3. **Review Transcripts**: Read a sample of transcripts to assess case difficulty
4. **Adjust Hints**: If too many students use all hints, increase the limit or adjust the case

### Case Design

1. **Clear Strategic Question**: The chat question should guide the entire conversation
2. **Concise Case Documents**: 2-5 pages of focused information
3. **Comprehensive Teaching Notes**: Include all key facts and frameworks you want the AI to use
4. **Test PDFs**: If PDFs don't convert well, use Markdown files instead

### Chat Options Strategy

- **Standard Assignment**: Hints: 3, Free: 1, Show Case: On, Evaluation: On
- **Exam Mode**: Hints: 0, Show Case: Off, Evaluation: On
- **Practice Mode**: Hints: 5, Free: 3, Show Case: On, Evaluation: Off
- **Feedback Collection**: Enable for new or pilot cases

### Persona Selection

- **Most Sections**: Allow Moderate, Strict, and Liberal
- **Advanced Students**: Allow all personas, default to Strict
- **Introductory Students**: Allow only Moderate and Liberal
- **Testing**: Use Sycophantic to verify rubric and evaluation logic

---

## Troubleshooting

### Students can't see a case
**Check**:
1. Is the case **Enabled**? (Content → Cases)
2. Is the case **Assigned** to the section? (Courses → Assignments)
3. Is the case **Active** for the section? (Courses → Assignments)
4. Is the student in the correct **Section**? (Courses → Students)

### Case content is blank
**Check**:
1. Were files uploaded successfully? (Content → Cases → Upload Files)
2. Check the `case_files/{case_id}/` directory on the server
3. Try uploading Markdown files instead of PDFs

### Chat options don't apply
**Check**:
1. Did you click **Save Options**?
2. Refresh the browser page
3. Verify the section-case assignment still exists

### Evaluation scores seem wrong
**Check**:
1. Review the **Teaching Note**: Does it include the evaluation criteria you expect?
2. Check the **Prompts** tab (Admin → Prompts): Is the evaluation prompt configured correctly?
3. Try a different **Supervisor Model**: Some models evaluate more strictly

### Student stuck on "Evaluation Loading"
**Possible causes**:
1. AI API quota exceeded or rate limit hit
2. Network timeout
3. Invalid API key

**Solutions**:
- Check server logs for errors
- Verify API keys in `.env.local`
- Try refreshing the page

### Students can't re-chat
**Check**:
1. Is **Allow Re-chat** enabled for that student? (Courses → Students → Toggle)
2. Re-chat permission is per-student, not per section

### Can't log in to admin dashboard
**Check**:
1. Are you using the correct admin email and password?
2. Was your admin account created? (Run `npm run create-admin email password`)
3. Check server logs for authentication errors

---

## Additional Resources

- **CASE_MANAGEMENT_GUIDE.md**: Detailed case management workflows and database schema
- **chat-options-reference.md**: Complete reference for all chat options
- **ABOUT_THIS_APP.md**: Technical overview and architecture
- **CLAUDE.md**: Developer guide for working with the codebase

---

## Support

For technical issues or feature requests:
- Check the documentation in the `docs/` folder
- Review server logs for error messages
- Consult the development team

---

**Version**: January 2026
**Last Updated**: 2026-01-07
