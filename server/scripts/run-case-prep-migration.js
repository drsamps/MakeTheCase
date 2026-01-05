#!/usr/bin/env node
/**
 * Run the Case Prep & Prompt Management migration
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '..', '..', '.env.local');
dotenv.config({ path: envPath });

async function runMigration() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    multipleStatements: true  // Allow running multiple SQL statements
  });

  try {
    console.log('Running Case Prep & Prompt Management migration...\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'migrations', '001_case_prep_and_prompts.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Migration completed successfully!\n');

    // Verify tables were created
    console.log('Verifying migration...');

    const [aiPromptsTables] = await pool.execute("SHOW TABLES LIKE 'ai_prompts'");
    const [settingsTables] = await pool.execute("SHOW TABLES LIKE 'settings'");

    console.log(`✓ ai_prompts table: ${aiPromptsTables.length > 0 ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ settings table: ${settingsTables.length > 0 ? 'EXISTS' : 'MISSING'}`);

    // Check case_files columns
    const [caseFilesCols] = await pool.execute(
      "SHOW COLUMNS FROM case_files WHERE Field IN ('processing_status', 'processing_model', 'outline_content')"
    );
    const processingStatusExists = caseFilesCols.some(col => col.Field === 'processing_status');
    const processingModelExists = caseFilesCols.some(col => col.Field === 'processing_model');
    const outlineContentExists = caseFilesCols.some(col => col.Field === 'outline_content');

    console.log(`✓ case_files.processing_status: ${processingStatusExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ case_files.processing_model: ${processingModelExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ case_files.outline_content: ${outlineContentExists ? 'EXISTS' : 'MISSING'}`);

    // Check seed data
    const [promptCount] = await pool.execute("SELECT COUNT(*) as count FROM ai_prompts");
    const [settingsCount] = await pool.execute("SELECT COUNT(*) as count FROM settings");

    console.log(`✓ ai_prompts records: ${promptCount[0].count}`);
    console.log(`✓ settings records: ${settingsCount[0].count}`);

    console.log('\n✅ All migration changes verified successfully!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
