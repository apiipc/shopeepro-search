/** Parse giá Shopee dạng "159,0k", "59,9k", "1,2tr" → số VND */
function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/\s/g, '');
  if (!s) return null;

  let mult = 1;
  let numStr = s;
  if (s.endsWith('tr') || s.endsWith('m')) {
    mult = 1_000_000;
    numStr = s.replace(/tr$|m$/, '');
  } else if (s.endsWith('k')) {
    mult = 1_000;
    numStr = s.replace(/k$/, '');
  }

  const normalized = numStr.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  if (Number.isNaN(n)) return null;
  return Math.round(n * mult);
}

function formatVnd(amount) {
  if (amount == null || Number.isNaN(amount)) return null;
  return `₫${amount.toLocaleString('vi-VN')}`;
}

function buildPriceDisplay(priceRaw, originalRaw) {
  const amount = parsePrice(priceRaw);
  const originalAmount = parsePrice(originalRaw);
  const formatted = amount != null ? formatVnd(amount) : priceRaw || 'Liên hệ';
  const originalFormatted =
    originalAmount != null && originalAmount > (amount || 0) ? formatVnd(originalAmount) : null;

  let discountPercent = null;
  let savingsFormatted = null;
  if (amount != null && originalAmount != null && originalAmount > amount) {
    discountPercent = Math.round(((originalAmount - amount) / originalAmount) * 100);
    savingsFormatted = formatVnd(originalAmount - amount);
  }

  return {
    priceAmount: amount,
    priceFormatted: formatted,
    originalAmount,
    originalFormatted,
    discountPercent,
    savingsFormatted,
    savingsAmount: originalAmount != null && amount != null && originalAmount > amount ? originalAmount - amount : null,
    hasPromo: discountPercent != null && discountPercent > 0,
  };
}

/** Thông điệp cho người mua — chỉ nói tiết kiệm khi có giá gốc thật */
function buildBuyerMessage(priceInfo) {
  if (priceInfo.hasPromo && priceInfo.savingsFormatted) {
    return {
      headline: `Rẻ hơn ${priceInfo.savingsFormatted}`,
      subline: `So với giá gốc ${priceInfo.originalFormatted} trên Shopee`,
      cta: 'Mua deal này',
    };
  }
  return {
    headline: priceInfo.priceFormatted,
    subline: 'Giá bán trên Shopee hiện tại',
    cta: 'Xem & mua trên Shopee',
  };
}

module.exports = { parsePrice, formatVnd, buildPriceDisplay, buildBuyerMessage };
