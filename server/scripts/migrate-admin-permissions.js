/**
 * Migrate admins table to add superuser and admin_access columns
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

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
    console.log(`✓ Connected to database: ${process.env.MYSQL_DATABASE}\n`);

    // Check if superuser column exists
    console.log('Checking for superuser column...');
    const [superuserCols] = await connection.execute("SHOW COLUMNS FROM admins LIKE 'superuser'");

    if (superuserCols.length === 0) {
      console.log('Adding superuser column...');
      await connection.execute(
        'ALTER TABLE admins ADD COLUMN superuser TINYINT(1) NOT NULL DEFAULT 1 COMMENT "Superuser has full access by default"'
      );
      console.log('✓ Added superuser column');
    } else {
      console.log('✓ superuser column already exists');
    }

    // Check if admin_access column exists
    console.log('Checking for admin_access column...');
    const [accessCols] = await connection.execute("SHOW COLUMNS FROM admins LIKE 'admin_access'");

    if (accessCols.length === 0) {
      console.log('Adding admin_access column...');
      await connection.execute(
        'ALTER TABLE admins ADD COLUMN admin_access TEXT DEFAULT NULL COMMENT "Comma-separated list of allowed functions for non-superusers"'
      );
      console.log('✓ Added admin_access column');
    } else {
      console.log('✓ admin_access column already exists');
    }

    // Check if index exists
    console.log('Checking for idx_admins_superuser index...');
    const [indexes] = await connection.execute(
      "SHOW INDEX FROM admins WHERE Key_name = 'idx_admins_superuser'"
    );

    if (indexes.length === 0) {
      console.log('Adding idx_admins_superuser index...');
      await connection.execute(
        'ALTER TABLE admins ADD INDEX idx_admins_superuser (superuser)'
      );
      console.log('✓ Added idx_admins_superuser index');
    } else {
      console.log('✓ idx_admins_superuser index already exists');
    }

    // Ensure all existing admins are superusers
    console.log('\nEnsuring all existing admins are superusers...');
    const [result] = await connection.execute(
      'UPDATE admins SET superuser = 1 WHERE superuser IS NULL OR superuser = 0'
    );
    console.log(`✓ Updated ${result.affectedRows} admin(s)`);

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
    const [admins] = await connection.execute('SELECT id, email, who, superuser, admin_access FROM admins');
    console.table(admins.map(admin => ({
      email: admin.email,
      who: admin.who,
      superuser: admin.superuser ? 'Yes' : 'No',
      admin_access: admin.admin_access || '(none)'
    })));

    console.log('\n✅ Migration completed successfully!');

  } catch (err) {
    console.error('\n❌ Migration error:', err.message);
    console.error(err);
    process.exit(1);
  }

  await connection.end();
  console.log('✓ Database connection closed\n');
}

migrate();
