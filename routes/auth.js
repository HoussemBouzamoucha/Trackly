const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const crypto  = require('crypto');

const BASE_URL = 'https://partner.converty.shop/en';

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

  // Must save the session (and its oauthState) BEFORE redirecting to Converty,
  // otherwise the session write races with the redirect and the CSRF check fails.
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
  const { code, state } = req.query;

  // CSRF check
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

    // Store tokens in session (use a database in production)
    req.session.converty = {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
    };

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Session save failed:', saveErr);
        return res.status(500).send(popupErrorPage('Session save failed — please try again.'));
      }
      console.log('✅ Converty OAuth success — tokens stored in session');
      res.redirect('/');
    });
  } catch (err) {
    console.error('❌ Token exchange failed:', err.response?.data || err.message);
    res.status(500).send(popupErrorPage('Token exchange failed: ' + (err.response?.data?.message || err.message)));
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

// ── Debug (remove after confirming OAuth works) ────────────────
// GET /integrations/converty/debug
router.get('/debug', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.CONVERTY_CLIENT_ID,
    redirect_uri:  process.env.CONVERTY_REDIRECT_URI,
    scope:         'read-stores read-products read-orders create-orders update-orders read-hooks create-hooks delete-hooks',
    state:         'DEBUG_STATE',
  });
  const authUrl = `${BASE_URL}/oauth2/authorize?${params.toString()}`;
  res.json({
    session_id:       req.session.id,
    session_has_data: !!req.session.converty,
    oauth_state:      req.session.oauthState || null,
    oauth_url:        authUrl,
    redirect_uri:     process.env.CONVERTY_REDIRECT_URI,
    client_id:        process.env.CONVERTY_CLIENT_ID,
    node_env:         process.env.NODE_ENV,
  });
});

// ── Disconnect ─────────────────────────────────────────────────
// GET /integrations/converty/disconnect
router.get('/disconnect', (req, res) => {
  delete req.session.converty;
  req.session.save(() => res.redirect('/'));
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
