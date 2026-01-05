/**
 * Script to create an admin user for the dashboard
 * Usage: node server/scripts/create-admin.js <email> <password> [--superuser]
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createAdmin() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node server/scripts/create-admin.js <email> <password> [--superuser]');
    console.log('Example: node server/scripts/create-admin.js admin@example.com mypassword123 --superuser');
    console.log('');
    console.log('Options:');
    console.log('  --superuser    Create as superuser with full access (default: regular instructor)');
    process.exit(1);
  }

  const [email, password, ...flags] = args;
  const isSuperuser = flags.includes('--superuser');

  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'ceochat'
    });

    // Check if email already exists
    const [existing] = await connection.execute(
      'SELECT id FROM admins WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      console.error('Error: An admin with this email already exists.');
      await connection.end();
      process.exit(1);
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    // Insert the new admin
    await connection.execute(
      'INSERT INTO admins (id, email, password_hash, who, superuser) VALUES (?, ?, ?, ?, ?)',
      [id, email, passwordHash, email, isSuperuser ? 1 : 0]
    );

    console.log('✓ Admin user created successfully!');
    console.log('  Email:', email);
    console.log('  ID:', id);
    console.log('  Superuser:', isSuperuser ? 'Yes' : 'No');

    await connection.end();
  } catch (error) {
    console.error('Error creating admin:', error.message);
    process.exit(1);
  }
}

createAdmin();

