# Case Assignment Scheduling Feature

## Summary
Added comprehensive scheduling controls to case assignments in the Assignments tab, allowing instructors to control when cases are available to students through date/time restrictions and manual overrides.

## New Functionality

### 1. Database Schema (Migration: 004_add_case_scheduling.sql)
Added three new columns to `section_cases` table:
- **`open_date`** (DATETIME NULL): When the case becomes available to students
- **`close_date`** (DATETIME NULL): When the case is no longer available for starting new chats
- **`manual_status`** (ENUM): Override control with three options:
  - `auto`: Use open_date and close_date to determine availability
  - `manually_opened`: Case is always available regardless of dates
  - `manually_closed`: Case is never available regardless of dates

### 2. Backend API Updates (server/routes/sectionCases.js)

#### New Endpoint
- **`PATCH /api/sections/:sectionId/cases/:caseId/scheduling`**
  - Updates scheduling fields (open_date, close_date, manual_status)
  - Returns updated assignment with all fields

#### Updated Endpoints
- **`GET /api/sections/:sectionId/cases`**: Now returns scheduling fields
- **`GET /api/sections/:sectionId/active-case`**: Includes availability check with `is_available` and `availability_message` fields
- **`POST /api/sections/:sectionId/cases`**: Accepts scheduling parameters when creating assignments
- All other case endpoints now include scheduling fields in responses

#### Helper Function
- **`isCaseAvailable(openDate, closeDate, manualStatus)`**: Server-side logic to determine case availability

### 3. Admin UI Updates (components/Dashboard.tsx)

#### Assignments Tab Enhancements
Added "Scheduling" button next to "Options" button for each assigned case:

**Scheduling Panel includes:**
1. **Availability Control dropdown**:
   - Auto (use dates below)
   - Always Available (manually opened)
   - Never Available (manually closed)
   - Dynamic help text explaining each mode

2. **Date/Time Controls** (only shown in Auto mode):
   - Open Date & Time picker (datetime-local input)
   - Close Date & Time picker (datetime-local input)
   - Clear instructions for each field

3. **Action Buttons**:
   - Cancel (discards changes)
   - Save Scheduling (persists to database)

**State Management:**
- Added `expandedScheduling`, `editingScheduling`, `isSavingScheduling` state variables
- `handleExpandScheduling()`: Opens scheduling panel and formats dates for input
- `handleSaveScheduling()`: Saves scheduling data via API

### 4. Student UI Updates (App.tsx)

#### Case Selection Screen
Students now see:
1. **Availability indicators**: "Not Available" badge for unavailable cases
2. **Availability messages**:
   - "Opens [date/time]" - if case hasn't opened yet
   - "Closed [date/time]" - if case has closed
   - "This case has been manually closed by the instructor." - if manually closed
3. **Disabled state**: Radio buttons are disabled for unavailable cases
4. **Visual feedback**: Grayed-out styling for unavailable cases

#### Availability Logic
Client-side `checkAvailability()` function checks:
1. Manual status override (takes precedence)
2. Open date restriction
3. Close date restriction
4. Returns availability status and appropriate message

## Important Behaviors

### For Instructors
- Dates and times are displayed in the browser's local timezone
- Manual override takes precedence over dates
- Setting a case as "manually opened" makes it immediately available
- Setting a case as "manually closed" immediately blocks access
- Changes take effect immediately upon saving

### For Students
- Cannot select cases that haven't opened yet
- Cannot select cases that have closed
- Can see when cases will open/close
- **Can continue existing chats even after close time** (close time only prevents starting new chats)
- Manual instructor override always takes precedence

## Testing Checklist

### Admin Testing
- [ ] Open Assignments tab
- [ ] Click "Scheduling" button on an assigned case
- [ ] Set open date to future → Save → Verify student can't access
- [ ] Set close date to past → Save → Verify student can't access
- [ ] Set manual_status to "manually_opened" → Save → Verify student can access immediately
- [ ] Set manual_status to "manually_closed" → Save → Verify student can't access
- [ ] Return to "auto" mode with valid dates → Save → Verify student can access

### Student Testing
- [ ] Log in as student
- [ ] Select section with scheduled cases
- [ ] Verify unavailable cases show "Not Available" badge
- [ ] Verify open/close dates are displayed correctly
- [ ] Verify can't select unavailable cases
- [ ] Verify can select and start available cases
- [ ] Start a chat before close time
- [ ] Wait for close time to pass
- [ ] Verify existing chat can continue
- [ ] Verify new chats cannot be started

## Files Modified

### New Files
1. `server/migrations/004_add_case_scheduling.sql` - Database migration
2. `dev/scheduling-feature-summary.md` - This documentation

### Modified Files
1. `server/routes/sectionCases.js` - Backend API endpoints and availability logic
2. `components/Dashboard.tsx` - Admin UI with scheduling controls
3. `App.tsx` - Student UI with availability display

## API Response Example

```json
{
  "data": {
    "id": 1,
    "section_id": "BUS-M-302-001",
    "case_id": "WAPO",
    "active": true,
    "chat_options": {...},
    "open_date": "2026-01-10T08:00:00.000Z",
    "close_date": "2026-01-17T23:59:00.000Z",
    "manual_status": "auto",
    "case_title": "Washington Post",
    "created_at": "2026-01-05T10:00:00.000Z"
  },
  "error": null
}
```

## Future Enhancements (Optional)
- Bulk scheduling for multiple cases
- Recurring schedule patterns
- Timezone selection for instructors
- Email notifications when cases open/close
- Grace period after close time
- Countdown timer showing time until open/close
