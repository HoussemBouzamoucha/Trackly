const express = require('express');
const router  = express.Router();
const { getColis }    = require('../delivery/Tictac/getColis');
const { getAllColis }  = require('../db');

// GET /api/tictac/colis — all locally mirrored colis (no API call)
router.get('/colis', async (req, res) => {
  try {
    const rows = await getAllColis();
    res.json({ data: rows, count: rows.length });
  } catch (err) { handleError(res, err); }
});

// GET /api/tictac/colis/:code_barre — fetch live from Tictac + mirror to DB
router.get('/colis/:code_barre', async (req, res) => {
  try {
    const data = await getColis(req.params.code_barre);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

function handleError(res, err) {
  const status  = err.response?.status || 500;
  const body    = err.response?.data;
  const message = body?.message || err.message;
  console.error('Tictac API error:', body || err.message);
  res.status(status).json({ error: message, details: body || null });
}

module.exports = router;
