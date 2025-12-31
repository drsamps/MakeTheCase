# About MakeTheCase

## Purpose

**MakeTheCase** is an **educational AI-powered case teaching tool** designed for business students. It simulates a conversation with a case study protagonist (e.g., Kent Beck, CEO of Malawi's Pizza) to help students practice analyzing a business case study and developing recommendations.

## Main Functionality

### 1. Multi-Case Architecture
- Instructors can upload and manage **multiple business cases** through the admin dashboard
- Each case includes:
  - The business case document (PDF or Markdown)
  - A teaching note with key facts (instructor-only, used by AI for evaluation)
  - A protagonist name and initials
  - A central strategic question for discussion
- Cases are assigned to course sections and can be activated/deactivated by day
- Examples: "Malawi's Pizza Catering", "Tesla Manufacturing Strategy", etc.

### 2. Simulated Protagonist Conversation
- Students engage in a real-time chat with an AI-simulated protagonist powered by multiple LLM providers (Google Gemini, OpenAI, Anthropic)
- The protagonist poses the case's strategic business question
- Students must reference facts from the case study to support their recommendations
- The AI uses the teaching note (hidden from students) to formulate challenging counter-arguments

### 3. Business Case Study Display
- The app presents the selected case study in a side panel
- Students read the case and cite relevant facts when chatting with the protagonist
- Case content loads dynamically based on the active case for their section

### 4. Configurable Chat Options
Instructors can configure behavior per section-case assignment:
- **Hints allowed**: Maximum number of hints (0 to disable, default 3)
- **Free hints**: Hints without score penalty (default 1)
- **Feedback prompts**: Optionally ask for student feedback at chat end
- **Transcript sharing**: Optionally ask permission to save anonymized transcripts
- **Allowed personas**: Restrict which protagonist personalities are available
- **Default persona**: Pre-select a personality for students

### 5. Multiple Protagonist Personas
Students can select different protagonist personalities that affect how strictly the AI requires case citations:
- **Moderate** (recommended) - Balanced approach with reasonable fact requirements
- **Strict** - Requires explicit case facts for every assertion
- **Liberal** - Supportive brainstorming mode, helps connect ideas to case
- **Leading** - Confidence-building mode with overt hints
- **Sycophantic** - Agrees with everything (for demonstration/testing)

The instructor can restrict which personas are available per section-case assignment.

### 6. AI Evaluation & Scoring
After the conversation ends:
- An "AI Supervisor" evaluates the student's performance using the teaching note
- Provides a score (out of 15) based on three criteria:
  1. Did the student study the reading material? (5 points)
  2. Did the student provide solid answers? (5 points)
  3. Did the student justify answers with case facts? (5 points)
- Deducts points for hints beyond the free hint allowance
- Gives constructive feedback on performance

### 7. Feedback Collection (Optional)
If enabled via chat options, the app can collect student feedback including:
- Helpfulness rating (1-5)
- What students liked
- Improvement suggestions
- Optional anonymized transcript sharing for research

### 8. Instructor Dashboard
Protected admin view (`#/admin`) for instructors with comprehensive management features:

#### **Cases Tab**
- Upload and manage business cases (PDF or Markdown format)
- For each case, configure:
  - Case ID (unique identifier, e.g., `malawis-pizza`)
  - Case title (display name)
  - Protagonist name and initials
  - Chat topic (optional)
  - Central strategic question
- Upload case document and teaching note separately
- Enable/disable cases
- View which sections are using each case
- Delete cases (removes all associated files and assignments)

#### **Course Sections Tab**
- View all sections in list or tile view (list is default)
- See student progress: completed/started count with tooltip
- See which case is currently active for each section
- Toggle section status with clickable Enabled/Disabled buttons
  - Enabled sections show with green badge
  - Disabled sections show with pink badge and dimmed appearance
- Create, edit, and duplicate sections
- Assign specific AI models per section
- **Manage Cases per Section:**
  - Assign multiple cases to a section
  - Mark one case as "active" for the current day
  - Configure chat options per section-case assignment:
    - Hints allowed (0-10)
    - Free hints (0-5)
    - Ask for feedback (on/off)
    - Ask to save transcript (on/off)
    - Allowed personas (multiselect)
    - Default persona
  - Remove case assignments

#### **Students Tab**
- View all students across all sections
- Filter by section and case
- Sort by name, score, hints, status, or completion time
- See completion status (Not Started, In Progress, Completed)
- View individual student transcripts and evaluations
- Toggle "Allow Re-chat" permission per student
- Export data to MySQL or CSV format
- Auto-refresh option for live monitoring during class

#### **AI Model Management**
- Create, edit, enable/disable, set default, and delete models in the `models` table
- Works with Google Gemini, OpenAI, and Anthropic model IDs (provider is auto-detected from the model_id)
- Prevents deleting models that are still assigned to sections
- **LLM Keys & Security:**
  - All provider calls are proxied through the backend
  - Keys are server-side env vars (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
  - No Vite-exposed keys are required on the client

### 9. Data Persistence
- Uses **MySQL** database for local storage
- Database schema includes:
  - `students` - Student records linked to CAS netid
  - `sections` - Course sections with model assignments
  - `cases` - Business case metadata
  - `case_files` - Uploaded case documents and teaching notes
  - `section_cases` - Junction table for section-case assignments with chat options
  - `evaluations` - Student performance data, scores, transcripts
  - `models` - AI model configurations
  - `admins` - Admin user accounts
- Express.js backend API server for database operations
- File storage in `case_files/{case_id}/` directories

### 10. Student Case Selection Flow
1. Student logs in (via CAS or local auth)
2. Student selects or confirms their course section
3. App displays all cases that are **active** for that section
4. Student selects a case and protagonist persona
5. Student reads the case and begins the conversation
6. After evaluation, student can start a new case (if multiple are active) or re-chat (if allowed by instructor)

### 11. Graceful API Error Handling
When the AI model is temporarily unavailable (e.g., due to rate limiting during high-traffic classroom sessions):
- Students see a friendly in-character message from the CEO asking them to wait
- The app automatically retries the request after 25 seconds
- On success, the conversation continues seamlessly with a "Thank you for your patience" message
- A subtle audio alert (double-beep) notifies the instructor that errors are occurring
- No technical jargon is shown to students

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express.js
- **AI**: Multi-provider support (Google Gemini, OpenAI, Anthropic)
- **Database**: MySQL
- **Build**: Vite
- **File Storage**: Local filesystem for case documents
- **Authentication**: JWT + BYU CAS integration

## Chat Options Configuration

Chat options are stored as JSON in the `section_cases.chat_options` column. The schema is documented in `config/chat_options.md`:

- **hints_allowed** (int, default 3): Maximum hints a student can request (0 disables hints)
- **free_hints** (int, default 1): Hints that don't penalize score
- **ask_for_feedback** (boolean, default false): Collect helpfulness rating and feedback
- **ask_save_transcript** (boolean, default false): Ask permission for anonymized transcript
- **allowed_personas** (CSV string, default "moderate,strict,liberal,leading,sycophantic"): Available personas
- **default_persona** (string, default "moderate"): Pre-selected persona

These options are configured per section-case assignment in the admin dashboard.

## Use Cases
The app has been tested with:
- Undergraduate GSCM (Global Supply Chain Management) students at BYU
- MBA 530 classes

## Running Locally

**Prerequisites:** Node.js, MySQL Server

1. Install dependencies:
   ```
   npm install
   ```

2. Set up MySQL database:
   ```sql
   mysql -u root -p < docs/mysql-database-structure-Oct2025.sql
   ```

3. Copy `env.local.example` to `.env.local` and configure:
   - `GEMINI_API_KEY` - Your Gemini API key
   - `MYSQL_USER` - Your MySQL username
   - `MYSQL_PASSWORD` - Your MySQL password
   - `JWT_SECRET` - A random string for JWT token signing

4. Run the database migrations:
   ```sql
   mysql -u root -p < server/migrations/add_admin_auth.sql
   mysql -u root -p < server/migrations/add_cases_tables.sql
   ```

5. (Optional) Seed the initial case:
   ```
   npm run seed-malawis
   ```

6. Create an admin user:
   ```
   npm run create-admin admin@example.com yourpassword
   ```

7. Start the backend server:
   ```
   npm run server
   ```

8. In a separate terminal, start the frontend:
   ```
   npm run dev
   ```

Or run both together:
   ```
   npm run dev:all
   ```

The app will be available at `http://localhost:3000/`

## Accessing the Instructor Dashboard

- Navigate to `#/admin` or Ctrl+click on the header title
- Requires authentication with admin email/password stored in MySQL

## BYU CAS Authentication (Admins & Students)

- Enable CAS by setting `CAS_ENABLED=true` in `.env.local`.
- Configure CAS endpoints:
  - `CAS_SERVER_URL` (e.g., `https://cas.byu.edu/cas`, trailing `/` preferred)
  - `CAS_SERVICE_BASE_URL` (public URL where the app is reachable, no trailing slash; include sub-path like `/chatwithceo` if hosted under one)
  - `SESSION_COOKIE_PATH` should match the app path (e.g., `/chatwithceo`).
- Attribute mappings (override if your CAS uses different names):
  - `CAS_ATTR_EMAIL_FIELD` (default `emailAddress`)
  - `CAS_ATTR_NETID_FIELD` (default `user`)
  - `CAS_ATTR_FIRSTNAME_FIELD` (default `givenName`)
  - `CAS_ATTR_LASTNAME_FIELD` (default `sn`)
- Flow:
  - Admins: can log in with CAS **or** existing email/password; CAS issues the same JWT format.
  - Students: must log in with CAS; the backend auto-creates/updates a student record keyed to the CAS netid and then requires section/persona selection before chatting.
- CAS routes:
  - `/api/cas/login` (redirects to CAS)
  - `/api/cas/verify` (CAS callback, issues JWT, redirects to app with token)
  - `/api/cas/logout` (returns CAS logout URL; client removes JWT)
- Restart note: on Windows any file change restarts the app automatically; on Linux you can `touch wsgi.py` (not needed here unless deployed similarly).

---

*This is an innovative teaching tool that uses AI to create an interactive, personalized case study experience where students practice executive-level business discussions.*

