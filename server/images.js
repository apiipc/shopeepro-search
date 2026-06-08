const fs = require('fs');
const path = require('path');
const db = require('./db');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'image-cache.json');
const UA = 'facebookexternalhit/1.1';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function parseProductLink(link) {
  if (!link) return null;
  const m = link.match(/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  const m2 = link.match(/i\.(\d+)\.(\d+)/);
  if (m2) return { shopId: m2[1], itemId: m2[2] };
  return null;
}

function extractImageFromHtml(html) {
  const hero = html.match(
    /src="(https:\/\/down-vn\.img\.susercontent\.com\/file\/[^"@]+)"[^>]*elementtiming="shopee:heroComponentPaint"/
  );
  if (hero && !hero[1].includes('promo-dim')) {
    return resizeImage(hero[1]);
  }

  const all = [...html.matchAll(/src="(https:\/\/down-vn\.img\.susercontent\.com\/file\/[^"@]+)"/g)];
  for (const m of all) {
    if (!m[1].includes('promo-dim') && !m[1].includes('shopeemobile.com')) {
      return resizeImage(m[1]);
    }
  }
  return null;
}

function resizeImage(url) {
  const base = url.split('@')[0];
  return `${base}@resize_w400_nl`;
}

/** Chuẩn hóa URL ảnh Shopee → CDN down-vn (ổn định hơn cf.shopee.vn) */
function normalizeShopeeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) return trimmed;

  const fileMatch = trimmed.match(/\/file\/([^@?]+)/);
  if (fileMatch) {
    return resizeImage(`https://down-vn.img.susercontent.com/file/${fileMatch[1]}`);
  }
  if (trimmed.includes('susercontent.com')) return resizeImage(trimmed);
  return trimmed;
}

async function fetchImageFromNox(productLink) {
  const token = process.env.NOXAPI_TOKEN;
  if (!token || !productLink) return null;
  try {
    const { fetchItemByUrl } = require('./noxapi');
    const data = await fetchItemByUrl(productLink);
    const raw = Array.isArray(data?.images) && data.images[0] ? data.images[0] : '';
    if (!raw) return null;
    const full = raw.startsWith('http') ? raw : `https://cf.shopee.vn/file/${raw}`;
    return normalizeShopeeImageUrl(full);
  } catch {
    return null;
  }
}

async function fetchImageFromShopee(productLink) {
  const url = productLink.startsWith('http') ? productLink : `https://shopee.vn/${productLink}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const html = await res.text();
  return extractImageFromHtml(html);
}

async function getProductImage(productId, productLink) {
  const cache = loadCache();
  if (cache[productId]) return normalizeShopeeImageUrl(cache[productId]);

  const product = db.getByProductId(productId);
  const link = productLink || product?.product_link;

  if (product?.image_url) {
    const normalized = normalizeShopeeImageUrl(product.image_url);
    cache[productId] = normalized;
    saveCache(cache);
    return normalized;
  }

  let imageUrl = link ? await fetchImageFromNox(link) : null;
  if (!imageUrl && link) imageUrl = await fetchImageFromShopee(link);
  if (imageUrl) imageUrl = normalizeShopeeImageUrl(imageUrl);

  if (imageUrl) {
    cache[productId] = imageUrl;
    saveCache(cache);
    if (product?.id) {
      db.update(product.id, { image_url: imageUrl });
    }
  }
  return imageUrl;
}

async function streamProductImage(productId, res) {
  const product = db.getByProductId(productId);
  let imageUrl = product?.image_url ? normalizeShopeeImageUrl(product.image_url) : null;
  if (!imageUrl) imageUrl = await getProductImage(productId, product?.product_link);
  if (!imageUrl) return false;

  const imgRes = await fetch(imageUrl, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://shopee.vn/',
      Accept: 'image/*',
    },
  });
  if (!imgRes.ok) return false;

  res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
  res.set('CDN-Cache-Control', 'public, s-maxage=604800');
  const buf = Buffer.from(await imgRes.arrayBuffer());
  res.send(buf);
  return true;
}

module.exports = {
  parseProductLink,
  fetchImageFromShopee,
  fetchImageFromNox,
  getProductImage,
  streamProductImage,
  normalizeShopeeImageUrl,
  extractImageFromHtml,
  resizeImage,
};
