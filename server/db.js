const usePostgres = !!(process.env.POSTGRES_URL || process.env.DATABASE_URL);

let impl = null;
let initPromise = null;

function getImpl() {
  if (!impl) impl = usePostgres ? require('./db-postgres') : require('./db-json');
  return impl;
}

async function init() {
  if (!initPromise) {
    initPromise = getImpl().init().then(() => {
      if (usePostgres) console.log('DB: Postgres (Neon)');
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
  usePostgres: () => usePostgres,
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
  dbPath: require('./db-json').dbPath,
};
