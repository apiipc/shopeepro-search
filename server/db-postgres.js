const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { normalize, mergeImportFields } = require('./db-shared');

function pgUrl() {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  ).trim();
}

let sqlClient = null;
function getSql() {
  if (!sqlClient) {
    const url = pgUrl();
    if (!url) throw new Error('POSTGRES_URL chưa cấu hình');
    sqlClient = neon(url);
  }
  return sqlClient;
}

function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

async function init() {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      product_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price TEXT DEFAULT '',
      revenue TEXT DEFAULT '',
      shop_name TEXT DEFAULT '',
      commission_rate TEXT DEFAULT '',
      commission TEXT DEFAULT '',
      product_link TEXT DEFAULT '',
      affiliate_link TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      original_price TEXT DEFAULT '',
      promo_label TEXT DEFAULT '',
      category TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_products_active ON products(active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  const count = await seedFromJsonIfEmpty();
  console.log(`Postgres sẵn sàng: ${count} sản phẩm`);
}

function rowFromDb(r) {
  if (!r) return null;
  return normalize({
    ...r,
    active: r.active ? 1 : 0,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  });
}

async function getMeta(key) {
  const rows = await sql`SELECT value FROM app_meta WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

async function setMeta(key, value) {
  await sql`
    INSERT INTO app_meta (key, value) VALUES (${key}, ${String(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

async function seedFromJsonIfEmpty() {
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM products`;
  if (count > 0) return count;

  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    console.log('Postgres trống — dùng Import CSV để thêm SP (bỏ qua seed JSON trên Vercel).');
    return 0;
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'products.json');
  if (!fs.existsSync(jsonPath)) return 0;

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const products = data.products || [];
  console.log(`Postgres trống → import ${products.length} SP từ products.json...`);

  for (const p of products) {
    const n = normalize(p);
    await sql`
      INSERT INTO products (
        product_id, name, price, revenue, shop_name, commission_rate, commission,
        product_link, affiliate_link, image_url, original_price, promo_label, category,
        active, created_at, updated_at
      ) VALUES (
        ${n.product_id}, ${n.name}, ${n.price}, ${n.revenue}, ${n.shop_name},
        ${n.commission_rate}, ${n.commission}, ${n.product_link}, ${n.affiliate_link},
        ${n.image_url}, ${n.original_price}, ${n.promo_label}, ${n.category},
        ${n.active}, ${n.created_at}, ${n.updated_at}
      )
      ON CONFLICT (product_id) DO NOTHING
    `;
  }

  const [{ count: after }] = await sql`SELECT COUNT(*)::int AS count FROM products`;
  return after;
}

async function upsertProduct(input) {
  const existing = await getByProductId(input.product_id);
  if (existing) {
    const merged = normalize({
      ...mergeImportFields(existing, input),
      id: existing.id,
      product_id: String(input.product_id),
      updated_at: new Date().toISOString(),
    });
    await sql`
      UPDATE products SET
        name = ${merged.name}, price = ${merged.price}, revenue = ${merged.revenue},
        shop_name = ${merged.shop_name}, commission_rate = ${merged.commission_rate},
        commission = ${merged.commission}, product_link = ${merged.product_link},
        affiliate_link = ${merged.affiliate_link}, image_url = ${merged.image_url},
        original_price = ${merged.original_price}, promo_label = ${merged.promo_label},
        category = ${merged.category}, active = ${merged.active}, updated_at = NOW()
      WHERE id = ${existing.id}
    `;
  } else {
    const n = normalize({ ...input, product_id: String(input.product_id) });
    await sql`
      INSERT INTO products (
        product_id, name, price, revenue, shop_name, commission_rate, commission,
        product_link, affiliate_link, image_url, original_price, promo_label, category, active
      ) VALUES (
        ${n.product_id}, ${n.name}, ${n.price}, ${n.revenue}, ${n.shop_name},
        ${n.commission_rate}, ${n.commission}, ${n.product_link}, ${n.affiliate_link},
        ${n.image_url}, ${n.original_price}, ${n.promo_label}, ${n.category}, ${n.active}
      )
    `;
  }
}

async function importProducts(inputs) {
  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    const existing = await getByProductId(input.product_id);
    if (existing) {
      await upsertProduct(input);
      updated++;
    } else {
      await upsertProduct(input);
      created++;
    }
  }
  return { created, updated };
}

function searchOrderClause(sort) {
  switch (sort) {
    case 'deal':
      return sql`ORDER BY (CASE WHEN original_price IS NOT NULL AND original_price <> '' THEN 1 ELSE 0 END) DESC, updated_at DESC`;
    case 'commission':
      return sql`ORDER BY commission_rate DESC NULLS LAST, updated_at DESC`;
    case 'price_asc':
      return sql`ORDER BY price ASC NULLS LAST`;
    case 'price_desc':
      return sql`ORDER BY price DESC NULLS LAST`;
    default:
      return sql`ORDER BY updated_at DESC`;
  }
}

async function search({ q = '', shop = '', sort = 'popular', page = 1, limit = 24, activeOnly = true }) {
  const offset = (page - 1) * limit;
  const qTrim = q.trim();
  const shopTrim = shop.trim();
  const orderClause = searchOrderClause(sort);
  const qPat = qTrim ? `%${qTrim}%` : '';
  const shopPat = shopTrim ? `%${shopTrim}%` : '';

  let countRow;
  let rows;

  if (activeOnly && !qTrim && !shopTrim) {
    [countRow] = await sql`SELECT COUNT(*)::int AS count FROM products WHERE active = 1`;
    rows = await sql`
      SELECT * FROM products WHERE active = 1
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (activeOnly && qTrim && !shopTrim) {
    [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE active = 1
        AND (name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
    `;
    rows = await sql`
      SELECT * FROM products
      WHERE active = 1
        AND (name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (activeOnly && !qTrim && shopTrim) {
    [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE active = 1 AND shop_name ILIKE ${shopPat}
    `;
    rows = await sql`
      SELECT * FROM products
      WHERE active = 1 AND shop_name ILIKE ${shopPat}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (activeOnly && qTrim && shopTrim) {
    [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE active = 1
        AND shop_name ILIKE ${shopPat}
        AND (name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
    `;
    rows = await sql`
      SELECT * FROM products
      WHERE active = 1
        AND shop_name ILIKE ${shopPat}
        AND (name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (!activeOnly && !qTrim && !shopTrim) {
    [countRow] = await sql`SELECT COUNT(*)::int AS count FROM products`;
    rows = await sql`
      SELECT * FROM products
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE (${!qTrim} OR name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
        AND (${!shopTrim} OR shop_name ILIKE ${shopPat})
    `;
    rows = await sql`
      SELECT * FROM products
      WHERE (${!qTrim} OR name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat})
        AND (${!shopTrim} OR shop_name ILIKE ${shopPat})
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  const total = countRow?.count ?? 0;
  return {
    items: rows.map(rowFromDb),
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

async function getAll({ q = '', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const qTrim = q.trim();
  const qPat = qTrim ? `%${qTrim}%` : '';

  let countRow;
  let rows;

  if (!qTrim) {
    [countRow] = await sql`SELECT COUNT(*)::int AS count FROM products`;
    rows = await sql`
      SELECT * FROM products
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat}
    `;
    rows = await sql`
      SELECT * FROM products
      WHERE name ILIKE ${qPat} OR shop_name ILIKE ${qPat} OR product_id ILIKE ${qPat}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  const total = countRow?.count ?? 0;
  return {
    items: rows.map(rowFromDb),
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

async function getById(id) {
  const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
  return rowFromDb(rows[0]);
}

async function getByProductId(productId) {
  const rows = await sql`SELECT * FROM products WHERE product_id = ${String(productId)}`;
  return rowFromDb(rows[0]);
}

async function create(input) {
  const n = normalize(input);
  const rows = await sql`
    INSERT INTO products (
      product_id, name, price, revenue, shop_name, commission_rate, commission,
      product_link, affiliate_link, image_url, original_price, promo_label, category, active
    ) VALUES (
      ${n.product_id}, ${n.name}, ${n.price}, ${n.revenue}, ${n.shop_name},
      ${n.commission_rate}, ${n.commission}, ${n.product_link}, ${n.affiliate_link},
      ${n.image_url}, ${n.original_price}, ${n.promo_label}, ${n.category}, ${n.active}
    )
    RETURNING *
  `;
  return rowFromDb(rows[0]);
}

async function update(id, input) {
  const existing = await getById(id);
  if (!existing) return null;
  const merged = normalize({ ...existing, ...input, id, updated_at: new Date().toISOString() });
  const rows = await sql`
    UPDATE products SET
      product_id = ${merged.product_id}, name = ${merged.name}, price = ${merged.price},
      revenue = ${merged.revenue}, shop_name = ${merged.shop_name},
      commission_rate = ${merged.commission_rate}, commission = ${merged.commission},
      product_link = ${merged.product_link}, affiliate_link = ${merged.affiliate_link},
      image_url = ${merged.image_url}, original_price = ${merged.original_price},
      promo_label = ${merged.promo_label}, category = ${merged.category},
      active = ${merged.active}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rowFromDb(rows[0]);
}

async function remove(id) {
  const rows = await sql`DELETE FROM products WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function stats() {
  const [all] = await sql`SELECT COUNT(*)::int AS c FROM products`;
  const [active] = await sql`SELECT COUNT(*)::int AS c FROM products WHERE active = 1`;
  const shopRows = await sql`
    SELECT COUNT(DISTINCT shop_name)::int AS c FROM products
    WHERE active = 1 AND shop_name <> ''
  `;
  return {
    totalProducts: active.c,
    totalShops: shopRows[0].c,
    totalAll: all.c,
  };
}

async function getShops(limit = 20) {
  const rows = await sql`
    SELECT shop_name, COUNT(*)::int AS count FROM products
    WHERE active = 1 AND shop_name <> ''
    GROUP BY shop_name ORDER BY count DESC LIMIT ${limit}
  `;
  return rows;
}

async function getTrending(limit = 8) {
  const rows = await sql`
    SELECT name FROM products WHERE active = 1 ORDER BY RANDOM() LIMIT ${limit}
  `;
  return rows.map((r) => r.name);
}

async function getProductsSlice({ offset = 0, limit = 20, requireLink = true } = {}) {
  const rows = requireLink
    ? await sql`
        SELECT * FROM products WHERE product_link <> '' ORDER BY id
        OFFSET ${offset} LIMIT ${limit}
      `
    : await sql`SELECT * FROM products ORDER BY id OFFSET ${offset} LIMIT ${limit}`;
  const [{ count }] = requireLink
    ? await sql`SELECT COUNT(*)::int AS count FROM products WHERE product_link <> ''`
    : await sql`SELECT COUNT(*)::int AS count FROM products`;
  return { items: rows.map(rowFromDb), total: count };
}

async function getProductsNeedingSync(limit = 20) {
  const rows = await sql`
    SELECT * FROM products
    WHERE product_link <> ''
      AND (image_url = '' OR original_price = '' OR price = '')
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  return rows.map(rowFromDb);
}

module.exports = {
  init,
  upsertProduct,
  importProducts,
  search,
  getAll,
  getById,
  getByProductId,
  getProductsSlice,
  getProductsNeedingSync,
  create,
  update,
  remove,
  stats,
  getShops,
  getTrending,
  getMeta,
  setMeta,
};
