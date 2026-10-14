const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');

const FASHN_API_KEY = process.env.FASHN_API_KEY;
const FASHN_API_URL = 'https://api.fashn.ai/v1';

// Avvia generazione try-on
router.post('/run', async (req, res) => {
  const { shop_domain, model_image, garment_image, category } = req.body;

  if (!shop_domain || !model_image || !garment_image) {
    return res.status(400).json({ error: 'Parametri mancanti' });
  }

  try {
    // Verifica shop e limiti
    const shopRes = await db.query('SELECT * FROM shops WHERE shop_domain = $1', [shop_domain]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Shop non trovato' });

    const shop = shopRes.rows[0];
    if (shop.status !== 'active') return res.status(403).json({ error: 'Abbonamento non attivo' });
    if (shop.fashn_calls_used >= shop.fashn_calls_limit) {
      return res.status(429).json({ error: 'Limite generazioni mensile raggiunto' });
    }

    // Chiama Fashn.ai
    const fashnRes = await axios.post(`${FASHN_API_URL}/run`, {
      model_image,
      garment_image,
      category: category || 'tops'
    }, {
      headers: { Authorization: `Bearer ${FASHN_API_KEY}` }
    });

    const predictionId = fashnRes.data.id;

    // Incrementa contatore
    await db.query(
      'UPDATE shops SET fashn_calls_used = fashn_calls_used + 1 WHERE shop_domain = $1',
      [shop_domain]
    );

    // Log
    await db.query(
      'INSERT INTO usage_log (shop_domain, action) VALUES ($1, $2)',
      [shop_domain, 'tryon_run']
    );

    res.json({ id: predictionId, status: 'processing' });
  } catch (err) {
    console.error('Tryon error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Errore generazione' });
  }
});

// Controlla stato generazione
router.get('/status/:id', async (req, res) => {
  try {
    const response = await axios.get(`${FASHN_API_URL}/status/${req.params.id}`, {
      headers: { Authorization: `Bearer ${FASHN_API_KEY}` }
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Errore status' });
  }
});

module.exports = router;
