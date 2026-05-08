const { Transaction, Review, Product, AuditLog, User } = require('../models');

// ─── Constants ────────────────────────────────────────────────────────────────
const LAMBDA = 0.01;           // Decay rate: ~50% weight loss after 70 days
const BASE_WEIGHT = 0.6;       // 60% of score comes from pure star rating
const SENTIMENT_WEIGHT = 0.4;  // 40% of score comes from NLP sentiment

/**
 * Converts a 1-5 star rating to a 0-100 scale.
 */
const ratingToScore = (rating) => ((rating - 1) / 4) * 100;

/**
 * Converts a sentiment score in [-1, 1] to a 0-100 scale.
 * -1 → 0, 0 → 50, +1 → 100
 */
const sentimentToScore = (sentiment) => ((sentiment + 1) / 2) * 100;

/**
 * Calculates a dynamic trust score for a user (seller).
 *
 * Algorithm:
 *  For each approved review:
 *    1. Compute a composite review score:
 *       reviewScore = BASE_WEIGHT * ratingScore + SENTIMENT_WEIGHT * sentimentScore
 *       (both components on 0-100 scale, so final is also 0-100)
 *    2. Apply exponential time-decay:  weight = e^(-lambda * ageDays)
 *    3. Apply contextual category risk: weight *= categoryRiskFactor
 *  Final = weighted average of reviewScores, clamped to [0, 100].
 *
 *  A seller with all 5-star reviews and no comments scores ~75
 *  (BASE_WEIGHT*100 + SENTIMENT_WEIGHT*50 = 60+20 = 80, minus small decay).
 *  A seller with all 5-star + positive comments approaches 100.
 *  A brand new seller with no reviews defaults to 50 (neutral).
 *
 * @param {number} userId - The seller's user ID.
 * @returns {Promise<number>} Trust score 0-100.
 */
async function calculateDynamicTrust(userId) {
  try {
    const transactions = await Transaction.findAll({
      where: { sellerId: userId },
      include: [
        {
          model: Review,
          as: 'review',
          required: true,
          where: { status: 'approved' },
        },
        {
          model: Product,
          as: 'product',
          required: false,
        },
      ],
    });

    if (transactions.length === 0) return 50;

    let totalWeightedScore = 0;
    let totalWeight = 0;
    const now = Date.now();

    for (const tx of transactions) {
      const review = tx.review;
      const rating = review.rating;                          // 1–5
      const sentiment = review.sentimentScore ?? 0;          // –1 to +1

      // 1. Composite review score on 0–100 scale
      const ratingScore    = ratingToScore(rating);           // 0–100
      const sentimentScore = sentimentToScore(sentiment);     // 0–100
      const reviewScore    = BASE_WEIGHT * ratingScore + SENTIMENT_WEIGHT * sentimentScore;

      // 2. Time-decay
      const ageInDays = (now - new Date(review.createdAt).getTime()) / 86_400_000;
      const decayWeight = Math.exp(-LAMBDA * ageInDays);

      // 3. Contextual risk factor (1.0 = neutral, >1 = high-risk category)
      const riskFactor  = tx.product?.categoryRiskFactor ?? 1.0;
      const finalWeight = decayWeight * riskFactor;

      totalWeightedScore += reviewScore * finalWeight;
      totalWeight        += finalWeight;
    }

    if (totalWeight === 0) return 50;

    const finalScore = totalWeightedScore / totalWeight;
    return Math.max(0, Math.min(100, Math.round(finalScore)));
  } catch (err) {
    console.error('calculateDynamicTrust error:', err);
    throw err;
  }
}

/**
 * Returns a detailed breakdown of the score components.
 * Each field shows the contribution (in points, on a 0–100 scale) of that factor.
 *
 * @param {number} userId
 * @returns {Promise<{baseScore, sentimentBonus, ageDecay, categoryRisk, finalScore}>}
 */
async function getTrustBreakdown(userId) {
  try {
    const transactions = await Transaction.findAll({
      where: { sellerId: userId },
      include: [
        { model: Review, as: 'review', required: true, where: { status: 'approved' } },
        { model: Product, as: 'product', required: false },
      ],
    });

    if (transactions.length === 0) {
      return { baseScore: 50, sentimentBonus: 0, ageDecay: 0, categoryRisk: 0, finalScore: 50 };
    }

    const now = Date.now();
    let baseSum = 0, sentimentSum = 0;
    let noDecayWeightSum = 0, noDecayScoreSum = 0;
    let decayOnlyWeightSum = 0, decayOnlyScoreSum = 0;

    for (const tx of transactions) {
      const r = tx.review;
      const rating    = r.rating;
      const sentiment = r.sentimentScore ?? 0;
      const ratingScore    = ratingToScore(rating);
      const sentimentScore = sentimentToScore(sentiment);
      const reviewScore    = BASE_WEIGHT * ratingScore + SENTIMENT_WEIGHT * sentimentScore;

      const ageInDays  = (now - new Date(r.createdAt).getTime()) / 86_400_000;
      const decayWeight = Math.exp(-LAMBDA * ageInDays);
      const riskFactor  = tx.product?.categoryRiskFactor ?? 1.0;

      // Step A: Pure unweighted rating component
      baseSum      += ratingScore;
      sentimentSum += sentimentScore;

      // Step B: Score with decay but NO risk factor (to isolate decay effect)
      noDecayWeightSum  += 1;
      noDecayScoreSum   += reviewScore;
      decayOnlyWeightSum  += decayWeight;
      decayOnlyScoreSum   += reviewScore * decayWeight;
    }

    const n = transactions.length;

    // 1. Base score: pure average rating mapped to 0-100
    const baseScore = Math.round(baseSum / n);

    // 2. Sentiment bonus: how much sentiment shifts the score vs pure rating
    const pureRatingAvg    = baseSum / n;
    const withSentimentAvg = (BASE_WEIGHT * (baseSum / n)) + (SENTIMENT_WEIGHT * (sentimentSum / n));
    const sentimentBonus   = Math.round(withSentimentAvg - pureRatingAvg);

    // 3. Age decay: difference between unweighted and decay-weighted score
    const unweightedAvg  = noDecayScoreSum / noDecayWeightSum;
    const decayAvg       = decayOnlyWeightSum > 0 ? decayOnlyScoreSum / decayOnlyWeightSum : unweightedAvg;
    const ageDecay       = Math.round(decayAvg - unweightedAvg); // negative = decay penalty

    // 4. Final score (with all factors including risk)
    const finalScore  = await calculateDynamicTrust(userId);
    const categoryRisk = Math.round(finalScore - decayAvg); // risk factor contribution

    return { baseScore, sentimentBonus, ageDecay, categoryRisk, finalScore };
  } catch (err) {
    console.error('getTrustBreakdown error:', err);
    return { baseScore: 50, sentimentBonus: 0, ageDecay: 0, categoryRisk: 0, finalScore: 50 };
  }
}

/**
 * Recalculates and persists the trust score for a user, and writes
 * an entry to the AuditLog so the trust-history chart accumulates data.
 *
 * @param {number} sellerId
 * @param {string} changeSource - e.g. 'review', 'cron', 'admin_override'
 * @returns {Promise<number>} New trust score
 */
async function recalculateAndPersist(sellerId, changeSource = 'review') {
  const seller = await User.findByPk(sellerId);
  if (!seller) throw new Error(`User ${sellerId} not found`);

  const oldScore = seller.trustScore;
  const newScore = await calculateDynamicTrust(sellerId);

  await User.update({ trustScore: newScore }, { where: { id: sellerId } });

  // Always write to AuditLog so the history chart builds over time
  await AuditLog.create({
    adminId: 0,          // 0 = system-generated (not an admin action)
    targetUserId: sellerId,
    oldScore,
    newScore,
    reason: changeSource,
  });

  return newScore;
}

module.exports = {
  calculateDynamicTrust,
  getTrustBreakdown,
  recalculateAndPersist,
};
