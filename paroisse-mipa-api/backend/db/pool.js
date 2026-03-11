// db/pool.js
const { Pool } = require('pg');

// Neon exige SSL — toujours activé
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Erreur pool PostgreSQL :', err.message);
});

module.exports = pool;
