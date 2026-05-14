# Model Management

This document describes how AI/LLM models are stored in the MySQL database and managed
through the admin Model Management UI. It is written so the pattern can be replicated in
a **React 19 + TypeScript + Tailwind CSS / Node.js + Express.js / MySQL 8** stack.

---

## 1. Database Schema

### 1.1 `models` table — full column reference

```sql
CREATE TABLE models (
    models_id          INT AUTO_INCREMENT PRIMARY KEY,

    -- Identity
    vendor             VARCHAR(30)   NOT NULL,          -- 'openai' | 'anthropic' | 'google' | 'openrouter'
    model_id           VARCHAR(255)  NOT NULL UNIQUE,   -- API model identifier; OpenRouter uses 'provider/model' e.g. 'openai/gpt-5'
    model_name         VARCHAR(100)  NOT NULL,          -- Human-readable display name

    -- Status
    enabled            BOOLEAN       NOT NULL DEFAULT TRUE,

    -- Metadata
    release_date       DATE          NULL,
    type               VARCHAR(100)  DEFAULT 'regular', -- 'regular' | 'reasoning' | 'hybrid' | 'vision' | 'code' | 'other'

    -- Pricing  (cost per million tokens; NULL = unknown/not set)
    cpm_input          DECIMAL(10,4) NULL,
    cpm_input_cache    DECIMAL(10,4) NULL,              -- cached-prompt read price
    cpm_output         DECIMAL(10,4) NULL,

    -- Parameter metadata (populated from OpenRouter import when available)
    supported_parameters  JSON NULL,   -- array of parameter names the model accepts, e.g. ["temperature","top_p"]
    default_parameters    JSON NULL,   -- object of vendor-specified defaults, e.g. {"temperature": 1.0}
    parameter_settings    JSON NULL,   -- object of admin-chosen overrides to apply at call time

    -- Timestamps
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Test tracking
    test_date          DATETIME NULL,
    test_status        VARCHAR(20) NULL,   -- 'pass' | 'fail' | NULL (never tested)
    test_results       JSON NULL,          -- full result payload from last test run

    INDEX idx_vendor_enabled (vendor, enabled),
    INDEX idx_enabled (enabled)
);
```

### 1.2 Key design decisions

| Decision | Rationale |
|---|---|
| `model_id` is `VARCHAR(255) UNIQUE` | OpenRouter identifiers use a `provider/model` slash format (e.g. `openai/gpt-5`) which exceeds common 50-char limits. The UNIQUE constraint prevents duplicate registrations. |
| `vendor = 'openrouter'` for proxied models | Separates the routing layer from the upstream provider. The app passes the full `model_id` to the OpenRouter API rather than directly to the upstream SDK. |
| Three JSON parameter columns | `supported_parameters` (vendor source-of-truth list), `default_parameters` (vendor defaults), `parameter_settings` (admin overrides). At call time: merge defaults ← overrides, then filter to `supported_parameters`. |
| CPM stored as `DECIMAL(10,4)` | Matches OpenRouter's per-token price × 1 000 000. Four decimal places handle sub-cent prices without floating-point drift. |
| `test_date/status/results` on the row | Avoids a separate audit table for simple pass/fail connectivity checks. The full JSON payload is stored so failure details can be shown without re-running the test. |

---

## 2. REST API

All endpoints require an authenticated admin session. The pattern below uses Express.js
conventions; adapt to your auth middleware.

### 2.1 Endpoint summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/models` | Enabled models only (for dropdowns) |
| `GET` | `/admin/all_models` | All models with full metadata (for management table) |
| `POST` | `/admin/models` | Create a new model |
| `PUT` | `/admin/models/:id` | Update an existing model |
| `DELETE` | `/admin/models/:id` | Delete a model |
| `PATCH` | `/admin/models/:id/toggle` | Toggle enabled/disabled |
| `PATCH` | `/admin/models/cpm_values` | Batch-update CPM pricing for multiple models |
| `POST` | `/admin/models/:id/test` | Run a connectivity test against the live API |
| `POST` | `/admin/models/openrouter/lookup` | Fetch OpenRouter metadata to prefill the Add form |

### 2.2 Response shapes

**`GET /admin/models`** — lightweight list for UI dropdowns:
```json
[
  {
    "vendor": "openai",
    "model_id": "gpt-4.1-mini",
    "model_name": "GPT 4.1 mini",
    "cpm_input": 0.4,
    "cpm_output": 1.6,
    "value": "openai:gpt-4.1-mini"
  }
]
```
The `value` field is the `vendor:model_id` token used when calling the LLM.

**`GET /admin/all_models`** — full row for the management table:
```json
[
  {
    "models_id": 7,
    "vendor": "openai",
    "model_id": "gpt-4.1-mini",
    "model_name": "GPT 4.1 mini",
    "enabled": true,
    "release_date": "2025-04-14",
    "type": "regular",
    "cpm_input": 0.4,
    "cpm_input_cache": null,
    "cpm_output": 1.6,
    "supported_parameters": "[\"temperature\",\"top_p\",\"max_tokens\"]",
    "default_parameters": "{\"temperature\": 1.0}",
    "parameter_settings": "{}",
    "created_at": "2025-05-01 10:00:00",
    "updated_at": "2026-05-10 14:23:11",
    "test_date": "2026-05-10 14:23:11",
    "test_status": "pass",
    "test_results": "{...}",
    "test_summary": "Pass: Paris is the capital of France."
  }
]
```

**`POST /admin/models/openrouter/lookup`** request body:
```json
{ "openrouter_model_id": "openai/gpt-5" }
```
Response:
```json
{
  "prefill": {
    "vendor": "openrouter",
    "model_id": "openai/gpt-5",
    "model_name": "OpenAI: GPT-5",
    "type": "regular",
    "release_date": "2025-05-14",
    "cpm_input": 5.0,
    "cpm_input_cache": null,
    "cpm_output": 15.0,
    "supported_parameters": ["temperature", "top_p", "max_tokens"],
    "default_parameters": {},
    "parameter_settings": {},
    "enabled": true
  },
  "openrouter": {
    "supported_parameters": ["temperature", "top_p", "max_tokens"],
    "default_parameters": {},
    "context_length": 128000,
    "description": "..."
  }
}
```

**`POST /admin/models/:id/test`** success response:
```json
{
  "success": true,
  "status": "pass",
  "model_name": "GPT 4.1 mini",
  "test_date": "2026-05-13 15:00:00",
  "summary": "Pass: Paris is the capital of France.",
  "test_results": {
    "status": "pass",
    "message": "Model returned expected answer.",
    "tested_model": "openai:gpt-4.1-mini",
    "prompt": "What is the capital of France?",
    "response_preview": "Paris is the capital of France.",
    "seconds": 1.23,
    "temperature_used": 0.2,
    "usage": { "prompt_tokens": 22, "completion_tokens": 9, "total_tokens": 31 }
  }
}
```

---

## 3. "Add New Model" workflow

### 3.1 Manual entry

1. Admin clicks **Add New Model**.
2. A modal form opens with fields: Vendor, Model ID, Model Name, Type, Enabled, Release Date, CPM Input, CPM Input Cache, CPM Output, Supported Parameters (JSON array), Default Parameters (JSON object), Parameter Settings (JSON object).
3. On submit the frontend validates that the three JSON fields parse correctly before sending `POST /admin/models`.
4. The server inserts the row and returns `{ success: true }`.
5. The table refreshes via `GET /admin/all_models`.

### 3.2 "Add new model from OpenRouter" workflow

This is a two-step assisted import that autofills the form from live OpenRouter metadata.

**Step 1 — Enter an OpenRouter model ID and fetch metadata**

1. Admin clicks **Add new model from OpenRouter**. The modal opens with Vendor pre-set to `openrouter`.
2. Admin types the OpenRouter model identifier in the Model ID field (format: `provider/model`, e.g. `openai/gpt-5`).
3. Admin clicks **Fetch model info from OpenRouter by Model ID entered above**.
4. The frontend sends `POST /admin/models/openrouter/lookup` with `{ openrouter_model_id: "openai/gpt-5" }`.

**Backend lookup logic (`POST /admin/models/openrouter/lookup`):**

```
GET https://openrouter.ai/api/v1/models
  Authorization: Bearer <OPENROUTER_API_KEY>
  HTTP-Referer: <OPENROUTER_HTTP_REFERER>   (optional)
  X-Title: <OPENROUTER_X_TITLE>             (optional)
```

- The full model list is fetched (no per-model endpoint needed).
- The target model is located by matching `id` (case-insensitive).
- Pricing is extracted from `pricing.prompt` and `pricing.completion` (per-token values), then multiplied by 1 000 000 to get CPM. `pricing.input_cache_read` (or `input_cache_write` as fallback) becomes `cpm_input_cache`.
- `release_date` is derived from the Unix timestamp in `created`.
- Model type is inferred from `supported_parameters` (presence of `reasoning`/`reasoning_effort` → `reasoning`) and `architecture.output_modalities` (presence of `image`/`video` → `vision`).
- `supported_parameters` and `default_parameters` are passed through verbatim from the OpenRouter response.

**Step 2 — Review prefilled fields and save**

5. The frontend populates all form fields from the `prefill` object in the response.
6. Admin reviews and optionally edits any field (e.g. change the display name, adjust CPM).
7. Admin clicks **Add Model**. The frontend sends `POST /admin/models` as normal.

**Important:** The lookup step only prefills the form — no database row is created until the admin submits the form in step 7.

**Required environment variables for OpenRouter:**

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | Authenticates all OpenRouter API calls |
| `OPENROUTER_HTTP_REFERER` | No | Shown in OpenRouter analytics; your app's URL |
| `OPENROUTER_X_TITLE` | No | Shown in OpenRouter analytics; your app's name |

---

## 4. "Test" / "Re-test" button

The **Test** button runs a live connectivity check for a single model without leaving the
management table.

### 4.1 UI states

| `test_status` in DB | Button label | Button style |
|---|---|---|
| `NULL` (never tested) | **Test** | default |
| `'pass'` | **Tested** | green background |
| `'fail'` | **Re-test** | pink/red background |

### 4.2 What happens when clicked

1. Button label changes to **Testing…** and is disabled.
2. Frontend sends `POST /admin/models/:id/test`.

**Backend test logic:**

3. The model row is fetched to get `vendor` and `model_id`.
4. The prompt **"What is the capital of France?"** is sent to the model with `temperature=0.2` and `max_tokens=1024`, using `system_prompt="Answer with a short factual response."`.
5. For OpenRouter models (`vendor = 'openrouter'`): the `model_id` already contains the upstream prefix (e.g. `openai/gpt-5`), so the call is routed through `https://openrouter.ai/api/v1/chat/completions` using the OpenRouter API key.
6. For direct models (`vendor` in `openai`/`anthropic`/`google`): the call goes directly to that provider's SDK using the corresponding API key.
7. The response is checked: **pass** if the word "paris" appears (case-insensitive) in the reply; **fail** otherwise (or if an exception occurs).
8. `test_date`, `test_status`, and `test_results` are written back to the model row.
9. The full result payload is returned to the frontend.

**Stored `test_results` JSON shape (pass):**
```json
{
  "status": "pass",
  "message": "Model returned expected answer.",
  "tested_model": "openai:gpt-4.1-mini",
  "prompt": "What is the capital of France?",
  "response_preview": "Paris is the capital of France.",
  "seconds": 1.23,
  "temperature_used": 0.2,
  "usage": { "prompt_tokens": 22, "completion_tokens": 9, "total_tokens": 31 }
}
```

**Stored `test_results` JSON shape (fail):**
```json
{
  "status": "fail",
  "error": "OpenAI API error 401: ...",
  "tested_model": null,
  "prompt": "What is the capital of France?"
}
```

10. On success the frontend shows a toast notification and refreshes the model list so the updated test status and button style appear immediately.
11. On failure the frontend shows a modal with the full error text (copyable to clipboard).

### 4.3 `test_summary` helper

A short human-readable string derived from `test_results` is stored/computed for display
in the management table without needing to parse the full JSON:

- Pass: `"Pass: <first 140 chars of response_preview>"`
- Fail: `"Fail: <first 140 chars of error message>"`

---

## 5. Runtime model resolution

When the application calls an LLM it uses the token `vendor:model_id` (e.g.
`openai:gpt-4.1-mini` or `openrouter:openai/gpt-5`).

The helper `resolveModelRuntimeConfiguration(modelValue)` (Python: `resolve_model_runtime_configuration`) queries the `models` table to load the three parameter JSON columns, then:

1. Merges `default_parameters` with `parameter_settings` (settings win on conflict).
2. Filters the merged result to only keys present in `supported_parameters`.
3. Returns the resolved parameter object alongside the normalized `vendor:model_id` token.

This means admin-configured parameter overrides (e.g. forcing a specific `top_p`) are
automatically applied to every call that uses that model, without any call-site changes.

---

## 6. Inline CPM editing ("edit CPMs" mode)

The management table has an **edit CPMs** checkbox that reveals inline number inputs for
`cpm_input`, `cpm_input_cache`, and `cpm_output` directly in the table cells. Clicking
**Save changes** sends a single `PATCH /admin/models/cpm_values` request with an array of
`{ models_id, cpm_input, cpm_input_cache, cpm_output }` objects for every row that was
modified. This avoids opening a full edit modal for routine price updates.

---

## 7. Replicating in Node.js / Express / React / MySQL 8

### 7.1 Database

Run the DDL from §1.1 verbatim — it is standard MySQL 8. Use the conditional stored-procedure pattern for migrations (see project migration rules) when adding columns to an existing table.

### 7.2 Backend (Express / TypeScript)

```typescript
// Minimal route structure — expand with your auth middleware
import express from 'express';
import mysql2 from 'mysql2/promise';

const router = express.Router();

// GET /api/admin/models — enabled only, for dropdowns
router.get('/models', requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    `SELECT vendor, model_id, model_name, cpm_input, cpm_output
     FROM models WHERE enabled = TRUE ORDER BY vendor, model_name`
  );
  res.json((rows as any[]).map(r => ({
    ...r,
    value: `${r.vendor}:${r.model_id}`
  })));
});

// GET /api/admin/all_models — full metadata, admin only
router.get('/all_models', requireAdmin, async (req, res) => {
  const [rows] = await db.query(
    `SELECT models_id, vendor, model_id, model_name, enabled, release_date,
            type, cpm_input, cpm_input_cache, cpm_output,
            supported_parameters, default_parameters, parameter_settings,
            created_at, updated_at, test_date, test_status, test_results
     FROM models ORDER BY vendor, model_name`
  );
  res.json(rows);
});

// POST /api/admin/models — create
router.post('/models', requireAdmin, async (req, res) => {
  const { vendor, model_id, model_name, enabled, release_date, type,
          cpm_input, cpm_input_cache, cpm_output,
          supported_parameters, default_parameters, parameter_settings } = req.body;
  if (!vendor || !model_id || !model_name) {
    return res.status(400).json({ error: 'vendor, model_id, and model_name are required' });
  }
  await db.execute(
    `INSERT INTO models (vendor, model_id, model_name, enabled, release_date, type,
       cpm_input, cpm_input_cache, cpm_output,
       supported_parameters, default_parameters, parameter_settings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vendor, model_id, model_name, enabled ?? true, release_date ?? null, type ?? 'regular',
     cpm_input ?? null, cpm_input_cache ?? null, cpm_output ?? null,
     JSON.stringify(supported_parameters ?? []),
     JSON.stringify(default_parameters ?? {}),
     JSON.stringify(parameter_settings ?? {})]
  );
  res.json({ success: true });
});

// PATCH /api/admin/models/:id/toggle
router.patch('/models/:id/toggle', requireAdmin, async (req, res) => {
  const [[row]] = await db.query<any[]>(
    'SELECT enabled, model_name FROM models WHERE models_id = ?', [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Model not found' });
  const newEnabled = !row.enabled;
  await db.execute(
    'UPDATE models SET enabled = ?, updated_at = NOW() WHERE models_id = ?',
    [newEnabled, req.params.id]
  );
  res.json({ success: true, enabled: newEnabled, model_name: row.model_name });
});

// POST /api/admin/models/openrouter/lookup
router.post('/models/openrouter/lookup', requireAdmin, async (req, res) => {
  const { openrouter_model_id } = req.body;
  if (!openrouter_model_id) return res.status(400).json({ error: 'openrouter_model_id required' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'OPENROUTER_API_KEY not configured' });

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(process.env.OPENROUTER_HTTP_REFERER && { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }),
      ...(process.env.OPENROUTER_X_TITLE && { 'X-Title': process.env.OPENROUTER_X_TITLE }),
    }
  });
  if (!response.ok) return res.status(502).json({ error: `OpenRouter returned ${response.status}` });

  const { data: models } = await response.json() as { data: any[] };
  const selected = models.find(m => m.id?.toLowerCase() === openrouter_model_id.toLowerCase());
  if (!selected) return res.status(404).json({ error: `Model not found: ${openrouter_model_id}` });

  const toMillions = (v: any) => v != null && v !== '' ? Math.round(parseFloat(v) * 1_000_000 * 10000) / 10000 : null;
  const pricing = selected.pricing ?? {};
  const cachePrice = pricing.input_cache_read ?? pricing.input_cache_write ?? null;

  const inferType = (m: any): string => {
    const supported = new Set(m.supported_parameters ?? []);
    if (supported.has('reasoning') || supported.has('reasoning_effort')) return 'reasoning';
    const out = new Set((m.architecture?.output_modalities ?? []));
    if (out.has('image') || out.has('video')) return 'vision';
    if ((m.name ?? '').toLowerCase().includes('code')) return 'code';
    return 'regular';
  };

  const releaseDate = typeof selected.created === 'number'
    ? new Date(selected.created * 1000).toISOString().slice(0, 10)
    : null;

  res.json({
    prefill: {
      vendor: 'openrouter',
      model_id: selected.id ?? openrouter_model_id,
      model_name: selected.name ?? selected.id ?? openrouter_model_id,
      type: inferType(selected),
      release_date: releaseDate,
      cpm_input: toMillions(pricing.prompt),
      cpm_input_cache: toMillions(cachePrice),
      cpm_output: toMillions(pricing.completion),
      supported_parameters: selected.supported_parameters ?? [],
      default_parameters: selected.default_parameters ?? {},
      parameter_settings: {},
      enabled: true,
    },
    openrouter: {
      supported_parameters: selected.supported_parameters ?? [],
      default_parameters: selected.default_parameters ?? {},
      context_length: selected.context_length,
      description: selected.description ?? '',
    }
  });
});

// POST /api/admin/models/:id/test
router.post('/models/:id/test', requireAdmin, async (req, res) => {
  const [[model]] = await db.query<any[]>(
    'SELECT vendor, model_id, model_name FROM models WHERE models_id = ?', [req.params.id]
  );
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const prompt = 'What is the capital of France?';
  let payload: any;
  let status: 'pass' | 'fail';

  try {
    const response = await callLlmApi({
      model: `${model.vendor}:${model.model_id}`,
      userPrompt: prompt,
      systemPrompt: 'Answer with a short factual response.',
      temperature: 0.2,
      maxTokens: 1024,
    });
    const text = (response.content ?? '').trim();
    const passed = Boolean(text) && text.toLowerCase().includes('paris');
    status = passed ? 'pass' : 'fail';
    payload = {
      status,
      message: passed ? 'Model returned expected answer.' : "Model responded but 'Paris' not found.",
      tested_model: `${model.vendor}:${model.model_id}`,
      prompt,
      response_preview: text.slice(0, 300),
      seconds: response.seconds,
      usage: response.metadata?.usage ?? {},
    };
  } catch (err: any) {
    status = 'fail';
    payload = { status: 'fail', error: String(err.message ?? err), tested_model: null, prompt };
  }

  await db.execute(
    `UPDATE models SET test_date = NOW(), test_status = ?, test_results = ?, updated_at = NOW()
     WHERE models_id = ?`,
    [status, JSON.stringify(payload), req.params.id]
  );

  res.status(status === 'pass' ? 200 : 500).json({
    success: status === 'pass',
    status,
    model_name: model.model_name,
    test_date: new Date().toISOString(),
    test_results: payload,
  });
});

export default router;
```

### 7.3 Frontend (React / TypeScript / Tailwind)

Key state and fetch patterns:

```typescript
// types.ts
export interface Model {
  models_id: number;
  vendor: string;
  model_id: string;
  model_name: string;
  enabled: boolean;
  release_date: string | null;
  type: string;
  cpm_input: number | null;
  cpm_input_cache: number | null;
  cpm_output: number | null;
  supported_parameters: string | null;  // JSON string
  default_parameters: string | null;
  parameter_settings: string | null;
  created_at: string;
  updated_at: string;
  test_date: string | null;
  test_status: 'pass' | 'fail' | null;
  test_results: string | null;          // JSON string
  test_summary: string;
}
```

**Table row action: Test button**

```tsx
function TestButton({ model, onRefresh }: { model: Model; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const label = !model.test_status ? 'Test' : model.test_status === 'pass' ? 'Tested' : 'Re-test';
  const colorClass = !model.test_status ? '' :
    model.test_status === 'pass' ? 'bg-green-200 border-green-700' : 'bg-red-100 border-red-600';

  async function handleTest() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/models/${model.models_id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        onRefresh();
      } else {
        setErrorText(JSON.stringify(data.test_results ?? data.error, null, 2));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        disabled={loading}
        onClick={handleTest}
        className={`px-2 py-1 border rounded text-sm ${colorClass}`}
      >
        {loading ? 'Testing…' : label}
      </button>
      {errorText && (
        <dialog open className="fixed inset-0 p-8 bg-white rounded shadow-xl z-50 max-w-xl">
          <pre className="text-xs overflow-auto max-h-96">{errorText}</pre>
          <button onClick={() => setErrorText(null)}>Close</button>
        </dialog>
      )}
    </>
  );
}
```

**OpenRouter import flow**

```tsx
async function fetchOpenRouterMetadata(openrouterId: string) {
  const res = await fetch('/api/admin/models/openrouter/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openrouter_model_id: openrouterId }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const { prefill } = await res.json();
  return prefill;  // use to populate form state
}
```

---

## 8. How models are selected at call time

When an LLM call is made, the caller passes `vendor:model_id` as the model token.
The routing logic is:

```
vendor = token.split(':')[0]

openai      → call OpenAI SDK directly          (model = token after ':')
anthropic   → call Anthropic SDK directly        (model = token after ':')
google      → call Google Generative AI SDK      (model = token after ':')
openrouter  → POST https://openrouter.ai/api/v1/chat/completions
               model field = token after ':'     (includes the slash prefix, e.g. openai/gpt-5)
```

For OpenRouter, the `model_id` in the database is the full OpenRouter model identifier
(`provider/model`). It is passed verbatim as the `model` field in the chat completions
request body.

**Parameter injection at call time** (see §5):

```typescript
async function resolveModelRuntimeConfig(vendorColonModelId: string) {
  const [vendor, modelId] = vendorColonModelId.split(':', 2);
  const [[row]] = await db.query<any[]>(
    `SELECT supported_parameters, default_parameters, parameter_settings
     FROM models WHERE LOWER(vendor) = ? AND model_id = ? LIMIT 1`,
    [vendor.toLowerCase(), modelId]
  );
  if (!row) return {};

  const supported: string[] = JSON.parse(row.supported_parameters ?? '[]');
  const defaults: Record<string, any> = JSON.parse(row.default_parameters ?? '{}');
  const overrides: Record<string, any> = JSON.parse(row.parameter_settings ?? '{}');

  const merged = { ...defaults, ...overrides };
  if (supported.length === 0) return merged;
  return Object.fromEntries(Object.entries(merged).filter(([k]) => supported.includes(k)));
}
```

---

## 9. Security notes

- All model management endpoints must require an authenticated admin session.
- The OpenRouter lookup endpoint proxies external HTTP — validate and sanitize the `openrouter_model_id` input (no shell injection risk here, but ensure it cannot be used to exfiltrate config by timing attacks).
- API keys (`OPENROUTER_API_KEY`, etc.) live only in environment variables — never in the database or client-side code.
- The test endpoint executes a live LLM call which costs money; restrict it to admins only and consider rate-limiting it.
```
