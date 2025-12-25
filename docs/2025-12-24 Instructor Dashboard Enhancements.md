# Instructor Dashboard Enhancements - December 24, 2025

## Overview
Enhanced the Instructor Dashboard with improved section management and user experience improvements.

## Changes Made

### 1. Course Sections STATUS Column
**Problem:** The STUDENTS and STATUS columns were redundant - both showed completed/started counts and pending counts, which are mathematically related.

**Solution:** Repurposed the STATUS column to show section enabled/disabled state with toggle functionality.

**Features:**
- Clickable status buttons to enable/disable sections
- **Enabled** sections: Green badge (`bg-green-100 text-green-800`)
- **Disabled** sections: Pink badge (`bg-pink-100 text-pink-800`)
- Disabled sections appear dimmed with reduced opacity
- Cannot toggle special sections ("Not in a course" and "Other course sections")
- Changes persist to MySQL database immediately

**Technical Notes:**
- MySQL stores enabled as `0` (disabled) or `1` (enabled) - numbers, not booleans
- All comparisons changed from `=== false` / `!== false` to truthy/falsy checks
- Used `!section.enabled` for toggling to handle numeric values correctly
- Added Authorization header with JWT token for API requests

### 2. Student Count Tooltip
**Enhancement:** Added `title="completed/started"` tooltip to STUDENTS column numbers.

**Benefit:** Users can hover over counts like "37/54" to see what the numbers mean.

### 3. Changed "Active" to "Pending"
**Problem:** "Active" students implied they were currently online, but they might have abandoned the assignment.

**Solution:** Changed label to "Pending" - more accurately describes students who started but haven't completed.

**Note:** This field was removed from the STATUS column as it was redundant with STUDENTS (pending = started - completed).

### 4. Default View Mode
**Changed:** List/table view is now the default instead of tiles/grid view.

**Implementation:**
```typescript
const [sectionViewMode, setSectionViewMode] = useState<'tiles' | 'list'>('list');
```

### 5. View Toggle Button Order
**Changed:** Swapped button order so List view button appears on the left (primary position) and Tiles view on the right.

## API Endpoints Used

### PATCH `/api/sections/:id`
Updates section fields including enabled status.

**Request:**
```json
{
  "enabled": true
}
```

**Response:**
```json
{
  "data": {
    "section_id": "GSCM401-3-F25",
    "section_title": "...",
    "enabled": 1,
    ...
  },
  "error": null
}
```

## Running the Application

**Both servers must be running:**

```bash
npm run dev:all
```

This starts:
- Backend API server on `http://localhost:3001`
- Frontend dev server on `http://localhost:3000`

**Troubleshooting port conflicts:**

Windows:
```powershell
netstat -ano | findstr :3001
taskkill /F /PID <pid>
```

Mac/Linux:
```bash
lsof -ti:3001 | xargs kill -9
```

## Files Modified

- `components/Dashboard.tsx` - Main dashboard component with section management UI
- `docs/ABOUT_THIS_APP.md` - Updated with new features
- `README.md` - Updated with current setup instructions

## Database Schema

The `sections` table includes:
- `section_id` (VARCHAR) - Primary key
- `section_title` (VARCHAR)
- `year_term` (VARCHAR)
- `enabled` (TINYINT) - 0 or 1
- `chat_model` (VARCHAR, nullable)
- `super_model` (VARCHAR, nullable)
- `created_at` (TIMESTAMP)

## Future Enhancements

Potential improvements:
- Bulk enable/disable multiple sections
- Section archiving instead of hard delete
- View history of when sections were enabled/disabled
- Filter to show only enabled or disabled sections


