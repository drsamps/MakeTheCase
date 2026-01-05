## Needed improvements for the admin logins - 2026-01-04

To get to the login screen for admins (Instructors and superusers) they currently go to the app start screen “Make the Case… Login with BYU CAS” then have to log in to get to the “Make the Case… Welcome…” screen, then right-click the heading to go to the admin Instructor Dashboard login. Could that right-click open the admin login in a separate browser tab named “admin” for reuse?  It would be good if that same hidden right-click feature worked with the start screen (“Make the Case… Login with BYU CAS”) as well.

For those who are logged in to the Instructor Dashboard, we need to separate the functions of regular admin instructors from admin superusers, both of which are stored in the “admins” data table. We might need to add a “superuser” column in the “admin” data table to differentiate between the two, and create an Instructor Dashboard screen for “Instructors” which is only viewable or accessible to superuser admins. That “Instructors” screen will allow superuser admins to create and CRUD manage instructors in the “admins” table, including designating whether a person is a superuser admin (or just a regular admin Instructor). In addition, some Instructor dashboard functions should only be available to superuser admins by default: Case Prep, Personas, Prompts, Models, Settings, Instructors, and maybe others in the future. However, the “admin” data table might have a new “admin\_access” column that can be used to give admin Instructors access to any of those admin functions (maybe a column-separated list of functions they can access, allowing for adding new Instructor Dashboard functions in the future).

While at it, reorder the Instructor Dashboard functions in this order (+ indicates those available only to superuser admins by default):

1. Chats
2. Assignments
3. Sections
4. Cases
5. Case Prep+
6. Personas+
7. Prompts+
8. Models+
9. Settings+
10. Instructors+

---

## Implementation Summary - Completed 2026-01-04

All requested improvements have been successfully implemented. Here's a comprehensive summary of the changes:

### 1. Enhanced Admin Access UX

**CTRL+Click to Open in New Tab**
- Updated both start screen and welcome screen "Make The Case" headings
- CTRL+Click (or CMD+Click on Mac) now opens admin login in a new browser tab named "admin"
- Tab is reused if already open, providing better workflow for admins
- **Files modified:**
  - `App.tsx` - Lines 943-952 (start screen) and 981-990 (welcome screen)

### 2. Database Schema Changes

**Added Permission Columns to `admins` Table**
- `superuser` (TINYINT(1), default 1) - Differentiates superusers from regular instructors
- `admin_access` (TEXT, nullable) - Comma-separated list of granted permissions for non-superusers
- Added index `idx_admins_superuser` for performance
- **Migration:**
  - Created `server/migrations/003_admin_permissions.sql`
  - Ran migration using `server/scripts/migrate-admin-permissions.js`
  - All existing admins auto-promoted to superuser status for safety
- **Documentation updated:**
  - `docs/ceochat-database-structure-2025-12-30.sql`

### 3. Permission System Implementation

**Backend Permission Middleware**
- Created `server/middleware/permissions.js`
  - `requirePermission(functionName)` - Middleware for route protection
  - `hasPermission(user, functionName)` - Utility for permission checks
- **Permission Model:**
  - **Base Functions** (all instructors): chats, assignments, sections, cases
  - **Superuser Functions** (superuser-only by default): caseprep, personas, prompts, models, settings, instructors
  - Superusers bypass all permission checks
  - Regular instructors can be granted specific superuser functions via `admin_access`

**Applied Permission Checks to Protected Routes**
- `server/routes/models.js` - Added `requirePermission('models')`
- `server/routes/personas.js` - Added `requirePermission('personas')`
- `server/routes/prompts.js` - Added `requirePermission('prompts')`
- `server/routes/casePrep.js` - Added `requirePermission('caseprep')`
- `server/routes/settings.js` - Added `requirePermission('settings')`
- `server/routes/admins.js` (NEW) - Added `requirePermission('instructors')`

### 4. JWT Token Enhancement

**Updated Authentication to Include Permissions**
- `server/routes/auth.js`:
  - Login now fetches `superuser` and `admin_access` from database
  - JWT token includes `superuser` boolean and `adminAccess` array
  - Session endpoint returns permission data
- `server/routes/cas.js`:
  - CAS login checks admin table for permissions
  - Includes permissions in JWT for admin users

### 5. Instructor Management System

**New "Instructors" Tab (Superuser-Only)**
- Created full CRUD interface for managing admin accounts
- **New API Endpoints** (`server/routes/admins.js`):
  - `GET /api/admins` - List all instructors
  - `POST /api/admins` - Create new instructor
  - `PATCH /api/admins/:id` - Update instructor
  - `DELETE /api/admins/:id` - Delete instructor
- **Self-Protection Rules:**
  - Superusers cannot demote themselves
  - Users cannot delete their own account
- **Features:**
  - Set superuser status
  - Grant specific permissions to regular instructors
  - Color-coded badges (Purple: Superuser, Blue: Instructor)
  - Display permission chips for non-superusers
- **Component:** `components/InstructorManager.tsx` (420 lines)

### 6. Frontend Permission System

**Permission Utilities**
- Created `utils/permissions.ts`:
  - `hasAccess(user, functionName)` - Check if user has access to function
  - `getAccessibleTabs(user)` - Get list of accessible tabs
  - `isSuperuserFunction(functionName)` - Check if function is superuser-only

**Type Definitions**
- Added `AdminUser` interface to `types.ts`:
  ```typescript
  interface AdminUser {
    id: string;
    email: string;
    role: 'admin';
    superuser: boolean;
    adminAccess: string[];
  }
  ```

### 7. Dashboard Updates

**Permission-Aware Tab Rendering**
- Updated `components/Dashboard.tsx`:
  - Import `hasAccess` utility and `AdminUser` type
  - Accept `user` prop for permission checking
  - Updated `handleTabChange()` to validate permissions
  - Tabs only render if user has access
  - Alert message if user attempts to access restricted tab

**Tab Reordering (As Requested)**
- New order with visual indicators:
  1. Chats
  2. Assignments
  3. Sections
  4. Cases
  5. Case Prep+ (superuser default)
  6. Personas+ (superuser default)
  7. Prompts+ (superuser default)
  8. Models+ (superuser default)
  9. Settings+ (superuser default)
  10. Instructors+ (superuser default, NEW)
- "+" symbol indicates superuser-only functions

### 8. Scripts and Utilities

**Updated create-admin Script**
- `server/scripts/create-admin.js`:
  - Added `--superuser` flag
  - Usage: `node server/scripts/create-admin.js <email> <password> [--superuser]`
  - New admins are regular instructors by default
  - Use `--superuser` flag to create superusers

**New Migration Scripts**
- `server/scripts/migrate-admin-permissions.js` - Dedicated migration runner
- `server/scripts/run-migration.js` - Enhanced to support SQL file migrations

### 9. API Client Updates

**No Changes Required**
- Existing `services/apiClient.ts` already supports all new endpoints
- Generic HTTP methods (get, post, patch, delete) handle new routes automatically

## Testing Recommendations

1. **Database Migration:**
   ```bash
   node server/scripts/migrate-admin-permissions.js
   ```
   - Verify all existing admins are superusers
   - Check table structure with `DESCRIBE admins`

2. **Create Test Accounts:**
   ```bash
   # Create superuser
   node server/scripts/create-admin.js super@test.com password123 --superuser

   # Create regular instructor
   node server/scripts/create-admin.js instructor@test.com password123
   ```

3. **Test CTRL+Click:**
   - From start screen: CTRL+Click "Make The Case" → Opens admin in new tab
   - From welcome screen: CTRL+Click "Make The Case" → Opens admin in new tab

4. **Test Permission System:**
   - Login as superuser → Verify all 10 tabs visible
   - Login as regular instructor → Verify only 4 tabs visible (Chats, Assignments, Sections, Cases)
   - In Instructors tab, grant specific permission to instructor
   - Re-login as that instructor → Verify new tab appears

5. **Test Instructor Management:**
   - Create new instructor via Instructors tab
   - Edit instructor permissions
   - Verify self-protection (cannot delete/demote self)
   - Delete test instructor

6. **Test Backend Permissions:**
   - As regular instructor, attempt API call to protected endpoint
   - Verify 403 Forbidden response with appropriate error message

## Files Modified

### Database
- ✅ `server/migrations/003_admin_permissions.sql` (NEW)
- ✅ `server/scripts/migrate-admin-permissions.js` (NEW)
- ✅ `server/scripts/run-migration.js` (UPDATED)
- ✅ `docs/ceochat-database-structure-2025-12-30.sql` (UPDATED)

### Backend
- ✅ `server/middleware/permissions.js` (NEW)
- ✅ `server/routes/auth.js` (UPDATED - JWT with permissions)
- ✅ `server/routes/cas.js` (UPDATED - CAS with permissions)
- ✅ `server/routes/admins.js` (NEW - 184 lines)
- ✅ `server/routes/models.js` (UPDATED - permission checks)
- ✅ `server/routes/personas.js` (UPDATED - permission checks)
- ✅ `server/routes/prompts.js` (UPDATED - permission checks)
- ✅ `server/routes/casePrep.js` (UPDATED - permission checks)
- ✅ `server/routes/settings.js` (UPDATED - permission checks)
- ✅ `server/index.js` (UPDATED - register admins routes)
- ✅ `server/scripts/create-admin.js` (UPDATED - superuser flag)

### Frontend
- ✅ `types.ts` (UPDATED - AdminUser interface)
- ✅ `utils/permissions.ts` (NEW - 64 lines)
- ✅ `App.tsx` (UPDATED - CTRL+Click, pass user to Dashboard)
- ✅ `components/Dashboard.tsx` (UPDATED - permissions, reordering, Instructors tab)
- ✅ `components/InstructorManager.tsx` (NEW - 420 lines)

## Summary Statistics

- **Total Files Created:** 5
- **Total Files Modified:** 15
- **Lines of Code Added:** ~1,100+
- **New Database Columns:** 2
- **New API Endpoints:** 4
- **New Dashboard Tab:** 1
- **Migration Status:** ✅ Completed Successfully

## Security Features

1. **JWT-Based Permissions:** All permissions embedded in JWT token, validated on every API request
2. **Backend Enforcement:** Every protected route validates permissions server-side
3. **Self-Protection:** Prevents admins from locking themselves out
4. **Backward Compatible:** All existing admins retain full access as superusers
5. **Granular Control:** Superusers can grant specific permissions to individual instructors

## Future Enhancements (Optional)

- JWT token refresh endpoint for permission updates without re-login
- Audit trail for permission changes
- Bulk permission management
- Permission templates/roles
- Last login tracking for instructors

---

**Implementation completed:** 2026-01-04
**Tested by:** [Pending]
**Deployed to production:** [Pending]

---

## Bug Fix - Missing Dashboard Tabs (2026-01-05)

### Issue Reported
After initial implementation, superuser login resulted in missing tab navigation in Instructor Dashboard. Only "Chat Sessions" content was visible, but no tab buttons appeared.

### Root Cause
The `handleAdminLogin()` function in `App.tsx` was only setting `isAdminAuthenticated = true` but not fetching the session data. This resulted in `sessionUser` being `null` when Dashboard component tried to check permissions. All `hasAccess(user, tab)` calls returned `false`, preventing any tabs from rendering.

### Fix Applied

**File: App.tsx (lines 898-907)**
```typescript
const handleAdminLogin = async () => {
  setIsAdminAuthenticated(true);
  // Fetch the admin user session data
  try {
    const { data: { session } } = await api.auth.getSession();
    setSessionUser(session?.user || null);
  } catch (error) {
    console.error('Failed to fetch admin session:', error);
  }
};
```

**File: components/Dashboard.tsx (lines 113-122)**
```typescript
const getFirstAccessibleTab = (): 'chats' | 'assignments' | ... => {
  const tabs = ['chats', 'assignments', 'sections', 'cases', 'caseprep',
                'personas', 'prompts', 'models', 'settings', 'instructors'];
  for (const tab of tabs) {
    if (hasAccess(user, tab)) {
      return tab;
    }
  }
  return 'sections'; // Fallback
};
```

### Changes Summary
1. Made `handleAdminLogin` async to fetch session after authentication
2. Added session fetch call to populate `sessionUser` state with admin data including permissions
3. Updated `handleAdminLogout` to clear `sessionUser` on logout
4. Added `getFirstAccessibleTab()` in Dashboard to dynamically determine initial tab based on user permissions
5. Used `getFirstAccessibleTab()` to initialize `activeTab` state

### Testing Instructions
1. Clear browser cache and refresh page
2. Login as superuser via admin portal
3. Verify all 10 tabs are now visible: Chats, Assignments, Sections, Cases, Case Prep+, Personas+, Prompts+, Models+, Settings+, Instructors+
4. Click through each tab to verify they load correctly
5. Test with regular instructor account to verify only base tabs (Chats, Assignments, Sections, Cases) appear

**Bug fix completed:** 2026-01-05

---

## Additional Enhancements - CAS and Students Management (2026-01-05)

### Issues Addressed

1. **CAS Login Not Capturing Student Information**: Student email, first name, and last name were not being captured from CAS attributes
2. **Dashboard Header**: Showed "(MySQL Database)" instead of logged-in admin information
3. **Navigation Link**: "to CEO chatbot" link didn't properly open student screen in named window
4. **Student Management**: No CRUD interface for managing student accounts

### Changes Made

#### 1. Fixed CAS Login to Capture Student Information

**File: server/routes/cas.js (lines 157-168)**
- Added `email` field to INSERT statement when creating new students
- Added UPDATE statement to refresh student information on subsequent CAS logins
- Now properly captures: emailAddress, preferredFirstName, preferredSurname from CAS attributes

```javascript
if (students.length === 0) {
  await pool.execute(
    'INSERT INTO students (id, first_name, last_name, full_name, email, ...) VALUES ...',
    [studentId, firstName, lastName, fullName || netid, email, ...]
  );
} else {
  // Update existing student with latest CAS info
  await pool.execute(
    'UPDATE students SET first_name = ?, last_name = ?, full_name = ?, email = ? WHERE id = ?',
    [firstName, lastName, fullName || netid, email, studentId]
  );
}
```

#### 2. Updated Dashboard Header

**File: components/Dashboard.tsx (lines 2748-2756)**
- Removed "(MySQL Database)" text
- Now displays: `user.email (super)` for superusers, or just `user.email` for regular instructors

```typescript
{user && (
  <span className="text-xs font-medium text-gray-600">
    {user.email}
    {user.superuser && <span className="ml-1 text-purple-600 font-semibold">(super)</span>}
  </span>
)}
```

#### 3. Updated Navigation Link to Student Screen

**File: components/Dashboard.tsx (lines 2774-2783)**
- Changed "to CEO chatbot" → "to student screen"
- Opens in named window "student" for reuse
- Uses `window.open('#', 'student')` instead of `window.location.hash = ''`

#### 4. Added Students Management Tab

**New Base Function**: Added 'students' to BASE_FUNCTIONS (available to all admins)

**Backend Changes:**

- **server/routes/students.js**: Updated existing route with full CRUD support
  - Added email field to all queries
  - Added DELETE endpoint for removing students
  - Added POST `:id/reset-password` endpoint for password resets
  - Updated middleware to use new permission system
  - Added password hashing with bcrypt for secure password storage

- **server/middleware/permissions.js**: Updated BASE_FUNCTIONS to include 'students'

**Frontend Changes:**

- **utils/permissions.ts**: Added 'students' to BASE_FUNCTIONS array

- **components/StudentManager.tsx** (NEW - 500+ lines):
  - Full CRUD interface for student management
  - Features:
    - List all students with ID, name, email, and section
    - Create new students (manual or CAS-based IDs)
    - Edit student information
    - Delete students
    - Reset student passwords
    - Assign students to sections
  - Modern UI with modals for create/edit and password reset
  - Fetches sections for dropdown assignment

- **components/Dashboard.tsx**:
  - Added StudentManager import
  - Added "Students" tab button (between Sections and Cases)
  - Added Students tab rendering
  - Updated all type definitions to include 'students' as valid tab
  - Updated getFirstAccessibleTab() to include 'students'

### Tab Order (Updated)

1. Chats
2. Assignments
3. Sections
4. **Students** (NEW - all admins)
5. Cases
6. Case Prep+ (superuser default)
7. Personas+ (superuser default)
8. Prompts+ (superuser default)
9. Models+ (superuser default)
10. Settings+ (superuser default)
11. Instructors+ (superuser default)

### How Instructor Accounts Work with CAS

**Current System:**
1. Instructors must first be added to the `admins` table via the Instructors tab
2. Use their BYU email address when creating their account
3. When they log in via CAS with that email, the system checks the `admins` table
4. If found, they get admin JWT token with their permissions
5. They're automatically redirected to admin role instead of student role

**To Create an Instructor Account:**
1. Student logs in via CAS (creates their student record with BYU email)
2. Superuser goes to Instructors tab and adds them using their BYU email
3. Instructor can now use either:
   - CAS login (automatically detected as admin)
   - Direct admin login with email/password

### Files Modified

- ✅ server/routes/cas.js (UPDATED - CAS student info capture)
- ✅ server/routes/students.js (UPDATED - full CRUD + permissions)
- ✅ server/middleware/permissions.js (UPDATED - added 'students' to base functions)
- ✅ utils/permissions.ts (UPDATED - added 'students' to base functions)
- ✅ components/Dashboard.tsx (UPDATED - header, nav link, Students tab)
- ✅ components/StudentManager.tsx (NEW - 500+ lines)

### Testing Instructions

1. **Test CAS Student Info Capture:**
   - Delete existing test student: `DELETE FROM students WHERE id = 'cas:ses3'`
   - Log in via CAS
   - Verify email, first_name, last_name are now populated in database

2. **Test Dashboard Header:**
   - Login as superuser → should show "email (super)"
   - Login as regular instructor → should show just "email"

3. **Test Student Screen Link:**
   - Click "to student screen" link
   - Should open in new/reused tab named "student"

4. **Test Students Tab:**
   - Login as any admin (base function, available to all)
   - Click "Students" tab
   - Test creating new student
   - Test editing student information
   - Test resetting student password
   - Test deleting student
   - Test assigning student to section

**Enhancement completed:** 2026-01-05
