-- Migration: 013_add_auto_anonymize_setting.sql
-- Purpose: Add setting for automatic transcript anonymization
-- Date: 2026-01-22

INSERT INTO settings (setting_key, setting_value, description)
VALUES ('auto_anonymize_transcripts', 'false', 'Automatically anonymize all transcripts when displayed to instructors')
ON DUPLICATE KEY UPDATE description = VALUES(description);
