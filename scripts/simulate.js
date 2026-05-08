const { User, Product, Transaction, Review, sequelize } = require('../models');
const { calculateDynamicTrust } = require('../utils/trustCalculator');

async function runSimulation() {
  console.log('--- Starting Dynamic Trust Simulation ---');
  
  // Sync the database to ensure tables exist
  await sequelize.sync();

  console.log('Generating 100 dummy sellers (90 Normal, 10 Malicious)...');
  
  const normalSellers = [];
  const maliciousSellers = [];

  // Create a dummy buyer
  const dummyBuyer = await User.create({
    name: 'Sim_Dummy_Buyer',
    email: `sim_buyer_${Date.now()}@example.com`,
    trustScore: 50
  });

  // Create Users
  for (let i = 1; i <= 100; i++) {
    const isMalicious = i <= 10;
    const name = isMalicious ? `Sim_Malicious_${i}` : `Sim_Normal_${i}`;
    const user = await User.create({
      name,
      email: `${name.toLowerCase()}_${Date.now()}@example.com`,
      trustScore: 50
    });

    // Create a dummy product for each seller
    const product = await Product.create({
      sellerId: user.id,
      title: `Simulated Product ${i}`,
      price: 100.00
    });

    user.productId = product.id; // Save product ID for later

    if (isMalicious) maliciousSellers.push(user);
    else normalSellers.push(user);
  }

  console.log('Generating 1,000 transactions and reviews...');
  
  const now = new Date();
  let totalTransactions = 0;

  // Generate reviews for normal sellers (10 reviews each, spread randomly over 60 days)
  for (const seller of normalSellers) {
    for (let j = 0; j < 10; j++) {
      const daysAgo = Math.floor(Math.random() * 60);
      const reviewDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      
      const transaction = await Transaction.create({
        buyerId: dummyBuyer.id,
        sellerId: seller.id,
        productId: seller.productId,
        status: 'completed'
      });

      // Random high rating between 3 and 5
      const rating = Math.floor(Math.random() * 3) + 3;
      const sentimentScore = rating >= 4 ? 0.8 : 0.2;

      await Review.create({
        transactionId: transaction.id,
        rating,
        sentimentScore,
        status: 'approved',
        createdAt: reviewDate,
        updatedAt: reviewDate
      }, { silent: true }); // silent: true prevents Sequelize from updating the timestamps

      totalTransactions++;
    }
  }

  // Generate reviews for malicious sellers
  // First 45 days (daysAgo > 15): 7 reviews, 5-star
  // Last 15 days (daysAgo <= 15): 3 reviews, 1-star
  for (const seller of maliciousSellers) {
    for (let j = 0; j < 10; j++) {
      let daysAgo;
      let rating;
      let sentimentScore;

      if (j < 7) {
        // High quality period (older than 15 days)
        daysAgo = Math.floor(Math.random() * 30) + 16; // 16 to 45 days ago
        rating = 5;
        sentimentScore = 0.9;
      } else {
        // Exit scam period (last 15 days)
        daysAgo = Math.floor(Math.random() * 15); // 0 to 14 days ago
        rating = 1;
        sentimentScore = -0.8;
      }

      const reviewDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      
      const transaction = await Transaction.create({
        buyerId: dummyBuyer.id,
        sellerId: seller.id,
        productId: seller.productId,
        status: 'completed'
      });

      await Review.create({
        transactionId: transaction.id,
        rating,
        sentimentScore,
        status: 'approved',
        createdAt: reviewDate,
        updatedAt: reviewDate
      }, { silent: true });

      totalTransactions++;
    }
  }

  console.log(`Successfully generated ${totalTransactions} transactions.`);
  console.log('Calculating metrics...');

  const results = [];

  // Combine sellers for calculation
  const allSellers = [...maliciousSellers, ...normalSellers.slice(0, 10)]; // Slice to keep report short

  for (const seller of allSellers) {
    // Calculate Standard Average
    const transactions = await Transaction.findAll({
      where: { sellerId: seller.id },
      include: [{ model: Review, as: 'review', required: true }]
    });

    let sum = 0;
    transactions.forEach(tx => sum += tx.review.rating);
    const avgRating = sum / transactions.length;
    
    // Scale average to 0-100 for direct comparison
    // Standard average: 1 star = 20, 5 star = 100
    const scaledAverage = (avgRating / 5) * 100;

    // Calculate Dynamic Trust Score
    const dynamicScore = await calculateDynamicTrust(seller.id);

    results.push({
      Seller: seller.name,
      Type: seller.name.includes('Malicious') ? 'Malicious' : 'Normal',
      'Avg Rating': avgRating.toFixed(2),
      'Standard Score (0-100)': scaledAverage.toFixed(0),
      'Dynamic Trust Score': dynamicScore
    });
  }

  console.log('\n--- Simulation Report (Malicious vs Sample Normal) ---');
  console.table(results);
  
  console.log('\nConclusion:');
  console.log('Notice how Malicious sellers maintain a relatively high Standard Score (~76/100) because of their early 5-star reviews.');
  console.log('However, the Dynamic Trust Score plunges significantly lower (<40/100) because it heavily penalizes recent bad behavior due to time-decay.');
  
  process.exit(0);
}

runSimulation().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
