require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
const path     = require('path');

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: '*' }));

// Raw body per webhook — prima di express.json
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Content-Security-Policy per app embedded Shopify
app.use((req, res, next) => {
  const shop = req.query.shop;
  if (shop && shop.includes('.myshopify.com')) {
    res.setHeader('Content-Security-Policy',
      `frame-ancestors https://${shop} https://admin.shopify.com;`
    );
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/shop',         require('./routes/shop'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/tryon',        require('./routes/tryon'));
app.use('/api/shopify-new',  require('./routes/shopify-oauth'));
app.use('/api/billing',      require('./routes/shopify-billing'));

// Dashboard embedded (aperta dentro il pannello Shopify)
app.get('/app', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public/embedded/app.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ TryStyleAI running on port ${PORT}`));
