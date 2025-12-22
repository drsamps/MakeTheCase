# MySQL Migration Notes for MakeTheCase

## Overview
This document explains how to migrate data from Supabase (PostgreSQL) to MySQL.

## Files Created
- `mysql-database-structure-Oct2025.sql` - MySQL schema matching the Supabase structure

## Key Differences Between PostgreSQL and MySQL

### Data Types
- **UUID**: PostgreSQL `uuid` → MySQL `CHAR(36)`
- **Timestamps**: PostgreSQL `timestamp with time zone` → MySQL `TIMESTAMP`
- **Boolean**: PostgreSQL `boolean` → MySQL `BOOLEAN` 
- **JSON**: PostgreSQL `jsonb` → MySQL `JSON`
- **Real**: PostgreSQL `real` → MySQL `FLOAT`
- **Numeric**: PostgreSQL `numeric` → MySQL `DECIMAL(10, 8)`

### Functions
- `gen_random_uuid()` → Use `UUID()` function or `CHAR(36) DEFAULT (UUID())`
- `now()` → `CURRENT_TIMESTAMP` or `NOW()`

### Table Order
Tables are created in this order to satisfy foreign key dependencies:
1. `models` - No dependencies
2. `students` - Referenced by evaluations
3. `sections` - References models
4. `evaluations` - References students and models
5. `admins` - Independent (auth.users reference removed)

## How to Use

### 1. Create the MySQL Database
```bash
mysql -u root -p < docs/mysql-database-structure-Oct2025.sql
```

Or manually:
```sql
CREATE DATABASE IF NOT EXISTS ceochat;
USE ceochat;
-- Then run the rest of the SQL file
```

### 2. Optional Foreign Key
The students table has an optional foreign key to sections (not in original schema):
```sql
ALTER TABLE students
  ADD CONSTRAINT students_section_id_fkey 
  FOREIGN KEY (section_id) REFERENCES sections(section_id) 
  ON DELETE SET NULL ON UPDATE CASCADE;
```

### 3. Importing Data from Supabase

#### Option A: Export from Supabase Dashboard
1. Go to Supabase Dashboard
2. For each table (students, evaluations, sections, models):
   - Click "..." → "Export data"
   - Export as CSV
3. Import into MySQL:
```bash
mysql -u root -p ceochat < students.csv
```

#### Option B: Use Supabase CLI
```bash
# Install Supabase CLI
npm install -g supabase

# Export data
supabase db dump --data-only

# Convert and import to MySQL
```

#### Option C: Programmatic Migration
Create a Node.js script to read from Supabase and write to MySQL:

```javascript
// migrate.js
import { createClient } from '@supabase/supabase-js';
import mysql from 'mysql2/promise';

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'your_user',
  password: 'your_password',
  database: 'ceochat'
});

// Fetch data from Supabase
const { data: students } = await supabase.from('students').select('*');

// Insert into MySQL
for (const student of students) {
  await connection.execute(
    `INSERT INTO students (id, created_at, first_name, last_name, full_name, persona, section_id, finished_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [student.id, student.created_at, student.first_name, student.last_name, 
     student.full_name, student.persona, student.section_id, student.finished_at]
  );
}

// Repeat for other tables...
```

## Important Notes

### UUID Handling
UUIDs from Supabase are stored as `CHAR(36)` in MySQL. You may need to:
- Generate UUIDs: `UPDATE students SET id = UUID() WHERE id IS NULL;`
- Or import UUIDs from Supabase as strings

### Admins Table
The `admins` table originally referenced `auth.users` which doesn't exist in this schema. You'll need to either:
- Create a users table
- Remove the foreign key constraint (already done)
- Import admin data separately

### JSON Fields
The `criteria` field in evaluations is JSON. Ensure your data maintains valid JSON format when importing.

## Tables Created

1. **models** - AI model configurations
2. **students** - Student information
3. **sections** - Course sections
4. **evaluations** - Student evaluation results
5. **admins** - Admin users

## Next Steps

After creating the schema and importing data, you can:
1. Connect the Instructor Dashboard to MySQL instead of Supabase
2. Create a backend API that reads from MySQL
3. Use the MySQL database for local development or reporting

