/**
 * Run database migration to add auth columns to admins table
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function migrate() {
  console.log('Connecting to MySQL database...');
  
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
  
  try {
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
    
    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
  
  await connection.end();
}

migrate();






