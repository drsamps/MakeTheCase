-- Migration: 047_instructor_teams.sql
-- Date: 2026-05-15
-- Description: Add Instructor Teams so instructors can share Cases, Rubrics,
--              Personas, and Case Writer projects with a defined group of
--              colleagues without making those resources public.
--
-- Tables:
--   instructor_teams           - one row per team
--   instructor_team_members    - team membership with role (owner/editor/viewer)
--   instructor_team_invitations - pending invites; resources don't become visible
--                                until invitee accepts (prevents silent surveillance)

CREATE TABLE IF NOT EXISTS instructor_teams (
  id CHAR(36) NOT NULL,
  team_name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_instructor_teams_created_by (created_by),
  CONSTRAINT fk_instructor_teams_created_by
    FOREIGN KEY (created_by) REFERENCES instructors(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS instructor_team_members (
  id INT AUTO_INCREMENT NOT NULL,
  team_id CHAR(36) NOT NULL,
  instructor_id CHAR(36) NOT NULL,
  role ENUM('owner', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_member (team_id, instructor_id),
  INDEX idx_team_members_team (team_id),
  INDEX idx_team_members_instructor (instructor_id),
  CONSTRAINT fk_team_members_team
    FOREIGN KEY (team_id) REFERENCES instructor_teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_instructor
    FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS instructor_team_invitations (
  id INT AUTO_INCREMENT NOT NULL,
  team_id CHAR(36) NOT NULL,
  invited_instructor_id CHAR(36) NULL COMMENT 'Resolved instructor id when invitee is an existing user',
  invited_email VARCHAR(255) NOT NULL COMMENT 'Email used to invite (may pre-date account creation)',
  invited_by CHAR(36) NOT NULL COMMENT 'Instructor who sent the invite',
  proposed_role ENUM('owner', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
  status ENUM('pending', 'accepted', 'declined', 'revoked') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pending_invite (team_id, invited_email, status),
  INDEX idx_invitations_email (invited_email),
  INDEX idx_invitations_status (status),
  CONSTRAINT fk_invitations_team
    FOREIGN KEY (team_id) REFERENCES instructor_teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_invitations_invited_instructor
    FOREIGN KEY (invited_instructor_id) REFERENCES instructors(id) ON DELETE SET NULL,
  CONSTRAINT fk_invitations_invited_by
    FOREIGN KEY (invited_by) REFERENCES instructors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Convenience view: which teams is each instructor a member of?
-- Used by visibility filters when joining shared resources.
CREATE OR REPLACE VIEW v_instructor_team_ids AS
SELECT instructor_id, team_id, role
FROM instructor_team_members;
