const { buildPriceDisplay } = require('./price');

function parseRevenue(revenue) {
  if (!revenue || typeof revenue !== 'string') return 0;
  const s = revenue.trim().toLowerCase();
  const m = s.match(/([\d.,]+)\s*(k|tr|m)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(',', '.'));
  if (Number.isNaN(n)) return 0;
  if (m[2] === 'k') n *= 1000;
  else if (m[2] === 'tr' || m[2] === 'm') n *= 1_000_000;
  return n;
}

function nameHasDealKeyword(name) {
  return /deal|🔥|giảm|sale|khuyến mãi|flash|hot|ưu đãi/i.test(name || '');
}

function buildPromoInfo(row) {
  const priceInfo = buildPriceDisplay(row.price, row.original_price);
  const tags = [];
  const seen = new Set();

  const addTag = (text, type) => {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    tags.push({ text, type });
  };

  if (row.promo_label?.trim()) addTag(row.promo_label.trim(), 'custom');

  if (priceInfo.hasPromo) {
    if (priceInfo.discountPercent >= 20) addTag('Giảm sốc', 'sale');
    else addTag(`-${priceInfo.discountPercent}%`, 'sale');
  }

  const sold = parseRevenue(row.revenue);
  if (sold >= 10_000) addTag('Bán chạy', 'hot');
  else if (sold >= 1_000) addTag('Được yêu thích', 'trust');

  if (nameHasDealKeyword(row.name)) addTag('Deal Shopee', 'deal');

  if (tags.length === 0) addTag('Giá tốt Shopee', 'default');

  let promoHighlight = '';
  if (priceInfo.hasPromo && priceInfo.savingsFormatted) {
    promoHighlight = `Tiết kiệm ${priceInfo.savingsFormatted} so với giá gốc shop`;
  } else if (sold >= 1_000 && row.revenue) {
    promoHighlight = `${row.revenue} đã bán trên Shopee — nhiều người đang chọn`;
  } else if (nameHasDealKeyword(row.name)) {
    promoHighlight = 'Sản phẩm đang được shop đẩy deal trên Shopee';
  } else {
    promoHighlight = 'Xem giá & khuyến mãi shop trực tiếp trên Shopee';
  }

  let buyerCta = 'Xem deal trên Shopee';
  if (priceInfo.hasPromo) buyerCta = 'Mua deal — tiết kiệm ngay';
  else if (sold >= 1_000) buyerCta = 'Mua như đang hot';
  else if (nameHasDealKeyword(row.name)) buyerCta = 'Săn deal ngay';

  return {
    tags: tags.slice(0, 3),
    promoHighlight,
    buyerCta,
    isHot: sold >= 1_000 || priceInfo.hasPromo || nameHasDealKeyword(row.name),
    soldLabel: row.revenue ? `${row.revenue} đã bán` : null,
    dealScore:
      (priceInfo.hasPromo ? 1000 + (priceInfo.discountPercent || 0) : 0) +
      sold / 100 +
      (nameHasDealKeyword(row.name) ? 50 : 0),
  };
}

function dealScore(row) {
  return buildPromoInfo(row).dealScore;
}

module.exports = { parseRevenue, buildPromoInfo, dealScore, nameHasDealKeyword };
