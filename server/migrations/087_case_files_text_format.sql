-- Migration 087: the format of a case file's extracted text.
--
-- The student reading panel renders each case file by the format of its TEXT
-- (utils/readingFormat.js): Markdown, or plain text one paragraph per line. file_format is the
-- original file's extension and can't tell them apart: a .docx is Markdown when mammoth's
-- Markdown conversion worked and plain text when it fell back, and an activity package installs
-- a PDF's text without its original. text_format is set wherever converted_text is produced
-- (upload, re-extract, fetch, paste, package install). NULL on rows from before this migration:
-- utils/readingFormat.js then guesses from file_format.

ALTER TABLE `case_files`
  ADD COLUMN `text_format` VARCHAR(16) DEFAULT NULL
    COMMENT 'Format of converted_text: markdown or text (utils/readingFormat.js); NULL = guess from file_format' AFTER `converted_text_original`;
