# Instructor Welcome screen

The **Home → Welcome** sub-tab shows orientation copy for instructors. Content is editable without rebuilding the frontend.

## Editing the message

| Item | Location |
|------|----------|
| Body copy | `config/welcome.md` (Markdown + optional HTML) |
| Logo / static images | `public/` (e.g. `public/MTC-student-256x256.jpg`) |
| API | `GET /api/content/welcome` → `server/routes/content.js` |
| UI | `components/WelcomeScreen.tsx` → `MarkdownPreview` |

After changing `welcome.md`, refresh the browser (no server restart required).

## HTML in Welcome content

Welcome uses `allowHtml="sanitized"` with the **`welcome`** sanitize preset (`utils/markdownSanitizeSchemas.ts`). You can embed a subset of HTML for layout (e.g. a right-floated logo). Disallowed tags and attributes are stripped.

### Floated logo example

Place the `<img>` **early** (right after the `#` heading) so following paragraphs wrap beside it:

```html
<img src="/MTC-student-256x256.jpg" alt="Make The Case"
  class="hidden sm:block float-right ml-4 mb-4 w-36 h-36 object-contain" />
```

- Use **root-relative** paths (`/filename.jpg`). The app adds the Vite `BASE_URL` prefix in production (`/makethecase/`).
- Tailwind utility classes on `img` are allowed via the `welcome` preset.
- `hidden sm:block` hides the logo on narrow viewports.

### In-app links

Markdown links like `[Case Writer](#/case-writer)` work. Hash `href`s open in the same tab; external URLs open in a new tab.

## MarkdownPreview HTML modes (developers)

`components/caseWriter/MarkdownPreview.tsx`:

| `allowHtml` | Behavior |
|-------------|----------|
| `false` (default) | Markdown only; HTML in source is not rendered |
| `'sanitized'` | `rehype-raw` + `rehype-sanitize` with `sanitizePreset` |
| `'any'` | `rehype-raw` only — use only for fully trusted content |

Presets live in `utils/markdownSanitizeSchemas.ts` (`welcome`, `minimal`). To support another screen:

1. Add or extend a preset in that file.
2. Pass `allowHtml="sanitized"` and `sanitizePreset="…"` on `MarkdownPreview`.
3. Document the preset here or in a feature-specific doc.

Future admin settings can map feature names → preset names without exposing raw tag lists in the UI.

## Security notes

- Case Writer, feedback, and other `MarkdownPreview` callers keep the default (`allowHtml={false}`).
- Do not set `allowHtml="any"` on LLM-generated or user-supplied markdown.
- Prefer **named presets** over ad-hoc sanitize rules from the database.

## Related

- `dev/2026-05-19-improved-login-navigation.md` — original Welcome / Home navigation plan
- `config/README.md` — short pointer for config editors
