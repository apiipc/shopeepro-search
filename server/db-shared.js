const CSV_MERGE_FIELDS = [
  'name',
  'price',
  'revenue',
  'shop_name',
  'commission_rate',
  'commission',
  'product_link',
  'affiliate_link',
];

function normalize(row) {
  return {
    id: row.id,
    product_id: String(row.product_id),
    name: row.name,
    price: row.price || '',
    revenue: row.revenue || '',
    shop_name: row.shop_name || '',
    commission_rate: row.commission_rate || '',
    commission: row.commission || '',
    product_link: row.product_link || '',
    affiliate_link: row.affiliate_link,
    image_url: row.image_url || '',
    original_price: row.original_price || '',
    promo_label: row.promo_label || '',
    category: row.category || '',
    active: row.active !== 0 && row.active !== false ? 1 : 0,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

function mergeImportFields(existing, incoming) {
  const merged = { ...existing };
  for (const key of CSV_MERGE_FIELDS) {
    if (incoming[key] !== undefined && incoming[key] !== '') merged[key] = incoming[key];
  }
  if (incoming.active !== undefined) merged.active = incoming.active;
  return merged;
}

module.exports = { CSV_MERGE_FIELDS, normalize, mergeImportFields };
