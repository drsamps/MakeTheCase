// Quick script to assign a case to a section
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

async function main() {
  const sectionId = process.argv[2] || 'MBA530-1-F25';
  const caseId = process.argv[3] || 'malawis-pizza';
  const active = process.argv[4] !== 'false';

  try {
    // Check if assignment exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (existing.length > 0) {
      // Update existing
      if (active) {
        // Deactivate all others first
        await pool.execute(
          'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
          [sectionId]
        );
      }
      await pool.execute(
        'UPDATE section_cases SET active = ? WHERE section_id = ? AND case_id = ?',
        [active ? 1 : 0, sectionId, caseId]
      );
      console.log(`Updated existing assignment: section=${sectionId}, case=${caseId}, active=${active}`);
    } else {
      // Insert new
      if (active) {
        // Deactivate all others first
        await pool.execute(
          'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
          [sectionId]
        );
      }
      await pool.execute(
        'INSERT INTO section_cases (section_id, case_id, active) VALUES (?, ?, ?)',
        [sectionId, caseId, active ? 1 : 0]
      );
      console.log(`Created new assignment: section=${sectionId}, case=${caseId}, active=${active}`);
    }

    // Verify
    const [result] = await pool.execute(
      `SELECT sc.*, c.case_title FROM section_cases sc JOIN cases c ON sc.case_id = c.case_id WHERE sc.section_id = ?`,
      [sectionId]
    );
    console.log('\nCurrent cases for section:');
    result.forEach(r => {
      console.log(`  - ${r.case_title} (${r.case_id}): active=${!!r.active}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
