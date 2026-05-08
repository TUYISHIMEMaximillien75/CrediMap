const express = require('express');
const router = express.Router();
const natural = require('natural');
const { Review, Transaction, User, UserKeyword } = require('../models');
const { recalculateAndPersist } = require('../utils/trustCalculator');
const mailer = require('../utils/mailer');
const checkSuspiciousActivity = require('../middleware/suspiciousActivity');
const authMiddleware = require('../middleware/auth');

const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "afinn");
const tokenizer = new natural.WordTokenizer();

// POST /api/reviews
router.post('/', authMiddleware, checkSuspiciousActivity, async (req, res) => {
  try {
    const { reviewToken, rating, comment } = req.body;
    const ipAddress = req.clientIp;
    const status = req.isSuspicious ? 'pending_review' : 'approved';

    // Validate request
    if (!reviewToken || !rating) {
      return res.status(400).json({ error: 'reviewToken and rating are required' });
    }

    // Ensure rating is between 1 and 5
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    // Validate transaction exists via reviewToken
    const transaction = await Transaction.findOne({ where: { reviewToken } });
    if (!transaction) {
      return res.status(404).json({ error: 'Invalid or expired review token' });
    }

    // Review Injection Prevention
    if (transaction.status !== 'completed') {
      return res.status(403).json({ error: 'Forbidden: Transaction is not completed' });
    }
    if (transaction.buyerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not own this transaction' });
    }

    const transactionId = transaction.id;
    const sellerId = transaction.sellerId;

    // Check if review already exists for this transaction
    const existingReview = await Review.findOne({ where: { transactionId } });
    if (existingReview) {
      return res.status(400).json({ error: 'Review already exists for this transaction' });
    }

    // Analyze sentiment if a comment is provided
    let sentimentScore = 0;

    // 52-word campus trust lexicon — covers common review language
    const TRUST_KEYWORDS = [
      // Positive — reliability & speed
      'fast', 'quick', 'punctual', 'prompt', 'responsive', 'timely',
      // Positive — honesty & trust
      'honest', 'authentic', 'genuine', 'trustworthy', 'transparent', 'legitimate',
      // Positive — quality & condition
      'quality', 'excellent', 'perfect', 'accurate', 'clean', 'careful',
      // Positive — service & attitude
      'reliable', 'professional', 'friendly', 'helpful', 'flexible', 'fair',
      // Positive — outcome
      'smooth', 'easy', 'safe', 'satisfied', 'recommended', 'legit',
      // Negative — fraud
      'scam', 'fake', 'fraud', 'lied', 'dishonest', 'sketchy',
      // Negative — reliability issues
      'late', 'slow', 'unresponsive', 'disappeared', 'ghosted', 'unreliable',
      // Negative — product issues
      'broken', 'damaged', 'wrong', 'missing', 'defective', 'overpriced',
      // Negative — attitude
      'rude', 'careless', 'terrible', 'awful', 'horrible', 'useless',
    ];

    if (comment && comment.trim() !== '') {
      const tokenized = tokenizer.tokenize(comment);
      if (tokenized.length > 0) {
        const rawScore = analyzer.getSentiment(tokenized);
        // AFINN scores are already normalized by word count but can exceed ±1.
        // Divide by 5 (max AFINN word score) to reliably squeeze into [-1, 1].
        sentimentScore = Math.max(-1, Math.min(1, rawScore / 5));

        // Keyword Extraction
        const lowerTokens = tokenized.map(t => t.toLowerCase());
        const matchedKeywords = lowerTokens.filter(t => TRUST_KEYWORDS.includes(t));
        
        // Extract unique matches per review to prevent spamming the same word
        const uniqueMatches = [...new Set(matchedKeywords)];

        for (const keyword of uniqueMatches) {
          const [userKeyword, created] = await UserKeyword.findOrCreate({
            where: { userId: sellerId, keyword },
            defaults: { count: 1 }
          });
          
          if (!created) {
            userKeyword.count += 1;
            await userKeyword.save();
          }
        }
      }
    }

    // Create the review
    const review = await Review.create({
      transactionId,
      rating,
      comment,
      sentimentScore,
      ipAddress,
      status
    });

    let newTrustScore = null;

    if (!req.isSuspicious) {
      newTrustScore = await recalculateAndPersist(sellerId, 'review');

      // Email seller about new review
      const seller = await User.findByPk(sellerId, { attributes: ['email', 'name'] });
      const buyer  = req.user ? await User.findByPk(req.user.id, { attributes: ['name'] }) : null;
      if (seller) {
        await mailer.sendReviewReceived(
          seller.email,
          seller.name,
          buyer?.name || 'A buyer',
          rating,
          transaction.product?.title || 'your listing',
        );
      }

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${sellerId}`).emit('notification', {
          type: 'NEW_REVIEW',
          message: `You received a new ${rating}-star review! Your trust score is now ${newTrustScore}.`,
          data: { rating, comment, newTrustScore },
        });
      }
    }

    // Optional: Clear the reviewToken so it cannot be used again
    transaction.reviewToken = null;
    await transaction.save();

    res.status(201).json({
      message: req.isSuspicious ? 'Review submitted and is pending approval due to suspicious activity' : 'Review added successfully',
      review,
      ...(newTrustScore !== null && { updatedTrustScore: newTrustScore })
    });
  } catch (err) {
    console.error('Error creating review:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
