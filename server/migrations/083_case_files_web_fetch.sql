-- Migration 083: Case Files — fetch web pages, paste text, keep the original extraction.
--
-- Content > Case Files can now add a web page (fetched through server/services/urlFetcher.js,
-- which blocks internal addresses on every redirect hop) or pasted text. Both are reviewed
-- before saving and stored as text only: file_source 'web' / 'pasted', file_format 'md',
-- with no file on disk. PDF/DOCX URLs still keep the original in uploads/.
--
-- converted_text_original holds the first extraction so an edited text can be reverted
-- without fetching again; text_edited_at marks rows whose converted_text was edited by hand
-- (so Re-fetch / Re-extract only warn when there is something to lose).
-- See docs/case-file-text-caching.md § Web pages and pasted text.

ALTER TABLE `case_files`
  ADD COLUMN `fetched_final_url` VARCHAR(2048) DEFAULT NULL
    COMMENT 'URL after redirects at the last fetch; differs from source_url when the origin redirected' AFTER `source_url`,
  ADD COLUMN `fetched_content_type` VARCHAR(120) DEFAULT NULL
    COMMENT 'Content-Type reported by the origin at the last fetch' AFTER `fetched_final_url`,
  ADD COLUMN `fetched_at` DATETIME DEFAULT NULL
    COMMENT 'When source_url was last fetched' AFTER `fetched_content_type`,
  ADD COLUMN `converted_text_original` LONGTEXT DEFAULT NULL
    COMMENT 'First extraction of converted_text, kept for Revert' AFTER `converted_text`,
  ADD COLUMN `text_edited_at` DATETIME DEFAULT NULL
    COMMENT 'Set when converted_text is edited by hand; cleared by re-extract / re-fetch / revert' AFTER `converted_at`;

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('case_files_url_fetch_enabled', '1',
        'Allow Content > Case Files to fetch web pages and files from instructor-supplied URLs (0 = disabled)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
