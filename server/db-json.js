const fs = require('fs');
const path = require('path');
const { parsePrice } = require('./price');
const { dealScore } = require('./promo');
const { normalize, mergeImportFields } = require('./db-shared');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'products.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ products: [], nextId: 1 }, null, 2));
}

function load() {
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function upsertProduct(input) {
  const data = load();
  const now = new Date().toISOString();
  const productId = String(input.product_id);
  const idx = data.products.findIndex((p) => String(p.product_id) === productId);

  if (idx >= 0) {
    data.products[idx] = normalize({
      ...mergeImportFields(data.products[idx], input),
      id: data.products[idx].id,
      created_at: data.products[idx].created_at,
      updated_at: now,
    });
  } else {
    data.products.push(
      normalize({
        ...input,
        product_id: productId,
        id: data.nextId++,
        created_at: now,
        updated_at: now,
      })
    );
  }
  save(data);
}

function importProducts(inputs) {
  const data = load();
  const now = new Date().toISOString();
  const indexByProductId = new Map();
  data.products.forEach((p, i) => indexByProductId.set(String(p.product_id), i));

  let created = 0;
  let updated = 0;

  for (const input of inputs) {
    const productId = String(input.product_id);
    const idx = indexByProductId.get(productId);

    if (idx !== undefined) {
      data.products[idx] = normalize({
        ...mergeImportFields(data.products[idx], input),
        product_id: productId,
        id: data.products[idx].id,
        created_at: data.products[idx].created_at,
        updated_at: now,
      });
      updated++;
    } else {
      const row = normalize({
        ...input,
        product_id: productId,
        id: data.nextId++,
        created_at: now,
        updated_at: now,
      });
      indexByProductId.set(productId, data.products.length);
      data.products.push(row);
      created++;
    }
  }

  save(data);
  return { created, updated };
}

function filterAndSort(items, { q, shop, sort }) {
  let filtered = items.filter((p) => {
    if (q) {
      const lq = q.toLowerCase();
      if (
        !p.name.toLowerCase().includes(lq) &&
        !(p.shop_name || '').toLowerCase().includes(lq) &&
        !String(p.product_id).includes(lq)
      ) {
        return false;
      }
    }
    if (shop && !(p.shop_name || '').toLowerCase().includes(shop.toLowerCase())) return false;
    return true;
  });

  const parsePriceLocal = (price) => parsePrice(price) || 0;

  if (sort === 'price_asc') filtered.sort((a, b) => parsePriceLocal(a.price) - parsePriceLocal(b.price));
  else if (sort === 'price_desc') filtered.sort((a, b) => parsePriceLocal(b.price) - parsePriceLocal(a.price));
  else if (sort === 'deal') filtered.sort((a, b) => dealScore(b) - dealScore(a));
  else if (sort === 'commission') {
    filtered.sort(
      (a, b) =>
        parseFloat((b.commission_rate || '0').replace('%', '')) -
        parseFloat((a.commission_rate || '0').replace('%', ''))
    );
  } else {
    filtered.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  return filtered;
}

function search({ q = '', shop = '', sort = 'popular', page = 1, limit = 24, activeOnly = true }) {
  let items = load().products.filter((p) => !activeOnly || p.active);
  items = filterAndSort(items, { q, shop, sort });
  const total = items.length;
  const offset = (page - 1) * limit;
  return { items: items.slice(offset, offset + limit), total, totalPages: Math.ceil(total / limit) || 1 };
}

function getAll({ q = '', page = 1, limit = 20 }) {
  let items = load().products;
  if (q) {
    const lq = q.toLowerCase();
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(lq) ||
        (p.shop_name || '').toLowerCase().includes(lq) ||
        String(p.product_id).includes(lq)
    );
  }
  items = [...items].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const total = items.length;
  const offset = (page - 1) * limit;
  return { items: items.slice(offset, offset + limit), total, totalPages: Math.ceil(total / limit) || 1 };
}

function getById(id) {
  return load().products.find((p) => p.id === id) || null;
}

function getByProductId(productId) {
  return load().products.find((p) => String(p.product_id) === String(productId)) || null;
}

function create(input) {
  const data = load();
  const row = normalize({
    ...input,
    id: data.nextId++,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  data.products.push(row);
  save(data);
  return row;
}

function update(id, input) {
  const data = load();
  const idx = data.products.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  data.products[idx] = normalize({
    ...data.products[idx],
    ...input,
    id,
    updated_at: new Date().toISOString(),
  });
  save(data);
  return data.products[idx];
}

function remove(id) {
  const data = load();
  const before = data.products.length;
  data.products = data.products.filter((p) => p.id !== id);
  if (data.products.length === before) return false;
  save(data);
  return true;
}

function stats() {
  const products = load().products.filter((p) => p.active);
  const shops = new Set(products.map((p) => p.shop_name).filter(Boolean));
  return { totalProducts: products.length, totalShops: shops.size, totalAll: load().products.length };
}

function getShops(limit = 20) {
  const map = {};
  load().products.forEach((p) => {
    if (!p.active || !p.shop_name) return;
    map[p.shop_name] = (map[p.shop_name] || 0) + 1;
  });
  return Object.entries(map)
    .map(([shop_name, count]) => ({ shop_name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getTrending(limit = 8) {
  const active = load().products.filter((p) => p.active);
  const shuffled = [...active].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit).map((p) => p.name);
}

function getProductsSlice({ offset = 0, limit = 20, requireLink = true } = {}) {
  let items = load().products;
  if (requireLink) items = items.filter((p) => p.product_link);
  const total = items.length;
  return { items: items.slice(offset, offset + limit), total };
}

function getProductsNeedingSync(limit = 20) {
  const items = load().products.filter(
    (p) => p.product_link && (!p.image_url || !p.original_price || !p.price)
  );
  return items.slice(0, limit);
}

const metaPath = path.join(dataDir, 'app-meta.json');

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveMetaFile(meta) {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function getMeta(key) {
  return loadMeta()[key] ?? null;
}

function setMeta(key, value) {
  const meta = loadMeta();
  meta[key] = String(value);
  saveMetaFile(meta);
}

module.exports = {
  dbPath,
  init: async () => {},
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
