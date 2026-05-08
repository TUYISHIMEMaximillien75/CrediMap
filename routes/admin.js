const express    = require('express');
const router     = express.Router();
const { Review, Transaction, User } = require('../models');
const { calculateDynamicTrust } = require('../utils/trustCalculator');
const authMiddleware = require('../middleware/auth');
const requireRole    = require('../middleware/requireRole');
const auditTrustScoreChange = require('../middleware/auditLogger');
const mailer     = require('../utils/mailer');

// All admin routes require authentication + admin role
router.use(authMiddleware, requireRole('admin'));

// GET /api/admin/users — list all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['trustScore', 'DESC']]
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/flagged-reviews
router.get('/flagged-reviews', async (req, res) => {
  try {
    const flaggedReviews = await Review.findAll({
      where: { status: 'pending_review' },
      include: [{
        model: Transaction, as: 'transaction',
        include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'email'] }]
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ flaggedReviews });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/flagged-reviews/:id/resolve
router.put('/flagged-reviews/:id/resolve', async (req, res) => {
  try {
    const { action } = req.body;
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: "Action must be 'approve' or 'reject'" });

    const review = await Review.findByPk(req.params.id, {
      include: [{ model: Transaction, as: 'transaction' }]
    });
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.status !== 'pending_review')
      return res.status(400).json({ error: 'Review is not pending' });

    review.status = action === 'approve' ? 'approved' : 'rejected';
    await review.save();

    const sellerId = review.transaction.sellerId;
    const newTrustScore = await calculateDynamicTrust(sellerId);
    await User.update({ trustScore: newTrustScore }, { where: { id: sellerId } });

    // Emit socket notification
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${sellerId}`).emit('notification', {
        type: 'TRUST_SCORE_UPDATE',
        message: `A review was ${review.status}. Your trust score is now ${newTrustScore}.`,
        data: { newTrustScore }
      });
    }

    res.json({ message: `Review ${review.status}`, review, updatedTrustScore: newTrustScore });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id/trust-score — manual override with audit log
router.put('/users/:id/trust-score', auditTrustScoreChange, async (req, res) => {
  try {
    const { newScore, reason } = req.body;
    if (newScore === undefined || !reason)
      return res.status(400).json({ error: 'newScore and reason are required' });

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.trustScore = newScore;
    await user.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${user.id}`).emit('notification', {
        type: 'TRUST_SCORE_UPDATE',
        message: `An admin updated your Trust Score to ${newScore}.`,
        data: { newTrustScore: newScore }
      });
    }

    res.json({ message: 'Trust score updated by admin', user: { id: user.id, trustScore: user.trustScore } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/simulation-stats
router.get('/simulation-stats', async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const maliciousUsers = await User.findAll({ where: { name: { [Op.like]: 'Sim_Malicious_%' } }, limit: 6 });
    const normalUsers = await User.findAll({ where: { name: { [Op.like]: 'Sim_Normal_%' } }, limit: 6 });
    const users = [...maliciousUsers, ...normalUsers];
    const stats = [];

    for (const user of users) {
      const transactions = await Transaction.findAll({
        where: { sellerId: user.id },
        include: [{ model: Review, as: 'review', required: true }]
      });
      let sum = 0;
      transactions.forEach(tx => sum += tx.review.rating);
      const avgRating = transactions.length > 0 ? sum / transactions.length : 0;
      stats.push({
        id: user.id, name: user.name,
        type: user.name.includes('Malicious') ? 'Malicious' : 'Normal',
        dynamicScore: user.trustScore,
        standardScore: Math.round((avgRating / 5) * 100),
        avgRating: avgRating.toFixed(1)
      });
    }

    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id/verify — toggle user verification
router.put('/users/:id/verify', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.isVerified = !user.isVerified;
    await user.save();

    const io = req.app.get('io');
    if (io && user.isVerified) {
      io.to(`user_${user.id}`).emit('notification', {
        type: 'VERIFIED',
        message: 'Your account has been verified by an admin! ✅',
        data: { isVerified: true }
      });
      // Email the user about their new verified status
      await mailer.sendVerified(user.email, user.name);
    }

    res.json({
      message: `User ${user.isVerified ? 'verified' : 'unverified'} successfully`,
      user: { id: user.id, isVerified: user.isVerified }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
