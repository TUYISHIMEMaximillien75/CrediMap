const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const IntentLog = sequelize.define('IntentLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    sellerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    buyerId: {
      type: DataTypes.INTEGER,
      allowNull: true, // Nullable in case the buyer is not logged in
    },
    actionType: {
      type: DataTypes.STRING,
      defaultValue: 'WhatsApp_Contact',
    }
  }, {
    timestamps: true,
  });

  return IntentLog;
};
