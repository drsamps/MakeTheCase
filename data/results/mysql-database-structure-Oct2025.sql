-- MySQL database structure for ChatWithCEO
-- Converted from Supabase PostgreSQL schema
-- Note: This is designed for the 'ceochat' database

-- Create database
CREATE DATABASE IF NOT EXISTS ceochat;
USE ceochat;

-- Table: models
-- Must be created first as other tables reference it
CREATE TABLE IF NOT EXISTS models (
  model_id VARCHAR(255) NOT NULL,
  model_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_model BOOLEAN NOT NULL DEFAULT FALSE,
  input_cost DECIMAL(10, 8),
  output_cost DECIMAL(10, 8),
  PRIMARY KEY (model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: students
-- Created early as evaluations references it
-- Note: Foreign key to sections is added via ALTER TABLE after sections table is created
CREATE TABLE IF NOT EXISTS students (
  id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  persona TEXT,
  section_id VARCHAR(20),
  finished_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_section_id (section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: sections
-- References models table
CREATE TABLE IF NOT EXISTS sections (
  section_id VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  section_title TEXT NOT NULL,
  year_term TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  chat_model VARCHAR(255),
  super_model VARCHAR(255),
  PRIMARY KEY (section_id),
  CONSTRAINT sections_chat_model_fkey FOREIGN KEY (chat_model) REFERENCES models(model_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT sections_super_model_fkey FOREIGN KEY (super_model) REFERENCES models(model_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CHECK (CHAR_LENGTH(section_id) <= 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: evaluations
-- References students and models tables
CREATE TABLE IF NOT EXISTS evaluations (
  id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  student_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  summary TEXT,
  criteria JSON,
  persona TEXT,
  hints INT DEFAULT 0,
  helpful FLOAT,
  liked TEXT,
  improve TEXT,
  chat_model VARCHAR(255),
  super_model VARCHAR(255),
  transcript TEXT,
  PRIMARY KEY (id),
  CONSTRAINT evaluations_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT evaluations_chat_model_fkey FOREIGN KEY (chat_model) REFERENCES models(model_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT evaluations_super_model_fkey FOREIGN KEY (super_model) REFERENCES models(model_id) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_student_id (student_id),
  INDEX idx_chat_model (chat_model),
  INDEX idx_super_model (super_model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: admins
-- Note: References auth.users which doesn't exist in this schema
-- You may need to create a users table or remove this foreign key constraint
CREATE TABLE IF NOT EXISTS admins (
  id CHAR(36) NOT NULL,
  who TEXT,
  PRIMARY KEY (id)
  -- Removed foreign key to auth.users as it doesn't exist in this schema
  -- CONSTRAINT admins_id_fkey FOREIGN KEY (id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional: Add foreign key from students to sections for data integrity
-- Note: This constraint wasn't in the original Supabase schema but helps maintain data integrity
-- Uncomment to enable:
-- ALTER TABLE students
--   ADD CONSTRAINT students_section_id_fkey FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE SET NULL ON UPDATE CASCADE;

