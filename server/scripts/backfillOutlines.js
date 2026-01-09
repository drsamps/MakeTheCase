/**
 * Backfill legacy outlines that exist only in case_files.outline_content
 * by creating outline assets on disk and inserting outline rows linked
 * to their parent files.
 *
 * Usage:
 *   node server/scripts/backfillOutlines.js
 */

import { pool } from '../db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

async function backfill() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, case_id, filename, file_type, prompt_order, outline_content
       FROM case_files
       WHERE outline_content IS NOT NULL
         AND is_outline = 0
         AND processing_status = 'completed'`
    );

    console.log(`[backfill] Found ${rows.length} parent files with inline outlines`);

    for (const row of rows) {
      const { id: parentId, case_id: caseId } = row;

      // Skip if a latest outline already exists for this parent
      const [existing] = await conn.execute(
        `SELECT id FROM case_files
         WHERE parent_file_id = ? AND is_outline = 1 AND is_latest_outline = 1
         LIMIT 1`,
        [parentId]
      );
      if (existing.length > 0) {
        console.log(`[backfill] Parent ${parentId} already has latest outline; skipping`);
        continue;
      }

      const outlineContent = row.outline_content || '';
      const baseName = path.basename(row.filename, path.extname(row.filename));
      const outlineFilename = `${baseName}-outline-${Date.now()}.md`;
      const outlineDir = path.join(CASE_FILES_DIR, caseId, 'uploads');
      await fs.mkdir(outlineDir, { recursive: true });
      const outlinePath = path.join(outlineDir, outlineFilename);
      await fs.writeFile(outlinePath, outlineContent, 'utf-8');
      const stats = await fs.stat(outlinePath);

      // Insert outline record
      await conn.execute(
        `INSERT INTO case_files (
          case_id, parent_file_id, filename, file_type, file_format,
          file_source, include_in_chat_prompt, prompt_order, file_version,
          original_filename, file_size, processing_status, outline_content,
          is_outline, is_latest_outline, created_at
        ) VALUES (?, ?, ?, 'outline', 'md',
          'ai_prepped', 1, ?, ?, ?, ?, 'completed', ?, 1, 1, NOW())`,
        [
          caseId,
          parentId,
          outlineFilename,
          (row.prompt_order || 0) * 1000 + 1,
          `outline-${new Date().toISOString()}`,
          outlineFilename,
          stats.size,
          outlineContent
        ]
      );

      // Clear latest flags on other outlines for this parent (if any)
      await conn.execute(
        `UPDATE case_files
         SET is_latest_outline = 0, include_in_chat_prompt = 0
         WHERE parent_file_id = ? AND is_outline = 1 AND filename <> ?`,
        [parentId, outlineFilename]
      );

      console.log(`[backfill] Created outline for parent ${parentId} -> ${outlineFilename}`);
    }

    console.log('[backfill] Complete');
  } catch (err) {
    console.error('[backfill] Error:', err);
  } finally {
    conn.release();
  }
}

backfill();
