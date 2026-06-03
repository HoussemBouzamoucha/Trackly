const axios = require('axios');
require('dotenv').config();
const { upsertColis } = require('../../db');

const API_URL  = process.env.TICTAC_API_URL;
const CODE_API = process.env.TICTAC_CODE_API;
const CLE_API  = process.env.TICTAC_CLE_API;

/**
 * Create — POST https://tic-tac-delivery.com/api/  (action=add)
 * Creates a colis in Tictac and saves a copy in the local DB.
 *
 * @param {Object} colis
 * @param {string} colis.tel_cl        - Téléphone client (requis)
 * @param {string} colis.nom_prenom_cl - Nom et prénom client (requis)
 * @param {string} colis.ville_cl      - Ville (requis)
 * @param {string} colis.delegation_cl - Délégation (requis)
 * @param {string|number} colis.cod    - Montant COD (requis)
 * @param {string} colis.libelle       - Libellé du colis (requis)
 * @param {string|number} colis.nb_piece - Nombre de pièces (requis)
 * @param {string} colis.adresse_cl    - Adresse client (requis)
 * @param {string} [colis.remarque]    - Remarque
 * @param {string} [colis.tel_2_cl]    - Téléphone 2
 * @param {string|number} [colis.service] - Service
 * @returns {Object} API response data (includes code_barre assigned by Tictac)
 */
async function createColis(colis) {
  const body = new URLSearchParams({
    action:        'add',
    code_api:      CODE_API,
    cle_api:       CLE_API,
    tel_cl:        colis.tel_cl        ?? '',
    nom_prenom_cl: colis.nom_prenom_cl ?? '',
    ville_cl:      colis.ville_cl      ?? '',
    delegation_cl: colis.delegation_cl ?? '',
    cod:           colis.cod           ?? '',
    libelle:       colis.libelle       ?? '',
    nb_piece:      colis.nb_piece      ?? '',
    adresse_cl:    colis.adresse_cl    ?? '',
    remarque:      colis.remarque      ?? '',
    tel_2_cl:      colis.tel_2_cl      ?? '',
    service:       colis.service       ?? '',
  });

  const { data } = await axios.post(API_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Mirror in local DB — use barcode returned by Tictac if available
  const code_barre = data.code_barre ?? data.barcode ?? null;
  if (code_barre) {
    await upsertColis({
      code_barre,
      libelle:       colis.libelle       ?? null,
      tel_cl:        colis.tel_cl        ?? null,
      nom_prenom_cl: colis.nom_prenom_cl ?? null,
      ville_cl:      colis.ville_cl      ?? null,
      delegation_cl: colis.delegation_cl ?? null,
      adresse_cl:    colis.adresse_cl    ?? null,
      tel_2_cl:      colis.tel_2_cl      ?? null,
      cod:           String(colis.cod)   ?? null,
      nb_piece:      String(colis.nb_piece) ?? null,
      remarque:      colis.remarque      ?? null,
      service:       String(colis.service ?? ''),
      raw_response:  data,
    });
  }

  return data;
}

module.exports = { createColis };
