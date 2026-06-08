const { normalizeShopeeImageUrl } = require('./images');

const NOXAPI_BASE = process.env.NOXAPI_URL || 'http://api.noxapi.com/v1/shopee';

function getToken() {
  return process.env.NOXAPI_TOKEN || '';
}

function mapInternalPrice(raw) {
  if (raw == null || raw <= 0) return null;
  return Math.round(raw / 100000);
}

function amountToPriceStr(vnd) {
  if (vnd == null || vnd <= 0) return '';
  if (vnd >= 1_000_000) {
    const tr = vnd / 1_000_000;
    const s = Number.isInteger(tr) ? String(tr) : tr.toFixed(1).replace('.', ',');
    return `${s}tr`;
  }
  const k = vnd / 1000;
  const s = Number.isInteger(k) ? `${k},0` : String(k).replace('.', ',');
  return `${s}k`;
}

function extractPrices(data) {
  const saleVnd = mapInternalPrice(data.price_info?.price_min ?? data.price_info?.price);
  let originVnd = null;

  for (const sku of data.skus || []) {
    const sale = mapInternalPrice(sku.sale_price);
    const origin = mapInternalPrice(sku.origin_price);
    if (sale != null && origin != null && origin > sale) {
      if (originVnd == null || origin > originVnd) originVnd = origin;
    }
  }

  if (originVnd != null && saleVnd != null && originVnd <= saleVnd) originVnd = null;

  return {
    saleVnd,
    originVnd,
    price: saleVnd != null ? amountToPriceStr(saleVnd) : '',
    original_price: originVnd != null ? amountToPriceStr(originVnd) : '',
  };
}

function mapItemToUpdate(data) {
  if (!data) return null;
  const prices = extractPrices(data);
  const imageRaw = Array.isArray(data.images) && data.images[0] ? data.images[0] : '';
  const imageFull = imageRaw.startsWith('http') ? imageRaw : imageRaw ? `https://cf.shopee.vn/file/${imageRaw}` : '';

  const update = {
    price: prices.price,
    original_price: prices.original_price,
    image_url: imageFull ? normalizeShopeeImageUrl(imageFull) : '',
    revenue:
      data.sold_count_display ||
      data.historical_sold_display ||
      data.global_sold_display ||
      (data.sold_count ? String(data.sold_count) : '') ||
      undefined,
  };

  if (data.title) update.name = data.title;
  if (data.shop_name || data.shop?.shop_name) {
    update.shop_name = data.shop_name || data.shop?.shop_name;
  }

  return update;
}

async function fetchItemByUrl(productUrl) {
  const token = getToken();
  if (!token) throw new Error('Chưa cấu hình NOXAPI_TOKEN');

  const url = productUrl.startsWith('http') ? productUrl : `https://shopee.vn/${productUrl}`;

  const res = await fetch(`${NOXAPI_BASE}/item_detail_by_url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  const json = await res.json();
  if (!json.success && json.code !== 200) {
    throw new Error(json.message || json.msg || `NoxAPI lỗi ${res.status}`);
  }
  return json.data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncProduct(product, { delayMs = 400 } = {}) {
  const link = product.product_link;
  if (!link) return { ok: false, reason: 'Thiếu link sản phẩm' };

  try {
    const data = await fetchItemByUrl(link);
    const fields = mapItemToUpdate(data);
    if (!fields?.price) return { ok: false, reason: 'Không lấy được giá' };
    if (delayMs) await sleep(delayMs);
    return { ok: true, fields };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  fetchItemByUrl,
  mapItemToUpdate,
  syncProduct,
  amountToPriceStr,
  extractPrices,
};
