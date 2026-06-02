const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');
const db      = require('../db');

const BASE_URL = 'https://partner.converty.shop';
const API_BASE = 'https://api.converty.shop/api/v1';

// ── Step 1: Redirect seller to Converty login ──────────────────
router.get('/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const SCOPES = 'read-stores read-products read-orders';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.CONVERTY_CLIENT_ID,
    redirect_uri:  process.env.CONVERTY_REDIRECT_URI,
    state,
  });

  const authUrl = `${BASE_URL}/oauth2/authorize?${params.toString()}&scope=${encodeURIComponent(SCOPES)}`;

  req.session.save((err) => {
    if (err) {
      console.error('❌ Session save failed on /connect:', err);
      return res.status(500).send('Session error — please try again.');
    }
    res.redirect(authUrl);
  });
});

// ── Step 2: OAuth callback ─────────────────────────────────────
router.get('/oauth/callback', async (req, res) => {
  console.log('📥 Callback hit — query params:', JSON.stringify(req.query));

  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('❌ Converty returned error:', error, error_description);
    return res.status(400).send(popupErrorPage(`Converty denied the request: ${error} — ${error_description || ''}`));
  }

  if (!state || state !== req.session.oauthState) {
    console.error('❌ CSRF state mismatch. Got:', state, '| Expected:', req.session.oauthState);
    return res.status(400).send(popupErrorPage('Authorization failed: state mismatch. Please try connecting again.'));
  }
  delete req.session.oauthState;

  if (!code) {
    return res.status(400).send(popupErrorPage('No authorization code received from Converty.'));
  }

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post(
      `${BASE_URL}/oauth2/token`,
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     process.env.CONVERTY_CLIENT_ID,
        client_secret: process.env.CONVERTY_CLIENT_SECRET,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Fetch store identity
    let storeData;
    try {
      const storeRes = await axios.get(`${API_BASE}/stores/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      storeData = storeRes.data?.data || storeRes.data;
    } catch (storeErr) {
      console.error('❌ Could not fetch store info:', storeErr.response?.data || storeErr.message);
      return res.status(500).send(popupErrorPage('Token exchanged but store info fetch failed: ' + (storeErr.response?.data?.message || storeErr.message)));
    }

    const store = {
      id:            String(storeData._id || storeData.id),
      name:          storeData.name   || 'My Store',
      domain:        storeData.domain || '',
      access_token,
      refresh_token,
      expires_at:    Date.now() + expires_in * 1000,
    };

    // Persist to database
    await db.upsertStore(store);

    // Set as active store in session
    req.session.activeStoreId = store.id;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Session save failed:', saveErr);
        return res.status(500).send(popupErrorPage('Session save failed — please try again.'));
      }
      console.log(`✅ Store "${store.name}" (${store.id}) saved to database`);
      res.redirect('/');
    });
  } catch (err) {
    console.error('❌ Token exchange failed:', err.response?.data || err.message);
    res.status(500).send(popupErrorPage('Token exchange failed: ' + (err.response?.data?.message || err.message)));
  }
});

// ── Token refresh helper ───────────────────────────────────────
async function getValidToken(req) {
  const storeId = req.session.activeStoreId;
  if (!storeId) throw new Error('No active store selected');

  const store = await db.getStore(storeId);
  if (!store) throw new Error('Store not found — please reconnect');

  const BUFFER = 5 * 60 * 1000;
  if (Date.now() < store.expires_at - BUFFER) {
    return store.access_token;
  }

  // Refresh the token
  const response = await axios.post(
    `${BASE_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: store.refresh_token,
      client_id:     process.env.CONVERTY_CLIENT_ID,
      client_secret: process.env.CONVERTY_CLIENT_SECRET,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  const updated = { ...store, access_token, refresh_token, expires_at: Date.now() + expires_in * 1000 };

  await db.upsertStore(updated);
  console.log(`🔄 Token refreshed for store ${storeId}`);
  return access_token;
}

// ── List all connected stores ──────────────────────────────────
router.get('/stores', async (req, res) => {
  try {
    const stores = await db.getAllStores();
    const list   = stores.map(s => ({ id: s.id, name: s.name, domain: s.domain }));
    res.json({ stores: list, activeStoreId: req.session.activeStoreId || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Switch active store ────────────────────────────────────────
router.get('/stores/:id/activate', async (req, res) => {
  const { id } = req.params;
  try {
    const store = await db.getStore(id);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    req.session.activeStoreId = id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session save failed' });
      res.json({ ok: true, activeStoreId: id });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Disconnect a single store ──────────────────────────────────
router.get('/stores/:id/disconnect', async (req, res) => {
  const { id } = req.params;
  try {
    await db.deleteStore(id);

    if (req.session.activeStoreId === id) {
      const remaining = await db.getAllStores();
      req.session.activeStoreId = remaining.length > 0 ? remaining[0].id : null;
    }

    req.session.save(() => res.redirect('/'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Disconnect all ─────────────────────────────────────────────
router.get('/disconnect', async (req, res) => {
  try {
    await db.deleteAllStores();
  } catch (err) {
    console.error('Error deleting all stores:', err.message);
  }
  delete req.session.activeStoreId;
  req.session.save(() => res.redirect('/'));
});

// ── Auth status ────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const stores = await db.getAllStores();
    const list   = stores.map(s => ({ id: s.id, name: s.name, domain: s.domain }));

    // If session has no activeStoreId but stores exist, default to first
    if (!req.session.activeStoreId && list.length > 0) {
      req.session.activeStoreId = list[0].id;
    }

    res.json({
      connected:     list.length > 0,
      stores:        list,
      activeStoreId: req.session.activeStoreId || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug ──────────────────────────────────────────────────────
router.get('/debug', (req, res) => {
  const SCOPES = 'read-stores read-products read-orders';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.CONVERTY_CLIENT_ID,
    redirect_uri:  process.env.CONVERTY_REDIRECT_URI,
    state:         'DEBUG_STATE',
  });
  const authUrl = `${BASE_URL}/oauth2/authorize?${params.toString()}&scope=${encodeURIComponent(SCOPES)}`;
  res.json({
    session_id:      req.session.id,
    active_store_id: req.session.activeStoreId || null,
    oauth_url:       authUrl,
    redirect_uri:    process.env.CONVERTY_REDIRECT_URI,
    client_id:       process.env.CONVERTY_CLIENT_ID,
    node_env:        process.env.NODE_ENV,
  });
});

// ── Popup error page ───────────────────────────────────────────
function popupErrorPage(message) {
  return `<!DOCTYPE html><html><head><title>Connection error</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fff0f0;}
.box{text-align:center;padding:32px;max-width:360px;}
h2{color:#c62828;margin-bottom:12px;}p{color:#555;font-size:14px;line-height:1.6;}
button{margin-top:20px;padding:10px 24px;background:#534AB7;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;}
</style></head><body><div class="box">
<h2>Connection failed</h2>
<p>${message}</p>
<button onclick="window.close()">Close</button>
</div></body></html>`;
}

module.exports = router;
module.exports.getValidToken = getValidToken;
