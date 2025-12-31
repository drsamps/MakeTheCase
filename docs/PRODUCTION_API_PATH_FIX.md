# Production Server API Path Fix

## Problem

On the production server (`services.byu.edu/makethecase/`), the "Start Chat" button was disabled and API calls were returning 404 errors. The browser console showed:

```
Failed to load resource: the server responded with a status of 404 (Not Found)
api/llm/case-data/malawis-pizza:1
```

The error message displayed:
```
Unable to load case content (HTTP 404): <!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">...
```

## Root Cause

The application uses a base path `/makethecase/` in production (configured in `vite.config.ts`), but several direct `fetch()` calls were using hardcoded `/api/...` paths instead of respecting the base URL.

### What Was Happening

- **Development:** Base URL is `/`, so `/api/llm/case-data/malawis-pizza` works
- **Production:** Base URL is `/makethecase/`, so requests went to:
  - ❌ `services.byu.edu/api/llm/case-data/malawis-pizza` (404 - doesn't exist)
  - ✅ Should be: `services.byu.edu/makethecase/api/llm/case-data/malawis-pizza`

### Apache Configuration

The Apache proxy configuration (`makethecase.conf`) correctly routes:
- `/makethecase/api/*` → `http://localhost:3001/api/*`
- `/makethecase/*` → `http://localhost:3001/makethecase/*`

But requests to `/api/*` (without the base path) were not being proxied, resulting in Apache 404 errors.

## Solution

### 1. Created `getApiBaseUrl()` Helper Function

Added a utility function in `services/apiClient.ts` that respects the Vite base URL:

```typescript
// Export API_BASE for use in direct fetch calls
export function getApiBaseUrl(): string {
  return API_BASE;
}
```

This function uses `import.meta.env.BASE_URL` which Vite sets to:
- `/` in development
- `/makethecase/` in production (from `vite.config.ts`)

### 2. Updated All Direct Fetch Calls

Replaced all hardcoded `/api/...` paths with `${getApiBaseUrl()}/...` in:

#### `App.tsx` (2 fixes)
- Case data loading: `/api/llm/case-data/${selectedCaseId}`
- Evaluation completion check: `/api/evaluations/check-completion/...`

#### `services/llmService.ts` (2 fixes)
- Chat endpoint: `/api/llm/chat`
- Evaluation endpoint: `/api/llm/eval`

#### `components/Dashboard.tsx` (11 fixes)
- Section cases: `/api/sections/${sectionId}/cases`
- Case upload: `/api/cases/${caseId}/upload`
- Case activation/deactivation: `/api/sections/${sectionId}/cases/${caseId}/activate`
- Case options: `/api/sections/${sectionId}/cases/${caseId}/options`
- Allow rechat: `/api/evaluations/${evaluationId}/allow-rechat`
- Section updates: `/api/sections/${section.section_id}`
- Model updates: `/api/models/${model.model_id}`
- LLM chat: `/api/llm/chat`

### Example Fix

**Before:**
```typescript
const caseResponse = await fetch(`/api/llm/case-data/${selectedCaseId}`);
```

**After:**
```typescript
import { getApiBaseUrl } from './services/apiClient';
const caseResponse = await fetch(`${getApiBaseUrl()}/llm/case-data/${selectedCaseId}`);
```

## Files Modified

1. `services/apiClient.ts` - Added `getApiBaseUrl()` export
2. `App.tsx` - Updated 2 fetch calls
3. `services/llmService.ts` - Updated 2 fetch calls
4. `components/Dashboard.tsx` - Updated 11 fetch calls

## Verification

After deploying the fix:

1. ✅ API requests correctly go to `/makethecase/api/...` in production
2. ✅ "Start Chat" button is enabled when a case is selected
3. ✅ Case data loads successfully
4. ✅ All admin dashboard operations work correctly

## Prevention Guidelines

To prevent this issue in the future:

### ✅ DO: Use the API Client or Helper Function

```typescript
// Option 1: Use the api client (preferred for database operations)
import { api } from './services/apiClient';
const { data, error } = await api.from('sections').select('*');

// Option 2: Use getApiBaseUrl() for direct fetch calls
import { getApiBaseUrl } from './services/apiClient';
const response = await fetch(`${getApiBaseUrl()}/custom-endpoint`);
```

### ❌ DON'T: Use Hardcoded Paths

```typescript
// ❌ BAD - Will break in production
const response = await fetch('/api/something');

// ❌ BAD - Will break in production
const response = await fetch(`/api/endpoint/${id}`);
```

### Testing Checklist

Before deploying to production, verify:

- [ ] No hardcoded `/api/` paths in fetch calls
- [ ] All API calls use either:
  - The `api` client from `apiClient.ts`, OR
  - `getApiBaseUrl()` helper function
- [ ] Test in production-like environment (with base path)
- [ ] Check browser console for 404 errors
- [ ] Verify API requests in Network tab show correct paths

## Related Configuration

### Vite Configuration (`vite.config.ts`)

```typescript
base: mode === 'production' ? '/makethecase/' : '/',
```

This sets the base URL that `import.meta.env.BASE_URL` uses.

### Apache Configuration (`makethecase.conf`)

```apache
# Proxy API requests to Node.js backend
ProxyPass /makethecase/api http://localhost:3001/api
ProxyPassReverse /makethecase/api http://localhost:3001/api
```

This routes `/makethecase/api/*` to the Node.js backend.

## Date Fixed

December 2024

## Related Issues

- Initial issue: "Start Chat" button disabled on production server
- Error: HTTP 404 on `/api/llm/case-data/malawis-pizza`
- Root cause: Hardcoded API paths not respecting base URL
