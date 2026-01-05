#!/usr/bin/env node
/**
 * Run migration with direct credentials
 */

import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'claudecode',
    password: 'devonly',
    database: 'ceochat',
    multipleStatements: true
  });

  try {
    console.log('Running migration with claudecode user...\n');

    const migrationPath = path.join(__dirname, '..', 'migrations', '001_case_prep_and_prompts.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    await connection.query(migrationSQL);

    console.log('✅ Migration completed successfully!\n');

    // Verify
    const [aiPrompts] = await connection.execute("SHOW TABLES LIKE 'ai_prompts'");
    const [settings] = await connection.execute("SHOW TABLES LIKE 'settings'");

    console.log(`✓ ai_prompts table: ${aiPrompts.length > 0 ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ settings table: ${settings.length > 0 ? 'EXISTS' : 'MISSING'}`);

    const [promptCount] = await connection.execute("SELECT COUNT(*) as count FROM ai_prompts");
    const [settingsCount] = await connection.execute("SELECT COUNT(*) as count FROM settings");

    console.log(`✓ ai_prompts records: ${promptCount[0].count}`);
    console.log(`✓ settings records: ${settingsCount[0].count}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
