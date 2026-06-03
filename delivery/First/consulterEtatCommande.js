const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.FIRST_DELIVERY_API_URL;
const TOKEN = process.env.FIRST_DELIVERY_TOKEN;

/**
 * Consulter l'état d'une commande — POST {{env}}/etat
 *
 * @param {string} barCode - Code à barre du produit (requis)
 *
 * Rate limit: 1 requête par seconde
 */
async function consulterEtatCommande(barCode) {
  if (!barCode) throw new Error('barCode est requis');

  const response = await axios.post(
    `${BASE_URL}/etat`,
    { barCode },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

module.exports = { consulterEtatCommande };
