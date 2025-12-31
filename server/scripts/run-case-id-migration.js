// Run the case_id migration for evaluations table
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'ceochat',
});

async function runMigration() {
  console.log('Running case_id migration for evaluations table...');
  
  try {
    // Check if columns already exist
    const [columns] = await pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'evaluations' AND COLUMN_NAME IN ('case_id', 'allow_rechat')",
      [process.env.MYSQL_DATABASE || 'ceochat']
    );
    
    const existingColumns = new Set(columns.map(c => c.COLUMN_NAME));
    
    if (!existingColumns.has('case_id')) {
      console.log('Adding case_id column...');
      await pool.execute(`ALTER TABLE evaluations ADD COLUMN case_id VARCHAR(30) DEFAULT NULL AFTER student_id`);
      console.log('✓ Added case_id column');
      
      // Add indexes
      try {
        await pool.execute(`ALTER TABLE evaluations ADD INDEX idx_case_id (case_id)`);
        console.log('✓ Added idx_case_id index');
      } catch (e) {
        if (e.code !== 'ER_DUP_KEYNAME') throw e;
        console.log('  idx_case_id index already exists');
      }
      
      try {
        await pool.execute(`ALTER TABLE evaluations ADD INDEX idx_student_case (student_id, case_id)`);
        console.log('✓ Added idx_student_case index');
      } catch (e) {
        if (e.code !== 'ER_DUP_KEYNAME') throw e;
        console.log('  idx_student_case index already exists');
      }
    } else {
      console.log('case_id column already exists');
    }
    
    if (!existingColumns.has('allow_rechat')) {
      console.log('Adding allow_rechat column...');
      await pool.execute(`ALTER TABLE evaluations ADD COLUMN allow_rechat BOOLEAN DEFAULT FALSE`);
      console.log('✓ Added allow_rechat column');
    } else {
      console.log('allow_rechat column already exists');
    }
    
    console.log('\n✓ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
