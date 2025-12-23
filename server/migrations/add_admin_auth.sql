-- Migration: Add authentication fields to admins table
-- Run this after the initial ceochat database is created

USE ceochat;

-- Add email and password_hash columns to admins table if they don't exist
ALTER TABLE admins 
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

-- Example: Insert a test admin user
-- Password is 'admin123' hashed with bcrypt (you should change this!)
-- To generate a new hash, use: node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
-- INSERT INTO admins (id, email, password_hash, who) 
-- VALUES (UUID(), 'admin@example.com', '$2a$10$example_hash_here', 'Admin User');

