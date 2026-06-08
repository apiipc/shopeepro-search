const db = require('./db');
const { syncProduct } = require('./noxapi');

const BATCH = parseInt(process.env.AUTO_SYNC_BATCH || '15', 10);

async function runAutoSync({ limit = BATCH } = {}) {
  if (!process.env.NOXAPI_TOKEN) {
    return { ok: false, reason: 'NOXAPI_TOKEN chưa cấu hình', updated: 0 };
  }

  await db.init();
  const items = await db.getProductsNeedingSync(limit);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const product = items[i];
    const result = await syncProduct(product, { delayMs: i < items.length - 1 ? 300 : 0 });
    if (result.ok) {
      await db.update(product.id, result.fields);
      updated++;
    } else {
      failed++;
    }
  }

  return { ok: true, updated, failed, processed: items.length, remaining: items.length === limit };
}

module.exports = { runAutoSync };
