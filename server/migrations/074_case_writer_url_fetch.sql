-- Migration 074: Case Writer — fetch page text for "Paste link" source material
--
-- Until now a `link` reference stored only `link_url` and left `content` NULL, so an
-- approved link contributed one "URL: https://…" line to every generation prompt and
-- nothing else. The new POST /projects/:id/references/:refId/fetch route downloads the
-- page, extracts its text into `content`, and rebuilds the outline — after which a link
-- behaves exactly like pasted text or an uploaded file (selection, use_mode, summaries).
--
-- Provenance columns below record what was actually read. `fetched_final_url` is stored
-- separately rather than overwriting `link_url`, because the instructor typed link_url
-- and it should stay as typed; the final URL is what the server actually fetched after
-- redirects (a redirect to a login or consent wall is then visible, not mysterious).
--
-- SSRF posture: server/services/urlFetcher.js resolves the hostname and refuses
-- loopback / RFC1918 / link-local (incl. 169.254.169.254 cloud metadata) / CGNAT /
-- IPv6 unique-local addresses, and re-validates on EVERY redirect hop — the origin
-- controls the Location header, so a pre-flight-only check is not a defense.
--
-- Roll-out: the feature is gated on `case_writer_url_fetch_enabled` and ships DISABLED.
-- An admin flips it to '1' in Settings to allow outbound fetches from this server.

ALTER TABLE `case_writer_references`
  ADD COLUMN `fetched_at`           TIMESTAMP NULL DEFAULT NULL
    COMMENT 'When link_url was last fetched into content' AFTER `link_url`,
  ADD COLUMN `fetched_content_type` VARCHAR(120) DEFAULT NULL
    COMMENT 'Content-Type reported by the origin at fetch time' AFTER `fetched_at`,
  ADD COLUMN `fetched_final_url`    VARCHAR(1024) DEFAULT NULL
    COMMENT 'URL after redirects; differs from link_url when the origin redirected' AFTER `fetched_content_type`;

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('case_writer_url_fetch_enabled', '0',
        'Allow Case Writer to fetch text from instructor-supplied URLs (0 = disabled)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
