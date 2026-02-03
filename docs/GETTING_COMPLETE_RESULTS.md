# Getting Complete Results: Monitor vs Analytics Discrepancy

**Date:** February 2026  
**Issue:** Students appearing in "Latest Chat Sessions" (Monitor) but missing from "Results (Analytics & Reports)"

## Problem Description

Instructors reported that the "Latest Chat Sessions" monitor showed more "completed" students than appeared in the "Results (Analytics & Reports)" Student Details view for the same section and case.

For example:
- Monitor showed 15 completed chats
- Results showed only 7 completed students with scores

## Root Causes Identified

### 1. NULL `section_id` in `case_chats` Table

**How it happened:**
- Migration `010_migrate_transcripts_data.sql` created `case_chats` records for legacy evaluations WITHOUT setting `section_id`
- Some edge cases in chat creation may have resulted in NULL section_id

**Why it caused the discrepancy:**

The Monitor query checks if the **student** is enrolled in the section:
```sql
WHERE cc.student_id IN (SELECT student_id FROM student_sections WHERE section_id = ?)
   OR cc.student_id IN (SELECT id FROM students WHERE section_id = ?)
```

The Results query required the **chat's** `section_id` to match:
```sql
JOIN case_chats cc ON ... AND cc.section_id = sec.section_id
```

Chats with NULL `section_id` would appear in Monitor but not in Results.

### 2. Legacy Enrollment Not Included

**How it happened:**
- Students can be enrolled in sections two ways:
  1. `student_sections` junction table (current method)
  2. `students.section_id` field (legacy method)
- Some students only had the legacy field set

**Why it caused the discrepancy:**

The Monitor query checked **both** enrollment methods:
```sql
WHERE ss.section_id = ? OR s.section_id = ?
```

The Results query only checked `student_sections`:
```sql
JOIN student_sections ss ON s.id = ss.student_id
JOIN sections sec ON ss.section_id = sec.section_id
```

Students enrolled via the legacy method appeared in Monitor but not in Results.

## Solution

### Fix 1: Handle NULL `section_id` in Queries

Changed the JOIN condition in `server/routes/analytics.js` from:
```sql
JOIN case_chats cc ON s.id = cc.student_id 
    AND c.case_id = cc.case_id 
    AND cc.section_id = sec.section_id
```

To:
```sql
JOIN case_chats cc ON s.id = cc.student_id 
    AND c.case_id = cc.case_id 
    AND (cc.section_id = sec.section_id OR cc.section_id IS NULL)
```

### Fix 2: Include Legacy Enrollment

Changed the enrollment JOIN in `server/routes/analytics.js` from:
```sql
JOIN student_sections ss ON s.id = ss.student_id
JOIN sections sec ON ss.section_id = sec.section_id
```

To:
```sql
LEFT JOIN student_sections ss ON s.id = ss.student_id
JOIN sections sec ON (ss.section_id = sec.section_id OR s.section_id = sec.section_id)
```

### Fix 3: Data Migration for Existing Records

Created migration `server/migrations/021_backfill_case_chats_section_id.sql` to backfill `section_id` for existing `case_chats` records where it was NULL, using student enrollment data.

## Files Modified

- `server/routes/analytics.js` - Updated 6 queries to handle both issues
- `server/migrations/021_backfill_case_chats_section_id.sql` - New migration to fix existing data

## Verification

After applying these fixes, the Monitor and Results views should show the same students for a given section/case combination.

## Prevention

To prevent this issue in the future:
1. Always ensure `section_id` is properly passed when creating `case_chats` records
2. The Results query now gracefully handles NULL `section_id` as a fallback
3. Both enrollment methods (junction table and legacy field) are now supported in Results
