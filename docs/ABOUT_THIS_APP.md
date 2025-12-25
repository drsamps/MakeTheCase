# About MakeTheCase

## Purpose

**MakeTheCase** is an **educational AI-powered case teaching tool** designed for business students. It simulates a conversation with a case study protagonist (e.g., Kent Beck, CEO of Malawi's Pizza) to help students practice analyzing a business case study and developing recommendations.

## Main Functionality

### 1. Simulated CEO Conversation
- Students engage in a real-time chat with an AI-simulated CEO powered by Google's Gemini models (Flash/Pro)
- The CEO poses a strategic business question: *"Should we stay in the catering business, or is pizza catering a distraction from our core restaurant operations?"*
- Students must reference facts from the case study to support their recommendations

### 2. Business Case Study Display
- The app presents the **Malawi's Pizza Catering** case study in a side panel
- Students read the case and cite relevant facts when chatting with the CEO

### 3. Multiple CEO Personas
Students can select different CEO personalities that affect how strictly the AI requires case citations:
- **Moderate** (recommended)
- **Strict**
- **Liberal**
- **Leading**
- **Sycophantic**

### 4. AI Evaluation & Scoring
After the conversation ends:
- An "AI Supervisor" evaluates the student's performance
- Provides a score (out of 15) based on criteria
- Gives feedback on how well the student analyzed the case

### 5. Feedback Collection
The app collects student feedback including:
- Helpfulness rating (1-5)
- What students liked
- Improvement suggestions
- Optional anonymized transcript sharing for research

### 6. Instructor Dashboard
- Protected admin view (`#/admin`) for instructors
- Allows downloading student data to MySQL
- Manages course sections and AI model settings
- **Course Sections Features:**
  - View all sections in list or tile view (list is default)
  - See student progress: completed/started count with tooltip
  - Toggle section status with clickable Enabled/Disabled buttons
    - Enabled sections show with green badge
    - Disabled sections show with pink badge and dimmed appearance
  - Create, edit, and duplicate sections
  - Assign specific AI models per section
- **Student Details:**
  - View individual student transcripts and evaluations
  - Sort by name, score, hints, or completion time
  - See completion status and persona used

### 7. Data Persistence
- Uses **MySQL** database for local storage
- Tracks students, evaluations, transcripts, and sections
- Express.js backend API server for database operations

### 8. Graceful API Error Handling
When the AI model is temporarily unavailable (e.g., due to rate limiting during high-traffic classroom sessions):
- Students see a friendly in-character message from the CEO asking them to wait
- The app automatically retries the request after 25 seconds
- On success, the conversation continues seamlessly with a "Thank you for your patience" message
- A subtle audio alert (double-beep) notifies the instructor that errors are occurring
- No technical jargon is shown to students

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express.js
- **AI**: Google Gemini API
- **Database**: MySQL
- **Build**: Vite

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

4. Run the database migration to add auth columns:
   ```sql
   mysql -u root -p < server/migrations/add_admin_auth.sql
   ```

5. Create an admin user:
   ```
   npm run create-admin admin@example.com yourpassword
   ```

6. Start the backend server:
   ```
   npm run server
   ```

7. In a separate terminal, start the frontend:
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

---

*This is an innovative teaching tool that uses AI to create an interactive, personalized case study experience where students practice executive-level business discussions.*

