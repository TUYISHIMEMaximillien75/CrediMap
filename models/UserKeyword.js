const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserKeyword = sequelize.define('UserKeyword', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    keyword: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    count: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    }
  }, {
    timestamps: true,
  });

  return UserKeyword;
};
