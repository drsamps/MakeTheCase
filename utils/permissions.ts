/**
 * Permission utilities for admin access control
 */

import { AdminUser } from '../types';

// Base functions available to all instructors
const BASE_FUNCTIONS = [
  'chats', 'assignments', 'sections', 'students', 'cases',
  // Multi-instructor additions:
  'teams',     // self-service Teams membership / sharing
  'apikeys',   // per-instructor API keys
  'rubrics',   // owned + system + team-shared
  'personas',  // system defaults (read-only) + per-instructor + team-shared — no " *" on Admin sub-tab
];

// Superuser-only functions by default (Admin sub-tabs show a trailing " *" in the UI)
const SUPERUSER_FUNCTIONS = [
  'caseprep', 'prompts', 'models', 'settings', 'instructors',
  'semesters', // semester catalog + set-current
  'auditlog',  // audit_log viewer
];

/**
 * Check if a user has access to a specific dashboard function
 *
 * @param user - Admin user object with superuser and adminAccess properties
 * @param functionName - Name of the function to check (e.g., 'caseprep', 'personas')
 * @returns True if user has access, false otherwise
 */
export function hasAccess(user: AdminUser | null | undefined, functionName: string): boolean {
  if (!user) return false;

  // Instructors get the base set, never the admin-only set.
  if (user.role === 'instructor') {
    return BASE_FUNCTIONS.includes(functionName);
  }

  if (user.role !== 'admin') return false;

  // Superusers have access to everything
  if (user.superuser) return true;

  // Base functions available to all admins
  if (BASE_FUNCTIONS.includes(functionName)) return true;

  // Check specific permissions
  return user.adminAccess?.includes(functionName) ?? false;
}

/**
 * Get list of all accessible tabs for a user
 *
 * @param user - Admin user object
 * @returns Array of accessible function names
 */
export function getAccessibleTabs(user: AdminUser | null | undefined): string[] {
  if (!user) {
    return [];
  }

  const allTabs = [...BASE_FUNCTIONS, ...SUPERUSER_FUNCTIONS];
  return allTabs.filter(tab => hasAccess(user, tab));
}

/**
 * Check if a function is superuser-only by default
 *
 * @param functionName - Name of the function to check
 * @returns True if function is superuser-only by default
 */
export function isSuperuserFunction(functionName: string): boolean {
  return SUPERUSER_FUNCTIONS.includes(functionName);
}
