-- Migration: 016_position_templates.sql
-- Purpose: Add position templates for quick position setup
-- Date: 2026-01-21

-- =====================================================
-- 1. Create position_templates table
-- =====================================================
CREATE TABLE IF NOT EXISTS position_templates (
  template_id INT AUTO_INCREMENT PRIMARY KEY,
  template_name VARCHAR(100) NOT NULL,
  template_description VARCHAR(255) DEFAULT NULL,
  is_system_template TINYINT(1) DEFAULT 0 COMMENT 'Built-in vs user-created',
  created_by CHAR(36) DEFAULT NULL COMMENT 'FK to admins for user-created templates',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_template_name (template_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. Create position_template_items table
-- =====================================================
CREATE TABLE IF NOT EXISTS position_template_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  position_name VARCHAR(100) NOT NULL,
  position VARCHAR(255) NOT NULL,
  position_order INT DEFAULT 0,

  FOREIGN KEY (template_id) REFERENCES position_templates(template_id) ON DELETE CASCADE,
  INDEX idx_template_items_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. Seed system templates
-- =====================================================

-- Agree/Disagree template
INSERT INTO position_templates (template_name, template_description, is_system_template)
VALUES ('Agree/Disagree', 'Simple binary positions for agreement or disagreement', 1);

SET @agree_disagree_id = LAST_INSERT_ID();

INSERT INTO position_template_items (template_id, position_name, position, position_order) VALUES
(@agree_disagree_id, 'agree', 'I agree with this position', 0),
(@agree_disagree_id, 'disagree', 'I disagree with this position', 1);

-- Support/Oppose template
INSERT INTO position_templates (template_name, template_description, is_system_template)
VALUES ('Support/Oppose', 'For proposals or recommendations', 1);

SET @support_oppose_id = LAST_INSERT_ID();

INSERT INTO position_template_items (template_id, position_name, position, position_order) VALUES
(@support_oppose_id, 'support', 'I support this recommendation', 0),
(@support_oppose_id, 'oppose', 'I oppose this recommendation', 1);

-- Yes/No/Undecided template
INSERT INTO position_templates (template_name, template_description, is_system_template)
VALUES ('Yes/No/Undecided', 'Three-option with neutral choice', 1);

SET @yes_no_id = LAST_INSERT_ID();

INSERT INTO position_template_items (template_id, position_name, position, position_order) VALUES
(@yes_no_id, 'yes', 'Yes, I recommend this action', 0),
(@yes_no_id, 'no', 'No, I do not recommend this action', 1),
(@yes_no_id, 'undecided', 'I am undecided on this action', 2);

-- Strong/Weak Support template (4-level scale)
INSERT INTO position_templates (template_name, template_description, is_system_template)
VALUES ('Strong/Weak Support', 'Four-level agreement scale', 1);

SET @strong_weak_id = LAST_INSERT_ID();

INSERT INTO position_template_items (template_id, position_name, position, position_order) VALUES
(@strong_weak_id, 'strongly_support', 'I strongly support this', 0),
(@strong_weak_id, 'somewhat_support', 'I somewhat support this', 1),
(@strong_weak_id, 'somewhat_oppose', 'I somewhat oppose this', 2),
(@strong_weak_id, 'strongly_oppose', 'I strongly oppose this', 3);

-- Recommend Action template
INSERT INTO position_templates (template_name, template_description, is_system_template)
VALUES ('Recommend Action', 'For case-specific action recommendations', 1);

SET @recommend_id = LAST_INSERT_ID();

INSERT INTO position_template_items (template_id, position_name, position, position_order) VALUES
(@recommend_id, 'proceed', 'I recommend proceeding with this action', 0),
(@recommend_id, 'modify', 'I recommend modifying this approach', 1),
(@recommend_id, 'reject', 'I recommend rejecting this proposal', 2);
