# Instructor Teams

Instructor **Teams** are private groups of colleagues. Membership lets you share Cases, Rubrics, Personas, and Case Writer projects without making them **Public** to every instructor on the platform.

This doc covers team membership, roles, and the invitation workflow. For how shared resources become visible to team members, see **[multi-instructor-visibility.md](./multi-instructor-visibility.md)**. For who may perform each action, see **[multi-instructor-permissions.md](./multi-instructor-permissions.md)**.

## Mental model

```
  Instructor A (owner)                Instructor B (invitee)
         │                                    │
         │  creates team                      │
         ▼                                    │
  instructor_teams ◄──────────────────────────┤
         │                                    │
         │  invites by email                  │
         ▼                                    │
  instructor_team_invitations (pending)       │
         │                                    │
         │  B signs in, opens Teams tab       │
         │  clicks Accept                     │
         ▼                                    ▼
  instructor_team_members ◄────────── B joins with proposed role
         │
         │  A sets case visibility = team + picks this team
         ▼
  resource_team_shares  →  B can now see/edit per access_level
```

Team membership and resource visibility are separate steps:

1. **Join a team** (this doc) — invitation → accept → row in `instructor_team_members`.
2. **Share a resource with a team** — owner sets visibility to `team` and selects team(s) in the Visibility picker. See [multi-instructor-visibility.md](./multi-instructor-visibility.md).

Resources shared with a team are **not** visible to pending invitees until they accept. This prevents silent surveillance.

## Dashboard location

Teams live under the **Setup** primary tab (alongside Personas and API Keys):

**Admin → Setup → Teams**

All instructors and admins can reach Setup via `hasSetupAccess()` (`teams` is in `BASE_FUNCTIONS` in `utils/permissions.ts`).

In-app help: `help/dashboard/TeamsHelp.tsx` (shown via the **Teams** HelpTooltip).

## Roles

Each team member has one of three roles in `instructor_team_members.role`:

| Role | Team management | Team-shared resources |
|---|---|---|
| **owner** | Rename team, invite/remove members, change member roles, delete team | Same as other members — governed by `resource_team_shares.access_level` on each resource |
| **editor** | Invite new members (cannot delete team or change roles) | Can edit resources shared with `access_level='edit'` |
| **viewer** | View team roster only | Can view team-shared resources; cannot edit unless the share grants `edit` |

The creator of a team becomes its first **owner**.

## Invitation workflow (in-app only)

**No email is sent.** Invitations are stored in the database and surfaced only inside the Teams UI. Transactional email for team invites is a deferred feature (see [multi-instructor-overview.md](./multi-instructor-overview.md) § What's not in this implementation).

### Inviter (team owner or editor)

1. Open **Setup → Teams** and select a team you belong to.
2. In **Invite an instructor**, enter the invitee's **instructor account email** and choose a role (`owner`, `editor`, or `viewer`).
3. Click **Invite**.

The server creates a row in `instructor_team_invitations` with `status='pending'`. The inviter sees it under **Pending invitations** on the team detail panel and can **Revoke** it at any time.

API: `POST /api/teams/:id/invitations` with body `{ "email": "…", "role": "viewer" }`. The server also accepts legacy field names `invited_email` / `proposed_role`.

Validation:

- Returns **409** if the email is already a member or already has a pending invite for this team.
- Resolves `invited_instructor_id` when an `instructors` row exists for that email (best-effort at invite time).

### Invitee

1. Sign in with the **same email address** that was invited.
2. Open **Setup → Teams**.
3. A blue banner appears at the top: **Pending invitations (N)** — one row per invite, showing team name, inviter, and proposed role.
4. Click **Accept** or **Decline**.

**Accept** adds a row to `instructor_team_members` with the proposed role and marks the invitation `accepted`. The team then appears in **Your teams**.

**Decline** marks the invitation `declined`; the invitee is not added.

There is no dashboard-wide badge or notification outside the Teams tab. Tell colleagues explicitly: *"Sign in, go to Setup → Teams, and accept the invitation."*

### Matching invites to users

`GET /api/teams/invitations/mine` returns pending rows where:

```sql
i.invited_instructor_id = me.id
OR i.invited_email = me.email
```

So invites work whether or not the instructor account existed when the invite was sent.

## After joining

Once a member accepts:

- The team appears in their **Your teams** list (`GET /api/teams`).
- They can select teams in the **Visibility** picker when editing Cases, Rubrics, Personas, or Case Writer projects (`GET /api/teams/mine`).
- They gain access to resources whose owner set `visibility='team'` and listed this team in `resource_team_shares`.

Team role (`owner`/`editor`/`viewer`) controls **team administration**, not per-resource edit rights. Per-resource `view` vs `edit` is set on each share in the Visibility picker.

## Owner operations

| Action | Who | UI / API |
|---|---|---|
| Revoke pending invite | Owner, original inviter, or admin | **Revoke** → `POST /api/teams/invitations/:invId/revoke` |
| Remove member | Owner, or member removing self | **Remove** → `DELETE /api/teams/:id/members/:instructorId` |
| Change member role | Owner only | Role dropdown → `PATCH /api/teams/:id/members/:instructorId` `{ "role": "…" }` |
| Delete team | Owner or admin | **Delete team** → `DELETE /api/teams/:id` (cascades members, invitations, and `resource_team_shares` for that team) |

The server prevents removing or demoting the **last owner** without promoting someone else first.

## Data model

Migration **047** (`server/migrations/047_instructor_teams.sql`):

### `instructor_teams`

One row per team: `id` (UUID), `team_name`, `description`, `created_by`.

### `instructor_team_members`

Membership: `team_id`, `instructor_id`, `role` (`owner` | `editor` | `viewer`), `joined_at`.

Unique on `(team_id, instructor_id)`.

### `instructor_team_invitations`

Pending and historical invites: `team_id`, `invited_email`, optional `invited_instructor_id`, `invited_by`, `proposed_role`, `status` (`pending` | `accepted` | `declined` | `revoked`).

Unique pending constraint: `(team_id, invited_email, status)`.

### View: `v_instructor_team_ids`

Convenience view over `instructor_team_members` used by visibility filters in `resourceAccess.js`.

## API routes

All paths under `/api/teams` in `server/routes/teams.js`. Require `verifyToken` + `requireAdminOrInstructor`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/teams` | List teams (member's teams, or all teams for admin not impersonating) |
| `GET` | `/teams/mine` | Lightweight list for VisibilityPicker |
| `POST` | `/teams` | Create team; caller becomes owner |
| `GET` | `/teams/:id` | Detail with members and pending invitations |
| `PATCH` | `/teams/:id` | Update name/description (owner or admin) |
| `DELETE` | `/teams/:id` | Delete team (owner or admin) |
| `POST` | `/teams/:id/invitations` | Invite by email |
| `GET` | `/teams/invitations/mine` | Pending invitations for caller |
| `POST` | `/teams/invitations/:invId/accept` | Invitee accepts |
| `POST` | `/teams/invitations/:invId/decline` | Invitee declines |
| `POST` | `/teams/invitations/:invId/revoke` | Owner, inviter, or admin revokes |
| `DELETE` | `/teams/:id/members/:instructorId` | Remove member |
| `PATCH` | `/teams/:id/members/:instructorId` | Change member role (owner only) |

### Admin impersonation

Admins must **impersonate an instructor** (`X-Act-As-Instructor`) to create a team or act as a team member. Pure admin tokens without impersonation can list all teams read-only but cannot create teams (400).

See [multi-instructor-impersonation.md](./multi-instructor-impersonation.md).

## Frontend

| File | Role |
|---|---|
| `components/TeamsManager.tsx` | Team list, create, detail, invite form, pending banner, accept/decline |
| `components/ui/VisibilityPicker.tsx` | Fetches `GET /teams/mine` when user picks Team visibility |
| `help/dashboard/TeamsHelp.tsx` | In-dashboard help content |

## Audit events

Writes are logged via `writeAudit` in `server/services/auditLog.js`:

- `team.create`, `team.update`, `team.delete`
- `team.invite`, `team.invitation.accept`
- `team.member.remove`, `team.member.role`

Visibility changes on resources are separate: `resource.visibility` in `visibilityWrites.js`.

## Verification

Multi-step invite flow is exercised in `dev/2026-05-16-permissions-test-checklist.md` (§ 0 setup and § 3 primary instructor checks). Re-run `.claude/perm-tests/run.mjs` after changing `server/routes/teams.js` or team UI.

## Related docs

- **[multi-instructor-overview.md](./multi-instructor-overview.md)** — architecture index
- **[multi-instructor-visibility.md](./multi-instructor-visibility.md)** — sharing resources with teams
- **[multi-instructor-permissions.md](./multi-instructor-permissions.md)** — permission matrix (Teams rows)
