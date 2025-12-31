-- Migration: Add case_id column to evaluations table for multi-case support
-- Run with: mysql -u root -p ceochat < server/migrations/add_case_id_to_evaluations.sql

USE ceochat;

-- Add case_id column to evaluations (nullable for backward compatibility with existing data)
ALTER TABLE evaluations 
ADD COLUMN case_id VARCHAR(30) DEFAULT NULL AFTER student_id,
ADD INDEX idx_case_id (case_id),
ADD INDEX idx_student_case (student_id, case_id);

-- Add foreign key constraint (optional, allows null for old data)
-- Note: This will fail if there are orphan case_ids, so we add it conditionally
-- ALTER TABLE evaluations ADD CONSTRAINT fk_evaluations_case_id FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE SET NULL;

-- Add allow_rechat column to allow instructors to reset completion status
-- Default FALSE means the evaluation counts as "completed"
-- TRUE means the student can re-chat this case
ALTER TABLE evaluations 
ADD COLUMN allow_rechat BOOLEAN DEFAULT FALSE AFTER transcript;
