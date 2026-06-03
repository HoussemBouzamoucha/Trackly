const express = require('express');
const router  = express.Router();
const { ACCOUNTS, ENDPOINTS, getAccountInfo, getCampaigns, getAdSets, getAds, getInsights } = require('../Meta_ads/metaAds');

// GET /api/meta/accounts
router.get('/accounts', (req, res) => {
  res.json({ accounts: ACCOUNTS, endpoints: ENDPOINTS });
});

// GET /api/meta/:accountId  — account info
router.get('/:accountId', async (req, res) => {
  try {
    const data = await getAccountInfo(req.params.accountId, req.query.fields);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// GET /api/meta/:accountId/campaigns
router.get('/:accountId/campaigns', async (req, res) => {
  try {
    const data = await getCampaigns(req.params.accountId, req.query.fields);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// GET /api/meta/:accountId/adsets
router.get('/:accountId/adsets', async (req, res) => {
  try {
    const data = await getAdSets(req.params.accountId, req.query.fields);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// GET /api/meta/:accountId/ads
router.get('/:accountId/ads', async (req, res) => {
  try {
    const data = await getAds(req.params.accountId, req.query.fields);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// GET /api/meta/:accountId/insights
router.get('/:accountId/insights', async (req, res) => {
  try {
    const { fields, ...extra } = req.query;
    const data = await getInsights(req.params.accountId, fields, extra);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

function handleError(res, err) {
  const status  = err.response?.status || 500;
  const body    = err.response?.data;
  const message = body?.error?.message || err.message;
  console.error('Meta API error:', body || err.message);
  res.status(status).json({ error: message, details: body || null });
}

module.exports = router;
