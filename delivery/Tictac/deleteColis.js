const axios = require('axios');
require('dotenv').config();
const { deleteColis: deleteColisFromDb } = require('../../db');

const API_URL  = process.env.TICTAC_API_URL;
const CODE_API = process.env.TICTAC_CODE_API;
const CLE_API  = process.env.TICTAC_CLE_API;

/**
 * Delete — POST https://tic-tac-delivery.com/api/  (action=delete)
 * Deletes a colis from Tictac and removes it from the local DB.
 *
 * @param {string} code_barre - Code barre du colis à supprimer (requis)
 * @returns {Object} API response data
 */
async function deleteColis(code_barre) {
  if (!code_barre) throw new Error('code_barre est requis');

  const body = new URLSearchParams({
    action:    'delete',
    code_api:  CODE_API,
    cle_api:   CLE_API,
    code_barre,
  });

  const { data } = await axios.post(API_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Remove from local DB
  await deleteColisFromDb(code_barre);

  return data;
}

module.exports = { deleteColis };
