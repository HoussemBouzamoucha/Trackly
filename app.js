require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db');

const authRoutes          = require('./routes/auth');
const apiRoutes           = require('./routes/api');
const metaAdsRoutes       = require('./routes/metaAds');
const firstDeliveryRoutes = require('./routes/firstDelivery');
const tictacRoutes        = require('./routes/tictac');

const app = express();

// Railway (and most PaaS) sit behind a reverse proxy — required for
// secure cookies and correct IP detection to work.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   isProd,          // HTTPS-only in production (Railway), plain HTTP locally
    sameSite: 'lax',           // lets the cookie survive the OAuth redirect back
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000, // 24 hours
  },
}));

// ── Routes ──────────────────────────────────
app.use('/integrations/converty', authRoutes);
app.use('/api/converty',       apiRoutes);
app.use('/api/meta',           metaAdsRoutes);
app.use('/api/firstdelivery',  firstDeliveryRoutes);
app.use('/api/tictac',         tictacRoutes);

// ── Health check ────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
db.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`📋 Open http://localhost:${PORT} in your browser\n`);
  });
}).catch(err => {
  console.error('❌ Failed to initialise database:', err);
  process.exit(1);
});
