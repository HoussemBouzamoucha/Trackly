const { Pool } = require('pg');

// ── Connection ──────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

// ── In-memory fallback (used when DATABASE_URL is not set) ──────
const mem = new Map();

if (!pool) {
  console.warn('⚠️  DATABASE_URL not set — using in-memory store (data lost on restart). Add a PostgreSQL service on Railway for persistence.');
}

// ── Schema init ─────────────────────────────────────────────────
async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connected_stores (
      id            TEXT PRIMARY KEY,
      name          TEXT    NOT NULL,
      domain        TEXT    DEFAULT '',
      access_token  TEXT    NOT NULL,
      refresh_token TEXT    NOT NULL,
      expires_at    BIGINT  NOT NULL
    )
  `);
  console.log('✅ Database ready');
}

// ── CRUD ────────────────────────────────────────────────────────
async function getAllStores() {
  if (!pool) return Array.from(mem.values());
  const { rows } = await pool.query('SELECT * FROM connected_stores');
  return rows;
}

async function getStore(id) {
  if (!pool) return mem.get(id) || null;
  const { rows } = await pool.query(
    'SELECT * FROM connected_stores WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function upsertStore(store) {
  if (!pool) { mem.set(store.id, store); return; }
  await pool.query(
    `INSERT INTO connected_stores (id, name, domain, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name          = EXCLUDED.name,
       domain        = EXCLUDED.domain,
       access_token  = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at    = EXCLUDED.expires_at`,
    [store.id, store.name, store.domain, store.access_token, store.refresh_token, store.expires_at]
  );
}

async function deleteStore(id) {
  if (!pool) { mem.delete(id); return; }
  await pool.query('DELETE FROM connected_stores WHERE id = $1', [id]);
}

async function deleteAllStores() {
  if (!pool) { mem.clear(); return; }
  await pool.query('DELETE FROM connected_stores');
}

module.exports = { initDb, getAllStores, getStore, upsertStore, deleteStore, deleteAllStores };
