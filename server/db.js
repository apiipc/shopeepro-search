const path = require('path');

const onVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);

function getPostgresUrl() {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  ).trim();
}

function usePostgresNow() {
  return !!getPostgresUrl();
}

let impl = null;
let implMode = null;
let initPromise = null;

function getImpl() {
  const mode = usePostgresNow() ? 'postgres' : 'json';
  if (onVercel && mode === 'json') {
    const err = new Error(
      'Vercel cần POSTGRES_URL (Neon). Vào Vercel → Storage → Connect to Project → Redeploy.'
    );
    err.code = 'NO_POSTGRES';
    throw err;
  }
  if (!impl || implMode !== mode) {
    impl = mode === 'postgres' ? require('./db-postgres') : require('./db-json');
    implMode = mode;
    initPromise = null;
  }
  return impl;
}

async function init() {
  if (!initPromise) {
    initPromise = getImpl()
      .init()
      .then(() => {
        if (usePostgresNow()) console.log('DB: Postgres (Neon)');
        else console.log('DB: JSON file');
      });
  }
  return initPromise;
}

function bind(name) {
  return async (...args) => {
    await init();
    return getImpl()[name](...args);
  };
}

module.exports = {
  init,
  usePostgres: () => usePostgresNow(),
  onVercel: () => onVercel,
  upsertProduct: bind('upsertProduct'),
  importProducts: bind('importProducts'),
  search: bind('search'),
  getAll: bind('getAll'),
  getById: bind('getById'),
  getByProductId: bind('getByProductId'),
  getProductsSlice: bind('getProductsSlice'),
  getProductsNeedingSync: bind('getProductsNeedingSync'),
  create: bind('create'),
  update: bind('update'),
  remove: bind('remove'),
  stats: bind('stats'),
  getShops: bind('getShops'),
  getTrending: bind('getTrending'),
  getMeta: bind('getMeta'),
  setMeta: bind('setMeta'),
  getPostgresUrl,
  dbPath: path.join(__dirname, '..', 'data', 'products.json'),
};
