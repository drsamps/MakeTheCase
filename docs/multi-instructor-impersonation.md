# Admin Impersonation & Audit Log

Admins keep system-wide oversight but don't own teaching resources. When an admin needs to *act inside* a specific instructor's data — to debug a broken section, rotate a key on the instructor's behalf, fix a bad rubric assignment — they impersonate that instructor for the duration of the operation. Every meaningful action under impersonation is captured in `audit_log` with both actor identities so it stays attributable.

## How impersonation works

Impersonation is **per-request scoping** on top of the admin's normal JWT. There is no separate impersonation login flow and no short-lived token issuance endpoint (the JWT-claim path is wired but unused — see below). The admin keeps their own admin token and the *scope* is set via a header.

```
   ┌────────────────────────────────────────────────────────────┐
   │ Admin clicks "View as: niftyware@gmail.com" in dashboard   │
   └────────────────────────┬───────────────────────────────────┘
                            ▼
   localStorage['mtc_impersonate_id'] = <instructor_id>
                            │
                            ▼  apiClient.ts adds the header
   Every fetch:  Authorization: Bearer <admin_jwt>
                 X-Act-As-Instructor: <instructor_id>
                            │
                            ▼  middleware/auth.js
   req.user.role === 'admin'
   req.effectiveInstructorId = <instructor_id>
                            │
                            ▼  route handlers + service helpers
   buildVisibilityScope, canAccessResource, callerInstructorId(),
   resolveActor() — all consult req.effectiveInstructorId
```

### Server middleware (`server/middleware/auth.js`)

```js
if (decoded.role === 'admin') {
  const headerActAs = req.headers['x-act-as-instructor'];
  const tokenActAs  = decoded.actAs;          // reserved for short-lived tokens
  const actAs = tokenActAs || headerActAs;
  if (actAs && typeof actAs === 'string') {
    req.effectiveInstructorId = actAs;
  }
}
```

Three things to note:

1. **Only admins can impersonate.** The block is gated by `role === 'admin'`. Instructors sending an `X-Act-As-Instructor` header have it silently ignored.
2. **JWT `actAs` claim wins over the header.** The middleware supports an alternate path where a short-lived impersonation JWT bakes the target instructor in. No route currently mints one — the `generateToken(..., extra)` helper would accept `{actAs}` if we ever needed it. Today, all impersonation rides the header.
3. **No expiry beyond the JWT itself.** The admin's normal token TTL (`AUTH_TOKEN_TTL = 12h`) bounds the session. Clearing localStorage or hitting "Exit impersonation" ends scope immediately on the next request.

### Frontend (`services/apiClient.ts`, `components/Dashboard.tsx`)

- `getImpersonationId()` reads `localStorage['mtc_impersonate_id']`, but only when the URL hash is admin-context (`#/admin` or `#/case-writer`). The student app never sends the header even if the localStorage key is set.
- `setImpersonationId(id)` writes or clears the key.
- `getAuthHeaders()` adds `X-Act-As-Instructor` to every authenticated request when impersonation is active.
- The Dashboard renders the picker (`View as: …`) in the header for admins only, plus a sticky yellow banner across the top whenever impersonation is active. Switching reloads the page so every cached fetch re-runs under the new scope:

  ```ts
  const applyImpersonation = (id: string | null) => {
    setImpersonationId(id);
    setImpersonateIdState(id);
    window.location.reload();
  };
  ```

- 401 handling clears both the auth token *and* the impersonation id (`setImpersonationId(null)`) so a re-login doesn't silently inherit a stale scope.

## What "acting as" actually changes

The effect is read-scope and write-attribution; it does not give the admin permissions the instructor lacks.

| Subsystem | When `effectiveInstructorId` is set |
|---|---|
| `resourceAccess.js` → `buildVisibilityScope` / `canAccessResource` | Treats the request as if it came from instructor X. The admin's blanket `(1=1)` admin-bypass is replaced by the instructor's normal owner/team/public scope. |
| `apiKeys.js` → `callerInstructorId(req)` | Returns the impersonated id, so admins can manage keys on the instructor's behalf. Without impersonation the route returns 400. |
| `teams.js` create-team endpoint | Requires impersonation for admins (400 otherwise). Teams are owned by instructors, not admins. |
| `caseWriter.js`, `courses.js`, `sections.js`, `models.js`, `personas.js`, `rubrics.js`, `rubricCriteria.js` | Apply the instructor's visibility scope. Pure admin (no impersonation) sees all rows. |
| `auditLog.js` → `resolveActor(req)` | Captures `actor_admin_id = u.id` AND `acted_as_instructor_id = req.effectiveInstructorId`. |

What does *not* change:
- `req.user.role` is still `'admin'`. `requireSuperuser`, `requireRole('admin')`, and the `adminAccess` allowlist still apply to the admin identity. An admin impersonating an instructor can still hit admin-only endpoints (e.g. `/api/instructors/...` superuser ops), and a non-superuser admin still can't bypass that gate by impersonating.
- The admin's `superuser` flag and `adminAccess` array travel with their JWT, not with the impersonation scope.

This is the "view-as" model: same person, scoped lens. It is *not* a role-swap.

## Audit log

Migration 052 adds the `audit_log` table:

```sql
CREATE TABLE audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_admin_id        CHAR(36) NULL,  -- admin who initiated (if any)
  actor_instructor_id   CHAR(36) NULL,  -- instructor who initiated (if not admin)
  acted_as_instructor_id CHAR(36) NULL, -- target when an admin is impersonating
  action       VARCHAR(80) NOT NULL,
  resource_type VARCHAR(40) NULL,
  resource_id   VARCHAR(64) NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(255) NULL,
  details     JSON         NULL,
  INDEX idx_audit_ts (ts),
  INDEX idx_audit_actor_admin (actor_admin_id),
  INDEX idx_audit_actor_instructor (actor_instructor_id),
  INDEX idx_audit_acted_as (acted_as_instructor_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_resource (resource_type, resource_id)
);
```

The append-only design plus six targeted indexes are tuned for three common questions:
- "What did admin X do today?" → `actor_admin_id` + `ts`.
- "What was done to instructor Y's data?" → `acted_as_instructor_id` or `actor_instructor_id` + `ts`.
- "Who changed this case last?" → `resource_type` + `resource_id`.

### Actor resolution

```js
// server/services/auditLog.js → resolveActor(req)
//
// admin acting as themselves: {actorAdminId: u.id, actorInstructorId: null,
//                              actedAsInstructorId: req.effectiveInstructorId || null}
// admin impersonating:        same as above, with actedAsInstructorId populated
// instructor:                 {actorAdminId: null, actorInstructorId: u.id,
//                              actedAsInstructorId: null}
```

The double-attribution is the whole point: an admin who rotates an instructor's key while impersonating produces a row that names both of them. You can answer "did anyone but instructor Y touch their keys?" with `WHERE actor_admin_id IS NOT NULL AND acted_as_instructor_id = ?`.

### Writing entries

```js
// server/services/auditLog.js
writeAudit(req, { action, resourceType, resourceId, details })
writeSystemAudit({ action, instructorId, resourceType, resourceId, details })  // no req (background jobs)
```

- `writeAudit` is **best-effort**. It catches its own errors and logs to stderr — audit failures must never break the underlying request.
- `details` is a JSON column; pass an object of `{old, new, …}` and `auditLog.js` stringifies it.
- `resource_id` is truncated to 64 chars.
- `ip` reads `x-forwarded-for` first, then `req.ip`, truncated to 64 chars.

### What actions are logged today

Direct uses of `writeAudit` / `writeSystemAudit` in the codebase:

| Action | Source | Notes |
|---|---|---|
| `apikey.set` | `apiKeys.js` POST | Includes `{provider, hint}` |
| `apikey.delete` | `apiKeys.js` DELETE | |
| `instructor.use_system_key` | `apiKeys.js` admin route | Includes `{enable}` |
| `resource.visibility` | `visibilityWrites.js` `setVisibility` | Includes `{old, new, teams}` |

The schema names `login`, `impersonate.start`, `ownership.transfer`, and `case.share` as canonical actions in its column comment. Those are wired into the table but not all sites are calling `writeAudit` yet — they remain follow-up work.

### Reading entries

No admin viewer endpoint exists yet (called out in `multi-instructor-overview.md`'s "What's not in this implementation" section). For now, read directly:

```sql
-- Recent activity by an admin
SELECT ts, action, resource_type, resource_id, acted_as_instructor_id, details
FROM audit_log
WHERE actor_admin_id = ?
ORDER BY ts DESC
LIMIT 100;

-- Everything done TO an instructor's data, whether by them or by an admin
SELECT ts, action, actor_admin_id, actor_instructor_id, resource_type, resource_id, details
FROM audit_log
WHERE actor_instructor_id = ? OR acted_as_instructor_id = ?
ORDER BY ts DESC
LIMIT 100;
```

The `auditlog` tab key is reserved in `utils/permissions.ts` (superuser-only) for when the viewer is built.

## Token refresh (related but distinct)

Impersonation lives on top of the admin's JWT, so the JWT-refresh story matters here:

- `generateToken(id, email, role, extra)` in `server/middleware/auth.js` mints 12h-TTL tokens.
- `POST /api/auth/refresh` (called by `refreshAuthToken()` in `apiClient.ts`) re-issues a fresh token from a still-valid one. The client calls it on app boot, on window focus, and on a timer.
- Refresh **does not change the impersonation scope** — that's stored separately in localStorage, not in the JWT. Refreshing keeps the admin "viewing as" the same instructor.
- 401 handling clears both. Logging back in starts fresh.
- **`getSession()` is resilient against the impersonation-reload race.** When the dashboard mounts under impersonation it issues `/auth/session` immediately; if the admin's token happens to be a tick from expiry the first call can 401, which used to drop the user back to the login screen. `apiClient.getSession()` now catches a 401 on `/auth/session`, calls `refreshAuthToken()` once, and retries before clearing the token. The impersonation header survives the round-trip, so the admin stays "viewing as" the same instructor across the refresh.
- **`/auth/session` payload contract:** for instructor sessions the endpoint returns `can_publish` and `use_system_key` alongside the identity fields. The frontend stores these on `user` and uses them to gate UI affordances (notably `<VisibilityPicker canPublish={user.can_publish} />`). If you add a new instructor-scoped flag that the UI needs to read at startup, surface it here too — the dashboard does **not** re-fetch the instructor row separately.

## Operational notes

- **Impersonation is not silent.** The yellow banner across the top of the Dashboard is intentional — an admin should never forget they're scoped to someone else. Don't suppress it.
- **Cross-tenant writes are audit-worthy.** When adding a new route that admins can hit while impersonating, add a `writeAudit` call for any state-changing operation. The seams are not enforced automatically.
- **Don't query through impersonation when you need admin vision.** If an admin's "view as" is active and you want all-rows behavior for a specific call (e.g., a dashboard widget that genuinely should aggregate everyone), pass `null` or skip `req.effectiveInstructorId` rather than impersonating yourself out of it.
- **Audit log is append-only by convention, not by DDL.** There is no trigger preventing `DELETE FROM audit_log`. If you operationalize this for compliance, add the trigger and a periodic export.
