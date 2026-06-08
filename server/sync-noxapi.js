const path = require('path');
const fs = require('fs');
const db = require('./db');
const { syncProduct } = require('./noxapi');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#= \t]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const limit = parseInt(process.argv[2], 10) || 20;
  const offset = parseInt(process.argv[3], 10) || 0;

  if (!process.env.NOXAPI_TOKEN) {
    console.error('Thiếu NOXAPI_TOKEN trong .env');
    process.exit(1);
  }

  const { items, total } = db.getProductsSlice({ offset, limit });
  console.log(`Sync NoxAPI: ${items.length} SP (offset ${offset}/${total})`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const result = await syncProduct(p, { delayMs: i < items.length - 1 ? 350 : 0 });
    if (result.ok) {
      db.update(p.id, result.fields);
      updated++;
      console.log(`  ✓ ${p.product_id} → ${result.fields.price}${result.fields.original_price ? ` (gốc ${result.fields.original_price})` : ''}`);
    } else {
      failed++;
      console.log(`  ✗ ${p.product_id}: ${result.reason}`);
    }
  }

  console.log(`\nXong: ${updated} cập nhật, ${failed} lỗi. Tiếp: npm run sync-nox -- ${limit} ${offset + limit}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
