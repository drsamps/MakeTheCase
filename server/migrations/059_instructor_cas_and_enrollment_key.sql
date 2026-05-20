-- 059: Enable CAS sign-in for instructors and add per-section enrollment keys
--
-- Part 1: instructors table gains netid + auth_method so an Admin can create
-- an instructor who signs in via BYU CAS (no password). password_hash becomes
-- nullable so CAS-only rows are valid.
--
-- Part 2: sections gains an optional enrollment_key. When set, students must
-- supply the key on self-enroll. Stored plaintext so instructors can re-share
-- the code with their class (e.g., via syllabus).

ALTER TABLE instructors
  ADD COLUMN netid VARCHAR(50) NULL AFTER email,
  ADD COLUMN auth_method ENUM('password','cas','both') NOT NULL DEFAULT 'password' AFTER active,
  MODIFY COLUMN password_hash VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_instructors_netid (netid);

ALTER TABLE sections
  ADD COLUMN enrollment_key VARCHAR(255) NULL AFTER accept_new_students;
