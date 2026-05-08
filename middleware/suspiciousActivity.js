const { Op } = require('sequelize');
const { Review, Transaction } = require('../models');

async function checkSuspiciousActivity(req, res, next) {
  try {
    const { reviewToken, rating } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Attach IP to request for the route to use
    req.clientIp = ipAddress;
    req.isSuspicious = false;

    if (!reviewToken) {
      return next(); // Let the route handle missing token
    }

    // Find the transaction to determine the sellerId
    const transaction = await Transaction.findOne({ where: { reviewToken } });
    if (!transaction) {
      return next(); // Let the route handle invalid token
    }

    const sellerId = transaction.sellerId;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Rule 1: Has the seller received more than three 5-star reviews in the last 10 minutes?
    if (rating === 5) {
      const recentFiveStarCount = await Review.count({
        where: {
          rating: 5,
          createdAt: {
            [Op.gte]: tenMinutesAgo
          }
        },
        include: [{
          model: Transaction,
          as: 'transaction',
          where: { sellerId },
          required: true
        }]
      });

      if (recentFiveStarCount >= 2) {
        req.isSuspicious = true;
        req.suspicionReason = 'Excessive 5-star reviews for this seller in a short time.';
        return next();
      }
    }

    // Rule 2: Has the current IP address posted reviews for different sellers in the last 10 minutes?
    // Let's count distinct sellerIds for this IP address in the last 10 minutes.
    const recentReviewsFromIp = await Review.findAll({
      where: {
        ipAddress: ipAddress,
        createdAt: {
          [Op.gte]: tenMinutesAgo
        }
      },
      include: [{
        model: Transaction,
        as: 'transaction',
        attributes: ['sellerId'],
        required: true
      }]
    });

    const uniqueSellers = new Set();
    // Add the current seller to the set since we are trying to review them now
    uniqueSellers.add(sellerId);
    
    recentReviewsFromIp.forEach(review => {
      if (review.transaction && review.transaction.sellerId) {
        uniqueSellers.add(review.transaction.sellerId);
      }
    });

    // If the IP has posted for more than 2 different sellers
    if (uniqueSellers.size > 2) {
      req.isSuspicious = true;
      req.suspicionReason = 'IP address posting reviews for multiple different sellers in a short time.';
      return next();
    }

    next();
  } catch (error) {
    console.error('Error in suspicious activity middleware:', error);
    next(error);
  }
}

module.exports = checkSuspiciousActivity;
