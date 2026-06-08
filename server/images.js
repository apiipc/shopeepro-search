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
  if (cache[productId]) return cache[productId];

  const product = db.getByProductId(productId);
  const link = productLink || product?.product_link;
  if (!link) return null;

  const imageUrl = await fetchImageFromShopee(link);
  if (imageUrl) {
    cache[productId] = imageUrl;
    saveCache(cache);
    if (product?.id) {
      db.update(product.id, { image_url: imageUrl });
    }
  }
  return imageUrl;
}

module.exports = {
  parseProductLink,
  fetchImageFromShopee,
  getProductImage,
  extractImageFromHtml,
  resizeImage,
};
