const fs = require('fs');
const path = require('path');
const { importCsvContent } = require('./csv-import');

const CSV_DIR = path.join(__dirname, '..', '..', '..', 'link sản phẩm');

async function importFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return importCsvContent(content);
}

async function main() {
  if (!fs.existsSync(CSV_DIR)) {
    console.error('Không tìm thấy:', CSV_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(CSV_DIR).filter((f) => f.endsWith('.csv'));
  let totals = { created: 0, updated: 0, duplicatesInFile: 0, skipped: 0, processed: 0 };

  for (const file of files) {
    const r = await importFile(path.join(CSV_DIR, file));
    console.log(
      `  ${file}: ${r.created} mới, ${r.updated} cập nhật, ${r.duplicatesInFile} trùng trong file, ${r.skipped} bỏ qua`
    );
    totals.created += r.created;
    totals.updated += r.updated;
    totals.duplicatesInFile += r.duplicatesInFile;
    totals.skipped += r.skipped;
    totals.processed += r.processed;
  }

  console.log(
    `\nTổng: ${totals.processed} sản phẩm unique từ ${files.length} file — ${totals.created} mới, ${totals.updated} cập nhật, ${totals.duplicatesInFile} trùng đã gộp, ${totals.skipped} dòng lỗi/thiếu.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
