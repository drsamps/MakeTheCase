# Analysis: case_chats vs evaluations Table Redundancy

**Date:** January 12, 2026  
**Issue:** Redundancy and inconsistency between `case_chats` and `evaluations` tables

---

## Executive Summary

Yes, there IS significant redundancy between these tables, and the current design has evolved into an inconsistent state due to:
1. **Legacy data** in `evaluations` without corresponding `case_chats` records
2. **Duplicate fields** storing the same information in both tables
3. **Circular references** creating maintenance complexity
4. **Confusion about source of truth** (e.g., which table stores the definitive transcript?)

---

## Current Table Structure

### `case_chats` Table
**Purpose:** Track the full lifecycle of each chat session (introduced Jan 2025)

**Key Fields:**
- `id` (PK)
- `student_id`
- `case_id`
- `section_id`
- `status` (started, in_progress, abandoned, canceled, killed, completed)
- `persona`
- `hints_used`
- `chat_model`
- `start_time`, `last_activity`, `end_time`
- **`transcript`** (TEXT)
- `evaluation_id` (FK → evaluations.id)
- `scenario_id`, `time_limit_minutes`, `time_started`
- `initial_position`, `final_position`, `position_method`

### `evaluations` Table
**Purpose:** Store AI evaluation results (legacy, pre-dates `case_chats`)

**Key Fields:**
- `id` (PK)
- `created_at`
- `student_id`
- `case_id`
- **`case_chat_id`** (FK → case_chats.id) ← Added later for backward compatibility
- `score`, `summary`, `criteria` (JSON)
- `persona`
- **`hints`** (same as `hints_used` in case_chats)
- `helpful`, `liked`, `improve` (feedback)
- `chat_model`, `super_model`
- **`transcript`** (TEXT) ← **Duplicate!**
- `allow_rechat`

---

## Redundant Fields

| Field | case_chats | evaluations | Issue |
|-------|------------|-------------|-------|
| **transcript** | ✅ | ✅ | **DUPLICATE DATA** - Which is the source of truth? |
| **hints** | `hints_used` | `hints` | Same data, different name |
| **persona** | ✅ | ✅ | Duplicated |
| **chat_model** | ✅ | ✅ | Duplicated |
| **student_id** | ✅ | ✅ | Necessary for both tables |
| **case_id** | ✅ | ✅ | Necessary for both tables |

---

## Circular References

The tables reference each other, creating a circular dependency:
- `case_chats.evaluation_id` → `evaluations.id`
- `evaluations.case_chat_id` → `case_chats.id`

This is architecturally problematic because:
1. You can't delete one without considering the other
2. Creates potential for orphaned records
3. Makes data integrity constraints complex
4. Confuses the "owns" relationship

---

## The Legacy Data Problem

**Root Cause:** The app originally only had the `evaluations` table. When `case_chats` was introduced (Jan 2025), existing evaluations had no corresponding chat records.

**Current State:**
- Old evaluations (pre-Jan 2025): Have `case_chat_id = NULL`
- New chats (post-Jan 2025): Have proper cross-references

**Recent Bug:** The transcript viewer was looking in `case_chats` but the transcript was only in `evaluations` (fixed today by checking both tables).

---

## Recommended Architecture

### Option 1: Clean Three-Table Separation (Recommended)

**Principle:** Each table has a single, clear responsibility with no overlap

#### **case_chats** - Session Management
- Tracks chat lifecycle and operational data
- Status, timing, activity tracking
- Position tracking (business logic)
- Links to transcript via `transcript_id` (optional FK)
- Lightweight, query-optimized for monitoring
- **DOES NOT store: transcript text, evaluation results**

**Fields:**
- `id` (PK)
- `student_id`, `case_id`, `section_id`, `scenario_id`
- `status`, `persona`, `hints_used`, `chat_model`
- `start_time`, `last_activity`, `end_time`, `time_limit_minutes`, `time_started`
- `initial_position`, `final_position`, `position_method`
- **`transcript_id`** (FK → transcripts.id, nullable)

#### **evaluations** - Assessment Results Only
- Stores AI evaluation outputs
- Score, summary, criteria breakdown
- Student feedback (helpful, liked, improve)
- Links to case_chat via `case_chat_id` (required FK)
- **DOES NOT store: transcript, hints, persona, chat_model** (get from case_chats)

**Fields:**
- `id` (PK)
- `case_chat_id` (FK → case_chats.id, NOT NULL)
- `student_id`, `case_id` (denormalized for query optimization)
- `created_at`
- `score`, `summary`, `criteria` (JSON)
- `super_model` (evaluation model used)
- `helpful`, `liked`, `improve` (feedback)
- `allow_rechat`

#### **transcripts** - Chat Transcript Storage (NEW)
- Stores all chat transcripts with metadata
- Tracks anonymization status
- Supports privacy/retention policies
- Can be purged independently of chat/evaluation records

**Fields:**
- `id` (PK, CHAR(36))
- `case_chat_id` (FK → case_chats.id, NOT NULL)
- `transcript` (TEXT, the actual conversation)
- `is_anonymized` (BOOLEAN, default FALSE)
- `anonymized_at` (TIMESTAMP, nullable)
- `created_at` (TIMESTAMP)
- `word_count` (INT, for analytics)
- `saved_with_permission` (BOOLEAN, for student consent tracking)

**Relationships:**
```
case_chats.transcript_id ----→ transcripts.id (optional, set when transcript saved)
                                      ↑
                                      |
                         transcripts.case_chat_id (always links back)

evaluations.case_chat_id ----→ case_chats.id (required)
```

**Benefits:**
1. **Clear ownership:** Each table has one job
2. **No duplication:** Transcript exists in one place only
3. **Privacy-friendly:** Easy to anonymize, purge, or export transcripts
4. **Performance:** Operational queries on case_chats don't load large TEXT fields
5. **Flexible policies:** Can delete transcripts while keeping chat/evaluation metadata
6. **Audit trail:** Track when transcripts were anonymized or modified
7. **Simpler queries:** Always know where to get each piece of data

---

### Option 2: Consolidation (Alternative)

Merge tables into a single `case_sessions` table with evaluation fields as nullable columns.

**Pros:**
- Single source of truth
- No joins needed for most queries
- Simpler data model

**Cons:**
- Larger table with many NULL columns for incomplete sessions
- Mixes operational (status tracking) with analytical (evaluation) data
- May require breaking changes to existing code

---

## Migration Plan (Option 1: Three-Table Architecture)

### Phase 1: Create Transcripts Table
```sql
-- 1. Create new transcripts table
CREATE TABLE transcripts (
  id CHAR(36) PRIMARY KEY,
  case_chat_id CHAR(36) NOT NULL,
  transcript TEXT,
  is_anonymized BOOLEAN DEFAULT FALSE,
  anonymized_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  word_count INT DEFAULT 0,
  saved_with_permission BOOLEAN DEFAULT FALSE,
  
  INDEX idx_case_chat_id (case_chat_id),
  INDEX idx_created_at (created_at),
  INDEX idx_anonymized (is_anonymized),
  
  FOREIGN KEY (case_chat_id) REFERENCES case_chats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Phase 2: Migrate Existing Transcripts
```sql
-- 2. Migrate transcripts from case_chats (newer records)
INSERT INTO transcripts (id, case_chat_id, transcript, created_at, word_count)
SELECT 
  UUID() as id,
  cc.id as case_chat_id,
  cc.transcript,
  cc.end_time as created_at,
  LENGTH(cc.transcript) - LENGTH(REPLACE(cc.transcript, ' ', '')) + 1 as word_count
FROM case_chats cc
WHERE cc.transcript IS NOT NULL;

-- 3. Migrate transcripts from evaluations (legacy records without case_chats)
-- First, create case_chats records for legacy evaluations
INSERT INTO case_chats (id, student_id, case_id, status, persona, hints_used, 
                        chat_model, end_time, start_time)
SELECT 
  UUID() as id,
  e.student_id,
  e.case_id,
  'completed' as status,
  e.persona,
  e.hints as hints_used,
  e.chat_model,
  e.created_at as end_time,
  e.created_at as start_time
FROM evaluations e
WHERE e.case_chat_id IS NULL;

-- 4. Update evaluations to reference their new case_chats
UPDATE evaluations e
JOIN case_chats cc ON e.id = cc.evaluation_id
SET e.case_chat_id = cc.id
WHERE e.case_chat_id IS NULL;

-- 5. Migrate legacy transcripts from evaluations to transcripts table
INSERT INTO transcripts (id, case_chat_id, transcript, created_at, word_count)
SELECT 
  UUID() as id,
  e.case_chat_id,
  e.transcript,
  e.created_at,
  LENGTH(e.transcript) - LENGTH(REPLACE(e.transcript, ' ', '')) + 1 as word_count
FROM evaluations e
WHERE e.transcript IS NOT NULL 
  AND e.case_chat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM transcripts t WHERE t.case_chat_id = e.case_chat_id
  );

-- 6. Link case_chats to their transcripts
-- First add the column
ALTER TABLE case_chats 
  ADD COLUMN transcript_id CHAR(36) DEFAULT NULL AFTER evaluation_id;

-- Then populate it
UPDATE case_chats cc
JOIN transcripts t ON t.case_chat_id = cc.id
SET cc.transcript_id = t.id;

-- Add foreign key constraint
ALTER TABLE case_chats
  ADD CONSTRAINT case_chats_transcript_fk 
  FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL,
  ADD INDEX idx_transcript_id (transcript_id);
```

### Phase 3: Clean Up Redundant Fields
```sql
-- 7. Remove redundant columns from evaluations
ALTER TABLE evaluations 
  DROP COLUMN transcript,
  DROP COLUMN persona,
  DROP COLUMN hints,
  DROP COLUMN chat_model;

-- 8. Make case_chat_id NOT NULL in evaluations (after migration)
ALTER TABLE evaluations 
  MODIFY case_chat_id CHAR(36) NOT NULL;

-- 9. Remove transcript column from case_chats
ALTER TABLE case_chats 
  DROP COLUMN transcript;

-- 10. Remove circular reference from case_chats
ALTER TABLE case_chats 
  DROP FOREIGN KEY case_chats_evaluation_fk,
  DROP COLUMN evaluation_id;
```

### Phase 4: Code Updates

**Backend API Routes:**

1. **`server/routes/transcripts.js`** (NEW)
   - `POST /api/transcripts` - Save transcript for a case_chat
   - `GET /api/transcripts/:id` - Get transcript by ID
   - `GET /api/transcripts/chat/:caseChatId` - Get transcript by case_chat_id
   - `PATCH /api/transcripts/:id/anonymize` - Anonymize a transcript
   - `DELETE /api/transcripts/:id` - Delete transcript (admin only)

2. **`server/routes/evaluations.js`** (UPDATE)
   - Remove `transcript` from all SELECT queries
   - Remove `transcript`, `persona`, `hints`, `chat_model` from INSERT
   - When returning evaluation, join case_chats for operational data
   - Join transcripts table if transcript text is needed

3. **`server/routes/caseChats.js`** (UPDATE)
   - Remove `transcript` from status update endpoint
   - Update complete endpoint to create transcript record separately
   - Add endpoint to fetch chat with transcript: `GET /api/case-chats/:id/with-transcript`

4. **`server/routes/analytics.js`** (UPDATE)
   - Update results query to join transcripts table
   - Update any queries that were fetching transcript from evaluations

**Frontend Components:**

1. **`components/Analytics.tsx`** (UPDATE)
   - Update `handleViewTranscript` to fetch from `/api/transcripts/chat/:caseChatId`
   - Remove fallback checks for evaluations.transcript

2. **`components/Dashboard.tsx`** (UPDATE)
   - Update transcript display to fetch from transcripts API
   - Add anonymization status indicator
   - Update evaluation display to join chat data

3. **`App.tsx`** (UPDATE)
   - When creating evaluation, also create transcript record
   - Update transcript save logic to use new API

**New Helper Functions:**

```typescript
// services/transcriptService.ts (NEW)
export const saveTranscript = async (
  caseChatId: string, 
  transcript: string,
  savedWithPermission: boolean = false
): Promise<{ data: any, error: any }> => {
  return api.post('/transcripts', {
    case_chat_id: caseChatId,
    transcript,
    saved_with_permission: savedWithPermission
  });
};

export const getTranscriptForChat = async (
  caseChatId: string
): Promise<{ data: any, error: any }> => {
  return api.get(`/transcripts/chat/${caseChatId}`);
};

export const anonymizeTranscript = async (
  transcriptId: string
): Promise<{ data: any, error: any }> => {
  return api.patch(`/transcripts/${transcriptId}/anonymize`);
};
```

---

## Impact Analysis

### Breaking Changes
- API responses for `/api/evaluations/:id` will no longer include `transcript` field
- Applications must join case_chats to get transcript
- Existing code assuming `evaluations.transcript` exists will fail

### Non-Breaking Option
- Keep transcript in both tables temporarily
- Add migration script to sync transcripts periodically
- Deprecate evaluations.transcript over time
- Eventually remove after transition period

---

## Immediate Fixes (Already Done)

✅ **Fixed:** Analytics transcript viewer now checks both tables (Jan 12, 2026)

---

## Recommendations

### Short-term (Next Sprint)
1. ✅ Fix transcript viewer to check both tables (DONE)
2. Create data migration script for legacy evaluations
3. Document which table is source of truth for each field
4. Add database views to simplify common queries

### Medium-term (Next Month)
1. Execute data migration for legacy records
2. Update all APIs to use case_chats as source for transcript
3. Remove redundant fields from evaluations table
4. Add database constraints to ensure data integrity

### Long-term (Future)
1. Consider full consolidation if complexity outweighs benefits
2. Archive old evaluation records to history table
3. Optimize queries with proper indexing and materialized views

---

## Database Views for Simplified Queries

### View 1: Completed Sessions with Evaluation
```sql
CREATE VIEW v_completed_sessions AS
SELECT 
  cc.id as case_chat_id,
  cc.student_id,
  s.full_name as student_name,
  cc.case_id,
  c.case_title,
  cc.section_id,
  sec.section_title,
  cc.status,
  cc.persona,
  cc.hints_used,
  cc.chat_model,
  cc.start_time,
  cc.end_time,
  cc.initial_position,
  cc.final_position,
  cc.position_method,
  cc.transcript_id,
  e.id as evaluation_id,
  e.score,
  e.summary,
  e.criteria,
  e.helpful,
  e.liked,
  e.improve,
  e.super_model,
  e.allow_rechat,
  e.created_at as evaluated_at
FROM case_chats cc
JOIN students s ON cc.student_id = s.id
JOIN cases c ON cc.case_id = c.case_id
LEFT JOIN sections sec ON cc.section_id = sec.section_id
LEFT JOIN evaluations e ON e.case_chat_id = cc.id
WHERE cc.status = 'completed';
```

### View 2: Session with Transcript (for transcript viewing)
```sql
CREATE VIEW v_sessions_with_transcript AS
SELECT 
  cc.id as case_chat_id,
  cc.student_id,
  s.full_name as student_name,
  cc.case_id,
  c.case_title,
  cc.section_id,
  cc.status,
  cc.persona,
  t.id as transcript_id,
  t.transcript,
  t.is_anonymized,
  t.anonymized_at,
  t.word_count,
  t.saved_with_permission,
  t.created_at as transcript_saved_at
FROM case_chats cc
JOIN students s ON cc.student_id = s.id
JOIN cases c ON cc.case_id = c.case_id
LEFT JOIN transcripts t ON t.case_chat_id = cc.id;
```

### View 3: Results Summary (for analytics)
```sql
CREATE VIEW v_results_summary AS
SELECT 
  s.id as student_id,
  s.full_name as student_name,
  sec.section_id,
  sec.section_title,
  c.case_id,
  c.case_title,
  cc.status,
  cc.persona,
  cc.hints_used,
  cc.initial_position,
  cc.final_position,
  cc.start_time,
  cc.end_time,
  TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time) as duration_minutes,
  e.score,
  e.helpful,
  e.allow_rechat,
  e.created_at as evaluated_at,
  CASE WHEN t.id IS NOT NULL THEN TRUE ELSE FALSE END as has_transcript,
  t.is_anonymized
FROM students s
JOIN student_sections ss ON s.id = ss.student_id
JOIN sections sec ON ss.section_id = sec.section_id
JOIN section_cases sc ON sec.section_id = sc.section_id
JOIN cases c ON sc.case_id = c.case_id
LEFT JOIN case_chats cc ON s.id = cc.student_id AND c.case_id = cc.case_id
LEFT JOIN evaluations e ON e.case_chat_id = cc.id
LEFT JOIN transcripts t ON t.case_chat_id = cc.id
WHERE sec.enabled = TRUE;
```

---

## Additional Benefits of Three-Table Architecture

### Privacy & Compliance
- **GDPR/FERPA friendly:** Easy to purge transcripts while keeping anonymized analytics
- **Student consent:** Track which transcripts were saved with permission
- **Anonymization:** Built-in support for anonymizing sensitive data
- **Retention policies:** Can implement automatic transcript deletion after X months

### Performance
- **Lighter queries:** Operational queries on case_chats don't load TEXT fields
- **Faster indexes:** case_chats table smaller → faster status queries
- **Selective loading:** Only fetch transcripts when actually needed
- **Archive-ready:** Easy to move old transcripts to archive storage

### Data Management
- **Clean separation:** Each table has one clear purpose
- **Independent lifecycle:** Can delete transcripts without losing chat metadata
- **Audit trail:** Track when transcripts saved, anonymized, accessed
- **Flexible policies:** Different retention rules for different tables

---

## Migration Safety Checklist

Before executing migration:

- [ ] **Backup database completely**
- [ ] Test migration on copy of production database first
- [ ] Verify all existing transcripts are accounted for:
  ```sql
  -- Count transcripts in current tables
  SELECT 
    COUNT(*) as case_chats_with_transcript 
  FROM case_chats WHERE transcript IS NOT NULL;
  
  SELECT 
    COUNT(*) as evaluations_with_transcript 
  FROM evaluations WHERE transcript IS NOT NULL;
  ```
- [ ] After migration, verify counts match:
  ```sql
  SELECT COUNT(*) as new_transcript_records FROM transcripts;
  ```
- [ ] Check for orphaned records
- [ ] Verify foreign key constraints
- [ ] Test transcript viewer in UI
- [ ] Test evaluation display in UI
- [ ] Test analytics reports

---

## Rollback Plan

If migration fails or issues discovered:

```sql
-- 1. Stop application
-- 2. Restore from backup
-- 3. OR: Copy transcripts back to original tables

-- Copy transcripts back to case_chats
UPDATE case_chats cc
JOIN transcripts t ON t.case_chat_id = cc.id
SET cc.transcript = t.transcript
WHERE cc.transcript IS NULL;

-- Copy transcripts back to evaluations
UPDATE evaluations e
JOIN transcripts t ON t.case_chat_id = e.case_chat_id
SET e.transcript = t.transcript
WHERE e.transcript IS NULL;

-- 4. Restart application with old code
```

---

## Conclusion

The three-table architecture provides:

1. **Clear separation of concerns:**
   - `case_chats` = session lifecycle & operational data
   - `evaluations` = AI assessment results
   - `transcripts` = conversation storage & privacy management

2. **No redundancy:** Each piece of data stored exactly once

3. **Better privacy:** Built-in support for anonymization and retention policies

4. **Improved performance:** Operational queries don't load large TEXT fields

5. **Easier maintenance:** Clear ownership and relationships

**Key Principle:** 
- case_chats tracks **what happened**
- evaluations stores **the assessment**  
- transcripts preserves **the conversation** (with privacy controls)

---

## Implementation Timeline

**Week 1: Preparation**
- [ ] Review and approve this plan
- [ ] Create backup strategy
- [ ] Write migration scripts
- [ ] Test on development database

**Week 2: Backend Migration**
- [ ] Create transcripts table
- [ ] Run data migration scripts
- [ ] Verify data integrity
- [ ] Update API routes

**Week 3: Frontend Updates**
- [ ] Update transcript viewers
- [ ] Update evaluation displays
- [ ] Test all user flows
- [ ] Deploy to staging

**Week 4: Production Rollout**
- [ ] Final database backup
- [ ] Execute migration in maintenance window
- [ ] Deploy updated application code
- [ ] Monitor for issues
- [ ] Verify all features working
