const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { Transaction, Product, User } = require('../models');
const authMiddleware = require('../middleware/auth');
const mailer   = require('../utils/mailer');

// POST /api/transactions — authenticated buyer creates a transaction
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { sellerId, productId } = req.body;
    const buyerId = req.user.id; // ← always from JWT, never from body

    if (!sellerId || !productId)
      return res.status(400).json({ error: 'sellerId and productId are required' });

    // Prevent self-transactions: buyer cannot be the seller
    if (parseInt(sellerId, 10) === buyerId)
      return res.status(400).json({ error: 'You cannot buy your own item' });

    // Verify the product belongs to the specified seller
    const product = await Product.findByPk(productId);
    if (!product)
      return res.status(404).json({ error: 'Product not found' });
    if (product.sellerId !== parseInt(sellerId, 10))
      return res.status(400).json({ error: 'Product does not belong to that seller' });

    const [transaction, created] = await Transaction.findOrCreate({
      where: {
        buyerId,
        sellerId: parseInt(sellerId, 10),
        productId,
        status: 'pending',
      }
    });

    res.status(201).json({ message: 'Transaction created successfully', transaction });
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/transactions/:id/complete — only the seller can mark as complete
router.put('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const transaction = await Transaction.findByPk(req.params.id);
    if (!transaction)
      return res.status(404).json({ error: 'Transaction not found' });

    // Only the seller of this transaction can mark it completed
    if (transaction.sellerId !== req.user.id && !req.user.isAdmin)
      return res.status(403).json({ error: 'Only the seller can complete this transaction' });

    if (transaction.status === 'completed')
      return res.status(400).json({ error: 'Transaction is already completed' });

    const reviewToken = crypto.randomBytes(16).toString('hex');
    transaction.status = 'completed';
    transaction.reviewToken = reviewToken;
    await transaction.save();

    // Email buyer with the review link
    try {
      const buyer   = await User.findByPk(transaction.buyerId,  { attributes: ['email', 'name'] });
      const seller  = await User.findByPk(transaction.sellerId, { attributes: ['name'] });
      const product = await Product.findByPk(transaction.productId, { attributes: ['title'] });
      if (buyer && seller && product) {
        const reviewLink = `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/review/${reviewToken}`;
        await mailer.sendDealComplete(buyer.email, buyer.name, seller.name, product.title, reviewLink);
      }
    } catch (mailErr) {
      console.warn('[Mailer] Deal complete email failed:', mailErr.message);
    }

    res.json({
      message: 'Transaction marked as completed. Share the reviewToken with the buyer.',
      transaction,
      reviewToken,
    });
  } catch (err) {
    console.error('Error completing transaction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/transactions/my — authenticated user's transactions (as buyer or seller)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const transactions = await Transaction.findAll({
      where: {
        [Op.or]: [{ buyerId: req.user.id }, { sellerId: req.user.id }]
      },
      include: [{ model: Product, as: 'product', attributes: ['id', 'title', 'category', 'price'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
