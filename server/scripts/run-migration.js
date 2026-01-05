/**
 * Run database migration from SQL file or add admin permissions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '.env.local' });

async function migrate() {
  console.log('\n🔌 Connecting to MySQL database...');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'ceochat'
  });

  try {
    console.log(`✓ Connected to database: ${process.env.MYSQL_DATABASE}`);

    // Check for migration file argument
    const migrationFile = process.argv[2];

    if (migrationFile) {
      // Run SQL file migration
      console.log(`\n📋 Running migration file: ${migrationFile}`);
      const migrationPath = path.isAbsolute(migrationFile)
        ? migrationFile
        : path.join(process.cwd(), migrationFile);

      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Split by semicolons and execute each statement
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        // Skip USE statements as we're already connected to the database
        if (statement.toUpperCase().startsWith('USE ')) {
          continue;
        }

        try {
          const [results] = await connection.execute(statement);

          // If this is a SELECT statement, show the results
          if (statement.toUpperCase().startsWith('SELECT')) {
            console.log('Results:', results);
          }
        } catch (err) {
          // Log but continue for idempotent statements
          if (err.message.includes('Duplicate column name')) {
            console.log(`ℹ️  Column already exists - skipping`);
          } else if (err.message.includes('Duplicate key name')) {
            console.log(`ℹ️  Index already exists - skipping`);
          } else {
            // Show other errors but continue
            console.log(`⚠️  ${err.message}`);
          }
        }
      }

      console.log('\n✅ Migration completed successfully!');

    } else {
      // Legacy behavior: add auth columns
      console.log('\n⚙️  Running legacy auth migration...');

      // Check if email column already exists
      const [cols] = await connection.execute("SHOW COLUMNS FROM admins LIKE 'email'");
      if (cols.length === 0) {
        await connection.execute('ALTER TABLE admins ADD COLUMN email VARCHAR(255) UNIQUE');
        console.log('✓ Added email column');
      } else {
        console.log('✓ email column already exists');
      }

      // Check if password_hash column already exists
      const [cols2] = await connection.execute("SHOW COLUMNS FROM admins LIKE 'password_hash'");
      if (cols2.length === 0) {
        await connection.execute('ALTER TABLE admins ADD COLUMN password_hash VARCHAR(255)');
        console.log('✓ Added password_hash column');
      } else {
        console.log('✓ password_hash column already exists');
      }

      console.log('\n✅ Migration complete!');
    }

    // Verify the changes
    console.log('\n📊 Current admin table structure:');
    const [columns] = await connection.execute('DESCRIBE admins');
    console.table(columns.map(col => ({
      Field: col.Field,
      Type: col.Type,
      Null: col.Null,
      Key: col.Key,
      Default: col.Default
    })));

    console.log('\n👥 Current admins:');
    try {
      const [admins] = await connection.execute('SELECT id, email, who, superuser, admin_access FROM admins');
      console.table(admins.map(admin => ({
        email: admin.email,
        who: admin.who,
        superuser: admin.superuser ? 'Yes' : 'No',
        admin_access: admin.admin_access || '(none)'
      })));
    } catch (err) {
      // If new columns don't exist yet, show basic info
      const [admins] = await connection.execute('SELECT id, email, who FROM admins');
      console.table(admins);
      console.log('ℹ️  Note: superuser and admin_access columns not yet added');
    }

  } catch (err) {
    console.error('\n❌ Migration error:', err.message);
    console.error(err);
    process.exit(1);
  }

  await connection.end();
  console.log('\n✓ Database connection closed');
}

migrate();






