-- Migration: 061_case_writer_industry_columns.sql
-- Date: 2026-05-20
-- Description: Add industries_preference and industry columns to case_writer_projects.
--   * industries_preference: instructor's optional industries hint for scenario generation
--     (wired into the {industry_preference} placeholder in case_writer.scenario_generation).
--   * industry: auto-populated from the selected scenario's `industry` field; shown as
--     case metadata on the Case Writer home list.

ALTER TABLE `case_writer_projects`
  ADD COLUMN `industries_preference` VARCHAR(500) NULL AFTER `case_type`,
  ADD COLUMN `industry` VARCHAR(255) NULL AFTER `industries_preference`;
