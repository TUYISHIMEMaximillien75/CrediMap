const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { AuditLog, User, UserKeyword } = require('../models');
const { getTrustBreakdown } = require('../utils/trustCalculator');
const authMiddleware = require('../middleware/auth');

// GET /api/users/me — authenticated user's own profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const breakdown = await getTrustBreakdown(userId);
    const keywords = await UserKeyword.findAll({
      where: { userId },
      order: [['count', 'DESC']],
      limit: 8
    });

    res.json({ user, trustBreakdown: breakdown, topKeywords: keywords });
  } catch (err) {
    console.error('Error fetching own profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id — public profile of any user
router.get('/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'trustScore', 'isVerified', 'createdAt']
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const breakdown = await getTrustBreakdown(userId);
    const keywords = await UserKeyword.findAll({
      where: { userId },
      order: [['count', 'DESC']],
      limit: 5
    });

    res.json({ user, trustBreakdown: breakdown, topKeywords: keywords });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/trust-history — last 30 days from AuditLog
router.get('/:id/trust-history', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logs = await AuditLog.findAll({
      where: { targetUserId: userId, createdAt: { [Op.gte]: thirtyDaysAgo } },
      order: [['createdAt', 'ASC']]
    });

    const history = logs.map(log => ({
      date: log.createdAt.toISOString().split('T')[0],
      score: log.newScore
    }));

    if (history.length === 0) {
      history.push({ date: new Date().toISOString().split('T')[0], score: user.trustScore });
    }

    res.json({ history });
  } catch (err) {
    console.error('Error fetching trust history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/me/transactions — authenticated user's transactions (buyer + seller)
router.get('/me/transactions', authMiddleware, async (req, res) => {
  try {
    const { Transaction, Product, Review } = require('../models');
    const userId = req.user.id;

    const transactions = await Transaction.findAll({
      where: {
        [Op.or]: [{ buyerId: userId }, { sellerId: userId }]
      },
      include: [
        { model: Product, as: 'product', attributes: ['id', 'title', 'category', 'price'] },
        { model: User, as: 'seller', attributes: ['id', 'name', 'trustScore'] },
        { model: User, as: 'buyer', attributes: ['id', 'name', 'phone'] },
        { model: Review, as: 'review', required: false },
      ],
      order: [['createdAt', 'DESC']],
    });

    // Annotate each tx with the user's role in it
    const result = transactions.map(tx => ({
      ...tx.toJSON(),
      role: tx.buyerId === userId ? 'buyer' : 'seller',
      // A buyer can review if: tx is completed + has a reviewToken + no review yet
      canReview: tx.buyerId === userId &&
                 tx.status === 'completed' &&
                 !!tx.reviewToken &&
                 !tx.review,
    }));

    res.json({ transactions: result });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
