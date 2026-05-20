/**
 * scripts/seedSimulation.js
 *
 * Populates the database with 6 realistic student sellers (3 Trusted, 3 Malicious)
 * and a realistic review history for each, so the Admin → Simulation tab
 * shows meaningful, believable data.
 *
 * Usage:  npm run seed:simulation
 * Safe to run multiple times — existing records are reused, new ones added.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User, Product, Transaction, Review } = require('../models');
const { recalculateAndPersist } = require('../utils/trustCalculator');

// ── Scenario config ───────────────────────────────────────────────────────────
const SCENARIOS = [

  // ── TRUSTED SELLERS ──────────────────────────────────────────────────────
  {
    name:  'Alice Uwimana',
    email: 'alice.uwimana@campus.rw',
    phone: '+250788123456',
    type:  'normal',
    product: {
      title:       'MacBook Pro 2021 — M1 Chip, 8 GB RAM',
      description: 'Excellent condition MacBook Pro with M1 chip. Used for one semester of engineering studies. Comes with original charger and box. No scratches, battery health at 96 %.',
      category:    'Electronics',
      price:       750.00,
      imageUrl:    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 1.3,
    },
    reviews: [
      { rating: 5, comment: 'The MacBook is exactly as described. Alice was very honest and responsive. Smooth handover on campus. Highly recommended!' },
      { rating: 5, comment: 'Great laptop, perfect condition. Seller was transparent about everything. Would buy from her again.' },
      { rating: 4, comment: 'Laptop works perfectly. Minor delay in response but overall a very trustworthy seller.' },
      { rating: 5, comment: 'Fast and easy transaction. Alice even helped me set up the device. 10/10.' },
      { rating: 5, comment: 'Legit seller. Exactly what was advertised. Zero issues. Highly satisfied.' },
    ],
  },

  {
    name:  'Brian Nkurunziza',
    email: 'brian.nkurunziza@campus.rw',
    phone: '+250788654321',
    type:  'normal',
    product: {
      title:       'Calculus: Early Transcendentals — 8th Edition',
      description: 'Stewart Calculus 8th edition, lightly used. Some highlighter on chapters 1–4, otherwise clean. Perfect for first-year engineering or math students.',
      category:    'Books',
      price:       35.00,
      imageUrl:    'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 0.8,
    },
    reviews: [
      { rating: 5, comment: 'Book was in great condition, just as he said. Fair price and quick meetup. Very trustworthy!' },
      { rating: 4, comment: 'Good deal. Some highlighting in early chapters but nothing distracting. Honest seller.' },
      { rating: 5, comment: 'Brian was flexible with timing and location. Book is perfect for the course. Thanks!' },
      { rating: 3, comment: 'Book is OK. A few more pencil marks than expected but still usable. Seller was polite.' },
      { rating: 5, comment: 'Exactly what I needed for the semester. Clean handover, no issues. Reliable seller.' },
    ],
  },

  {
    name:  'Carol Ingabire',
    email: 'carol.ingabire@campus.rw',
    phone: '+250788987654',
    type:  'normal',
    product: {
      title:       'Nike Air Max 270 — Size 42, White/Black',
      description: 'Worn only twice, barely used. Bought for a sports event and kept in box since. Original box included. No discoloration or sole wear.',
      category:    'Clothing & Shoes',
      price:       80.00,
      imageUrl:    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 1.0,
    },
    reviews: [
      { rating: 5, comment: 'Shoes are brand new. Carol was very honest — she even showed unboxing photos beforehand. Perfect transaction.' },
      { rating: 4, comment: 'Good shoes, accurate description. Quick meetup at the library. Satisfied!' },
      { rating: 5, comment: 'Super clean sneakers. Seller was punctual and communicative. Would recommend.' },
      { rating: 5, comment: 'Love the shoes! Carol was friendly and professional. Zero issues from start to finish.' },
      { rating: 4, comment: 'Great deal, genuine seller. Shoes are in perfect shape. Minor quibble — she took a while to confirm.' },
    ],
  },

  // ── MALICIOUS SELLERS ─────────────────────────────────────────────────────
  {
    name:  'Dave Mugabo',
    email: 'dave.mugabo@campus.rw',
    phone: '+250788111222',
    type:  'malicious',
    product: {
      title:       'Samsung Galaxy S22 Ultra — 256 GB, Phantom Black',
      description: 'Used Samsung Galaxy S22 Ultra in good condition. All features working. Selling because upgrading to S24.',
      category:    'Electronics',
      price:       400.00,
      imageUrl:    'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 1.3,
    },
    reviews: [
      { rating: 5, comment: 'Great seller!' },
      { rating: 5, comment: 'Very professional, recommended!' },
      { rating: 5, comment: 'Smooth and fast deal. Trusted!' },
      { rating: 1, comment: 'SCAM! Phone was reported stolen. Police involved. Do NOT buy from this person.' },
      { rating: 1, comment: 'Fake listing. Phone had a cracked motherboard hidden under the screen protector. Disappeared after payment.' },
    ],
  },

  {
    name:  'Eve Kamikazi',
    email: 'eve.kamikazi@campus.rw',
    phone: '+250788333444',
    type:  'malicious',
    product: {
      title:       'HP Desk Lamp + Study Organizer Kit',
      description: 'LED desk lamp with USB charging port plus a study organizer. Both in working condition. Selling as a bundle.',
      category:    'General',
      price:       25.00,
      imageUrl:    'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 1.0,
    },
    reviews: [
      { rating: 5, comment: 'Amazing deal, great quality!' },
      { rating: 5, comment: 'Lamp works perfectly. Fast delivery.' },
      { rating: 1, comment: 'Lamp was broken inside — taped together to look fine. Lied about condition completely.' },
      { rating: 1, comment: 'Do NOT trust this seller. Sent a completely different item. No refund. Total fraud!' },
      { rating: 2, comment: 'Unresponsive after payment. Wrong item sent. Very disappointing experience.' },
    ],
  },

  {
    name:  'Frank Habimana',
    email: 'frank.habimana@campus.rw',
    phone: '+250788555666',
    type:  'malicious',
    product: {
      title:       'Yamaha F310 Acoustic Guitar — Full Size',
      description: 'Yamaha F310 with strap and pick set. Good condition for a beginner or intermediate player. Selling because switching to electric.',
      category:    'Sports & Music',
      price:       120.00,
      imageUrl:    'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=600&q=80',
      categoryRiskFactor: 1.1,
    },
    reviews: [
      { rating: 5, comment: 'Best seller on campus! Super trustworthy.' },
      { rating: 5, comment: 'Guitar arrived fast and in good condition!' },
      { rating: 1, comment: 'Ghosted me after I sent the money. Guitar never arrived. Reporting to campus security.' },
      { rating: 1, comment: 'Overpriced junk. Tuning pegs broken, neck slightly warped. Lied about condition.' },
      { rating: 2, comment: 'Unreliable. Rescheduled meetup 3 times then stopped responding. Avoid at all costs.' },
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('\n🌱  CrediMap Realistic Seeder\n' + '─'.repeat(50));

  await sequelize.authenticate();
  console.log('✅  DB connected\n');

  const hashedPw = await bcrypt.hash('SimPassword123!', 10);

  // Shared buyer account
  const [buyer] = await User.findOrCreate({
    where:    { email: 'sim.buyer@credmap.dev' },
    defaults: { name: 'Test Buyer Account', email: 'sim.buyer@credmap.dev', password: hashedPw, trustScore: 65 },
  });
  console.log(`👤  Shared buyer: ${buyer.name} (id=${buyer.id})\n`);

  for (const scenario of SCENARIOS) {
    const tag = scenario.type === 'normal' ? '🟢' : '🔴';
    console.log(`${tag}  ${scenario.name}  <${scenario.email}>`);

    // Ensure seller exists
    const [seller] = await User.findOrCreate({
      where:    { email: scenario.email },
      defaults: {
        name:       scenario.name,
        email:      scenario.email,
        phone:      scenario.phone,
        password:   hashedPw,
        trustScore: 50,
        isVerified: scenario.type === 'normal',
      },
    });

    // One product per seller — reuse by title if it already exists
    const [product] = await Product.findOrCreate({
      where:    { sellerId: seller.id, title: scenario.product.title },
      defaults: {
        sellerId:           seller.id,
        title:              scenario.product.title,
        description:        scenario.product.description,
        category:           scenario.product.category,
        price:              scenario.product.price,
        imageUrl:           scenario.product.imageUrl,
        categoryRiskFactor: scenario.product.categoryRiskFactor,
        status:             'available',
      },
    });
    console.log(`    📦  ${product.title} — $${product.price}`);

    // One transaction + review per review entry
    for (let i = 0; i < scenario.reviews.length; i++) {
      const rev   = scenario.reviews[i];
      const token = `sim_${seller.id}_rev_${i}`;

      let tx = await Transaction.findOne({ where: { reviewToken: token } });
      if (!tx) {
        tx = await Transaction.create({
          buyerId:     buyer.id,
          sellerId:    seller.id,
          productId:   product.id,
          status:      'completed',
          reviewToken: token,
        });
      }

      const existing = await Review.findOne({ where: { transactionId: tx.id } });
      if (!existing) {
        await Review.create({
          transactionId: tx.id,
          rating:        rev.rating,
          comment:       rev.comment,
          status:        'approved',
          reviewToken:   token,
        });
        console.log(`    Rev ${i + 1}: ${rev.rating}★  "${rev.comment.slice(0, 55)}..."`);
      } else {
        console.log(`    Rev ${i + 1}: already exists, skipped`);
      }
    }

    // Recalculate trust score
    try {
      await recalculateAndPersist(seller.id);
      const updated = await User.findByPk(seller.id);
      const icon = updated.trustScore >= 70 ? '✅' : updated.trustScore >= 40 ? '⚠️' : '❌';
      console.log(`    📊  Final trust score: ${updated.trustScore}  ${icon}\n`);
    } catch (e) {
      console.warn(`    ⚠️  Score recalc failed: ${e.message}\n`);
    }
  }

  console.log('─'.repeat(50));
  console.log('✅  Done! Open Admin → Simulation tab to see results.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
