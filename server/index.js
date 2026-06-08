const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const { importCsvContent } = require('./csv-import');
const { streamProductImage } = require('./images');
const { buildPriceDisplay, buildBuyerMessage } = require('./price');
const { buildPromoInfo } = require('./promo');
const { syncProduct } = require('./noxapi');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#= \t]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function mapProduct(row, { includeCommission = false } = {}) {
  const priceInfo = buildPriceDisplay(row.price, row.original_price);
  const buyer = buildBuyerMessage(priceInfo);
  const promo = buildPromoInfo(row);
  const base = {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    price: row.price,
    priceFormatted: priceInfo.priceFormatted,
    priceAmount: priceInfo.priceAmount,
    originalPrice: row.original_price || '',
    originalFormatted: priceInfo.originalFormatted,
    discountPercent: priceInfo.discountPercent,
    savingsFormatted: priceInfo.savingsFormatted,
    savingsAmount: priceInfo.savingsAmount,
    hasPromo: priceInfo.hasPromo,
    buyerHeadline: buyer.headline,
    buyerSubline: buyer.subline,
    buyerCta: promo.buyerCta,
    promoTags: promo.tags,
    promoHighlight: promo.promoHighlight,
    promoLabel: row.promo_label || '',
    isHot: promo.isHot,
    soldLabel: promo.soldLabel,
    revenue: row.revenue,
    shopName: row.shop_name,
    productLink: row.product_link,
    affiliateLink: row.affiliate_link,
    imageUrl: row.image_url,
    category: row.category,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeCommission) {
    base.commissionRate = row.commission_rate;
    base.commission = row.commission;
    base.promoLabel = row.promo_label || '';
  }
  return base;
}

app.get('/api/search', (req, res) => {
  const result = db.search({
    q: (req.query.q || '').trim(),
    shop: (req.query.shop || '').trim(),
    sort: req.query.sort || 'popular',
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 48)),
  });
  res.json({
    query: req.query.q || '',
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 24,
    total: result.total,
    totalPages: result.totalPages,
    items: result.items.map((r) => mapProduct(r)),
  });
});

app.get('/api/trending', (_req, res) => {
  res.json({ items: db.getTrending(8) });
});

app.get('/api/shops', (_req, res) => {
  res.json({ items: db.getShops(20) });
});

app.get('/api/stats', (_req, res) => {
  res.json(db.stats());
});

// Proxy ảnh qua server — tránh chặn hotlink Shopee CDN trên trình duyệt
app.get('/api/product-image/:productId', async (req, res) => {
  const productId = req.params.productId;
  try {
    const ok = await streamProductImage(productId, res);
    if (!ok) res.status(404).send('No image');
  } catch {
    res.status(502).send('Failed to fetch image');
  }
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) return res.json({ ok: true, token: ADMIN_PASSWORD });
  res.status(401).json({ error: 'Sai mật khẩu' });
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  const result = db.getAll({
    q: (req.query.q || '').trim(),
    page: Math.max(1, parseInt(req.query.page, 10) || 1),
    limit: Math.min(100, parseInt(req.query.limit, 10) || 20),
  });
  res.json({
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 20,
    total: result.total,
    totalPages: result.totalPages,
    items: result.items.map((r) => mapProduct(r, { includeCommission: true })),
  });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const p = req.body;
  if (!p.productId || !p.name || !p.affiliateLink) {
    return res.status(400).json({ error: 'Thiếu productId, name hoặc affiliateLink' });
  }
  const row = db.create({
    product_id: String(p.productId),
    name: p.name,
    price: p.price || '',
    revenue: p.revenue || '',
    shop_name: p.shopName || '',
    commission_rate: p.commissionRate || '',
    commission: p.commission || '',
    product_link: p.productLink || '',
    affiliate_link: p.affiliateLink,
    image_url: p.imageUrl || '',
    original_price: p.originalPrice || '',
    promo_label: p.promoLabel || '',
    category: p.category || '',
    active: p.active === false ? 0 : 1,
  });
  res.status(201).json(mapProduct(row, { includeCommission: true }));
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.getById(id);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy' });
  const p = req.body;
  const row = db.update(id, {
    product_id: p.productId ?? existing.product_id,
    name: p.name ?? existing.name,
    price: p.price ?? existing.price,
    revenue: p.revenue ?? existing.revenue,
    shop_name: p.shopName ?? existing.shop_name,
    commission_rate: p.commissionRate ?? existing.commission_rate,
    commission: p.commission ?? existing.commission,
    product_link: p.productLink ?? existing.product_link,
    affiliate_link: p.affiliateLink ?? existing.affiliate_link,
    image_url: p.imageUrl ?? existing.image_url,
    original_price: p.originalPrice ?? existing.original_price,
    promo_label: p.promoLabel ?? existing.promo_label,
    category: p.category ?? existing.category,
    active: p.active === false ? 0 : p.active === true ? 1 : existing.active,
  });
  res.json(mapProduct(row, { includeCommission: true }));
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const ok = db.remove(parseInt(req.params.id, 10));
  if (!ok) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json({ ok: true });
});

app.post('/api/admin/import-csv', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file CSV' });
  try {
    const result = importCsvContent(req.file.buffer.toString('utf-8'));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/sync-noxapi', requireAdmin, async (req, res) => {
  if (!process.env.NOXAPI_TOKEN) {
    return res.status(400).json({ error: 'Chưa cấu hình NOXAPI_TOKEN trên server' });
  }
  const limit = Math.min(25, Math.max(1, parseInt(req.body.limit, 10) || 10));
  const offset = Math.max(0, parseInt(req.body.offset, 10) || 0);
  const { items, total } = db.getProductsSlice({ offset, limit });

  let updated = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const product = items[i];
    const result = await syncProduct(product, { delayMs: i < items.length - 1 ? 350 : 0 });
    if (result.ok) {
      db.update(product.id, result.fields);
      updated++;
    } else {
      failed++;
      if (errors.length < 5) errors.push({ id: product.id, name: product.name.slice(0, 40), reason: result.reason });
    }
  }

  res.json({
    ok: true,
    updated,
    failed,
    processed: items.length,
    offset,
    nextOffset: offset + items.length,
    total,
    done: offset + items.length >= total,
    errors,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    const s = db.stats();
    console.log(`ShopeePro chạy tại http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
    console.log(`Sản phẩm: ${s.totalAll} (${s.totalProducts} đang hiển thị)`);
    if (s.totalAll === 0) console.log('Chạy: npm run import');
  });
}

module.exports = app;
