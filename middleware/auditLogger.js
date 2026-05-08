const { AuditLog, User } = require('../models');

/**
 * Middleware that intercepts requests modifying a user's Trust Score.
 * It caches the old score before the route handler executes.
 * It overrides res.json to ensure the audit log is only written if the request succeeds.
 */
const auditTrustScoreChange = async (req, res, next) => {
  const targetUserId = req.params.id; // Assumes route is e.g., /api/admin/users/:id/trust-score
  const { newScore, reason } = req.body;
  
  // If the route doesn't have the required fields, we just skip logging
  if (newScore === undefined || !reason) {
    return next();
  }

  // 0 = system/unknown, only use a real ID if auth middleware ran
  const adminId = req.user ? req.user.id : 0;

  try {
    const user = await User.findByPk(targetUserId);
    if (user) {
      req.auditData = {
        adminId,
        targetUserId,
        oldScore: user.trustScore,
        newScore,
        reason
      };
    }
  } catch (err) {
    console.error('Audit Logger Error: Could not fetch user:', err);
  }

  // Intercept the response to log only on success
  const originalJson = res.json;
  res.json = function (data) {
    // If the response is successful and we collected audit data
    if (res.statusCode >= 200 && res.statusCode < 300 && req.auditData) {
      AuditLog.create(req.auditData)
        .then(() => console.log(`[AUDIT LOG] Trust Score manually updated for User ${req.auditData.targetUserId}`))
        .catch(err => console.error('Failed to write to AuditLog:', err));
    }
    originalJson.call(this, data);
  };

  next();
};

module.exports = auditTrustScoreChange;
