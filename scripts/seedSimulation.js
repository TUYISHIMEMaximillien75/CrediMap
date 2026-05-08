/**
 * scripts/seedSimulation.js
 *
 * Populates the database with 6 simulated sellers (3 Normal, 3 Malicious)
 * and a realistic review history for each, so the Admin → Simulation tab
 * shows meaningful data.
 *
 * Usage:  npm run seed:simulation
 * Safe to run multiple times — existing sim users are reused, new reviews added.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, Product, Transaction, Review, AuditLog } = require('../models');
const { recalculateAndPersist } = require('../utils/trustCalculator');

// ── Scenario config ─────────────────────────────────────────────────────────
const SCENARIOS = [
  // Normal sellers
  {
    name: 'Sim_Normal_Alice',
    email: 'sim.normal.alice@credmap.dev',
    type: 'normal',
    reviews: [
      { rating: 5, comment: 'Fast delivery, excellent quality. Very trustworthy seller!' },
      { rating: 4, comment: 'Quick and responsive. Item was accurate and clean.' },
      { rating: 5, comment: 'Honest and reliable. Highly recommended!' },
      { rating: 5, comment: 'Smooth transaction, legit seller. Very satisfied.' },
      { rating: 4, comment: 'Professional and punctual. Item was perfect.' },
    ],
  },
  {
    name: 'Sim_Normal_Brian',
    email: 'sim.normal.brian@credmap.dev',
    type: 'normal',
    reviews: [
      { rating: 5, comment: 'Genuine seller. Transparent and helpful throughout.' },
      { rating: 4, comment: 'Friendly and fair pricing. Definitely authentic.' },
      { rating: 5, comment: 'Reliable and timely. Quality item as described.' },
      { rating: 3, comment: 'Good overall. Acceptable condition.' },
      { rating: 5, comment: 'Professional, flexible, and easy to deal with.' },
    ],
  },
  {
    name: 'Sim_Normal_Carol',
    email: 'sim.normal.carol@credmap.dev',
    type: 'normal',
    reviews: [
      { rating: 4, comment: 'Careful packaging, clean item. Satisfied!' },
      { rating: 5, comment: 'Super fast, safe and smooth exchange.' },
      { rating: 4, comment: 'Prompt reply, item matched description.' },
      { rating: 5, comment: 'Very trustworthy! Would buy again.' },
      { rating: 4, comment: 'Honest seller, no issues at all.' },
    ],
  },
  // Malicious sellers — inflated fake positives + real complaints
  {
    name: 'Sim_Malicious_Dave',
    email: 'sim.malicious.dave@credmap.dev',
    type: 'malicious',
    reviews: [
      { rating: 5, comment: 'Excellent!' },
      { rating: 5, comment: 'Perfect seller!' },
      { rating: 5, comment: 'Amazing quality!' },
      { rating: 1, comment: 'Scam! Item was broken and he disappeared.' },
      { rating: 1, comment: 'Fake listing. Dishonest and rude.' },
    ],
  },
  {
    name: 'Sim_Malicious_Eve',
    email: 'sim.malicious.eve@credmap.dev',
    type: 'malicious',
    reviews: [
      { rating: 5, comment: 'Great!' },
      { rating: 5, comment: 'Fast and reliable!' },
      { rating: 1, comment: 'Terrible. Damaged item, lied about condition.' },
      { rating: 1, comment: 'Do not buy from this person. Total fraud!' },
      { rating: 2, comment: 'Slow and unresponsive. Wrong item sent.' },
    ],
  },
  {
    name: 'Sim_Malicious_Frank',
    email: 'sim.malicious.frank@credmap.dev',
    type: 'malicious',
    reviews: [
      { rating: 5, comment: 'Best seller ever!' },
      { rating: 5, comment: 'Super trustworthy!' },
      { rating: 1, comment: 'Ghosted me after payment. Sketchy.' },
      { rating: 1, comment: 'Overpriced and item was defective.' },
      { rating: 2, comment: 'Unreliable and careless. Avoid.' },
    ],
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('\n🌱  CrediMap Simulation Seeder\n' + '─'.repeat(45));

  await sequelize.authenticate();
  console.log('✅  DB connected\n');

  const hashedPw = await bcrypt.hash('SimPassword123!', 10);

  // Shared buyer account that "purchases" from each sim seller
  const [buyer] = await User.findOrCreate({
    where: { email: 'sim.buyer@credmap.dev' },
    defaults: { name: 'Sim_Buyer_Test', email: 'sim.buyer@credmap.dev', password: hashedPw, trustScore: 50 },
  });
  console.log(`👤  Shared buyer: ${buyer.name} (id=${buyer.id})\n`);

  for (const scenario of SCENARIOS) {
    const tag = scenario.type === 'normal' ? '🟢' : '🔴';
    console.log(`${tag}  ${scenario.name}`);

    // Ensure seller exists
    const [seller] = await User.findOrCreate({
      where: { email: scenario.email },
      defaults: { name: scenario.name, email: scenario.email, password: hashedPw, trustScore: 50 },
    });

    // One product per seller
    const [product] = await Product.findOrCreate({
      where: { sellerId: seller.id, title: `${scenario.name}'s Listing` },
      defaults: {
        sellerId: seller.id,
        title: `${scenario.name}'s Listing`,
        description: 'Simulation product for Admin trust score testing.',
        price: 50.00,
        category: 'General',
        categoryRiskFactor: 1.0,
      },
    });

    // One transaction + review per row (each review needs its own tx)
    for (let i = 0; i < scenario.reviews.length; i++) {
      const rev = scenario.reviews[i];
      const token = `sim_${seller.id}_rev_${i}`;

      // Create a separate completed transaction for each review
      let tx = await Transaction.findOne({ where: { reviewToken: token } });
      if (!tx) {
        tx = await Transaction.create({
          buyerId: buyer.id,
          sellerId: seller.id,
          productId: product.id,
          status: 'completed',
          reviewToken: token,
        });
      }

      // Create review only if one doesn't already exist for this tx
      const existing = await Review.findOne({ where: { transactionId: tx.id } });
      if (!existing) {
        await Review.create({
          transactionId: tx.id,
          rating:        rev.rating,
          comment:       rev.comment,
          status:        'approved',
          reviewToken:   token,
        });
        console.log(`    Rev ${i + 1}: ${rev.rating}★  "${rev.comment.slice(0, 45)}..."`);
      } else {
        console.log(`    Rev ${i + 1}: already exists, skipped`);
      }
    }

    // Recalculate trust score from seeded reviews
    try {
      await recalculateAndPersist(seller.id);
      const updated = await User.findByPk(seller.id);
      console.log(`    📊  Final score: ${updated.trustScore}\n`);
    } catch (e) {
      console.warn(`    ⚠️  Score recalc failed: ${e.message}\n`);
    }
  }

  console.log('─'.repeat(45));
  console.log('✅  Done! Open Admin → Simulation tab to see results.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
