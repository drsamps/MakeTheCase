import { pool } from '../db.js';
import { getSetting } from '../services/promptService.js';

const ROLES = ['student', 'ta', 'instructor', 'primary_instructor', 'admin'];

const DEFAULT_SUBMITTER_ROLES = Object.freeze({
  student: true,
  ta: true,
  instructor: true,
  primary_instructor: true,
  admin: true,
});

const DEFAULT_VIEWER_RULES = Object.freeze({
  student: ['admin'],
  ta: ['admin'],
  instructor: ['admin'],
  primary_instructor: ['admin'],
  admin: ['admin'],
});

function parseJsonOr(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function getSubmitterRolesSetting() {
  const raw = await getSetting('feedback.submitter_roles');
  return { ...DEFAULT_SUBMITTER_ROLES, ...parseJsonOr(raw, DEFAULT_SUBMITTER_ROLES) };
}

export async function getViewerRulesSetting() {
  const raw = await getSetting('feedback.viewer_rules');
  const parsed = parseJsonOr(raw, DEFAULT_VIEWER_RULES);
  const merged = { ...DEFAULT_VIEWER_RULES };
  for (const role of ROLES) {
    const list = parsed[role];
    if (Array.isArray(list)) {
      merged[role] = list.filter(r => ROLES.includes(r));
    }
  }
  return merged;
}

export async function resolveSubmitterRole(user) {
  if (!user) return null;
  if (user.role === 'student') return 'student';
  if (user.role === 'admin') return 'admin';
  if (user.role !== 'instructor' || !user.id) return null;

  const [primary] = await pool.execute(
    `SELECT 1 AS x
       FROM instructor_semesters WHERE instructor_id = ?
     UNION ALL
     SELECT 1 FROM courses  WHERE primary_instructor_id = ?
     UNION ALL
     SELECT 1 FROM sections WHERE primary_instructor_id = ?
     LIMIT 1`,
    [user.id, user.id, user.id]
  );
  if (primary.length > 0) return 'primary_instructor';

  const [ta] = await pool.execute(
    'SELECT 1 FROM instructor_sections WHERE instructor_id = ? LIMIT 1',
    [user.id]
  );
  if (ta.length > 0) return 'ta';

  return 'instructor';
}

export function canSubmit(role, submitterRoles) {
  if (!role) return false;
  return submitterRoles[role] === true;
}

export function allowedSubmitterRolesForViewer(viewerRole, viewerRules) {
  if (!viewerRole) return [];
  return ROLES.filter(submitter => {
    const list = viewerRules[submitter];
    return Array.isArray(list) && list.includes(viewerRole);
  });
}

export const FEEDBACK_ROLES = ROLES;
