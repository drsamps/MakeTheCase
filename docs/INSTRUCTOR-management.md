# Instructor and Admin Access Control

This document describes the four-tier access control system for MakeTheCase.

## Overview

MakeTheCase uses a four-tier access control system:

| Tier | Table | Description |
|------|-------|-------------|
| **Superuser Admin** | `admins` (superuser=1) | Full system access |
| **Regular Admin** | `admins` (superuser=0) | Function-based access via `admin_access` field |
| **Primary Instructor** | `instructors` | Assigned to semesters; can manage courses/sections within them |
| **TA (Teaching Assistant)** | `instructors` | Assigned to specific sections only |

## Database Schema

### Admins Table
Stores admin accounts (both superusers and regular admins).

```sql
admins (
  id              CHAR(36) PRIMARY KEY,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(255),
  who             VARCHAR(200),        -- Display name
  superuser       TINYINT(1),          -- 1 = full access, 0 = limited
  admin_access    TEXT                 -- Comma-separated permissions
)
```

### Instructors Table
Stores instructor accounts (both primary instructors and TAs).

```sql
instructors (
  id              CHAR(36) PRIMARY KEY,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(255),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  full_name       VARCHAR(200),
  active          TINYINT(1),          -- Can log in if active
  last_login      TIMESTAMP
)
```

### Instructor-Semester Assignments
Links primary instructors to semesters they can manage.

```sql
instructor_semesters (
  id              INT PRIMARY KEY,
  instructor_id   CHAR(36),            -- FK to instructors
  semester_id     INT,                 -- FK to semesters
  assigned_at     TIMESTAMP,
  assigned_by     CHAR(36)             -- Admin who made assignment
)
```

### Instructor-Section Assignments (TAs)
Links TAs to specific sections with granular permissions.

```sql
instructor_sections (
  id                  INT PRIMARY KEY,
  instructor_id       CHAR(36),        -- FK to instructors
  section_id          VARCHAR(20),     -- FK to sections
  can_manage_students TINYINT(1),      -- Permission to add/remove students
  can_manage_cases    TINYINT(1),      -- Permission to assign/configure cases
  can_view_chats      TINYINT(1),      -- Permission to view student conversations
  assigned_at         TIMESTAMP,
  assigned_by         CHAR(36)
)
```

## Access Levels Explained

### 1. Superuser Admins
- **Who**: System administrators
- **Access**: Full access to all features and data
- **Can do**:
  - Everything
  - Create/delete semesters
  - Manage all admin and instructor accounts
  - Assign instructors to semesters
  - Access all courses, sections, and student data
  - Share/unshare cases

### 2. Regular Admins
- **Who**: Staff with dashboard access but limited permissions
- **Access**: Base access plus additional permissions from `admin_access` field
- **Base access includes**:
  - View and manage sections (all sections)
  - View student chats and evaluations
  - Manage case assignments
- **Additional permissions** (granted via `admin_access`):
  - `caseprep` - Case preparation tools
  - `personas` - Manage chat personas
  - `prompts` - Edit system prompts
  - `models` - Configure AI models
  - `settings` - System settings
  - `instructors` - Manage instructor accounts

### 3. Primary Instructors
- **Who**: Faculty assigned to teach in specific semesters
- **Access**: Limited to their assigned semesters and derived courses/sections
- **Assignment**: Linked to semesters via `instructor_semesters` table
- **Can do**:
  - Create courses within their assigned semesters
  - Create sections within their courses
  - Manage all sections in their courses
  - Assign TAs to their sections
  - View student chats and evaluations for their sections
  - Create and share cases
- **Cannot do**:
  - Create or delete semesters
  - Access other instructors' semesters/courses
  - Manage admin accounts

### 4. TAs (Teaching Assistants)
- **Who**: Graduate students or assistants helping with specific sections
- **Access**: Limited to specifically assigned sections
- **Assignment**: Linked to sections via `instructor_sections` table
- **Permissions are granular per section**:
  - `can_manage_students` - Add/remove students from the section
  - `can_manage_cases` - Configure case assignments for the section
  - `can_view_chats` - View student conversations and evaluations
- **Cannot do**:
  - Create courses or sections
  - Access sections they're not assigned to
  - Assign other TAs

## Access Inheritance

```
Primary Instructor assigned to Semester
    └── Can access all Courses in that Semester
        └── Can access all Sections in those Courses

TA assigned to Section
    └── Can only access that specific Section
```

## Case Ownership and Sharing

Cases have ownership tracking:

```sql
cases (
  ...
  created_by_type  ENUM('admin', 'instructor'),
  created_by       CHAR(36),
  is_shared        TINYINT(1),
  shared_at        TIMESTAMP,
  shared_by        CHAR(36)
)
```

- **Private cases** (`is_shared=0`): Only visible to creator and superusers
- **Shared cases** (`is_shared=1`): Visible to all admins and instructors
- **Sharing**: Case owner can share; only superusers can unshare
- **Migration note**: All pre-existing cases were marked as shared for backward compatibility

## Login Flow

1. User submits email/password to `/api/auth/login`
2. System checks `admins` table first
   - If found: Authenticate, return token with `role: 'admin'`
3. If not in admins, check `instructors` table
   - If found and `active=1`: Authenticate, return token with `role: 'instructor'`
4. Token includes role, which determines middleware behavior

## API Middleware

Key middleware functions in `server/middleware/instructorAccess.js`:

| Middleware | Description |
|------------|-------------|
| `requireSuperuser` | Only superuser admins |
| `requireAdmin` | Any admin (superuser or regular) |
| `requireAdminOrInstructor` | Admins or instructors |
| `requireSemesterAccess` | Admin or instructor assigned to semester |
| `requireCourseAccess` | Admin or instructor with course access |
| `requireSectionAccess` | Admin or instructor with section access |
| `requireCaseAccess` | Case owner, shared case viewer, or admin |

## UI Management

### Admin Tab > Instructors
- View all instructors
- Create new instructor accounts
- Assign instructors to semesters (makes them primary instructors)
- Assign instructors to sections (makes them TAs)
- Manage TA permissions per section
- View and remove assignments

### Admin Tab > Admins
- View all admin accounts
- Create new admins
- Set superuser status
- Configure `admin_access` permissions for regular admins

### Courses Tab > Semesters
- View instructors assigned to each semester
- Assign/remove instructors from semesters (superuser only)

### Sections Display
- Shows primary instructor name on section cards
- Primary instructor inherited from course or set directly

## API Endpoints

### Instructor Management
```
GET    /api/instructors                    - List all instructors
GET    /api/instructors/:id                - Get instructor with assignments
POST   /api/instructors                    - Create instructor (superuser)
PATCH  /api/instructors/:id                - Update instructor
DELETE /api/instructors/:id                - Delete instructor (superuser)
```

### Semester Assignments
```
GET    /api/instructors/:id/semesters      - Get instructor's semesters
POST   /api/instructors/:id/semesters      - Assign to semester (superuser)
DELETE /api/instructors/:id/semesters/:sid - Remove from semester (superuser)
GET    /api/semesters/:id/instructors      - Get semester's instructors
```

### Section Assignments (TAs)
```
GET    /api/instructors/:id/sections       - Get instructor's sections
POST   /api/instructors/:id/sections       - Assign to section
PATCH  /api/instructors/:id/sections/:sid  - Update TA permissions
DELETE /api/instructors/:id/sections/:sid  - Remove from section
```

## Security Notes

1. **Password Storage**: All passwords are hashed with bcrypt (10 rounds)
2. **JWT Tokens**: Include role, user ID, and relevant permissions
3. **Token Storage**:
   - Admin tokens: `localStorage.admin_auth_token`
   - Student tokens: `localStorage.student_auth_token`
4. **Inactive Accounts**: Instructors with `active=0` cannot log in
5. **Cascade Deletes**: Deleting an instructor removes all their assignments
