# Transcript Anonymization Features Implementation

**Date:** January 22, 2026  
**Purpose:** Add instructor controls for transcript anonymization with display status and auto-anonymize setting

---

## Overview

Implemented a comprehensive transcript anonymization system that:
1. Saves original (non-anonymized) transcripts to the database
2. Shows anonymization status in transcript viewer
3. Provides manual anonymization button for instructors
4. Adds auto-anonymize setting for automatic anonymization on display

---

## Changes Made

### 1. Database Migration

**File:** `server/migrations/013_add_auto_anonymize_setting.sql`

Added new setting to control automatic anonymization:

```sql
INSERT INTO settings (setting_key, setting_value, description)
VALUES ('auto_anonymize_transcripts', 'false', 'Automatically anonymize all transcripts when displayed to instructors')
ON DUPLICATE KEY UPDATE description = VALUES(description);
```

### 2. Analytics Component Updates

**File:** `components/Analytics.tsx`

**Added State Variables:**
- `transcriptData` - Full transcript object with metadata
- `isAnonymizing` - Loading state during anonymization
- `autoAnonymize` - Setting for auto-anonymize behavior

**New Functions:**
- `handleAnonymizeTranscript()` - Anonymizes transcript by replacing student name and case title with placeholders
- Updated `handleViewTranscript()` - Checks auto-anonymize setting and applies anonymization if enabled

**UI Enhancements:**
- Added anonymization status badge (green "Anonymized" or yellow "Not Anonymized")
- Added "Anonymize" button (only shown for non-anonymized transcripts)
- Button shows loading spinner during anonymization process
- Fetches auto-anonymize setting on component mount

**Anonymization Logic:**
```typescript
// Replaces student name parts with "STUDENT"
// Replaces case title parts with "CASE"
const anonymizedText = transcriptContent.replace(
  new RegExp(`\\b${studentName.split(/\s+/).join('\\b|\\b')}\\b`, 'gi'),
  'STUDENT'
).replace(
  new RegExp(`\\b${caseTitle.split(/\s+/).join('\\b|\\b')}\\b`, 'gi'),
  'CASE'
);
```

### 3. Settings Manager Updates

**File:** `components/SettingsManager.tsx`

Enhanced to display boolean settings as toggle switches:
- Auto-detects boolean settings (values of 'true' or 'false')
- Renders toggle switch UI for boolean settings
- Maintains text input for non-boolean settings
- Formats setting keys as readable labels (e.g., "Auto Anonymize Transcripts")

**Toggle Switch UI:**
- Blue background when enabled
- Gray background when disabled
- Smooth animation on toggle
- Shows "Modified" badge when changed

### 4. Transcript Storage Changes

**File:** `App.tsx` (from previous work)

- Saves **original, non-anonymized** transcripts to `transcripts` table
- Removed in-place anonymization at save time
- Anonymization now happens only on display (client-side) or when manually triggered (server-side)

---

## How It Works

### Viewing Transcripts

1. **Instructor opens transcript:**
   - System fetches transcript from `transcripts` table
   - Checks `is_anonymized` flag in database
   - Displays status badge (Anonymized/Not Anonymized)

2. **Auto-Anonymize Enabled:**
   - If setting is ON and transcript is not already anonymized
   - Automatically anonymizes transcript and saves to database
   - Displays anonymized version

3. **Auto-Anonymize Disabled:**
   - Shows original transcript
   - Instructor can manually click "Anonymize" button
   - Anonymization is permanent (saved to database)

### Manual Anonymization

1. Instructor clicks "Anonymize" button
2. Client-side anonymization replaces:
   - Student name parts → "STUDENT"
   - Case title parts → "CASE"
3. Sends anonymized text to server
4. Server updates transcript and sets `is_anonymized = TRUE`
5. UI updates to show "Anonymized" status
6. Button disappears (already anonymized)

### Settings Management

1. Instructor goes to Admin → Settings
2. Finds "Auto Anonymize Transcripts" toggle
3. Toggles ON/OFF
4. Clicks "Save Changes"
5. Setting applies to all future transcript views

---

## API Endpoints Used

### Existing Endpoints

- `GET /api/settings/auto_anonymize_transcripts` - Get auto-anonymize setting
- `PATCH /api/settings/auto_anonymize_transcripts` - Update setting
- `GET /api/transcripts/chat/:caseChatId` - Fetch transcript by chat ID
- `PATCH /api/transcripts/:id/anonymize` - Anonymize a transcript

### Transcript Anonymization Endpoint

**`PATCH /api/transcripts/:id/anonymize`**

Request body:
```json
{
  "anonymized_transcript": "Anonymized text content"
}
```

Response:
```json
{
  "data": {
    "id": "transcript-uuid",
    "case_chat_id": "chat-uuid",
    "transcript": "Anonymized text...",
    "is_anonymized": true,
    "anonymized_at": "2026-01-22T10:30:00Z",
    "word_count": 450,
    "saved_with_permission": false
  },
  "error": null
}
```

---

## User Experience

### For Instructors

**Viewing Transcripts:**
1. Click transcript icon in Results table
2. Modal opens showing transcript
3. Status badge shows anonymization state
4. If not anonymized, "Anonymize" button appears

**Manual Anonymization:**
1. Click "Anonymize" button
2. Button shows "Anonymizing..." with spinner
3. Transcript updates to anonymized version
4. Status badge changes to "Anonymized"
5. Button disappears

**Auto-Anonymize Setting:**
1. Go to Admin → Settings
2. Find "Auto Anonymize Transcripts" toggle
3. Toggle ON to automatically anonymize all transcripts
4. Toggle OFF to require manual anonymization
5. Click "Save Changes"

### For Students

No changes - students still see their original transcripts during and after the chat session.

---

## Privacy & Data Integrity

### Original Data Preserved

- Original transcripts are saved to database **before** any anonymization
- Anonymization is a **separate, explicit action**
- Once anonymized, the original cannot be recovered (by design)

### Anonymization is Permanent

- When a transcript is anonymized (manually or automatically), it updates the database
- The `is_anonymized` flag is set to TRUE
- The `anonymized_at` timestamp is recorded
- The original text is replaced with anonymized text

### Student Names & Case Titles

The anonymization logic:
- Splits student name into parts (first, last, middle)
- Replaces each part with "STUDENT" (case-insensitive, whole words only)
- Splits case title into parts
- Replaces each part with "CASE" (case-insensitive, whole words only)
- Uses word boundaries to avoid partial matches

Example:
```
Original: "Hi John, welcome to the Benihana case study."
Anonymized: "Hi STUDENT, welcome to the CASE case study."
```

---

## Testing Checklist

- [x] Transcript modal shows anonymization status badge
- [x] "Anonymize" button appears for non-anonymized transcripts
- [x] "Anonymize" button disappears for already-anonymized transcripts
- [x] Clicking "Anonymize" button updates transcript in database
- [x] Auto-anonymize setting appears in Settings Manager
- [x] Toggle switch works for boolean settings
- [x] Auto-anonymize setting is fetched on Analytics component mount
- [x] When auto-anonymize is ON, transcripts are automatically anonymized on view
- [x] When auto-anonymize is OFF, transcripts show original content
- [x] Anonymization replaces student name with "STUDENT"
- [x] Anonymization replaces case title with "CASE"
- [x] Original transcripts are saved (not anonymized at save time)

---

## Future Enhancements

### Potential Improvements

1. **Bulk Anonymization:**
   - Add button to anonymize all transcripts for a section
   - Add button to anonymize transcripts older than X days
   - Use existing `/api/transcripts/bulk-anonymize` endpoint

2. **Anonymization Preview:**
   - Show preview of anonymized text before confirming
   - Allow instructor to review changes

3. **Custom Anonymization Rules:**
   - Allow instructors to specify additional terms to anonymize
   - Support for email addresses, phone numbers, etc.

4. **Anonymization Audit Log:**
   - Track who anonymized each transcript
   - Track when anonymization occurred
   - Add `anonymized_by` column to transcripts table

5. **Undo Anonymization:**
   - Store original transcript separately
   - Allow reverting to original (with proper permissions)
   - Requires additional `original_transcript` column

---

## Related Files

### Modified Files
- `components/Analytics.tsx` - Transcript viewer with anonymization controls
- `components/SettingsManager.tsx` - Settings UI with toggle switches
- `App.tsx` - (Previous work) Saves original transcripts

### New Files
- `server/migrations/013_add_auto_anonymize_setting.sql` - Database migration
- `dev/2026-01-22-transcript-anonymization-features.md` - This document

### Related Documentation
- `dev/2026-01-12-table-redundancy-analysis.md` - Three-table architecture
- `dev/2026-01-12-implementation-summary.md` - Transcript table implementation
- `server/routes/transcripts.js` - Transcript API endpoints

---

## Deployment Notes

### Database Migration

Run the migration to add the setting:

```bash
mysql -u root -p makethecase < server/migrations/013_add_auto_anonymize_setting.sql
```

### App Restart

After deploying code changes:

**Linux:**
```bash
touch /var/www/pyapps/makethecase/wsgi.py
```

**Windows (Development):**
```bash
# Any file modification triggers restart
# Or restart the development server manually
```

### Verification

1. Check setting exists:
   ```sql
   SELECT * FROM settings WHERE setting_key = 'auto_anonymize_transcripts';
   ```

2. Test transcript viewer:
   - Open Analytics → Results
   - Click transcript icon for a completed chat
   - Verify status badge appears
   - Verify "Anonymize" button appears (if not anonymized)

3. Test auto-anonymize:
   - Go to Admin → Settings
   - Toggle "Auto Anonymize Transcripts" ON
   - Save changes
   - View a non-anonymized transcript
   - Verify it's automatically anonymized

---

## Conclusion

This implementation provides instructors with flexible control over transcript anonymization:

- **Original data is preserved** at save time
- **Manual control** via "Anonymize" button
- **Automatic anonymization** via settings toggle
- **Clear status indicators** in the UI
- **Permanent anonymization** for privacy compliance

The system balances data privacy with instructor needs, allowing them to choose when and how transcripts are anonymized.
