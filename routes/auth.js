const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');

const BASE_URL = 'https://converty.shop/en';

// ── Step 1: Redirect seller to Converty login ──────────────────
// GET /integrations/converty/connect
router.get('/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.CONVERTY_CLIENT_ID,
    redirect_uri:  process.env.CONVERTY_REDIRECT_URI,
    scope:         'read-stores read-products read-orders create-orders update-orders read-hooks create-hooks delete-hooks',
    state,
  });

  const authUrl = `${BASE_URL}/oauth2/authorize?${params.toString()}`;
  res.redirect(authUrl);
});

// ── Step 2: Converty redirects back here with a code ──────────
// GET /integrations/converty/oauth/callback
router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;

  // CSRF check
  if (!state || state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid state parameter — possible CSRF attack' });
  }
  delete req.session.oauthState;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code received' });
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

    // Store tokens in session (use a database in production)
    req.session.converty = {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
    };

    console.log('✅ Converty OAuth success — tokens stored in session');
    res.redirect('/');
  } catch (err) {
    console.error('❌ Token exchange failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Token exchange failed', details: err.response?.data });
  }
});

// ── Token refresh helper (called automatically by API routes) ──
async function getValidToken(req) {
  const session = req.session.converty;
  if (!session) throw new Error('Not connected to Converty');

  const BUFFER = 5 * 60 * 1000; // 5 minutes
  if (Date.now() < session.expires_at - BUFFER) {
    return session.access_token;
  }

  // Refresh the token
  const response = await axios.post(
    `${BASE_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: session.refresh_token,
      client_id:     process.env.CONVERTY_CLIENT_ID,
      client_secret: process.env.CONVERTY_CLIENT_SECRET,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  req.session.converty = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000,
  };

  console.log('🔄 Token refreshed successfully');
  return access_token;
}

// ── Disconnect ─────────────────────────────────────────────────
// GET /integrations/converty/disconnect
router.get('/disconnect', (req, res) => {
  delete req.session.converty;
  res.redirect('/');
});

// ── Auth status ────────────────────────────────────────────────
// GET /integrations/converty/status
router.get('/status', (req, res) => {
  const connected = !!req.session.converty;
  res.json({
    connected,
    expires_at: req.session.converty?.expires_at || null,
  });
});

module.exports = router;
module.exports.getValidToken = getValidToken;
