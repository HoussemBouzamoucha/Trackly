const express = require('express');
const router  = express.Router();
const { filtrerCommandes }      = require('../delivery/First/filtrerCommandes');
const { consulterEtatCommande } = require('../delivery/First/consulterEtatCommande');

// GET /api/firstdelivery/filter
// Query params: barCode, createdAtFrom, createdAtTo, state, pageNumber, limit
router.get('/filter', async (req, res) => {
  try {
    const { barCode, createdAtFrom, createdAtTo, state, pageNumber, limit } = req.query;
    const data = await filtrerCommandes({
      barCode:       barCode       || '',
      createdAtFrom: createdAtFrom || '',
      createdAtTo:   createdAtTo   || '',
      state:         state != null ? Number(state) : undefined,
      pagination: {
        pageNumber: pageNumber ? Number(pageNumber) : 1,
        limit:      limit      ? Number(limit)      : 10,
      },
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// GET /api/firstdelivery/etat?barCode=...
router.get('/etat', async (req, res) => {
  try {
    const { barCode } = req.query;
    if (!barCode) return res.status(400).json({ error: 'barCode requis' });
    const data = await consulterEtatCommande(barCode);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

function handleError(res, err) {
  const status  = err.response?.status || 500;
  const body    = err.response?.data;
  const message = body?.message || err.message;
  console.error('First Delivery API error:', body || err.message);
  res.status(status).json({ error: message, details: body || null });
}

module.exports = router;
