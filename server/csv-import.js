const { parse } = require('csv-parse/sync');
const { importProducts } = require('./db');

function parseProductRow(row) {
  const productId = String(row['Mã sản phẩm'] || row.product_id || '').trim();
  const affiliateLink = String(row['Link ưu đãi'] || row.affiliate_link || '').trim();
  const name = String(row['Tên sản phẩm'] || row.name || '').trim();
  if (!productId || !affiliateLink || !name) return null;

  return {
    product_id: productId,
    name,
    price: String(row['Giá'] || row.price || '').trim(),
    revenue: String(row['Doanh thu'] || row.revenue || '').trim(),
    shop_name: String(row['Tên cửa hàng'] || row.shop_name || '').trim(),
    commission_rate: String(row['Tỉ lệ hoa hồng'] || row.commission_rate || '').trim(),
    commission: String(row['Hoa hồng'] || row.commission || '').trim(),
    product_link: String(row['Link sản phẩm'] || row.product_link || '').trim(),
    affiliate_link: affiliateLink,
    active: 1,
  };
}

/** Loại trùng trong cùng file CSV — giữ dòng cuối (dữ liệu mới nhất) */
function dedupeByProductId(rows) {
  const map = new Map();
  let duplicatesInFile = 0;
  for (const row of rows) {
    if (map.has(row.product_id)) duplicatesInFile++;
    map.set(row.product_id, row);
  }
  return { unique: [...map.values()], duplicatesInFile };
}

function importCsvContent(content) {
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });

  let skipped = 0;
  const parsed = [];
  for (const row of rows) {
    const product = parseProductRow(row);
    if (!product) {
      skipped++;
      continue;
    }
    parsed.push(product);
  }

  const { unique, duplicatesInFile } = dedupeByProductId(parsed);
  const { created, updated } = importProducts(unique);

  return {
    ok: true,
    totalRows: rows.length,
    processed: unique.length,
    created,
    updated,
    duplicatesInFile,
    skipped,
    imported: created + updated,
  };
}

module.exports = { parseProductRow, dedupeByProductId, importCsvContent };
