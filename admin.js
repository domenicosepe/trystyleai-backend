const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET;

// Login admin
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (!result.rows.length) return res.status(401).json({ error: 'Credenziali errate' });
    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Credenziali errate' });
    const token = jwt.sign({ id: admin.id, username }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Middleware auth
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Token mancante' });
  try {
    req.admin = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token non valido' });
  }
}

// Lista shops
router.get('/shops', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM shops ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modifica shop (piano, status, limiti)
router.put('/shops/:domain', authMiddleware, async (req, res) => {
  const { plan, status, fashn_calls_limit, fashn_calls_used } = req.body;
  try {
    await db.query(`
      UPDATE shops SET
        plan = COALESCE($1, plan),
        status = COALESCE($2, status),
        fashn_calls_limit = COALESCE($3, fashn_calls_limit),
        fashn_calls_used = COALESCE($4, fashn_calls_used),
        updated_at = NOW()
      WHERE shop_domain = $5
    `, [plan, status, fashn_calls_limit, fashn_calls_used, req.params.domain]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats generali
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const total = await db.query('SELECT COUNT(*) FROM shops');
    const active = await db.query("SELECT COUNT(*) FROM shops WHERE status = 'active'");
    const calls = await db.query('SELECT SUM(fashn_calls_used) FROM shops');
    res.json({
      totalShops: parseInt(total.rows[0].count),
      activeShops: parseInt(active.rows[0].count),
      totalCalls: parseInt(calls.rows[0].sum || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup iniziale admin (usa SETUP_KEY)
router.post('/setup', async (req, res) => {
  const { key, username, password } = req.body;
  if (key !== process.env.SETUP_KEY) return res.status(403).json({ error: 'Key non valida' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.query(`
      INSERT INTO admins (username, password) VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET password = $2
    `, [username, hashed]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
