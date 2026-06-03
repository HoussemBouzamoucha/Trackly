const axios = require('axios');
require('dotenv').config();

const API_VERSION = process.env.META_API_VERSION || 'v19.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

const ACCOUNTS = [
  { name: 'OJ1',     id: 'act_386398953885409' },
  { name: 'AJ1',     id: 'act_420352014017891' },
  { name: 'Velmora', id: 'act_2664733963891198' },
  { name: 'SHOPI T', id: 'act_2099928840772443' },
  { name: 'TUNSHOP', id: 'act_838301375930345' },
];

const ENDPOINTS = [
  { label: 'Account info',  path: '',           defaultFields: 'name,account_status,currency,timezone_name,amount_spent' },
  { label: 'Campaigns',     path: '/campaigns', defaultFields: 'name,status,objective,daily_budget,lifetime_budget' },
  { label: 'Ad sets',       path: '/adsets',    defaultFields: 'name,status,daily_budget,start_time,end_time' },
  { label: 'Ads',           path: '/ads',       defaultFields: 'name,status,adset_id' },
  { label: 'Insights',      path: '/insights',  defaultFields: 'impressions,clicks,spend,ctr,cpc,reach' },
  { label: 'Product Spend', path: '/insights',  defaultFields: 'spend,impressions,clicks,ctr,cpc',
    extraParams: { breakdowns: 'product_id', level: 'ad', date_preset: 'last_30d' } },
];

async function metaGet(path, params = {}) {
  const { data } = await axios.get(`${BASE_URL}${path}`, {
    params: { ...params, access_token: process.env.META_ACCESS_TOKEN },
    headers: { 'User-Agent': 'Trackly/1.0' },
  });
  return data;
}

async function getAccountInfo(accountId, fields) {
  return metaGet(`/${accountId}`, { fields: fields || ENDPOINTS[0].defaultFields });
}

async function getCampaigns(accountId, fields) {
  return metaGet(`/${accountId}/campaigns`, { fields: fields || ENDPOINTS[1].defaultFields });
}

async function getAdSets(accountId, fields) {
  return metaGet(`/${accountId}/adsets`, { fields: fields || ENDPOINTS[2].defaultFields });
}

async function getAds(accountId, fields) {
  return metaGet(`/${accountId}/ads`, { fields: fields || ENDPOINTS[3].defaultFields });
}

async function getInsights(accountId, fields, extraParams = {}) {
  return metaGet(`/${accountId}/insights`, {
    fields: fields || ENDPOINTS[4].defaultFields,
    ...extraParams,
  });
}

module.exports = { ACCOUNTS, ENDPOINTS, getAccountInfo, getCampaigns, getAdSets, getAds, getInsights };
