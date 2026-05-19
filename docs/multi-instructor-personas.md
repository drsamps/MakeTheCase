# Multi-Instructor — Chatbot Personas

How built-in and custom personas work for instructors, chat options, and student case chats.

Related: [multi-instructor-permissions.md](./multi-instructor-permissions.md) (matrix rows), [multi-instructor-visibility.md](./multi-instructor-visibility.md) (Private/Team/Public on custom personas).

## Built-in vs custom

| Type | DB flag | Who can edit | Who sees it |
|---|---|---|---|
| **Built-in** | `is_system_default = 1` | Superuser only (`moderate`, `strict`, `liberal`, `leading`, `sycophantic`) | Everyone (read) |
| **Custom** | `is_system_default = 0` | Owner, team co-editor with `edit`, or admin with full vision | Per visibility (private / team / public) |

Instructors cannot save changes to built-in rows. The dashboard shows **View** + **Clone** (not Edit/Delete) and returns **409 `SYSTEM_DEFAULT_READONLY`** if PATCH is attempted anyway.

## Clone

```
POST /api/personas/:personaId/clone
```

- Caller must be able to **view** the source (including built-ins).
- Creates a new **private** row owned by the effective instructor (`created_by`).
- New `persona_id` is derived from the source plus an instructor-scoped suffix (max 30 chars).
- UI opens the new persona in **Edit** mode after clone.

## Chat options: Allowed Personas & Default Persona

Per **section–case assignment** (`section_cases.chat_options` JSON):

| Field | Meaning |
|---|---|
| `allowed_personas` | Comma-separated `persona_id` list students may choose from |
| `default_persona` | Pre-selected persona when a student starts a chat |

**Allowed Personas rule:** if `allowed_personas` is missing, null, empty, or whitespace-only → **all enabled personas** in the database are allowed (not limited to the five built-ins).

Legacy assignments that still store `moderate,strict,liberal,leading,sycophantic` remain restricted to those five until an instructor clears the restriction (checks **All enabled personas** in Assignments → Chat Options).

Configure under **Assignments → Chat Options → Persona** (main editor and inline assignment panel).

## Student case chats

Students do not call `/api/personas` (instructor-only). When loading section cases, the server attaches:

```json
"available_personas": [
  { "persona_id", "persona_name", "description", "instructions", "sort_order" }
]
```

Resolution uses `server/services/personaService.js` → `resolveAvailablePersonas(allowed_personas)` after chat options are merged with section/global defaults.

The student app:

- Populates the personality dropdown from `available_personas`
- Applies `default_persona` from chat options (fallback: first available row by sort order)
- Passes `personaData` (including DB `instructions`) into `buildSystemPrompt` for custom/cloned personas

## Dashboard navigation

Personas lives under the **Setup** primary tab alongside **API Keys** and **Teams**. Setup is shown whenever `hasSetupAccess()` is true (in practice: every instructor and admin, since Personas / API Keys / Teams are all in `BASE_FUNCTIONS`).

| Primary tab | Visibility | Sub-tabs |
|---|---|---|
| **Setup** | `hasSetupAccess()` — all instructors and admins | Personas, API Keys, Teams |
| **Admin** | `hasAdminAccess()` — admins with access to any of `instructors` / `prompts` / `models` / `settings` (all `SUPERUSER_FUNCTIONS`) | Instructors, Settings, Models, Prompts, Admins, Logging, Shadow-Owned (superuser) |

The top-level **Admin** tab label shows trailing `*` only when `user.superuser` is true. Sub-tab labels no longer carry an asterisk — the Setup/Admin split now communicates the audience.

## Enforcement

| Layer | Location |
|---|---|
| List / create / clone | `server/routes/personas.js` |
| Edit / delete gates | `server/services/resourceAccess.js` (`system_readonly` for built-ins) |
| Clone + student resolution | `server/services/personaService.js` |
| `available_personas` on cases | `server/routes/sectionCases.js` |
| Tab visibility | `utils/permissions.ts` → `hasAccess(user, 'personas')` |
| Personas table UI | `components/Dashboard.tsx` (`renderPersonasTab`, `canEditPersona`, etc. in `utils/personas.ts`) |

## Help content

- `help/dashboard/PersonasHelp.tsx` — built-in vs custom, clone workflow
- `help/dashboard/ChatOptionsHelp.tsx` — Allowed Personas + Default Persona
- `help/dashboard/VisibilityHelp.tsx` — clone note for system defaults (shared with rubrics/criteria)
