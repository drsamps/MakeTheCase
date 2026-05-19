# Resource Visibility & Team Sharing

Every shareable teaching resource in MakeTheCase has a **visibility** that determines who can see and use it. This doc covers the data model, the read/write helpers, and the team-sharing flow.

> **Team membership first.** An instructor must belong to a team before team-shared resources become visible to them. Creating teams, inviting colleagues, and accepting invitations are documented in **[multi-instructor-teams.md](./multi-instructor-teams.md)**.

## The three visibility levels

| Value | Who can see it |
|---|---|
| `private` | Only the owner (and admins). |
| `team` | The owner + admins + every member of every team listed in `resource_team_shares` for this row. |
| `public` | Every instructor in the system + admins. **Requires `instructors.can_publish=1`** to set. |

System-default rows (built-in personas, the seeded rubric, etc.) carry `is_system_default=1` and behave as `public` to everyone but are read-only — even to admins through the regular instructor UI.

## Resource types covered

Five types share the visibility model. Each has a row in `RESOURCE_CONFIG` in `server/services/resourceAccess.js`:

| Type key | Table | PK | Owner column | Owner-type column | Visibility col | System-default col |
|---|---|---|---|---|---|---|
| `case` | `cases` | `case_id` | `created_by` | `created_by_type` | `visibility` | — |
| `rubric` | `rubrics` | `rubric_id` | `created_by` | `created_by_type` | `visibility` | `is_system_default` |
| `rubric_criteria` | `rubric_criteria` | `id` | `created_by` | `created_by_type` | `visibility` | `is_system_default` |
| `persona` | `personas` | `persona_id` | `created_by` | `created_by_type` | `visibility` | `is_system_default` |
| `case_writer_project` | `case_writer_projects` | `project_id` | `owner_id` | `owner_type` | `visibility` | — |

Owner-type ENUM: `'instructor' | 'admin' | 'system'`.

## Team shares

Membership in a team is managed separately — see **[multi-instructor-teams.md](./multi-instructor-teams.md)** for create / invite / accept. This section covers how resources are linked to teams once members exist.

`resource_team_shares` is the join table used only when `visibility='team'`:

```sql
CREATE TABLE resource_team_shares (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  resource_type ENUM('case','rubric','rubric_criteria','persona','case_writer_project'),
  resource_id   VARCHAR(64) NOT NULL,
  team_id       BIGINT NOT NULL,
  access_level  ENUM('view','edit') DEFAULT 'view',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY u_share (resource_type, resource_id, team_id)
);
```

A row here means "members of `team_id` can `access_level` this resource." `access_level='edit'` lets the team member save changes; `'view'` is read-only.

## Reading (the visibility scope)

All list/get endpoints for the five shareable types use the same helper, so the WHERE clause is centralized:

```js
// server/services/resourceAccess.js
buildVisibilityScope(req, resourceType, alias) → { whereSql, params }
```

- `req` carries the caller (admin or instructor) and any impersonation context.
- `alias` is the SQL alias for the resource table (so the helper can reference `${alias}.created_by`).
- Returns a parameterized fragment to drop into your query.

Behavior:

- **Admin (no impersonation):** `(1=1)` — sees everything.
- **Admin (impersonating instructor X):** treated as instructor X for read scope.
- **Instructor X:** `(owner = X) OR (visibility = 'public') OR (is_system_default = 1) OR (visibility = 'team' AND id IN (SELECT resource_id FROM resource_team_shares WHERE team_id IN (X's teams)))`.

For a single-row gate, use:

```js
canAccessResource(req, resourceType, resourceId, action) → { allowed, reason, row }
```

`action` is `'view'` or `'edit'`. `reason` is one of `'owner'`, `'public'`, `'team:view'`, `'team:edit'`, `'admin'`, `'system'`, `'not_found'`, `'not_visible'`, `'not_owner'` — useful for logging and error messages.

In a route, the standard pattern is:

```js
router.get('/:id', verifyToken, requireResourceAccess('case', 'id', 'view'), (req, res) => {
  // req.resource holds the row; req.resourceAccess holds {allowed, reason}
  res.json({ data: req.resource });
});
```

## Writing (the visibility change)

Every visibility transition goes through one helper so the `can_publish` rule is enforced uniformly:

```js
// server/services/visibilityWrites.js
setVisibility(req, resourceType, resourceId, body) → { ok, status?, error? }
```

`body` is:

```ts
{
  visibility: 'private' | 'team' | 'public',
  team_ids?: Array<{ team_id: number; access_level?: 'view' | 'edit' }>
}
```

Behavior:

1. Loads the row, runs `canAccessResource(req, …, 'edit')`. If the caller can't edit, returns 403.
2. If `visibility === 'public'` AND the caller is an instructor AND `can_publish !== 1` → 403. Co-editors saving an *already-public* row are not blocked (the check fires only on transition *to* public).
3. Updates the row's `visibility`.
4. Deletes existing `resource_team_shares` rows for this resource.
5. If `visibility === 'team'`, inserts a new row per `team_ids[]` entry.
6. Writes an audit entry: `action='resource.visibility'`, `resource_type`, `resource_id`, `details={old, new, teams}`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/cases/:id/visibility` | Change a case's visibility / shares |
| `PATCH` | `/api/rubrics/:id/visibility` | Same for rubrics |
| `PATCH` | `/api/personas/:id/visibility` | Same for personas |
| `PATCH` | `/api/case-writer/projects/:id/visibility` | Same for case writer projects |

All accept the body shape above. The client sends `team_ids`, never `team_shares` (a legacy name in some early drafts).

## Frontend: VisibilityPicker

`components/ui/VisibilityPicker.tsx`:

```tsx
<VisibilityPicker
  value={visibility}
  onChange={setVisibility}
  teamShares={teamShares}
  onTeamSharesChange={setTeamShares}
  canPublish={user.can_publish ?? false}
/>
```

- Renders three radios: Private / Team / Public. The Public option is hidden when `canPublish=false`.
- Selecting **Team** expands a multi-select of the caller's teams (fetched from `GET /api/teams/mine`) with per-team `access_level` toggles.
- The picker emits the canonical `team_ids` shape. Wrap in your editor and POST the assembled `body` to the resource's `…/visibility` endpoint.

## Rubrics: clone-and-share semantics

Rubrics and rubric criteria are special because students' evaluations FK to specific `rubric_id` / criterion `id` values. To let an instructor customize a system or team rubric without polluting the shared library, the only path is to **clone**:

- `POST /api/rubrics/:id/clone` — Deep-ish copy. The new rubric is owned by the caller, `visibility='private'`, and its `criteria_ids[]` array initially **references the same criterion ids** as the source.
- `POST /api/rubric-criteria/:id/clone` — Creates a new criterion with an auto-generated id (`<orig>_<instructorShort>_<rand4>`) to avoid colliding on the UNIQUE index. Owner = caller; `visibility='private'`.

If an instructor tries to PATCH a criterion they don't own, the API returns **409** with a hint to clone first. The UI offers a one-click "Clone criterion and update this rubric to use my copy."

## Source-of-truth check

If you find yourself writing `WHERE created_by = ?` or `WHERE visibility = 'public'` directly in a route, stop. The visibility model lives in `resourceAccess.js`/`visibilityWrites.js`. Add to those helpers; don't fork.
