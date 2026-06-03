const axios = require('axios');
require('dotenv').config();
const { upsertColis } = require('../../db');

const API_URL  = process.env.TICTAC_API_URL;
const CODE_API = process.env.TICTAC_CODE_API;
const CLE_API  = process.env.TICTAC_CLE_API;

/**
 * Get — POST https://tic-tac-delivery.com/api/  (action=get)
 * Fetches a colis by barcode from Tictac and mirrors it in the local DB.
 *
 * @param {string} code_barre - Code barre du colis (requis)
 * @returns {Object} API response data
 */
async function getColis(code_barre) {
  if (!code_barre) throw new Error('code_barre est requis');

  const body = new URLSearchParams({
    action:     'get',
    code_api:   CODE_API,
    cle_api:    CLE_API,
    code_barre,
  });

  const { data } = await axios.post(API_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Mirror in local DB
  await upsertColis({
    code_barre,
    libelle:       data.libelle       ?? null,
    tel_cl:        data.tel_cl        ?? null,
    nom_prenom_cl: data.nom_prenom_cl ?? null,
    ville_cl:      data.ville_cl      ?? null,
    delegation_cl: data.delegation_cl ?? null,
    adresse_cl:    data.adresse_cl    ?? null,
    tel_2_cl:      data.tel_2_cl      ?? null,
    cod:           data.cod           ?? null,
    nb_piece:      data.nb_piece      ?? null,
    remarque:      data.remarque      ?? null,
    service:       data.service       ?? null,
    raw_response:  data,
  });

  return data;
}

module.exports = { getColis };
