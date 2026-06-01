const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getValidToken } = require('./auth');

const BASE_URL = 'https://partner.converty.shop/api/v1';

// ── Middleware: ensure connected ───────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.converty) {
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

// ─────────────────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────────────────
function handleError(res, err) {
  console.error('Converty API error:', err.response?.data || err.message);
  const status = err.response?.status || 500;
  res.status(status).json({
    error: err.response?.data?.message || err.message,
    details: err.response?.data || null,
  });
}

module.exports = router;
