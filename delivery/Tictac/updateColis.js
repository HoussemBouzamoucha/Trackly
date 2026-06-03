const axios = require('axios');
require('dotenv').config();
const { upsertColis } = require('../../db');

const API_URL  = process.env.TICTAC_API_URL;
const CODE_API = process.env.TICTAC_CODE_API;
const CLE_API  = process.env.TICTAC_CLE_API;

/**
 * Update — POST https://tic-tac-delivery.com/api/  (action=update)
 * Updates a colis in Tictac and syncs the change in the local DB.
 *
 * @param {string} code_barre - Code barre du colis à modifier (requis)
 * @param {Object} fields     - Champs à mettre à jour (mêmes que create)
 * @returns {Object} API response data
 */
async function updateColis(code_barre, fields = {}) {
  if (!code_barre) throw new Error('code_barre est requis');

  const body = new URLSearchParams({
    action:        'update',
    code_api:      CODE_API,
    cle_api:       CLE_API,
    code_barre,
    tel_cl:        fields.tel_cl        ?? '',
    nom_prenom_cl: fields.nom_prenom_cl ?? '',
    ville_cl:      fields.ville_cl      ?? '',
    delegation_cl: fields.delegation_cl ?? '',
    cod:           fields.cod           ?? '',
    libelle:       fields.libelle       ?? '',
    nb_piece:      fields.nb_piece      ?? '',
    adresse_cl:    fields.adresse_cl    ?? '',
    remarque:      fields.remarque      ?? '',
    tel_2_cl:      fields.tel_2_cl      ?? '',
    service:       fields.service       ?? '',
  });

  const { data } = await axios.post(API_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Mirror in local DB
  await upsertColis({
    code_barre,
    libelle:       fields.libelle       ?? null,
    tel_cl:        fields.tel_cl        ?? null,
    nom_prenom_cl: fields.nom_prenom_cl ?? null,
    ville_cl:      fields.ville_cl      ?? null,
    delegation_cl: fields.delegation_cl ?? null,
    adresse_cl:    fields.adresse_cl    ?? null,
    tel_2_cl:      fields.tel_2_cl      ?? null,
    cod:           String(fields.cod ?? ''),
    nb_piece:      String(fields.nb_piece ?? ''),
    remarque:      fields.remarque      ?? null,
    service:       String(fields.service ?? ''),
    raw_response:  data,
  });

  return data;
}

module.exports = { updateColis };
