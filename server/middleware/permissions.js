/**
 * Permission middleware for granular admin access control
 */

// Base functions available to all instructors
const BASE_FUNCTIONS = ['chats', 'assignments', 'sections', 'students', 'cases', 'casefiles'];

// Superuser-only functions by default
const SUPERUSER_FUNCTIONS = ['caseprep', 'personas', 'prompts', 'models', 'settings', 'instructors'];

/**
 * Middleware to check if admin has access to specific dashboard function
 * Superusers bypass all checks
 *
 * @param {string} functionName - Name of the function to check (e.g., 'caseprep', 'personas')
 * @returns {Function} Express middleware function
 */
export function requirePermission(functionName) {
  return (req, res, next) => {
    // Must be authenticated
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Superusers have access to everything
    if (req.user.superuser) {
      return next();
    }

    // Base functions available to all admins
    if (BASE_FUNCTIONS.includes(functionName)) {
      return next();
    }

    // Check if user has specific permission
    const adminAccess = req.user.adminAccess || [];
    if (adminAccess.includes(functionName)) {
      return next();
    }

    // Access denied
    return res.status(403).json({
      error: `Access denied to ${functionName}. Contact a superuser for access.`
    });
  };
}

/**
 * Helper function to check if a user has access to a specific function
 * Can be used for non-middleware permission checks
 *
 * @param {Object} user - User object with superuser and adminAccess properties
 * @param {string} functionName - Name of the function to check
 * @returns {boolean} True if user has access, false otherwise
 */
export function hasPermission(user, functionName) {
  if (!user || user.role !== 'admin') {
    return false;
  }

  // Superusers have access to everything
  if (user.superuser) {
    return true;
  }

  // Base functions available to all
  if (BASE_FUNCTIONS.includes(functionName)) {
    return true;
  }

  // Check specific permissions
  const adminAccess = user.adminAccess || [];
  return adminAccess.includes(functionName);
}
