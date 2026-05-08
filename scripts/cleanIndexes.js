/**
 * cleanIndexes.js — Drops ALL non-primary, non-essential indexes from
 * Users and Transactions tables, then lets Sequelize rebuild the necessary ones.
 *
 * Run once: node scripts/cleanIndexes.js
 * Then restart the server.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// Indexes we want to KEEP — these are essential for correctness
const KEEP = {
  Users:        new Set(['PRIMARY', 'email']),
  Transactions: new Set(['PRIMARY', 'reviewToken']),
};

async function cleanTable(conn, table) {
  const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\``);
  const keep = KEEP[table] || new Set(['PRIMARY']);

  const toDrop = rows
    .map(r => r.Key_name)
    .filter(k => !keep.has(k));

  const unique = [...new Set(toDrop)];

  if (unique.length === 0) {
    console.log(`✓ ${table}: nothing to drop`);
    return;
  }

  console.log(`\n${table}: dropping ${unique.length} excess indexes...`);
  for (const keyName of unique) {
    try {
      await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${keyName}\``);
      console.log(`  ✓ Dropped: ${keyName}`);
    } catch (e) {
      console.log(`  - Skipped ${keyName}: ${e.message}`);
    }
  }

  const [after] = await conn.query(`SHOW INDEX FROM \`${table}\``);
  console.log(`  → ${table} now has ${after.length} indexes`);
}

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('Connected.\n');

  await cleanTable(conn, 'Users');
  await cleanTable(conn, 'Transactions');

  await conn.end();
  console.log('\n✅ Done. Now restart the server with: npm run dev');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
