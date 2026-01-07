// Run migration 005_add_case_scenarios.sql
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'claudecode',
    password: 'devonly',
    database: process.env.MYSQL_DATABASE || 'ceochat',
    multipleStatements: false
  });

  try {
    console.log('Connected to database');

    // Helper to check if table exists
    async function tableExists(name) {
      const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [name]
      );
      return rows.length > 0;
    }

    // Helper to check if column exists
    async function columnExists(table, column) {
      const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      return rows.length > 0;
    }

    // Helper to check if constraint exists
    async function constraintExists(table, constraintName) {
      const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, constraintName]
      );
      return rows.length > 0;
    }

    // Helper to check if index exists
    async function indexExists(table, indexName) {
      const [rows] = await connection.query(
        `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, indexName]
      );
      return rows.length > 0;
    }

    console.log('\n1. Creating case_scenarios table...');
    if (await tableExists('case_scenarios')) {
      console.log('   Table already exists, skipping');
    } else {
      await connection.query(`
        CREATE TABLE case_scenarios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          case_id VARCHAR(30) NOT NULL,
          scenario_name VARCHAR(100) NOT NULL,
          protagonist VARCHAR(100) NOT NULL,
          protagonist_initials VARCHAR(5) NOT NULL,
          protagonist_role VARCHAR(200) DEFAULT NULL,
          chat_topic VARCHAR(255) DEFAULT NULL,
          chat_question TEXT NOT NULL,
          chat_time_limit INT DEFAULT 0,
          chat_time_warning INT DEFAULT 5,
          arguments_for TEXT DEFAULT NULL,
          arguments_against TEXT DEFAULT NULL,
          chat_options_override JSON DEFAULT NULL,
          sort_order INT DEFAULT 0,
          enabled BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
          INDEX idx_case_scenarios_case_id (case_id),
          INDEX idx_case_scenarios_enabled (enabled),
          INDEX idx_case_scenarios_sort_order (case_id, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('   Created');
    }

    console.log('\n2. Creating section_case_scenarios table...');
    if (await tableExists('section_case_scenarios')) {
      console.log('   Table already exists, skipping');
    } else {
      await connection.query(`
        CREATE TABLE section_case_scenarios (
          id INT AUTO_INCREMENT PRIMARY KEY,
          section_case_id INT NOT NULL,
          scenario_id INT NOT NULL,
          enabled BOOLEAN DEFAULT TRUE,
          sort_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (section_case_id) REFERENCES section_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE CASCADE,
          UNIQUE KEY unique_section_scenario (section_case_id, scenario_id),
          INDEX idx_scs_section_case (section_case_id),
          INDEX idx_scs_scenario (scenario_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('   Created');
    }

    console.log('\n3. Adding columns to section_cases...');
    if (!(await columnExists('section_cases', 'selection_mode'))) {
      await connection.query(`ALTER TABLE section_cases ADD COLUMN selection_mode ENUM('student_choice', 'all_required') NOT NULL DEFAULT 'student_choice'`);
      console.log('   Added selection_mode');
    } else {
      console.log('   selection_mode exists');
    }
    if (!(await columnExists('section_cases', 'require_order'))) {
      await connection.query(`ALTER TABLE section_cases ADD COLUMN require_order BOOLEAN DEFAULT FALSE`);
      console.log('   Added require_order');
    } else {
      console.log('   require_order exists');
    }
    if (!(await columnExists('section_cases', 'use_scenarios'))) {
      await connection.query(`ALTER TABLE section_cases ADD COLUMN use_scenarios BOOLEAN DEFAULT FALSE`);
      console.log('   Added use_scenarios');
    } else {
      console.log('   use_scenarios exists');
    }

    console.log('\n4. Adding columns to case_chats...');
    if (!(await columnExists('case_chats', 'scenario_id'))) {
      await connection.query(`ALTER TABLE case_chats ADD COLUMN scenario_id INT DEFAULT NULL`);
      console.log('   Added scenario_id');
    } else {
      console.log('   scenario_id exists');
    }
    if (!(await columnExists('case_chats', 'time_limit_minutes'))) {
      await connection.query(`ALTER TABLE case_chats ADD COLUMN time_limit_minutes INT DEFAULT NULL`);
      console.log('   Added time_limit_minutes');
    } else {
      console.log('   time_limit_minutes exists');
    }
    if (!(await columnExists('case_chats', 'time_started'))) {
      await connection.query(`ALTER TABLE case_chats ADD COLUMN time_started TIMESTAMP NULL DEFAULT NULL`);
      console.log('   Added time_started');
    } else {
      console.log('   time_started exists');
    }

    console.log('\n5. Adding foreign key and index to case_chats...');
    if (!(await constraintExists('case_chats', 'case_chats_scenario_fk'))) {
      try {
        await connection.query(`ALTER TABLE case_chats ADD CONSTRAINT case_chats_scenario_fk FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE SET NULL`);
        console.log('   Added foreign key');
      } catch (e) {
        console.log('   FK error:', e.message);
      }
    } else {
      console.log('   Foreign key exists');
    }
    if (!(await indexExists('case_chats', 'idx_case_chats_scenario_id'))) {
      await connection.query(`ALTER TABLE case_chats ADD INDEX idx_case_chats_scenario_id (scenario_id)`);
      console.log('   Added index');
    } else {
      console.log('   Index exists');
    }

    console.log('\n6. Migrating existing cases to scenarios...');
    const [insertResult] = await connection.query(`
      INSERT INTO case_scenarios (case_id, scenario_name, protagonist, protagonist_initials, chat_topic, chat_question, enabled, sort_order)
      SELECT case_id, 'Default Scenario', protagonist, protagonist_initials, chat_topic, chat_question, enabled, 0
      FROM cases
      WHERE case_id NOT IN (SELECT DISTINCT case_id FROM case_scenarios)
    `);
    console.log('   Created', insertResult.affectedRows, 'default scenarios');

    console.log('\n7. Auto-assigning scenarios to section_cases...');
    const [assignResult] = await connection.query(`
      INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order)
      SELECT sc.id, cs.id, TRUE, 0
      FROM section_cases sc
      JOIN case_scenarios cs ON cs.case_id = sc.case_id AND cs.scenario_name = 'Default Scenario'
      WHERE NOT EXISTS (
        SELECT 1 FROM section_case_scenarios scs WHERE scs.section_case_id = sc.id AND scs.scenario_id = cs.id
      )
    `);
    console.log('   Assigned', assignResult.affectedRows, 'scenarios');

    console.log('\n8. Enabling use_scenarios for section_cases...');
    const [updateResult] = await connection.query(`
      UPDATE section_cases sc
      SET use_scenarios = TRUE
      WHERE EXISTS (SELECT 1 FROM section_case_scenarios scs WHERE scs.section_case_id = sc.id)
    `);
    console.log('   Updated', updateResult.affectedRows, 'section_cases');

    console.log('\n=== Migration Complete ===');

    // Verify
    const [scenarios] = await connection.query('SELECT id, case_id, scenario_name, protagonist FROM case_scenarios');
    console.log('\nScenarios created:');
    scenarios.forEach(s => console.log(`  - ${s.id}: ${s.case_id} / ${s.scenario_name} (${s.protagonist})`));

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
