const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.FIRST_DELIVERY_API_URL;
const TOKEN = process.env.FIRST_DELIVERY_TOKEN;

/**
 * Filtrer les commandes — POST {{env}}/filter
 *
 * @param {Object} filters
 * @param {string}  [filters.barCode]        - Code à barre (exactement 12 chiffres si renseigné)
 * @param {string}  [filters.createdAtFrom]  - Date début création (format YYYY-MM-DD)
 * @param {string}  [filters.createdAtTo]    - Date fin création  (format YYYY-MM-DD)
 * @param {number}  [filters.state]          - État de la commande (voir détails des états)
 * @param {Object}  [filters.pagination]
 * @param {number}  [filters.pagination.pageNumber] - Numéro de page (>= 1, défaut: 1)
 * @param {number}  [filters.pagination.limit]      - Éléments par page (1-100, défaut: 10)
 *
 * Rate limit: 2 requêtes par 10 secondes
 */
async function filtrerCommandes(filters = {}) {
  const body = {
    barCode: filters.barCode ?? '',
    createdAtFrom: filters.createdAtFrom ?? '',
    createdAtTo: filters.createdAtTo ?? '',
    state: filters.state ?? 0,
    pagination: {
      pageNumber: filters.pagination?.pageNumber ?? 1,
      limit: filters.pagination?.limit ?? 10,
    },
  };

  const response = await axios.post(`${BASE_URL}/filter`, body, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}

module.exports = { filtrerCommandes };
