const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getValidToken } = require('./auth');

const BASE_URL = 'https://api.converty.shop/api/v1';

// ── Middleware: ensure connected ───────────────────────────────
function requireAuth(req, res, next) {
  const storeId = req.session.activeStoreId;
  const stores  = req.session.convertyStores;
  if (!storeId || !stores || !stores[storeId]) {
    return res.status(401).json({ error: 'Not connected to Converty. Visit /integrations/converty/connect first.' });
  }
  next();
}

// ── Helper: make authenticated GET request ─────────────────────
async function convertyGet(req, endpoint, params = {}) {
  const token = await getValidToken(req);
  const url = `${BASE_URL}${endpoint}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return response.data;
}

// ─────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────

// GET /api/converty/store
// Returns info about the connected seller's store
router.get('/store', requireAuth, async (req, res) => {
  try {
    const data = await convertyGet(req, '/stores/me');
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────

// GET /api/converty/products
// Query params: page (default 1), limit (default 10, max 200), search
router.get('/products', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const params = { page, limit };
    if (search) params.search = search;
    const data = await convertyGet(req, '/products', params);
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/converty/products/:id
// Returns a single product by ID
router.get('/products/:id', requireAuth, async (req, res) => {
  try {
    const data = await convertyGet(req, `/products/${req.params.id}`);
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────

// GET /api/converty/orders
// Query params: page (default 1), limit (default 10, max 200)
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const data = await convertyGet(req, '/orders', { page, limit });
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/converty/orders/:id
// Returns a single order by ID
router.get('/orders/:id', requireAuth, async (req, res) => {
  try {
    const data = await convertyGet(req, `/orders/${req.params.id}`);
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────────────────────

// GET /api/converty/webhooks
// Returns all registered webhooks for this store
router.get('/webhooks', requireAuth, async (req, res) => {
  try {
    const data = await convertyGet(req, '/hooks');
    res.json(data);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Debug: inspect stored token (remove after confirming) ─────
router.get('/token-info', requireAuth, async (req, res) => {
  const storeId = req.session.activeStoreId;
  const s = req.session.convertyStores[storeId];
  res.json({
    store_id:       storeId,
    store_name:     s.name,
    token_preview:  s.access_token?.substring(0, 40) + '...',
    expires_at:     new Date(s.expires_at).toISOString(),
    expires_in_min: Math.round((s.expires_at - Date.now()) / 60000),
    test_url:       `${BASE_URL}/stores/me`,
  });
});

// ── Debug: raw probe of Converty API endpoints ─────────────────
router.get('/probe', requireAuth, async (req, res) => {
  const token = req.session.convertyStores[req.session.activeStoreId].access_token;

  const hit = async (url, headers) => {
    try {
      const r = await axios.get(url, { headers, validateStatus: () => true });
      return { status: r.status, body: typeof r.data === 'string' ? r.data.substring(0, 80) : r.data };
    } catch (e) { return { error: e.message }; }
  };

  // Test different base URLs
  const bases = [
    'https://api.converty.shop/api/v1',
    'https://api.converty.shop/api/v2',
    'https://api.converty.shop/api',
    'https://api.converty.shop/v1',
  ];
  const paths = ['/store', '/stores/me', '/products', '/orders', '/hooks'];

  const byBase = {};
  for (const base of bases) {
    byBase[base] = {};
    for (const path of paths) {
      byBase[base][path] = await hit(base + path, { Authorization: `Bearer ${token}` });
    }
  }

  // Test different auth header formats on the known-good path
  const authFormats = {
    'Bearer token':  { Authorization: `Bearer ${token}` },
    'Token token':   { Authorization: `Token ${token}` },
    'raw token':     { Authorization: token },
    'X-Auth-Token':  { 'X-Auth-Token': token },
    'no auth':       {},
  };
  const authTest = {};
  for (const [name, headers] of Object.entries(authFormats)) {
    authTest[name] = await hit('https://api.converty.shop/api/v1/store', headers);
  }

  res.json({ byBase, authTest });
});

// ─────────────────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────────────────
function handleError(res, err) {
  const status  = err.response?.status || 500;
  const body    = err.response?.data;
  const message = body?.message || err.message;
  console.error(`Converty API ${status}:`, body || err.message);
  res.status(status).json({ error: message, details: body || null, status });
}

module.exports = router;
