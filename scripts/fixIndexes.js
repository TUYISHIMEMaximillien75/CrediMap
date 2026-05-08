/**
 * fixIndexes.js — One-time script to drop duplicate/excess indexes from tables
 * that have hit MySQL's 64-key limit due to repeated sync({ alter: true }) runs.
 *
 * Run once: node fixIndexes.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABLES = ['Users', 'Products', 'Transactions', 'Reviews', 'AuditLogs', 'UserKeywords', 'IntentLogs'];

async function fixIndexes() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('Connected. Scanning for excess indexes...\n');

  for (const table of TABLES) {
    try {
      const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\``);
      if (rows.length === 0) continue;

      // Group by Key_name, keep PRIMARY, keep the first occurrence of each unique key name
      const seen     = new Set(['PRIMARY']);
      const toDrop   = [];

      for (const row of rows) {
        const keyName = row.Key_name;
        if (keyName === 'PRIMARY') continue;

        if (seen.has(keyName)) {
          // Duplicate — mark for deletion
          toDrop.push(keyName);
        } else {
          seen.add(keyName);
        }
      }

      // Deduplicate the drop list
      const uniqueToDrop = [...new Set(toDrop)];

      if (uniqueToDrop.length === 0) {
        console.log(`✓ ${table}: ${rows.length} indexes — OK`);
        continue;
      }

      console.log(`⚠ ${table}: ${rows.length} indexes, dropping ${uniqueToDrop.length} duplicates...`);
      for (const keyName of uniqueToDrop) {
        try {
          await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${keyName}\``);
          console.log(`  Dropped: ${keyName}`);
        } catch (e) {
          console.error(`  Failed to drop ${keyName}:`, e.message);
        }
      }

      // Also check if total keys still > 60 — if so, drop non-essential ones
      const [after] = await conn.query(`SHOW INDEX FROM \`${table}\``);
      if (after.length > 60) {
        console.log(`  ⚠ Still ${after.length} keys — dropping non-unique, non-FK indexes...`);
        for (const row of after) {
          if (row.Key_name === 'PRIMARY') continue;
          if (row.Non_unique === 1) { // non-unique index — safe to drop extras
            try {
              await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${row.Key_name}\``);
              console.log(`  Dropped non-unique: ${row.Key_name}`);
            } catch { /* already dropped */ }
          }
        }
      }

    } catch (e) {
      if (e.code === 'ER_NO_SUCH_TABLE') {
        console.log(`- ${table}: table doesn't exist yet, skipping`);
      } else {
        console.error(`Error processing ${table}:`, e.message);
      }
    }
  }

  await conn.end();
  console.log('\nDone. You can now restart the server.');
}

fixIndexes().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
