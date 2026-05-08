const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Review = sequelize.define('Review', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    transactionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // 1-to-1 relationship with Transaction
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5,
      },
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sentimentScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    temporalWeight: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('approved', 'pending_review', 'rejected'),
      defaultValue: 'approved',
    },
  }, {
    timestamps: true, // Provides createdAt and updatedAt
  });

  return Review;
};
