#!/usr/bin/env node
/**
 * Run the additional prompts migration
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
    console.log('Running additional prompts migration...\n');

    const migrationPath = path.join(__dirname, '..', 'migrations', '002_additional_prompt_templates.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    await connection.query(migrationSQL);

    console.log('✅ Migration completed successfully!\n');

    // Verify
    const [promptCount] = await connection.execute("SELECT COUNT(*) as count FROM ai_prompts");
    const [settingsCount] = await connection.execute("SELECT COUNT(*) as count FROM settings");

    console.log(`✓ Total ai_prompts records: ${promptCount[0].count}`);
    console.log(`✓ Total settings records: ${settingsCount[0].count}`);

    // List the new prompts
    const [newPrompts] = await connection.execute("SELECT `use`, version FROM ai_prompts WHERE `use` IN ('chat_system_prompt', 'chat_evaluation') ORDER BY `use`, version");
    console.log('\nNew prompt templates:');
    newPrompts.forEach(p => console.log(`  - ${p.use} / ${p.version}`));

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
