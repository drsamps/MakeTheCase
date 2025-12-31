# Case Management Guide

This guide explains how to use the multi-case support features in MakeTheCase.

## Overview

MakeTheCase supports multiple business cases. Instructors can:
- Upload and manage multiple cases
- Assign different cases to different sections
- Activate one case per section at a time
- Configure chat behavior per section-case assignment

## Table of Contents

1. [Creating a New Case](#creating-a-new-case)
2. [Assigning Cases to Sections](#assigning-cases-to-sections)
3. [Activating Cases](#activating-cases)
4. [Configuring Chat Options](#configuring-chat-options)
5. [Student Experience](#student-experience)
6. [Case File Format](#case-file-format)
7. [Database Schema](#database-schema)

---

## Creating a New Case

### Step 1: Access the Cases Tab
1. Log in to the admin dashboard at `#/admin`
2. Click the **Cases** tab

### Step 2: Create the Case Entry
1. Click **+ Add Case**
2. Fill in the case metadata:
   - **Case ID**: Unique identifier (lowercase, hyphens, e.g., `tesla-manufacturing`)
   - **Case Title**: Display name (e.g., "Tesla Manufacturing Strategy")
   - **Protagonist Name**: Full name (e.g., "Elon Musk")
   - **Protagonist Initials**: 2-3 letter abbreviation (e.g., "EM")
   - **Chat Topic** (optional): Brief description (e.g., "Vertical integration strategy")
   - **Chat Question**: The central strategic question the protagonist asks students
3. Click **Create Case**

### Step 3: Upload Case Documents
1. Find your newly created case in the list
2. Click **Upload Files**
3. Upload the **Case Document**:
   - Accepts PDF or Markdown (.md)
   - This is what students will read
   - PDFs are automatically converted to Markdown
4. Upload the **Teaching Note**:
   - Accepts PDF or Markdown (.md)
   - Contains key facts and analysis for the AI to use
   - Students never see this content
   - Used by the AI to formulate counter-arguments and evaluate student responses

### Step 4: Enable the Case
- Toggle the case to **Enabled** status (green badge)
- Disabled cases cannot be assigned to sections

---

## Assigning Cases to Sections

### Method 1: From the Sections Tab
1. Go to the **Sections** tab
2. Click on a section to view details
3. Click **Manage Cases** button
4. In the modal:
   - See all cases currently assigned to this section
   - Click **+ Assign Case** dropdown to add more cases
   - Select a case from the list
   - Click **Activate** next to the case you want active for today
   - Configure chat options (see below)
   - Remove cases by clicking the **×** icon

### Method 2: From the Cases Tab
1. Go to the **Cases** tab
2. Find the case you want to assign
3. See which sections already have this case (shown in case card)
4. To assign to a new section, go to that section's "Manage Cases" interface

**Note**: A case must be assigned to a section before it can be activated.

---

## Activating Cases

Only **one case** can be active per section at any given time.

### To Activate a Case:
1. Open the section's **Manage Cases** modal
2. Find the case you want to activate
3. Click the **Activate** button
4. The previously active case (if any) is automatically deactivated

### Active Case Behavior:
- **Students** see only active cases for their section on the home screen
- Students with no active case see: "Currently no available case chats"
- You can activate a different case each class day
- Students who completed a case can re-chat if you enable "Allow Re-chat" per student

---

## Configuring Chat Options

Chat options control the student experience per section-case assignment.

### Where to Configure:
1. Go to **Sections** tab → select a section
2. Click **Manage Cases**
3. For each assigned case, click **⚙ Configure Options**

### Available Options:

#### Hints Allowed (0-10, default: 3)
- Maximum number of hints a student can request
- Students type the word "hint" in their message to request one
- Set to **0** to disable hints entirely
- When limit is reached, the protagonist refuses additional hints

#### Free Hints (0-5, default: 1)
- Number of hints that don't penalize the student's score
- Each hint beyond this costs 1 point
- Should be ≤ Hints Allowed
- The AI evaluator uses this value when calculating scores

#### Ask for Feedback (checkbox, default: off)
- If enabled, asks student for:
  - Helpfulness rating (1-5)
  - What they liked
  - What could be improved
- Occurs after "time is up" and before evaluation

#### Ask to Save Transcript (checkbox, default: off)
- If enabled, asks student permission to save an anonymized copy of the transcript
- For research/improvement purposes
- Happens after feedback (if enabled) or after chat ends

#### Allowed Personas (multiselect)
- Choose which protagonist personalities students can select:
  - **Moderate** - Balanced (recommended)
  - **Strict** - Requires explicit case facts
  - **Liberal** - Supportive brainstorming
  - **Leading** - Confidence-building with hints
  - **Sycophantic** - Agrees with everything (testing only)
- Students only see the personas you select

#### Default Persona (dropdown)
- Pre-selects a persona when the student starts
- Must be one of the allowed personas
- Students can change it before starting the chat

### Saving Options:
- Click **Save Options** after making changes
- Options are stored as JSON in the database
- Each section-case assignment has independent options

---

## Student Experience

### Login and Section Selection
1. Student logs in (CAS or local auth)
2. If no section assigned, student selects from dropdown
3. Section is saved to their student record

### Case Selection
1. Home screen shows: "Available case chats for [Section Name]:"
2. Lists all **active** cases as radio buttons
3. Student selects a case
4. Student selects protagonist personality (filtered by `allowed_personas`)
5. Default persona is pre-selected based on `default_persona`

### During Chat
- Student can read the case in the side panel
- Student types messages to discuss the case
- Student can request hints by typing "hint" (subject to `hints_allowed` limit)
- When done, student types "time is up"

### After Chat
1. If `ask_for_feedback` is true: collects helpfulness rating and feedback
2. If `ask_save_transcript` is true: asks permission to save transcript
3. AI evaluates the conversation
4. Student sees score and feedback
5. Student can exit or start another case (if multiple are active)

### Re-chatting
- By default, students who complete a case cannot chat with it again
- Instructors can toggle "Allow Re-chat" per student in the admin dashboard
- Useful for practice or exam retakes

---

## Case File Format

### Case Document (for students)
Should include:
- Company background
- Industry context
- Key stakeholders
- Financial data
- Strategic challenges
- Relevant facts for decision-making

**Format**: PDF or Markdown
**Location after upload**: `case_files/{case_id}/case.md` (auto-converted)

### Teaching Note (instructor-only)
Should include:
- Analysis framework
- Key decision factors
- Common student misconceptions
- Important case facts the AI should reference
- Counter-arguments to test student knowledge
- Implementation considerations

**Format**: PDF or Markdown
**Location after upload**: `case_files/{case_id}/teaching_note.md` (auto-converted)

### Markdown Tips
- Use `#` for headings
- Use `**bold**` for emphasis
- Include bullet lists for key facts
- Tables work well for financial data
- Keep formatting simple - it will be displayed in a scrollable panel

---

## Database Schema

### `cases` Table
Stores case metadata:
```sql
CREATE TABLE cases (
  case_id VARCHAR(30) PRIMARY KEY,
  case_title VARCHAR(100) NOT NULL,
  protagonist VARCHAR(100) NOT NULL,
  protagonist_initials VARCHAR(3) NOT NULL,
  chat_topic VARCHAR(255),
  chat_question TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  enabled BOOLEAN DEFAULT TRUE
);
```

### `case_files` Table
Tracks uploaded documents:
```sql
CREATE TABLE case_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id VARCHAR(30) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(30) NOT NULL, -- 'case' or 'teaching_note'
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
);
```

### `section_cases` Table
Junction table for assignments:
```sql
CREATE TABLE section_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_id VARCHAR(20) NOT NULL,
  case_id VARCHAR(30) NOT NULL,
  active BOOLEAN DEFAULT FALSE,
  chat_options JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
  UNIQUE KEY unique_section_case (section_id, case_id)
);
```

### `chat_options` JSON Structure
Example:
```json
{
  "hints_allowed": 3,
  "free_hints": 1,
  "ask_for_feedback": true,
  "ask_save_transcript": false,
  "allowed_personas": "moderate,strict,liberal",
  "default_persona": "moderate"
}
```

---

## Tips and Best Practices

### Case Creation
- Use descriptive case IDs (e.g., `walmart-supply-chain` not `case1`)
- Make protagonist names recognizable from the case
- Write clear, focused chat questions
- Keep teaching notes concise but comprehensive

### Case Assignment
- Assign cases to sections in advance of the semester
- Activate only one case per day
- Test the case yourself before assigning to students

### Chat Options
- Start with default options and adjust based on experience
- Use `hints_allowed: 0` for exams
- Enable feedback collection for pilot cases
- Restrict personas for structured learning outcomes

### Monitoring
- Use the Students tab to watch live progress during class
- Enable "Auto-refresh" for real-time monitoring
- Filter by case to see performance on specific assignments
- Check average scores and hints to adjust difficulty

### Troubleshooting
- If students can't see a case: check that it's **active** for their section
- If case content is blank: verify files uploaded successfully in `case_files/` directory
- If options don't apply: refresh the page and check the section-case assignment
- For PDF conversion issues: use Markdown files instead

---

## API Endpoints

### Cases
- `GET /api/cases` - List all cases
- `GET /api/cases/:id` - Get case details
- `POST /api/cases` - Create new case
- `PATCH /api/cases/:id` - Update case metadata
- `DELETE /api/cases/:id` - Delete case
- `POST /api/cases/:id/upload` - Upload case document or teaching note
- `GET /api/cases/:id/content/:fileType` - Retrieve case content (case or teaching_note)

### Section Cases
- `GET /api/sections/:sectionId/cases` - List cases for a section
- `POST /api/sections/:sectionId/cases` - Assign case to section
- `DELETE /api/sections/:sectionId/cases/:caseId` - Remove case from section
- `PATCH /api/sections/:sectionId/cases/:caseId/activate` - Activate a case
- `GET /api/sections/:sectionId/active-case` - Get active case for section
- `PATCH /api/sections/:sectionId/cases/:caseId/options` - Update chat options

### Chat Options
- `GET /api/chat-options/schema` - Get chat options schema
- `GET /api/chat-options/defaults` - Get default values

---

*For general app information, see [ABOUT_THIS_APP.md](ABOUT_THIS_APP.md)*
