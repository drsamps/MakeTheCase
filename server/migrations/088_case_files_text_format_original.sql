-- Migration 088: the format of a case file's ORIGINAL extraction.
--
-- The Case Files editor can now change a text's format (utils/readingMarkdown.js): Auto-format
-- turns a PDF's plain text into Markdown, Text only turns Markdown into plain text. Restoring
-- the original extraction (converted_text_original) must put back its format too, or a PDF
-- auto-formatted and then restored would keep text_format = 'markdown' and render its plain
-- text as Markdown to every student.
--
-- text_format_original pairs with converted_text_original and is written wherever that is:
-- the first hand edit (PUT /converted-text copies text_format before overwriting it), upload,
-- re-extract, fetch, re-fetch, paste and package install. NULL with converted_text_original
-- NULL means "the original is the current text, in text_format". See
-- docs/case-file-text-caching.md § The reading editor.

ALTER TABLE `case_files`
  ADD COLUMN `text_format_original` VARCHAR(16) DEFAULT NULL
    COMMENT 'Format of converted_text_original: markdown or text; NULL = same as text_format' AFTER `text_format`;

-- Until now no writer could change text_format without also replacing converted_text_original,
-- so every existing original is in the row's current format.
UPDATE `case_files`
   SET `text_format_original` = `text_format`
 WHERE `converted_text_original` IS NOT NULL AND `text_format` IS NOT NULL;
