const { Pool } = require('pg');

// ── Connection ──────────────────────────────────────────────────
const pool = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'your_railway_postgres_url_here'
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

// ── In-memory fallback (used when DATABASE_URL is not set) ──────
const mem = new Map();

// In-memory fallbacks for dashboard tables
const dashboardProductsMem = [];
const personalExpensesMem = [];
const metaAdsSpendingMem = [];
const ordersMem = [];

if (!pool) {
  console.warn('⚠️  DATABASE_URL not set or placeholder value used — using in-memory store (data lost on restart). Add a PostgreSQL service on Railway for persistence.');
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
  await initTictacTable();
  await initDashboardTables();
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

// ── Dashboard tables ─────────────────────────────────────────────
async function initDashboardTables() {
  if (!pool) return;
  
  // Products table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_products (
      id            SERIAL PRIMARY KEY,
      product_name  TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      price         DECIMAL(10, 2) NOT NULL,
      delivery_company TEXT,
      sale_date     TIMESTAMPTZ DEFAULT NOW(),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Expenses table (5 optional fields)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personal_expenses (
      id            SERIAL PRIMARY KEY,
      amount        DECIMAL(10, 2) NOT NULL,
      category      TEXT,
      description   TEXT,
      expense_date  TIMESTAMPTZ DEFAULT NOW(),
      field1        TEXT,
      field2        TEXT,
      field3        TEXT,
      field4        TEXT,
      field5        TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Meta ads spending
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_ads_spending (
      id            SERIAL PRIMARY KEY,
      campaign_name TEXT NOT NULL,
      amount_spent  DECIMAL(10, 2) NOT NULL,
      impressions   INTEGER,
      clicks        INTEGER,
      conversions   INTEGER,
      date          TIMESTAMPTZ DEFAULT NOW(),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Orders table for KPI tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                SERIAL PRIMARY KEY,
      order_number      TEXT UNIQUE,
      status            TEXT DEFAULT 'pending',
      revenue           DECIMAL(10, 2) NOT NULL,
      product_cost      DECIMAL(10, 2) DEFAULT 0,
      shipping_cost     DECIMAL(10, 2) DEFAULT 0,
      confirmed         BOOLEAN DEFAULT FALSE,
      delivered         BOOLEAN DEFAULT FALSE,
      returned          BOOLEAN DEFAULT FALSE,
      order_date        TIMESTAMPTZ DEFAULT NOW(),
      created_at        TIMESTAMPTZ DEFAULT NOW()
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

async function getAllColis() {
  if (!pool) return [];
  const { rows } = await pool.query(
    'SELECT * FROM tictac_colis ORDER BY synced_at DESC'
  );
  return rows;
}

async function deleteColis(code_barre) {
  if (!pool) return;
  await pool.query('DELETE FROM tictac_colis WHERE code_barre = $1', [code_barre]);
}

// ── Dashboard Products CRUD ──────────────────────────────────────
async function addProduct(product_name, quantity, price, delivery_company, sale_date = new Date()) {
  if (!pool) {
    const item = {
      id: dashboardProductsMem.length + 1,
      product_name,
      quantity: parseInt(quantity, 10),
      price: parseFloat(price),
      delivery_company,
      sale_date: new Date(sale_date),
      created_at: new Date()
    };
    dashboardProductsMem.push(item);
    return item;
  }
  const { rows } = await pool.query(
    `INSERT INTO dashboard_products (product_name, quantity, price, delivery_company, sale_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [product_name, quantity, price, delivery_company, sale_date]
  );
  return rows[0];
}

async function getAllProducts() {
  if (!pool) {
    return [...dashboardProductsMem].sort((a, b) => b.sale_date - a.sale_date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM dashboard_products ORDER BY sale_date DESC'
  );
  return rows;
}

async function deleteProduct(id) {
  if (!pool) {
    const idx = dashboardProductsMem.findIndex(p => String(p.id) === String(id));
    if (idx !== -1) dashboardProductsMem.splice(idx, 1);
    return;
  }
  await pool.query('DELETE FROM dashboard_products WHERE id = $1', [id]);
}

async function getProductsByDateRange(startDate, endDate) {
  if (!pool) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return dashboardProductsMem
      .filter(p => p.sale_date >= s && p.sale_date <= e)
      .sort((a, b) => b.sale_date - a.sale_date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM dashboard_products WHERE sale_date >= $1 AND sale_date <= $2 ORDER BY sale_date DESC',
    [startDate, endDate]
  );
  return rows;
}

// ── Dashboard Expenses CRUD ──────────────────────────────────────
async function addExpense(amount, category, description, expense_date, field1, field2, field3, field4, field5) {
  if (!pool) {
    const item = {
      id: personalExpensesMem.length + 1,
      amount: parseFloat(amount),
      category,
      description,
      expense_date: new Date(expense_date),
      field1,
      field2,
      field3,
      field4,
      field5,
      created_at: new Date()
    };
    personalExpensesMem.push(item);
    return item;
  }
  const { rows } = await pool.query(
    `INSERT INTO personal_expenses (amount, category, description, expense_date, field1, field2, field3, field4, field5)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [amount, category, description, expense_date, field1, field2, field3, field4, field5]
  );
  return rows[0];
}

async function getAllExpenses() {
  if (!pool) {
    return [...personalExpensesMem].sort((a, b) => b.expense_date - a.expense_date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM personal_expenses ORDER BY expense_date DESC'
  );
  return rows;
}

async function deleteExpense(id) {
  if (!pool) {
    const idx = personalExpensesMem.findIndex(e => String(e.id) === String(id));
    if (idx !== -1) personalExpensesMem.splice(idx, 1);
    return;
  }
  await pool.query('DELETE FROM personal_expenses WHERE id = $1', [id]);
}

async function getExpensesByDateRange(startDate, endDate) {
  if (!pool) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return personalExpensesMem
      .filter(ex => ex.expense_date >= s && ex.expense_date <= e)
      .sort((a, b) => b.expense_date - a.expense_date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM personal_expenses WHERE expense_date >= $1 AND expense_date <= $2 ORDER BY expense_date DESC',
    [startDate, endDate]
  );
  return rows;
}

// ── Meta Ads Spending CRUD ───────────────────────────────────────
async function addMetaSpending(campaign_name, amount_spent, impressions, clicks, conversions, date) {
  if (!pool) {
    const item = {
      id: metaAdsSpendingMem.length + 1,
      campaign_name,
      amount_spent: parseFloat(amount_spent),
      impressions: impressions ? parseInt(impressions, 10) : null,
      clicks: clicks ? parseInt(clicks, 10) : null,
      conversions: conversions ? parseInt(conversions, 10) : null,
      date: new Date(date),
      created_at: new Date()
    };
    metaAdsSpendingMem.push(item);
    return item;
  }
  const { rows } = await pool.query(
    `INSERT INTO meta_ads_spending (campaign_name, amount_spent, impressions, clicks, conversions, date)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [campaign_name, amount_spent, impressions, clicks, conversions, date]
  );
  return rows[0];
}

async function getAllMetaSpending() {
  if (!pool) {
    return [...metaAdsSpendingMem].sort((a, b) => b.date - a.date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM meta_ads_spending ORDER BY date DESC'
  );
  return rows;
}

async function deleteMetaSpending(id) {
  if (!pool) {
    const idx = metaAdsSpendingMem.findIndex(s => String(s.id) === String(id));
    if (idx !== -1) metaAdsSpendingMem.splice(idx, 1);
    return;
  }
  await pool.query('DELETE FROM meta_ads_spending WHERE id = $1', [id]);
}

async function getMetaSpendingByDateRange(startDate, endDate) {
  if (!pool) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return metaAdsSpendingMem
      .filter(m => m.date >= s && m.date <= e)
      .sort((a, b) => b.date - a.date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM meta_ads_spending WHERE date >= $1 AND date <= $2 ORDER BY date DESC',
    [startDate, endDate]
  );
  return rows;
}

// ── Orders CRUD ──────────────────────────────────────────────────
async function addOrder(order_number, revenue, product_cost = 0, shipping_cost = 0, confirmed = false, delivered = false, returned = false) {
  if (!pool) {
    const item = {
      id: ordersMem.length + 1,
      order_number,
      status: confirmed ? 'confirmed' : 'pending',
      revenue: parseFloat(revenue),
      product_cost: parseFloat(product_cost),
      shipping_cost: parseFloat(shipping_cost),
      confirmed: Boolean(confirmed),
      delivered: Boolean(delivered),
      returned: Boolean(returned),
      order_date: new Date(),
      created_at: new Date()
    };
    ordersMem.push(item);
    return item;
  }
  const { rows } = await pool.query(
    `INSERT INTO orders (order_number, status, revenue, product_cost, shipping_cost, confirmed, delivered, returned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [order_number, confirmed ? 'confirmed' : 'pending', revenue, product_cost, shipping_cost, confirmed, delivered, returned]
  );
  return rows[0];
}

async function getAllOrders() {
  if (!pool) {
    return [...ordersMem].sort((a, b) => b.order_date - a.order_date);
  }
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY order_date DESC');
  return rows;
}

async function updateOrder(id, updates) {
  if (!pool) {
    const idx = ordersMem.findIndex(o => String(o.id) === String(id));
    if (idx !== -1) {
      ordersMem[idx] = { ...ordersMem[idx], ...updates };
      return ordersMem[idx];
    }
    return null;
  }
  const setClause = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(updates);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE orders SET ${setClause} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0];
}

async function deleteOrder(id) {
  if (!pool) {
    const idx = ordersMem.findIndex(o => String(o.id) === String(id));
    if (idx !== -1) ordersMem.splice(idx, 1);
    return;
  }
  await pool.query('DELETE FROM orders WHERE id = $1', [id]);
}

async function getOrdersByDateRange(startDate, endDate) {
  if (!pool) {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return ordersMem
      .filter(o => o.order_date >= s && o.order_date <= e)
      .sort((a, b) => b.order_date - a.order_date);
  }
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE order_date >= $1 AND order_date <= $2 ORDER BY order_date DESC',
    [startDate, endDate]
  );
  return rows;
}

module.exports = {
  initDb, getAllStores, getStore, upsertStore, deleteStore, deleteAllStores,
  initTictacTable, upsertColis, getColisById, getAllColis, deleteColis,
  // Dashboard products
  addProduct, getAllProducts, deleteProduct, getProductsByDateRange,
  // Dashboard expenses
  addExpense, getAllExpenses, deleteExpense, getExpensesByDateRange,
  // Meta ads spending
  addMetaSpending, getAllMetaSpending, deleteMetaSpending, getMetaSpendingByDateRange,
  // Orders
  addOrder, getAllOrders, updateOrder, deleteOrder, getOrdersByDateRange,
};
