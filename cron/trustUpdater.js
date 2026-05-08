const cron = require('node-cron');
const { Transaction } = require('../models');
const { recalculateAndPersist } = require('../utils/trustCalculator');

/**
 * Initializes the cron job to recalculate dynamic trust scores for all sellers daily.
 * This ensures that the exponential time-decay logic naturally lowers the impact of old reviews,
 * maintaining a 'current' relevance to the trust scores.
 * 
 * @param {import('socket.io').Server} io - The Socket.io server instance for notifications
 */
function initTrustUpdaterCron(io) {
  // Schedule the job to run every midnight (00:00) server time
  cron.schedule('0 0 * * *', async () => {
    console.log('Starting daily trust score recalculation cron job...');
    
    try {
      // Find all distinct seller IDs by querying the Transaction table
      const transactions = await Transaction.findAll({
        attributes: ['sellerId'],
        group: ['sellerId']
      });

      const sellerIds = transactions.map(t => t.sellerId);
      console.log(`Found ${sellerIds.length} active sellers. Recalculating trust scores...`);

      let successCount = 0;
      let failCount = 0;

      // Iterate through sellers and recalculate
      for (const sellerId of sellerIds) {
        try {
          // Recalculate, update User.trustScore, AND write to AuditLog for history tracking
          const newTrustScore = await recalculateAndPersist(sellerId, 'cron');

          // Emit real-time notification if user is online
          if (io) {
            io.to(`user_${sellerId}`).emit('notification', {
              type: 'TRUST_SCORE_UPDATE',
              message: `Daily recalculation complete. Your Dynamic Trust Score is now ${newTrustScore}.`,
              data: { newTrustScore },
            });
          }

          successCount++;
        } catch (err) {
          console.error(`Failed to update trust score for seller ${sellerId}:`, err);
          failCount++;
        }
      }

      console.log(`Daily trust score recalculation completed. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
      console.error('Error executing daily trust score recalculation:', error);
    }
  });
}

module.exports = initTrustUpdaterCron;
