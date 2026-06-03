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

// ── Tictac colis table ───────────────────────────────────────────
async function initTictacTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tictac_colis (
      code_barre     TEXT PRIMARY KEY,
      libelle        TEXT,
      tel_cl         TEXT,
      nom_prenom_cl  TEXT,
      ville_cl       TEXT,
      delegation_cl  TEXT,
      adresse_cl     TEXT,
      tel_2_cl       TEXT,
      cod            TEXT,
      nb_piece       TEXT,
      remarque       TEXT,
      service        TEXT,
      raw_response   JSONB,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function upsertColis(colis) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO tictac_colis
       (code_barre, libelle, tel_cl, nom_prenom_cl, ville_cl, delegation_cl,
        adresse_cl, tel_2_cl, cod, nb_piece, remarque, service, raw_response, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (code_barre) DO UPDATE SET
       libelle       = EXCLUDED.libelle,
       tel_cl        = EXCLUDED.tel_cl,
       nom_prenom_cl = EXCLUDED.nom_prenom_cl,
       ville_cl      = EXCLUDED.ville_cl,
       delegation_cl = EXCLUDED.delegation_cl,
       adresse_cl    = EXCLUDED.adresse_cl,
       tel_2_cl      = EXCLUDED.tel_2_cl,
       cod           = EXCLUDED.cod,
       nb_piece      = EXCLUDED.nb_piece,
       remarque      = EXCLUDED.remarque,
       service       = EXCLUDED.service,
       raw_response  = EXCLUDED.raw_response,
       synced_at     = NOW()`,
    [
      colis.code_barre, colis.libelle, colis.tel_cl, colis.nom_prenom_cl,
      colis.ville_cl, colis.delegation_cl, colis.adresse_cl, colis.tel_2_cl,
      colis.cod, colis.nb_piece, colis.remarque, colis.service,
      JSON.stringify(colis.raw_response ?? colis),
    ]
  );
}

async function getColisById(code_barre) {
  if (!pool) return null;
  const { rows } = await pool.query(
    'SELECT * FROM tictac_colis WHERE code_barre = $1',
    [code_barre]
  );
  return rows[0] || null;
}

async function deleteColis(code_barre) {
  if (!pool) return;
  await pool.query('DELETE FROM tictac_colis WHERE code_barre = $1', [code_barre]);
}

module.exports = {
  initDb, getAllStores, getStore, upsertStore, deleteStore, deleteAllStores,
  initTictacTable, upsertColis, getColisById, deleteColis,
};
