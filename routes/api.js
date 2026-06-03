const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getValidToken } = require('./auth');
const db = require('../db');

const BASE_URL = 'https://api.converty.shop/api/v1';

// ── Middleware: ensure connected ───────────────────────────────
async function requireAuth(req, res, next) {
  const storeId = req.session.activeStoreId;
  if (!storeId) {
    return res.status(401).json({ error: 'Not connected to Converty. Visit /integrations/converty/connect first.' });
  }
  const store = await db.getStore(storeId);
  if (!store) {
    return res.status(401).json({ error: 'Store not found — please reconnect.' });
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
// CSV EXPORT — products sales report
// ─────────────────────────────────────────────────────────────

// GET /api/converty/export/products-csv
// Fetches all orders across all pages and returns a CSV file with
// one row per (product × order), grouped by product name.
router.get('/export/products-csv', requireAuth, async (req, res) => {
  try {
    const LIMIT = 200;
    let page = 1;
    const allOrders = [];

    // Paginate through all orders
    while (true) {
      const data = await convertyGet(req, '/orders', { page, limit: LIMIT });
      const batch = data.data || data.orders || (Array.isArray(data) ? data : []);
      if (!batch.length) break;
      allOrders.push(...batch);
      if (batch.length < LIMIT) break;
      page++;
    }

    // Flatten to one row per (product × order)
    const rows = [];
    for (const order of allOrders) {
      const cart = Array.isArray(order.cart) ? order.cart : [];
      const t    = order.total || {};
      const cur  = order.currencyCode || 'TND';

      for (const item of cart) {
        rows.push({
          productName:      item.product?.name || '—',
          productPrice:     item.product?.price ?? '',
          orderRef:         order.reference || '',
          orderDate:        order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : '',
          orderStatus:      order.status || '',
          buyerName:        order.customer?.name  || '',
          buyerPhone:       order.customer?.phone || '',
          buyerCity:        order.customer?.city  || '',
          qty:              item.quantity || 1,
          unitPrice:        item.pricePerUnit ?? item.product?.price ?? '',
          deliveryCharged:  t.deliveryPrice  ?? 0,
          deliveryCost:     t.deliveryCost   ?? 0,
          orderTotal:       t.totalPrice     ?? t.basePrice ?? '',
          currency:         cur,
        });
      }
    }

    // Sort by product name so all rows for the same product are together
    rows.sort((a, b) => String(a.productName).localeCompare(String(b.productName)));

    // CSV helpers
    function csvField(val) {
      const s = String(val ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }

    const headers = [
      'Product Name', 'Product Price', 'Order #', 'Order Date', 'Order Status',
      'Buyer Name', 'Buyer Phone', 'Buyer City',
      'Qty', 'Unit Price', 'Delivery (Customer)', 'Delivery Cost (Merchant)',
      'Order Total', 'Currency',
    ];

    const lines = [
      headers.map(csvField).join(','),
      ...rows.map(r => [
        r.productName, r.productPrice, r.orderRef, r.orderDate, r.orderStatus,
        r.buyerName, r.buyerPhone, r.buyerCity,
        r.qty, r.unitPrice, r.deliveryCharged, r.deliveryCost,
        r.orderTotal, r.currency,
      ].map(csvField).join(',')),
    ];

    const csv      = lines.join('\n');
    const filename = `products-sales-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // UTF-8 BOM so Excel opens Arabic/French text correctly
    res.send('\uFEFF' + csv);

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
  const s = await db.getStore(req.session.activeStoreId);
  res.json({
    store_id:       s.id,
    store_name:     s.name,
    token_preview:  s.access_token?.substring(0, 40) + '...',
    expires_at:     new Date(Number(s.expires_at)).toISOString(),
    expires_in_min: Math.round((Number(s.expires_at) - Date.now()) / 60000),
    test_url:       `${BASE_URL}/stores/me`,
  });
});

// ── Debug: raw probe of Converty API endpoints ─────────────────
router.get('/probe', requireAuth, async (req, res) => {
  const store = await db.getStore(req.session.activeStoreId);
  const token = store.access_token;

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
