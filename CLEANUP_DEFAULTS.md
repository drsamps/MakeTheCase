# Chat Options Defaults - Duplicate Cleanup

## Problem

MySQL's `UNIQUE` constraint on `section_id` allows multiple NULL values (each NULL is considered unique). This caused 8 duplicate global default rows to accumulate in the `chat_options_defaults` table.

## Symptoms

- `UPDATE` queries affected 8 rows instead of 1
- Global defaults weren't persisting correctly
- Backend log showed "Update attempt - affected rows: 8"

## Fix Applied

1. **Code Fix** (DONE): Added `LIMIT 1` to UPDATE queries to prevent multi-row updates
2. **Database Cleanup** (PENDING): Run migration to delete duplicate rows

## How to Clean Up the Database

### Option 1: Run the Migration (Recommended)

```powershell
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/019_cleanup_duplicate_defaults.sql
```

This will:
- Show duplicate rows before cleanup
- Delete all but the most recent global default (keeps newest `updated_at`)
- Delete any duplicate section-specific defaults
- Show verification counts

### Option 2: Manual Cleanup (If you want to be more careful)

1. **Check how many duplicates exist:**
```sql
SELECT COUNT(*) FROM chat_options_defaults WHERE section_id IS NULL;
-- Should return 8
```

2. **See all global defaults:**
```sql
SELECT id, created_at, updated_at, LEFT(chat_options, 100) as preview
FROM chat_options_defaults 
WHERE section_id IS NULL 
ORDER BY updated_at DESC;
```

3. **Keep the newest, delete the rest:**
```sql
-- This keeps the row with the highest ID (most recent)
DELETE FROM chat_options_defaults
WHERE section_id IS NULL
AND id NOT IN (
  SELECT max_id FROM (
    SELECT MAX(id) as max_id FROM chat_options_defaults WHERE section_id IS NULL
  ) as t
);
```

4. **Verify cleanup:**
```sql
SELECT COUNT(*) FROM chat_options_defaults WHERE section_id IS NULL;
-- Should return 1
```

## Prevention

The code now uses `LIMIT 1` in UPDATE queries, so even if duplicates somehow appear again, only one row will be affected.

## Why This Happened

- The original seeding or testing created multiple global default rows
- MySQL's UNIQUE constraint doesn't prevent multiple NULLs
- The `INSERT...ON DUPLICATE KEY UPDATE` syntax didn't catch this edge case

## Status

✅ **Code Fixed**: UPDATE queries now use `LIMIT 1`
⏳ **Database Cleanup**: Run migration 019 to remove duplicates
