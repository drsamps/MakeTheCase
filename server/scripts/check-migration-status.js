#!/usr/bin/env node
/**
 * Check if the case_chats migration is needed
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

async function checkMigrationStatus() {
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
    console.log('Checking migration status...\n');

    // Check if case_chats table exists
    const [tables] = await pool.execute(
      "SHOW TABLES LIKE 'case_chats'"
    );
    const caseChatTableExists = tables.length > 0;
    console.log(`✓ case_chats table: ${caseChatTableExists ? 'EXISTS' : 'MISSING'}`);

    // Check students table columns
    const [studentsCols] = await pool.execute(
      "SHOW COLUMNS FROM students WHERE Field IN ('email', 'password_hash', 'favorite_persona')"
    );
    const emailExists = studentsCols.some(col => col.Field === 'email');
    const passwordHashExists = studentsCols.some(col => col.Field === 'password_hash');
    const favoritePersonaExists = studentsCols.some(col => col.Field === 'favorite_persona');

    console.log(`✓ students.email: ${emailExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ students.password_hash: ${passwordHashExists ? 'EXISTS' : 'MISSING'}`);
    console.log(`✓ students.favorite_persona: ${favoritePersonaExists ? 'EXISTS' : 'MISSING'}`);

    // Check evaluations table columns
    const [evalCols] = await pool.execute(
      "SHOW COLUMNS FROM evaluations WHERE Field = 'case_chat_id'"
    );
    const caseChatIdExists = evalCols.length > 0;
    console.log(`✓ evaluations.case_chat_id: ${caseChatIdExists ? 'EXISTS' : 'MISSING'}`);

    console.log('\n---');

    const migrationNeeded = !caseChatTableExists || !emailExists || !passwordHashExists ||
                           !favoritePersonaExists || !caseChatIdExists;

    if (migrationNeeded) {
      console.log('❌ Migration is NEEDED - run the migration file');
      process.exit(1);
    } else {
      console.log('✅ Migration is NOT needed - all changes already applied');
      process.exit(0);
    }

  } catch (err) {
    console.error('Error checking migration status:', err.message);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

checkMigrationStatus();
