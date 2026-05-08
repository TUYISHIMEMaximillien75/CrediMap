const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    sellerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '',
    },
    category: {
      type: DataTypes.STRING,
      defaultValue: 'General',
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.ENUM('available', 'sold'),
      defaultValue: 'available',
      allowNull: false,
    },
    categoryRiskFactor: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      allowNull: false,
    },
  }, {
    timestamps: true,
  });

  return Product;
};

