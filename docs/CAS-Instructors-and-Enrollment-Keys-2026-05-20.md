# CAS-Enabled Instructors + Per-Section Enrollment Keys (2026-05-20)

This change closes two access-control gaps that previously forced workarounds:

1. **Instructors couldn't be CAS-only.** The `instructors` table required `password_hash NOT NULL`, the Add Instructor modal forced a password, and `server/routes/cas.js` only checked the `admins` table before falling through to students. The only way an instructor could log in via BYU CAS was if they happened to also have a row in `admins`.
2. **Any BYU CAS student could join any open section.** `sections.accept_new_students` was the only gate — there was no per-section secret, so anyone with BYU credentials could enroll themselves in any open course.

Both are now addressed in one migration plus targeted route and UI changes.

---

## Part 1 — CAS-enabled instructors

### Data model

Migration `server/migrations/059_instructor_cas_and_enrollment_key.sql`:

```sql
ALTER TABLE instructors
  ADD COLUMN netid VARCHAR(50) NULL AFTER email,
  ADD COLUMN auth_method ENUM('password','cas','both') NOT NULL DEFAULT 'password' AFTER active,
  MODIFY COLUMN password_hash VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_instructors_netid (netid);
```

Existing rows default to `auth_method='password'`, so no current instructor is affected. `password_hash` is now nullable, which lets CAS-only rows exist without a stored password.

### CAS verify branch — `server/routes/cas.js`

A new instructor lookup runs between the existing admin check and the student-creation block. It matches by NetID first, then by email, and:

- Rejects inactive rows.
- Rejects rows with `auth_method='password'` (those users must still use the email/password form).
- Backfills `netid` on the row if it was previously null but CAS just provided one.
- Issues a JWT with `role='instructor'`.

The lookup is skipped when `requestedRole === 'student'`, so a student deep-linking through CAS won't accidentally land as an instructor.

### Password login guard — `server/routes/auth.js`

Before the bcrypt compare, the login endpoint now refuses CAS-only instructors with a clear message pointing them to the "Sign in with BYU NetID" button. This catches the case where a CAS-only instructor types their email into the password form by habit.

### Instructor CRUD — `server/routes/instructors.js`

`POST /api/instructors` and `PATCH /api/instructors/:id` accept two new fields:

- `auth_method`: `'password' | 'cas' | 'both'`
- `netid`: lowercased/trimmed string, unique across instructors

Password is conditional: required when `auth_method` is `password` or `both`, ignored (and not stored) when `cas`. Switching an existing instructor to CAS clears `password_hash`.

### Admin-only student lookup — `server/routes/students.js`

New endpoint `GET /api/students/lookup?q=...` (admin-only) returns up to ~20 students by name/email, each with a derived `netid` (stripped from the `cas:{netid}` id prefix). This powers the Add Instructor typeahead so an admin can promote an existing CAS student to instructor without retyping their NetID and email.

The route is registered **before** `/:id` so it isn't shadowed.

### Add/Edit Instructor modal — `components/InstructorManager.tsx`

The modal now exposes:

- A **Sign-in method** radio: `BYU CAS only` / `Password only` / `Both`.
- A **NetID** field (shown for CAS or Both, optional).
- A **Password** field (shown for Password or Both).
- A **"Look up from students"** typeahead (Add mode only) that calls the new lookup endpoint and autofills name, email, and NetID on select. Selecting a row with a NetID also flips the radio to CAS.

The instructor list shows a small badge per row: blue `CAS`, gray `Pwd`, or purple `CAS+Pwd`.

### Login screen

`components/Login.tsx` was unchanged — the existing "Sign in with BYU NetID" button now naturally lands instructors via the new branch in `cas.js`.

---

## Part 2 — Per-section enrollment keys

### Data model

Same migration as above adds:

```sql
ALTER TABLE sections
  ADD COLUMN enrollment_key VARCHAR(255) NULL AFTER accept_new_students;
```

Plaintext, optional. Instructors can view and edit their own key (it's published in the syllabus anyway — this isn't a password).

### Sections API — `server/routes/sections.js`

- `GET /api/sections/public` does **not** expose the raw key. It exposes a derived boolean `requires_enrollment_key` so the student UI can decide whether to prompt.
- `GET /api/sections` and `GET /api/sections/:id` (instructor/admin views) return the actual `enrollment_key` so it can be displayed and edited.
- `POST /api/sections` and `PATCH /api/sections/:id` accept `enrollment_key` (trimmed, with empty string → `NULL`).

### Self-enrollment validation — `server/routes/studentSections.js`

`POST /api/student-sections/enroll`:

- If the student is already enrolled, return the row idempotently — no key check (this preserves existing enrollments).
- Otherwise, if the section has an enrollment key, the request body must include a matching `enrollment_key` (trimmed). On mismatch, returns HTTP 403 with `code: 'ENROLLMENT_KEY_REQUIRED'`.

Instructor-added rows go through `POST /api/students/:id/sections` instead and intentionally bypass this gate (they set `enrolled_by='instructor'` and the instructor has already vetted the student).

### Course Sections list — `components/Dashboard.tsx`

The pink "Accept" pill in the **New Students** column is now a 3-state indicator:

| `accept_new_students` | `enrollment_key` | Label | Tooltip |
|---|---|---|---|
| `false` | (any) | **Locked** | "Locked — click to accept new students" |
| `true` | empty | **Accept NO key** | "Accepting new students with no enrollment key — any BYU CAS user can join. Click Edit to set an enrollment key (recommended)." |
| `true` | set | **Accept w/key** | "Accepting new students. Enrollment key: `{key}` — share via syllabus. Click Edit to change." |

The pill itself remains a single-click toggle for `accept_new_students`. The key is only edited inside the Edit Section modal so it can't be cleared by accident.

### Edit Section modal — `components/Dashboard.tsx`

A labeled text input "Enrollment key (optional)" was added with a Clear button and the helper text: *"If set, new students must enter this code to self-enroll. Publish it in your syllabus. Leave blank to allow any BYU CAS user to join while 'Accept' is on."*

The `sectionForm` state, `handleCreateSection`, `handleEditSection`, and `handleSaveSection` were all updated to carry `enrollment_key` through. The deep-link reset in the courses-subtab effect was also patched.

### Student self-enroll prompt — `App.tsx`

The Welcome screen's "remember your course section" button now reads `requires_enrollment_key` on the chosen section. When required:

- Renders an enrollment-key input above the button with helper copy.
- Disables the button until the input has a non-blank value.
- Sends `enrollment_key` in the `POST /student-sections/enroll` body.
- On `ENROLLMENT_KEY_REQUIRED` (or any "enrollment key" message — `apiClient` only surfaces `.message`, not `.code`, so we regex-match as a fallback), shows an inline red error: "Enrollment key is incorrect or missing. Check with your instructor."

Switching the section selector clears both the input and any error.

`types.ts` `Section` interface gained `requires_enrollment_key?: boolean`.

---

## Files touched

| File | Purpose |
|---|---|
| `server/migrations/059_instructor_cas_and_enrollment_key.sql` | Schema: `netid`, `auth_method`, nullable `password_hash`, `enrollment_key` |
| `server/routes/cas.js` | Instructor lookup branch in CAS verify |
| `server/routes/auth.js` | Block password login when `auth_method='cas'` |
| `server/routes/instructors.js` | `auth_method` + `netid` on POST/PATCH; CAS-aware validation |
| `server/routes/students.js` | `GET /students/lookup` admin-only typeahead source |
| `server/routes/sections.js` | Expose `requires_enrollment_key`; accept `enrollment_key` on write |
| `server/routes/studentSections.js` | Enforce enrollment key on new self-enrollment |
| `components/InstructorManager.tsx` | Add/Edit modal: radio, NetID, student typeahead; row badges |
| `components/Dashboard.tsx` | 3-state pill + Enrollment key input on Edit Section modal |
| `App.tsx` | Student enrollment-key prompt + error display |
| `types.ts` | `Section.requires_enrollment_key` |

---

## Manual verification checklist

1. **Migration:** `npm run migrate -- --only 059`. Confirm via `DESCRIBE instructors` (netid, auth_method, password_hash NULLABLE) and `DESCRIBE sections` (enrollment_key).
2. **Add CAS instructor:** Open Add Instructor → typeahead a known CAS student → confirm name/email/NetID autofill, radio flips to CAS → submit with no password. Row has `auth_method='cas'`, `netid` set, `password_hash IS NULL`.
3. **CAS instructor login:** Click "Sign in with BYU NetID". Token returns `role='instructor'`; dashboard loads.
4. **Password instructor unaffected:** Existing password instructor still logs in via email/password.
5. **CAS-only blocked from password form:** Submitting the CAS-only instructor's email + any password → 403 with the "use BYU NetID" message.
6. **Both method:** Set an instructor to `auth_method='both'`; verify both paths work.
7. **Pill states:** Toggle `accept_new_students` and the enrollment key field through all 3 combinations; confirm label + tooltip update.
8. **Public API doesn't leak key:** `GET /api/sections/public` shows `requires_enrollment_key: true` but no raw key.
9. **Student blocked without key:** Fresh CAS student attempts self-enroll → no key → 403. Wrong key → 403. Correct key → row inserted with `enrolled_by='self'`.
10. **Existing enrollments untouched:** Previously enrolled students in the keyed section continue to access it without being re-prompted.
11. **Instructor-added bypass:** Instructor manually adds a student via Dashboard → no key required.
