<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MakeTheCase - AI-Powered Case Study Teaching Tool

An interactive business case study simulator where students chat with an AI-powered CEO to practice case analysis.

**For detailed documentation, see [docs/ABOUT_THIS_APP.md](docs/ABOUT_THIS_APP.md)**

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
   ```

3. **Configure environment:**
   - Copy `env.local.example` to `.env.local`
   - Set `GEMINI_API_KEY`, `MYSQL_USER`, `MYSQL_PASSWORD`, `JWT_SECRET`

4. **Create admin account:**
   ```bash
   npm run create-admin admin@example.com yourpassword
   ```

5. **Run the app:**
   ```bash
   npm run dev:all
   ```
   This starts both the backend API (port 3001) and frontend (port 3000)

   **Or run separately:**
   ```bash
   npm run server    # Backend API on port 3001
   npm run dev       # Frontend on port 3000 (in separate terminal)
   ```

6. **Access the app:**
   - Student view: `http://localhost:3000/`
   - Instructor dashboard: `http://localhost:3000/#/admin` (or Ctrl+click header)

## Troubleshooting

**Port already in use errors:**
- Windows: `netstat -ano | findstr :3000` then `taskkill /F /PID <pid>`
- Mac/Linux: `lsof -ti:3000 | xargs kill -9`

**Both servers must be running** for the instructor dashboard to work properly.

View in AI Studio: https://ai.studio/apps/drive/11OE3-2Irr8PTsIxuDhEpNqXf3xbiT9zh
