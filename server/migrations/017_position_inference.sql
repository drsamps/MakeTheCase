-- Migration: 017_position_inference.sql
-- Purpose: Add columns for AI position inference tracking
-- Date: 2026-01-22

-- =====================================================
-- 1. Add AI inference columns to case_chats table
-- =====================================================

ALTER TABLE case_chats
ADD COLUMN position_inferred_at TIMESTAMP DEFAULT NULL
    COMMENT 'When AI inference was performed',
ADD COLUMN position_inference_confidence DECIMAL(3,2) DEFAULT NULL
    COMMENT 'AI confidence score (0.00 to 1.00)',
ADD COLUMN position_inference_reasoning TEXT DEFAULT NULL
    COMMENT 'AI explanation for inferred positions';

-- =====================================================
-- 2. Add index for finding chats needing inference
-- =====================================================

ALTER TABLE case_chats
ADD INDEX idx_case_chats_inference (status, position_inferred_at);

-- =====================================================
-- 3. Update chat_position_logs to track AI inferences
-- =====================================================

-- Add confidence column to position logs for AI-recorded positions
ALTER TABLE chat_position_logs
ADD COLUMN confidence DECIMAL(3,2) DEFAULT NULL
    COMMENT 'AI confidence for this position inference';
