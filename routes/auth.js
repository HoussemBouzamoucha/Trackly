const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');

const BASE_URL = 'https://partner.converty.shop';
const API_BASE = 'https://api.converty.shop/api/v1';

// ── Step 1: Redirect seller to Converty login ──────────────────
// GET /integrations/converty/connect
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

// ── Step 2: Converty redirects back here with a code ──────────
// GET /integrations/converty/oauth/callback
router.get('/oauth/callback', async (req, res) => {
  console.log('📥 Callback hit — query params:', JSON.stringify(req.query));
  console.log('📦 Session state:', req.session.oauthState, '| Session ID:', req.session.id);

  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('❌ Converty returned error:', error, error_description);
    return res.status(400).send(popupErrorPage(`Converty denied the request: ${error} — ${error_description || ''}`));
  }

  if (!state || state !== req.session.oauthState) {
    console.error('❌ CSRF state mismatch. Got:', state, '| Expected:', req.session.oauthState);
    return res.status(400).send(popupErrorPage('Authorization failed: state mismatch. Please close this window and try connecting again.'));
  }
  delete req.session.oauthState;

  if (!code) {
    return res.status(400).send(popupErrorPage('No authorization code received from Converty.'));
  }

  try {
    // Step 3: Exchange code for tokens
    const response = await axios.post(
      `${BASE_URL}/oauth2/token`,
      new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     process.env.CONVERTY_CLIENT_ID,
        client_secret: process.env.CONVERTY_CLIENT_SECRET,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    // Step 4: Fetch store identity with the new token
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

    const storeId     = String(storeData._id || storeData.id);
    const storeName   = storeData.name   || 'My Store';
    const storeDomain = storeData.domain || '';

    // Save to multi-store map
    if (!req.session.convertyStores) req.session.convertyStores = {};

    req.session.convertyStores[storeId] = {
      id:            storeId,
      name:          storeName,
      domain:        storeDomain,
      access_token,
      refresh_token,
      expires_at:    Date.now() + expires_in * 1000,
    };
    req.session.activeStoreId = storeId;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Session save failed:', saveErr);
        return res.status(500).send(popupErrorPage('Session save failed — please try again.'));
      }
      console.log(`✅ Converty OAuth success — store "${storeName}" (${storeId}) saved`);
      res.redirect('/');
    });
  } catch (err) {
    console.error('❌ Token exchange failed:', err.response?.data || err.message);
    res.status(500).send(popupErrorPage('Token exchange failed: ' + (err.response?.data?.message || err.message)));
  }
});

// ── Token refresh helper (called automatically by API routes) ──
async function getValidToken(req) {
  const storeId = req.session.activeStoreId;
  if (!storeId) throw new Error('No active store selected');

  const stores = req.session.convertyStores;
  if (!stores || !stores[storeId]) throw new Error('Not connected to Converty');

  const store  = stores[storeId];
  const BUFFER = 5 * 60 * 1000; // 5 minutes

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
  req.session.convertyStores[storeId] = {
    ...store,
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000,
  };

  console.log(`🔄 Token refreshed for store ${storeId}`);
  return access_token;
}

// ── List all connected stores ──────────────────────────────────
// GET /integrations/converty/stores
router.get('/stores', (req, res) => {
  const stores = req.session.convertyStores || {};
  const list   = Object.values(stores).map(s => ({
    id:     s.id,
    name:   s.name,
    domain: s.domain,
  }));
  res.json({ stores: list, activeStoreId: req.session.activeStoreId || null });
});

// ── Switch active store ────────────────────────────────────────
// GET /integrations/converty/stores/:id/activate
router.get('/stores/:id/activate', (req, res) => {
  const { id }  = req.params;
  const stores  = req.session.convertyStores || {};

  if (!stores[id]) {
    return res.status(404).json({ error: 'Store not found in session' });
  }

  req.session.activeStoreId = id;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session save failed' });
    res.json({ ok: true, activeStoreId: id });
  });
});

// ── Disconnect a single store ──────────────────────────────────
// GET /integrations/converty/stores/:id/disconnect
router.get('/stores/:id/disconnect', (req, res) => {
  const { id } = req.params;
  const stores  = req.session.convertyStores || {};

  delete stores[id];
  req.session.convertyStores = stores;

  // Switch active to another store, or clear
  if (req.session.activeStoreId === id) {
    const remaining = Object.keys(stores);
    req.session.activeStoreId = remaining.length > 0 ? remaining[0] : null;
  }

  req.session.save(() => res.redirect('/'));
});

// ── Disconnect all stores ──────────────────────────────────────
// GET /integrations/converty/disconnect
router.get('/disconnect', (req, res) => {
  delete req.session.convertyStores;
  delete req.session.activeStoreId;
  req.session.save(() => res.redirect('/'));
});

// ── Auth status ────────────────────────────────────────────────
// GET /integrations/converty/status
router.get('/status', (req, res) => {
  const stores = req.session.convertyStores || {};
  const list   = Object.values(stores).map(s => ({
    id:     s.id,
    name:   s.name,
    domain: s.domain,
  }));
  res.json({
    connected:     list.length > 0,
    stores:        list,
    activeStoreId: req.session.activeStoreId || null,
  });
});

// ── Debug ──────────────────────────────────────────────────────
// GET /integrations/converty/debug
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
    session_id:       req.session.id,
    session_has_data: !!(req.session.convertyStores && Object.keys(req.session.convertyStores).length > 0),
    active_store_id:  req.session.activeStoreId || null,
    oauth_state:      req.session.oauthState || null,
    oauth_url:        authUrl,
    redirect_uri:     process.env.CONVERTY_REDIRECT_URI,
    client_id:        process.env.CONVERTY_CLIENT_ID,
    node_env:         process.env.NODE_ENV,
  });
});

// ── Popup error page helper ────────────────────────────────────
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
