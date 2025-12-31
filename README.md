<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MakeTheCase - AI-Powered Case Study Teaching Tool

An interactive business case study simulator where students chat with AI-powered case protagonists to practice case analysis and strategic thinking.

## Features
- 📚 **Multi-Case Support** - Upload and manage multiple business cases
- 🎭 **Dynamic Protagonists** - Each case has its own protagonist personality
- ⚙️ **Configurable Chat Options** - Control hints, feedback, and personas per section-case
- 📊 **Comprehensive Analytics** - Track student performance across cases
- 🔄 **Flexible Assignment** - Activate different cases for different days
- 🤖 **Multi-Provider AI** - Works with Google Gemini, OpenAI, and Anthropic

## Documentation
- **[ABOUT_THIS_APP.md](docs/ABOUT_THIS_APP.md)** - Complete app overview and features
- **[CASE_MANAGEMENT_GUIDE.md](docs/CASE_MANAGEMENT_GUIDE.md)** - How to create and manage multiple cases

## Quick Start

**Prerequisites:** Node.js, MySQL Server

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up MySQL database:**
   ```bash
   mysql -u root -p < docs/mysql-database-structure-Oct2025.sql
   mysql -u root -p < server/migrations/add_admin_auth.sql
   mysql -u root -p < server/migrations/add_cases_tables.sql
   ```

3. **(Optional) Seed initial case:**
   ```bash
   npm run seed-malawis
   ```

4. **Configure environment:**
   - Copy `env.local.example` to `.env.local`
   - Set `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
   - Set `MYSQL_USER`, `MYSQL_PASSWORD`, `JWT_SECRET`

5. **Create admin account:**
   ```bash
   npm run create-admin admin@example.com yourpassword
   ```

6. **Run the app:**
   ```bash
   npm run dev:all
   ```
   This starts both the backend API (port 3001) and frontend (port 3000)

   **Or run separately:**
   ```bash
   npm run server    # Backend API on port 3001
   npm run dev       # Frontend on port 3000 (in separate terminal)
   ```

7. **Access the app:**
   - Student view: `http://localhost:3000/`
   - Instructor dashboard: `http://localhost:3000/#/admin` (or Ctrl+click header)

## Case Management

See **[CASE_MANAGEMENT_GUIDE.md](docs/CASE_MANAGEMENT_GUIDE.md)** for complete instructions on:
- Creating and uploading new cases
- Assigning cases to sections
- Activating cases for specific days
- Configuring chat options (hints, feedback, personas)

## Model management
- Sign in to the instructor dashboard and open the **Models** tab.
- Create/edit/enable/disable/delete models; setting a model as default clears previous defaults.
- Model IDs can be Gemini, OpenAI (gpt-*/o*), or Anthropic (claude-*); provider is auto-detected.
- Models assigned to sections must be reassigned before deletion.

## Troubleshooting

**Port already in use errors:**
- Windows: `netstat -ano | findstr :3000` then `taskkill /F /PID <pid>`
- Mac/Linux: `lsof -ti:3000 | xargs kill -9`

**Both servers must be running** for the instructor dashboard to work properly.

View in AI Studio: https://ai.studio/apps/drive/11OE3-2Irr8PTsIxuDhEpNqXf3xbiT9zh
