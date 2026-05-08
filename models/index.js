const { Sequelize } = require('sequelize');
const dbConfig = require('../config/database');

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  dialect: dbConfig.dialect,
  logging: dbConfig.logging,
});

const User = require('./User')(sequelize);
const Product = require('./Product')(sequelize);
const Transaction = require('./Transaction')(sequelize);
const Review = require('./Review')(sequelize);
const IntentLog = require('./IntentLog')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const UserKeyword = require('./UserKeyword')(sequelize);

// ── Associations ──────────────────────────────────────────────────────────────

// User -> Product
User.hasMany(Product, { foreignKey: 'sellerId', as: 'products' });
Product.belongsTo(User, { foreignKey: 'sellerId', as: 'seller' });

// User -> Transaction (Buyer)
User.hasMany(Transaction, { foreignKey: 'buyerId', as: 'purchases' });
Transaction.belongsTo(User, { foreignKey: 'buyerId', as: 'buyer' });

// User -> Transaction (Seller)
User.hasMany(Transaction, { foreignKey: 'sellerId', as: 'sales' });
Transaction.belongsTo(User, { foreignKey: 'sellerId', as: 'seller' });

// Product -> Transaction
Product.hasMany(Transaction, { foreignKey: 'productId', as: 'transactions' });
Transaction.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Transaction -> Review
Transaction.hasOne(Review, { foreignKey: 'transactionId', as: 'review' });
Review.belongsTo(Transaction, { foreignKey: 'transactionId', as: 'transaction' });

// User -> UserKeyword
User.hasMany(UserKeyword, { foreignKey: 'userId', as: 'keywords' });
UserKeyword.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User -> AuditLog
User.hasMany(AuditLog, { foreignKey: 'targetUserId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'targetUserId', as: 'targetUser' });

// IntentLog associations
User.hasMany(IntentLog, { foreignKey: 'sellerId', as: 'intentsReceived' });
User.hasMany(IntentLog, { foreignKey: 'buyerId', as: 'intentsMade' });
IntentLog.belongsTo(User, { foreignKey: 'sellerId', as: 'intentSeller' });
IntentLog.belongsTo(User, { foreignKey: 'buyerId', as: 'intentBuyer' });
Product.hasMany(IntentLog, { foreignKey: 'productId', as: 'intents' });
IntentLog.belongsTo(Product, { foreignKey: 'productId', as: 'intentProduct' });

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = {
  sequelize,
  Sequelize,
  User,
  Product,
  Transaction,
  Review,
  IntentLog,
  AuditLog,
  UserKeyword,
};
