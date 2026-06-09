const db = require('./db');

const AN_REDIRECT = 'https://s.shopee.vn/an_redir';
const DEFAULT_AFFILIATE_ID = '17334660087';
const DEFAULT_SUB_ID = 'shopeepro-web-shopeepro----';
const UA = 'facebookexternalhit/1.1';

const SHOPEE_HOSTS = ['shopee.vn', 's.shopee.vn', 'shp.ee', 'shope.ee'];

function isShopeeHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return SHOPEE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function parseInputUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!isShopeeHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function cleanLandingUrl(url) {
  const u = new URL(url);
  if (u.hostname.includes('shopee.vn')) {
    return `${u.origin}${u.pathname}`;
  }
  return u.toString();
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLandingUrl(raw) {
  const parsed = parseInputUrl(raw);
  if (!parsed) return { ok: false, error: 'Link không hợp lệ — chỉ hỗ trợ shopee.vn, s.shopee.vn, shp.ee' };

  const host = parsed.hostname.toLowerCase();
  if (host.includes('shopee.vn')) {
    return { ok: true, landingUrl: cleanLandingUrl(parsed.toString()) };
  }

  try {
    let current = parsed.toString();
    for (let i = 0; i < 6; i++) {
      const res = await fetchWithTimeout(current, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      current = res.url || current;
      break;
    }
    const finalHost = new URL(current).hostname;
    if (finalHost.includes('shopee.vn')) {
      return { ok: true, landingUrl: cleanLandingUrl(current) };
    }
    return { ok: true, landingUrl: parsed.toString() };
  } catch {
    return { ok: true, landingUrl: parsed.toString() };
  }
}

async function getAffiliateId() {
  try {
    const fromMeta = await db.getMeta('affiliate_id');
    if (fromMeta && /^\d+$/.test(fromMeta.trim())) return fromMeta.trim();
  } catch {
    /* db chưa sẵn sàng */
  }
  const fromEnv = (process.env.AFFILIATE_ID || '').trim();
  return fromEnv || DEFAULT_AFFILIATE_ID;
}

function buildAffiliateLink(landingUrl, affiliateId, subId = DEFAULT_SUB_ID) {
  const encoded = encodeURIComponent(landingUrl);
  const sub = String(subId || DEFAULT_SUB_ID).trim() || DEFAULT_SUB_ID;
  return `${AN_REDIRECT}?origin_link=${encoded}&affiliate_id=${affiliateId}&sub_id=${sub}`;
}

async function createAffiliateLink(rawUrl, { subId } = {}) {
  const affiliateId = await getAffiliateId();
  if (!affiliateId) {
    return { ok: false, error: 'Chưa cấu hình affiliate_id' };
  }

  const resolved = await resolveLandingUrl(rawUrl);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    landingUrl: resolved.landingUrl,
    affiliateLink: buildAffiliateLink(resolved.landingUrl, affiliateId, subId),
    affiliateId,
  };
}

module.exports = {
  createAffiliateLink,
  getAffiliateId,
  buildAffiliateLink,
  resolveLandingUrl,
  parseInputUrl,
  DEFAULT_AFFILIATE_ID,
};
