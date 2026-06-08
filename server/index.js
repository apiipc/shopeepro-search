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
const { runAutoSync } = require('./auto-sync');

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
const CRON_SECRET = process.env.CRON_SECRET || '';

let autoSyncRunning = false;

async function maybeRunBackgroundSync() {
  if (autoSyncRunning || !process.env.NOXAPI_TOKEN) return;
  const last = await db.getMeta('last_auto_sync');
  const minGap = parseInt(process.env.AUTO_SYNC_INTERVAL_MS || '1800000', 10);
  if (last && Date.now() - parseInt(last, 10) < minGap) return;

  autoSyncRunning = true;
  runAutoSync()
    .then(async (r) => {
      if (r.ok) await db.setMeta('last_auto_sync', String(Date.now()));
      console.log(`Auto-sync: ${r.updated}/${r.processed} cập nhật`);
    })
    .catch((err) => console.error('Auto-sync lỗi:', err.message))
    .finally(() => {
      autoSyncRunning = false;
    });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(async (_req, _res, next) => {
  try {
    await db.init();
    next();
  } catch (err) {
    next(err);
  }
});

app.use((_req, _res, next) => {
  maybeRunBackgroundSync();
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireCron(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.secret;
  if (CRON_SECRET && token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!CRON_SECRET && process.env.VERCEL) return res.status(401).json({ error: 'CRON_SECRET chưa cấu hình' });
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

app.get('/api/health', async (_req, res) => {
  const s = await db.stats();
  res.json({
    ok: true,
    db: db.usePostgres() ? 'postgres' : 'json',
    products: s.totalAll,
    active: s.totalProducts,
    noxapi: !!process.env.NOXAPI_TOKEN,
  });
});

app.get('/api/search', async (req, res) => {
  const result = await db.search({
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

app.get('/api/trending', async (_req, res) => {
  res.json({ items: await db.getTrending(8) });
});

app.get('/api/shops', async (_req, res) => {
  res.json({ items: await db.getShops(20) });
});

app.get('/api/stats', async (_req, res) => {
  res.json(await db.stats());
});

app.get('/api/cron/auto-sync', requireCron, async (_req, res) => {
  const result = await runAutoSync({ limit: parseInt(process.env.AUTO_SYNC_BATCH || '25', 10) });
  if (result.ok) await db.setMeta('last_auto_sync', String(Date.now()));
  res.json(result);
});

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

app.get('/api/admin/products', requireAdmin, async (req, res) => {
  const result = await db.getAll({
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

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const p = req.body;
  if (!p.productId || !p.name || !p.affiliateLink) {
    return res.status(400).json({ error: 'Thiếu productId, name hoặc affiliateLink' });
  }
  const row = await db.create({
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

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await db.getById(id);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy' });
  const p = req.body;
  const row = await db.update(id, {
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

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const ok = await db.remove(parseInt(req.params.id, 10));
  if (!ok) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json({ ok: true });
});

app.post('/api/admin/import-csv', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file CSV' });
  try {
    const result = await importCsvContent(req.file.buffer.toString('utf-8'));
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
  const { items, total } = await db.getProductsSlice({ offset, limit });

  let updated = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const product = items[i];
    const result = await syncProduct(product, { delayMs: i < items.length - 1 ? 350 : 0 });
    if (result.ok) {
      await db.update(product.id, result.fields);
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
  db.init().then(async () => {
    const s = await db.stats();
    console.log(`ShopeePro chạy tại http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin.html`);
    console.log(`DB: ${db.usePostgres() ? 'Postgres' : 'JSON'}`);
    console.log(`Sản phẩm: ${s.totalAll} (${s.totalProducts} đang hiển thị)`);
    if (s.totalAll === 0) console.log('Chạy: npm run import');
    maybeRunBackgroundSync();
    app.listen(PORT);
  });
}

module.exports = app;
