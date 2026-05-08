const express = require('express');
const router = express.Router();
const { IntentLog } = require('../models');
const authMiddleware = require('../middleware/auth');

// POST /api/engagement/intent-to-buy
// Logs when a user clicks "Contact Seller" — uses JWT for buyerId if logged in
router.post('/intent-to-buy', async (req, res) => {
  try {
    const { sellerId, productId } = req.body;

    if (!sellerId || !productId)
      return res.status(400).json({ error: 'sellerId and productId are required' });

    // Extract buyerId from JWT token if provided, otherwise anonymous
    let buyerId = null;
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        buyerId = decoded.user.id;
      } catch { /* anonymous browse — that's fine */ }
    }

    const log = await IntentLog.create({
      sellerId,
      productId,
      buyerId,
      actionType: 'WhatsApp_Contact',
    });

    res.status(201).json({ message: 'Intent logged', logId: log.id });
  } catch (err) {
    console.error('Error logging intent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
