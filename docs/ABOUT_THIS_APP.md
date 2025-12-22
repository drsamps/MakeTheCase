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

### 7. Data Persistence
- Uses **Supabase** for cloud storage
- Tracks students, evaluations, transcripts, and sections
- Can export to MySQL for analysis

### 8. Graceful API Error Handling
When the AI model is temporarily unavailable (e.g., due to rate limiting during high-traffic classroom sessions):
- Students see a friendly in-character message from the CEO asking them to wait
- The app automatically retries the request after 25 seconds
- On success, the conversation continues seamlessly with a "Thank you for your patience" message
- A subtle audio alert (double-beep) notifies the instructor that errors are occurring
- No technical jargon is shown to students

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS
- **AI**: Google Gemini API
- **Database**: Supabase (with MySQL export capability)
- **Build**: Vite

## Use Cases
The app has been tested with:
- Undergraduate GSCM (Global Supply Chain Management) students at BYU
- MBA 530 classes

## Running Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Set the `GEMINI_API_KEY` in `.env.local` to your Gemini API key
3. Run the app:
   ```
   npm run dev
   ```

The app will be available at `http://localhost:3000/`

## Accessing the Instructor Dashboard

- Navigate to `#/admin` or Ctrl+click on the header title
- Requires authentication via Supabase

---

*This is an innovative teaching tool that uses AI to create an interactive, personalized case study experience where students practice executive-level business discussions.*

