require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes  = require('./routes/api');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set to true in production with HTTPS
}));

// ── Routes ──────────────────────────────────
app.use('/integrations/converty', authRoutes);
app.use('/api/converty', apiRoutes);

// ── Health check ────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📋 Open http://localhost:${PORT} in your browser\n`);
});
