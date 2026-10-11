# Study-Chat Activities and Activity Packages

How a case became a self-contained activity, and how activities move between MakeTheCase
servers. Added 2026-10 (migrations 084-086).

- [What an activity is](#what-an-activity-is)
- [Activity types](#activity-types)
- [Default settings](#default-settings)
- [Packages: what the instructor sees](#packages-what-the-instructor-sees)
- [Package format 1](#package-format-1)
- [Will it install? The compatibility check](#will-it-install-the-compatibility-check)
- [What installing does](#what-installing-does)
- [The rules](#the-rules)
- [Adding things later](#adding-things-later)
- [Checking it](#checking-it)
- [Not built yet](#not-built-yet)

## What an activity is

A **Study-Chat activity** is: the student studies some documents, chats on a scenario with an AI
persona, the chat ends (time limit or the student's request), the chat is graded against a
rubric, and the instructor reviews the results before class.

What differs between activities is the documents, the scenarios and positions, the personas, the
rubric and the chat options. All of that now hangs off one record, the **case**:

| Part | Where it lives |
|---|---|
| Identity and type | `cases` (`case_id`, `activity_type`, `activity_uid`) |
| Documents | `case_files` (text in `converted_text`, optional original on disk) |
| Scenarios and positions | `case_scenarios`, `scenario_positions` |
| Default settings | `cases.default_settings`, `cases.default_rubric_id` |
| Personas, rubric | shared tables, named by the settings |

The dashboard still says "Cases". Nothing keyed on `case_id` changed (assignments, chats, grades
and analytics all are), which is why the case was made the activity rather than adding a table
above it.

## Activity types

`cases.activity_type` says which Study-Chat activity a case is:

| Type | The student | The AI plays | Personas offered |
|---|---|---|---|
| `case_chat` (default) | argues a position | the scenario's protagonist | personalities |
| `teach_back` | explains the reading | the audience persona they picked | audiences (`audience-*`) |

- **The type belongs to the case.** It used to be `chat_options.activity_mode` on each
  assignment, so a case could be either type depending on where it was assigned. That key is
  retired: no code reads it, every route that stores chat options strips it
  (`services/chatOptions.js#withoutActivityMode`), and stored copies are inert.
- **It is fixed once the case is in use** (assigned, on a course's list, or has chats). `PATCH
  /api/cases/:id` answers 409 `ACTIVITY_TYPE_IN_USE`. To run another activity on the same
  reading, use **Copy** on the Cases screen and change the copy's type. Changing a type clears
  the case's default settings, which were written for the old type.
- **One list, two files.** `utils/activityTypes.js` is the list and each type's traits (shared by
  server and dashboard). `server/services/activityTypes.js` adds what each type does on the
  server: its chat prompt, opening line, grading prompt, and grading adjustments. Callers ask
  `activityBehaviour(type)`; nothing tests `type === 'teach_back'`.
- Every endpoint that returns a case, an assignment or a course version returns
  `activity_type`. The student app reads it from the assigned case
  (`App.tsx`), and the chat options editors show it read-only.

## Default settings

A case carries the settings it is meant to be run with: chat options, selection mode, position
tracking, the rubric, and which scenarios are offered (`services/activityDefaults.js`).

- They are **copied** when the case is attached: a new course Main version starts from them, and
  so does a section assignment that follows no Main. They are never followed afterwards, so
  editing a case's defaults changes nothing that already exists. Course versions remain the
  live, written-through settings.
- They are set by installing a package, or by **Save as case defaults** on a course version
  (Assignments > By course). **Edit** on the Cases screen shows whether a case has any, and
  clears them.
- When someone attaches a case they do not own, its default rubric is used only if they can see
  that rubric (`caseDefaultsForCaller`).

## Packages: what the instructor sees

On **Content > Cases**:

- **Download** (a row, or tick several and **Download selected**) builds a package. The dialog
  picks where each case's settings come from (its defaults, a course version, a section's own
  settings, or none), and has two tick boxes: include original files, and include documents
  marked proprietary.
- **Install from file** reads a package and shows the plan: what would be added, what is already
  here, what would be added under a new id, and all the AI instructions in the package. Nothing
  is written until **Install**.
- **Copy** makes a second case on the same server (it is a download and install in one step).

Installed cases are private to the installer and assigned nowhere.

## Package format 1

One ZIP named `<case-id>.mtc.zip` (or `makethecase-activities-<date>.mtc.zip` for several):

```
manifest.json
activities/<key>/activity.json
activities/<key>/documents/d1.md      the text students and the AI read, and outlines
activities/<key>/originals/d1.pdf     only when the exporter ticked "include original files"
personas.json
rubrics.json
```

`manifest.json`

| Field | Meaning |
|---|---|
| `format`, `format_version` | `makethecase.activity-pack`, `1` |
| `requires` | tokens the installer must understand (see below) |
| `exported_at`, `exported_from` | when, and `{app_version, schema}` of the server that made it |
| `activities` | `{key, uid, title, activity_type, content_hash}` per activity |
| `includes_originals` | whether original files were asked for |
| `omitted` | documents left out: `{activity, title, role, reason}` |
| `warnings` | personas or a rubric that could not be included |
| `note` | free text from the exporter |

`activity.json`: `uid`, `suggested_id`, `title`, `version_label`, `activity_type`, then

- `documents[]`: `key`, `role` (`case_files.file_type`), `title`, `include_in_prompt`,
  `prompt_order`, `proprietary`, `outline_of`, `text` (path) with `text_sha256`, and `original`
  (`{path, filename, bytes, sha256}`) or null.
- `scenarios[]`: every `case_scenarios` field, a `uid`, `is_base`, and `positions[]`.
- `settings`: the settings bundle, or null. `rubric`, `scenarios[].scenario` and
  `positions[].position` are package keys, never database ids.
- `persona_selection` and `personas[]`: keys into `personas.json`. `named` means the settings
  list them. `all_enabled` means the settings offer every enabled persona, and these are what
  that meant on the exporting server.

Things worth knowing:

- **Settings are the effective ones.** `chat_options: NULL` ("follow this server's defaults") is
  resolved before export, because another server's defaults differ.
- **Numeric ids never travel.** Text ids (`case_id`, `persona_id`, `criteria_id`) travel as
  *suggestions*; the installing server uses one only when it is free.
- **Proprietary documents** are left out, text and original, unless the exporter ticks the box.
- **Outlines.** An outline travels as an outline only when its parent document travels. If the
  parent is left out, the outline is sent as a plain document of the *parent's role*. The role
  decides whether text is shown to students: an outline with no parent row is read as case
  content (`routes/llm.js#loadCaseData`), so a teaching-note outline that lost its parent would
  otherwise be shown to students after install.
- **The content hash** covers an activity's `activity.json` and the personas, rubric and
  criteria it uses. It detects damage and edits, and tells an installer whether a package is the
  one already installed. It is not a signature: someone who edits a package can recompute it.
- **Never in a package:** owner, visibility, team shares, sections, dates, models, students,
  chats, transcripts, grades, API keys, proprietary confirmation.

## Will it install? The compatibility check

The requirement: an activity must not be installed on a server too old to run it. Before this
there was no version to compare (`package.json` said `0.0.0`), and the dangerous failure was
silent: an unknown chat option was simply ignored, so a teach-back would have installed on a
server that had never heard of teach-back and run as a protagonist chat.

The check runs on the **installing** server (`services/activityPack/capabilities.js`):

1. `format_version` must be one this server reads.
2. Every token in `requires` must be one this server has. Today the tokens are the activity
   types, `activity_type:<id>`, built from `utils/activityTypes.js`.
3. Strict values (`format.js#assertValidPack`): an unknown activity type, chat option, document
   role, persona kind or enum is refused. Unknown extra *properties* are ignored.

Why tokens and not "requires version 1.4": an old server cannot know what a newer one added, so a
version requirement is a promise only the new server can check. A token is checked by the old
server itself. The app version (`exported_from.app_version`) only words the message:

> This package needs something this MakeTheCase server does not have: "debate" activities. It was
> made with MakeTheCase 1.4.0; this server is 1.0.0. Update this server, then install the package
> again.

A server older than this feature has no Install button at all, so that floor is automatic.

`GET /api/version` (staff) returns `{app_version, schema, activity_packs: {format_versions,
capabilities}}`. **Bump `version` in `package.json` on each production deploy**
(`deployment/HOW_TO_DEPLOY.md`).

## What installing does

Two requests, like course rollover:

- `POST /api/activity-packs/inspect` returns the plan and writes nothing.
- `POST /api/activity-packs/install` plans again and refuses (409 `PLAN_CHANGED`) unless the plan
  hash matches the one the person confirmed, then writes everything in one transaction. Original
  files go into the new case's folder, which is removed if anything fails.

For each item the plan says one of:

| Action | Meaning |
|---|---|
| `install` | a new case, under the suggested id or the next free one |
| `skip` | this activity (same `activity_uid`) is already here; left as it is |
| `copy` | install it anyway as a separate case with new ids, titled "(copy)" |
| `create` | persona, criterion or rubric that does not exist here |
| `reuse` | one exists here with identical content |
| `install_copy` | the id is taken by different content; the package's goes in under a new id |
| `use_server` | use the one already here (forced for built-ins, a choice otherwise) |
| `not_needed` | a persona bundled only for "all enabled"; this server has its own |

- Everything created is private and owned by the installer.
- The package's settings become the case's default settings. "Also add to a course" (course
  owner or admin) puts the case on that course's list with those settings; no section gets it
  and nothing becomes active.
- A proprietary document that was included arrives unconfirmed, so it stays out of prompts until
  it is confirmed in Case Files on this server.
- A case someone else has here that the installer cannot see is not reported as "already
  installed"; their install simply gets its own ids.
- Documents installed without an original are `file_source = 'imported_text'` (text only, like
  web pages and pasted text); with one, `'imported'`.

## The rules

Each fails silently if broken. They are repeated in the header of
`server/services/activityPack/index.js`.

1. **Fail closed.** An unknown format version, `requires` token, activity type, chat option,
   document role, persona kind or enum is refused, never ignored. This cannot be added later to
   servers already deployed.
2. **The ZIP is untrusted.** Entry names are never used as paths; only entries the manifest
   names are read; sizes are capped while inflating, not from the sizes the ZIP declares.
3. **A package never sets** an owner, visibility, id, system-default flag or proprietary
   confirmation, and never carries students, chats, grades, sections, dates, models or keys.
4. **Installing only creates** rows or reuses identical ones. It never overwrites.
5. **Download checks view access** to each case, to the course or section its settings come
   from, and to each persona and rubric bundled. "All enabled personas" resolves to every
   enabled persona on the server, including other instructors' private ones.
6. **Install must match the confirmed plan** (`plan_hash`).
7. **Package text is untrusted.** Persona instructions, scenario instructions, arguments and
   rubric prompts go into AI prompts as written, so the plan lists all of it for review, and the
   dialogs show package text as plain text.

## Adding things later

- **A new activity type (Debate, Pitch).** Add it to `utils/activityTypes.js` and add its
  builders to `server/services/activityTypes.js`. Its `requires` token then exists on servers
  with that code and on no others, with no change to the package code.
- **A new chat option.** Add it to `DEFAULT_CHAT_OPTIONS` in `services/chatOptions.js`. Packages
  that use it are refused by servers that do not have it.
- **Anything else an older installer would mishandle by ignoring** (a new per-scenario setting,
  say): add a token in `capabilities.js` and have `export.js` write it when a package uses the
  feature.
- **A change to the layout itself:** raise `FORMAT_VERSION` and keep reading the old one.

## Checking it

```bash
node server/scripts/check-activity-pack.js              # format, ZIP and 22 refusals; queries nothing
node server/scripts/check-activity-pack.js --db [case]  # plus a round trip on the dev database
node server/scripts/check-chat-prompt.js                # chat prompts are still byte-identical
```

The round trip downloads a case with a course version's settings and its original files,
installs it as a copy, downloads the copy, compares the two, and deletes the copy. Each refusal
is a package that must not install; run the script after touching anything under
`services/activityPack`, `utils/activityTypes.js`, or the chat option list.

## Not built yet

- **Updating an installed activity in place.** The stable ids (`activity_uid`, `scenario_uid`,
  `position_uid`) and the content hash it needs are already in format 1.
- An editor for a case's default settings (today they come from a package or a course version).
- A persona-kind column in place of the `audience-` id prefix. The package already records the
  kind explicitly.
- Installing from a URL or a shared catalogue; passphrase-protected packages.
