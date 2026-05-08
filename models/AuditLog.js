const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // 0 = system-generated (review/cron), >0 = actual admin user ID
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    targetUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    oldScore: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    newScore: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    // 'review' | 'cron' | 'admin_override' — describes what triggered the change
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'system',
    },
  }, {
    timestamps: true,
  });

  return AuditLog;
};

