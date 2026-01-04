#!/usr/bin/env node
/**
 * Mark Abandoned Chats Script
 *
 * This script marks chat sessions as 'abandoned' if they have been inactive
 * for too long. Run this periodically (e.g., every 15 minutes via cron or PM2).
 *
 * Usage:
 *   node server/scripts/mark-abandoned-chats.js [--timeout=60]
 *
 * Options:
 *   --timeout=N   Minutes of inactivity before marking as abandoned (default: 60)
 *   --dry-run     Show what would be updated without making changes
 *
 * Example cron entry (every 15 minutes):
 *   */15 * * * * cd /path/to/MakeTheCase && node server/scripts/mark-abandoned-chats.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '..', '..', '.env.local');
dotenv.config({ path: envPath });

// Parse command line arguments
const args = process.argv.slice(2);
const timeoutArg = args.find(a => a.startsWith('--timeout='));
const timeout = timeoutArg ? parseInt(timeoutArg.split('=')[1], 10) : 60;
const dryRun = args.includes('--dry-run');

async function main() {
  console.log(`[${new Date().toISOString()}] Mark Abandoned Chats - Starting`);
  console.log(`  Timeout: ${timeout} minutes`);
  console.log(`  Dry run: ${dryRun}`);

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
  });

  try {
    // First, show what will be marked as abandoned
    const [preview] = await pool.execute(
      `SELECT id, student_id, case_id, section_id, status, start_time, last_activity,
              TIMESTAMPDIFF(MINUTE, last_activity, NOW()) as inactive_minutes
       FROM case_chats
       WHERE status IN ('started', 'in_progress')
         AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)
       ORDER BY last_activity ASC`,
      [timeout]
    );

    if (preview.length === 0) {
      console.log('  No chats to mark as abandoned.');
    } else {
      console.log(`  Found ${preview.length} chat(s) to mark as abandoned:`);
      for (const chat of preview) {
        console.log(`    - ${chat.id}: ${chat.status}, inactive ${chat.inactive_minutes} min`);
      }

      if (!dryRun) {
        // Mark chats as abandoned
        const [result] = await pool.execute(
          `UPDATE case_chats
           SET status = 'abandoned', end_time = CURRENT_TIMESTAMP
           WHERE status IN ('started', 'in_progress')
             AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
          [timeout]
        );

        console.log(`  Marked ${result.affectedRows} chat(s) as abandoned.`);
      } else {
        console.log('  (Dry run - no changes made)');
      }
    }

    // Also log some stats
    const [stats] = await pool.execute(
      `SELECT status, COUNT(*) as count
       FROM case_chats
       GROUP BY status
       ORDER BY status`
    );

    console.log('  Current chat status distribution:');
    for (const stat of stats) {
      console.log(`    ${stat.status}: ${stat.count}`);
    }

  } catch (err) {
    console.error('  Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }

  console.log(`[${new Date().toISOString()}] Mark Abandoned Chats - Complete`);
}

main();
