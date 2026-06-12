const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');
const { getValidToken } = require('./auth');
const { getInsights, ACCOUNTS } = require('../Meta_ads/metaAds');
const { filtrerCommandes } = require('../delivery/First/filtrerCommandes');

// Helper function to calculate date ranges
function getDateRange(period) {
  const endDate = new Date();
  let startDate = new Date();

  // Set end of day for accurate bounds
  endDate.setHours(23, 59, 59, 999);

  switch (period) {
    case 'daily':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      startDate.setDate(endDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      startDate.setMonth(endDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      startDate.setFullYear(endDate.getFullYear() - 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      startDate.setMonth(endDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
  }
  return { startDate, endDate };
}

// ── Products ─────────────────────────────────────────────────────

// Add a product
router.post('/products', async (req, res) => {
  try {
    const { product_name, quantity, price, delivery_company, sale_date } = req.body;
    
    if (!product_name || !quantity || !price) {
      return res.status(400).json({ error: 'product_name, quantity, and price are required' });
    }

    const product = await db.addProduct(product_name, quantity, price, delivery_company, sale_date || new Date());
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get all products
router.get('/products', async (req, res) => {
  try {
    const products = await db.getAllProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get products by period
router.get('/products/:period', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRange(req.params.period);
    const products = await db.getProductsByDateRange(startDate, endDate);
    
    const totalRevenue = products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0);

    res.json({ products, totalRevenue, totalQuantity, period: req.params.period });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete product
router.delete('/products/:id', async (req, res) => {
  try {
    await db.deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Expenses ─────────────────────────────────────────────────────

// Add an expense
router.post('/expenses', async (req, res) => {
  try {
    const { amount, category, description, expense_date, field1, field2, field3, field4, field5 } = req.body;
    
    if (!amount) {
      return res.status(400).json({ error: 'amount is required' });
    }

    const expense = await db.addExpense(
      amount, category, description, expense_date || new Date(),
      field1, field2, field3, field4, field5
    );
    res.json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get all expenses
router.get('/expenses', async (req, res) => {
  try {
    const expenses = await db.getAllExpenses();
    res.json(expenses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get expenses by period
router.get('/expenses/:period', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRange(req.params.period);
    const expenses = await db.getExpensesByDateRange(startDate, endDate);
    
    const totalExpenses = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

    res.json({ expenses, totalExpenses, period: req.params.period });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete expense
router.delete('/expenses/:id', async (req, res) => {
  try {
    await db.deleteExpense(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Meta Ads ─────────────────────────────────────────────────────

// Add meta ads spending
router.post('/meta-ads', async (req, res) => {
  try {
    const { campaign_name, amount_spent, impressions, clicks, conversions, date } = req.body;
    
    if (!campaign_name || !amount_spent) {
      return res.status(400).json({ error: 'campaign_name and amount_spent are required' });
    }

    const spending = await db.addMetaSpending(
      campaign_name, amount_spent, impressions, clicks, conversions, date || new Date()
    );
    res.json(spending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get all meta ads spending
router.get('/meta-ads', async (req, res) => {
  try {
    const spending = await db.getAllMetaSpending();
    res.json(spending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get meta ads spending by period
router.get('/meta-ads/:period', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRange(req.params.period);
    const spending = await db.getMetaSpendingByDateRange(startDate, endDate);
    
    const totalSpent = spending.reduce((sum, s) => sum + parseFloat(s.amount_spent), 0);
    const totalImpressions = spending.reduce((sum, s) => sum + (s.impressions || 0), 0);
    const totalClicks = spending.reduce((sum, s) => sum + (s.clicks || 0), 0);
    const totalConversions = spending.reduce((sum, s) => sum + (s.conversions || 0), 0);

    res.json({
      spending,
      totalSpent,
      totalImpressions,
      totalClicks,
      totalConversions,
      period: req.params.period,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete meta ads spending
router.delete('/meta-ads/:id', async (req, res) => {
  try {
    await db.deleteMetaSpending(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard Summary ────────────────────────────────────────────

// Get complete dashboard data
router.get('/summary/:period', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRange(req.params.period);
    const startDateStr = startDate.toISOString().substring(0, 10);
    const endDateStr = endDate.toISOString().substring(0, 10);

    let productsList = [];
    let metaAdsList = [];

    let totalOrdersCount = 0;
    let confirmedOrdersCount = 0;
    let deliveredOrdersCount = 0;
    let returnedOrdersCount = 0;

    let deliveredRevenue = 0;
    let productCost = 0;
    let shippingCost = 0;

    // ── 1. Fetch Converty Products Sold (Orders) ──
    const storeId = req.session?.activeStoreId;
    let fetchedFromConverty = false;

    if (storeId) {
      try {
        const token = await getValidToken(req);
        // Fetch orders
        const response = await axios.get('https://api.converty.shop/api/v1/orders', {
          headers: { Authorization: `Bearer ${token}` },
          params: { limit: 100 }
        });
        const orders = response.data?.data || response.data?.orders || [];
        
        // Filter orders in the date range
        const periodOrders = orders.filter(o => {
          if (o.isTest) return false;
          const orderDate = new Date(o.createdAt);
          return orderDate >= startDate && orderDate <= endDate;
        });

        totalOrdersCount = periodOrders.length;

        // ── 2. Cross-reference with Delivery Companies ──
        // Fetch First Delivery commands in this range
        let firstDeliveryOrders = [];
        try {
          const fdRes = await filtrerCommandes({
            createdAtFrom: startDateStr,
            createdAtTo: endDateStr,
            pagination: { limit: 100 }
          });
          firstDeliveryOrders = fdRes?.result || fdRes?.data || [];
        } catch (err) {
          console.log('First Delivery fetch skipped or failed:', err.message);
        }

        // Fetch local Tictac mirrored colis
        let tictacColis = [];
        try {
          tictacColis = await db.getAllColis();
        } catch (err) {
          console.log('Tictac database query skipped or failed:', err.message);
        }

        // Map order items to products list and calculate order aggregates
        for (const o of periodOrders) {
          const orderStatus = (o.status || '').toLowerCase();
          
          // COD status classifications
          const isConfirmed = !['pending', 'unconfirmed', 'cancelled', 'new', 'draft'].includes(orderStatus);
          const isDelivered = ['delivered', 'completed', 'success', 'livré'].includes(orderStatus);
          const isReturned = ['returned', 'refused', 'failed-delivery', 'retour', 'retourné'].includes(orderStatus);

          if (isConfirmed) confirmedOrdersCount++;
          if (isDelivered) {
            deliveredOrdersCount++;
            
            // Sum delivered revenue
            const orderTotal = parseFloat(o.total?.totalPrice || o.total?.basePrice || 0);
            deliveredRevenue += orderTotal;

            // Sum shipping fees paid
            const orderShipping = parseFloat(o.total?.deliveryCost || o.total?.deliveryPrice || 7.00);
            shippingCost += orderShipping;

            // Sum product costs
            const cart = Array.isArray(o.cart) ? o.cart : [];
            for (const item of cart) {
              const unitPrice = parseFloat(item.pricePerUnit ?? item.product?.price ?? 0);
              const cost = parseFloat(item.product?.cost || item.cost || (unitPrice * 0.3) || 0);
              const qty = item.quantity || 1;
              productCost += cost * qty;
            }
          }
          if (isReturned) returnedOrdersCount++;

          // Determine delivery company
          let deliveryCompany = 'Converty (Standard)';
          const customerPhone = o.customer?.phone;
          const customerName = o.customer?.name;

          // Try matching First Delivery
          const matchedFd = firstDeliveryOrders.find(fd => {
            const fdPhone = fd.Client?.telephone || fd.client?.telephone || '';
            const fdName = fd.Client?.name || fd.client?.nom || '';
            return (customerPhone && fdPhone && customerPhone.includes(fdPhone)) || 
                   (customerName && fdName && customerName.toLowerCase() === fdName.toLowerCase());
          });

          // Try matching Tictac
          const matchedTt = tictacColis.find(tt => {
            return (customerPhone && tt.tel_cl && customerPhone.includes(tt.tel_cl)) || 
                   (customerName && tt.nom_prenom_cl && customerName.toLowerCase() === tt.nom_prenom_cl.toLowerCase());
          });

          if (matchedFd) {
            deliveryCompany = 'First Delivery';
          } else if (matchedTt) {
            deliveryCompany = 'Tictac';
          }

          const cart = Array.isArray(o.cart) ? o.cart : [];
          for (const item of cart) {
            productsList.push({
              id: o.id || o.reference,
              product_name: item.product?.name || 'Unknown Product',
              quantity: item.quantity || 1,
              price: parseFloat(item.pricePerUnit ?? item.product?.price ?? 0),
              status: o.status || '—',
              delivery_company: deliveryCompany,
              sale_date: o.createdAt
            });
          }
        }
        fetchedFromConverty = true;
      } catch (err) {
        console.error('Error fetching live Converty orders:', err.message);
      }
    }

    // Fallback to local DB products if Converty was not fetched/connected
    if (!fetchedFromConverty || productsList.length === 0) {
      const localProducts = await db.getProductsByDateRange(startDate, endDate);
      for (const p of localProducts) {
        const orderTotal = p.quantity * p.price;
        deliveredRevenue += orderTotal;
        shippingCost += 7.00;
        productCost += (p.price * 0.3) * p.quantity;
        
        confirmedOrdersCount += 1;
        deliveredOrdersCount += 1;
        totalOrdersCount += 1;

        productsList.push({
          id: p.id,
          product_name: p.product_name,
          quantity: p.quantity,
          price: parseFloat(p.price),
          status: 'delivered',
          delivery_company: p.delivery_company || '—',
          sale_date: p.sale_date
        });
      }
    }

    // ── 3. Fetch Meta Ads Spend ──
    let fetchedFromMeta = false;
    const timeRange = JSON.stringify({ since: startDateStr, until: endDateStr });
    
    const isMetaTokenSet = process.env.META_ACCESS_TOKEN && process.env.META_ACCESS_TOKEN !== 'your_meta_access_token_here';
    if (isMetaTokenSet) {
      try {
        for (const acc of ACCOUNTS) {
          try {
            const res = await getInsights(acc.id, 'campaign_name,spend,impressions,clicks,conversions', { time_range: timeRange });
            const data = res.data || [];
            for (const item of data) {
              metaAdsList.push({
                id: item.campaign_id || Math.random().toString(36).substring(7),
                campaign_name: item.campaign_name || 'Unnamed Campaign',
                amount_spent: parseFloat(item.spend || 0),
                impressions: parseInt(item.impressions || 0),
                clicks: parseInt(item.clicks || 0),
                conversions: parseInt(item.conversions || 0),
                date: item.date_start || startDateStr
              });
            }
          } catch (accErr) {
            console.error(`Meta Ads fetch failed for account ${acc.name}:`, accErr.message);
          }
        }
        fetchedFromMeta = true;
      } catch (err) {
        console.error('Error fetching live Meta Ads:', err.message);
      }
    }

    if (!fetchedFromMeta || metaAdsList.length === 0) {
      const localAds = await db.getMetaSpendingByDateRange(startDate, endDate);
      metaAdsList = localAds.map(ad => ({
        id: ad.id,
        campaign_name: ad.campaign_name,
        amount_spent: parseFloat(ad.amount_spent),
        impressions: ad.impressions,
        clicks: ad.clicks,
        conversions: ad.conversions,
        date: ad.date
      }));
    }

    // ── 4. Calculate Final KPIs ──
    const totalAdsSpend = metaAdsList.reduce((sum, s) => sum + parseFloat(s.amount_spent), 0);
    
    const costPerOrder = totalOrdersCount > 0 ? (totalAdsSpend / totalOrdersCount) : 0;
    const confirmationRate = totalOrdersCount > 0 ? (confirmedOrdersCount / totalOrdersCount) * 100 : 0;
    const deliveryRate = confirmedOrdersCount > 0 ? (deliveredOrdersCount / confirmedOrdersCount) * 100 : 0;
    const returnRate = confirmedOrdersCount > 0 ? (returnedOrdersCount / confirmedOrdersCount) * 100 : 0;
    
    const deliveredRoas = totalAdsSpend > 0 ? (deliveredRevenue / totalAdsSpend) : 0;
    const netProfit = deliveredRevenue - productCost - shippingCost - totalAdsSpend;
    const profitRoas = totalAdsSpend > 0 ? (netProfit / totalAdsSpend) : 0;

    res.json({
      period: req.params.period,
      totalAdsSpend: parseFloat(totalAdsSpend.toFixed(2)),
      totalOrdersCount,
      confirmedOrdersCount,
      deliveredOrdersCount,
      returnedOrdersCount,
      
      costPerOrder: parseFloat(costPerOrder.toFixed(2)),
      confirmationRate: parseFloat(confirmationRate.toFixed(2)),
      deliveryRate: parseFloat(deliveryRate.toFixed(2)),
      returnRate: parseFloat(returnRate.toFixed(2)),
      
      deliveredRevenue: parseFloat(deliveredRevenue.toFixed(2)),
      productCost: parseFloat(productCost.toFixed(2)),
      shippingCost: parseFloat(shippingCost.toFixed(2)),
      
      deliveredRoas: parseFloat(deliveredRoas.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      profitRoas: parseFloat(profitRoas.toFixed(2)),
      
      products: productsList,
      metaSpending: metaAdsList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
