const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY_NEW;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET_NEW;
const APP_URL = process.env.APP_URL || 'https://tryon-app-production-867f.up.railway.app';

const PLANS = {
  basic:   { name: 'TryStyleAI Basic',    price: 30.00,  calls: 80,  trialDays: 7 },
  pro:     { name: 'TryStyleAI Pro',      price: 85.00,  calls: 250, trialDays: 7 },
  premium: { name: 'TryStyleAI Business', price: 275.00, calls: 840, trialDays: 7 }
};

async function getShop(shop) {
  const r = await db.query('SELECT * FROM shops WHERE shop_domain = $1', [shop]);
  return r.rows[0] || null;
}

// Crea abbonamento
router.get('/subscribe', async (req, res) => {
  const { shop, plan } = req.query;
  if (!shop || !PLANS[plan]) return res.status(400).json({ error: 'Parametri non validi' });

  const shopData = await getShop(shop);
  if (!shopData) return res.status(404).json({ error: 'Shop non trovato' });

  const p = PLANS[plan];
  const returnUrl = `${APP_URL}/api/billing/confirm?shop=${shop}&plan=${plan}`;

  const mutation = `
    mutation {
      appSubscriptionCreate(
        name: "${p.name}"
        returnUrl: "${returnUrl}"
        trialDays: ${p.trialDays}
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: ${p.price}, currencyCode: EUR }
              interval: EVERY_30_DAYS
            }
          }
        }]
      ) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }
  `;

  try {
    const response = await axios.post(
      `https://${shop}/admin/api/2024-01/graphql.json`,
      { query: mutation },
      { headers: { 'X-Shopify-Access-Token': shopData.access_token, 'Content-Type': 'application/json' } }
    );
    const data = response.data.data?.appSubscriptionCreate;
    if (data?.userErrors?.length) return res.status(400).json({ error: data.userErrors[0].message });

    await db.query('UPDATE shops SET ls_subscription_id = $1 WHERE shop_domain = $2',
      [data.appSubscription.id, shop]);

    res.redirect(data.confirmationUrl);
  } catch (err) {
    console.error('Subscribe error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Errore creazione abbonamento' });
  }
});

// Conferma dopo pagamento
router.get('/confirm', async (req, res) => {
  const { shop, plan } = req.query;
  const shopData = await getShop(shop);
  if (!shopData || !PLANS[plan]) return res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);

  try {
    const subId = shopData.ls_subscription_id;
    const query = `{ node(id: "${subId}") { ... on AppSubscription { id status currentPeriodEnd } } }`;
    const response = await axios.post(
      `https://${shop}/admin/api/2024-01/graphql.json`,
      { query },
      { headers: { 'X-Shopify-Access-Token': shopData.access_token, 'Content-Type': 'application/json' } }
    );
    const sub = response.data.data?.node;
    if (sub?.status === 'ACTIVE') {
      const nextPayment = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date(Date.now() + 30 * 86400000);
      await db.query(`
        UPDATE shops SET plan=$1, status='active', fashn_calls_limit=$2, fashn_calls_used=0, next_payment_date=$3
        WHERE shop_domain=$4
      `, [plan, PLANS[plan].calls, nextPayment, shop]);
    }
  } catch (err) {
    console.error('Confirm error:', err.message);
  }
  res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
});

// Info piano corrente
router.get('/current', async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Shop mancante' });
  const shopData = await getShop(shop);
  if (!shopData) return res.status(404).json({ error: 'Shop non trovato' });

  const p = PLANS[shopData.plan] || null;
  res.json({
    shop: shopData.shop_domain,
    plan: shopData.plan,
    planName: p?.name || 'Nessun piano',
    status: shopData.status,
    callsUsed: shopData.fashn_calls_used,
    callsLimit: shopData.fashn_calls_limit,
    nextPayment: shopData.next_payment_date,
    plans: Object.entries(PLANS).map(([key, pl]) => ({
      key, name: pl.name, price: pl.price, calls: pl.calls, trialDays: pl.trialDays
    }))
  });
});

// Cancella abbonamento
router.post('/cancel', async (req, res) => {
  const { shop } = req.body;
  const shopData = await getShop(shop);
  if (!shopData?.ls_subscription_id) return res.status(400).json({ error: 'Nessun abbonamento attivo' });

  const mutation = `
    mutation { appSubscriptionCancel(id: "${shopData.ls_subscription_id}") {
      appSubscription { id status } userErrors { field message }
    }}
  `;
  try {
    await axios.post(
      `https://${shop}/admin/api/2024-01/graphql.json`,
      { query: mutation },
      { headers: { 'X-Shopify-Access-Token': shopData.access_token, 'Content-Type': 'application/json' } }
    );
    await db.query("UPDATE shops SET status='cancelled', plan='none' WHERE shop_domain=$1", [shop]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Errore cancellazione' });
  }
});

// Webhook aggiornamenti abbonamento
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const hash = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(req.body).digest('base64');
  if (hash !== hmac) return res.status(401).send('Non autorizzato');

  const data = JSON.parse(req.body);
  const shop = req.get('X-Shopify-Shop-Domain');
  if (data.status === 'CANCELLED' || data.status === 'DECLINED') {
    await db.query("UPDATE shops SET status='cancelled', plan='none' WHERE shop_domain=$1", [shop]);
  }
  res.sendStatus(200);
});

module.exports = router;
module.exports.PLANS = PLANS;
