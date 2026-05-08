/**
 * Role guard factory middleware.
 * Usage: router.get('/admin-only', authMiddleware, requireRole('admin'), handler)
 *
 * Since we use isAdmin: boolean (not a role string), only 'admin' is a valid argument.
 */
const requireRole = (role) => (req, res, next) => {
  if (role === 'admin' && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'Access denied: admin privileges required' });
  }
  next();
};

module.exports = requireRole;
