const express = require('express');
const router = express.Router();
const db = require('../db');

// Info shop per dashboard cliente
router.get('/info', async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: 'Shop mancante' });
  try {
    const result = await db.query('SELECT * FROM shops WHERE shop_domain = $1', [shop]);
    if (!result.rows.length) return res.status(404).json({ error: 'Shop non trovato' });
    const s = result.rows[0];
    res.json({
      shop: s.shop_domain,
      email: s.email,
      plan: s.plan,
      status: s.status,
      callsUsed: s.fashn_calls_used,
      callsLimit: s.fashn_calls_limit,
      nextPayment: s.next_payment_date
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrazione manuale shop (da landing page)
router.post('/register', async (req, res) => {
  const { shop_domain, email, plan } = req.body;
  if (!shop_domain || !email) return res.status(400).json({ error: 'Dati mancanti' });
  try {
    await db.query(`
      INSERT INTO shops (shop_domain, email, plan, status, fashn_calls_used, fashn_calls_limit)
      VALUES ($1, $2, $3, 'pending', 0, 0)
      ON CONFLICT (shop_domain) DO UPDATE SET email = $2
    `, [shop_domain, email, plan || 'none']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
