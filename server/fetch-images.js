const db = require('./db');
const { getProductImage } = require('./images');

async function main() {
  await db.init();
  const { items } = await db.getAll({ limit: 99999 });
  const products = items.filter((p) => !p.image_url && p.product_link);
  console.log(`Cần tải ảnh cho ${products.length} sản phẩm...\n`);

  let ok = 0;
  let fail = 0;
  const batch = parseInt(process.argv[2], 10) || products.length;

  for (let i = 0; i < Math.min(batch, products.length); i++) {
    const p = products[i];
    process.stdout.write(`[${i + 1}/${Math.min(batch, products.length)}] ${p.product_id}... `);
    try {
      const url = await getProductImage(p.product_id, p.product_link);
      if (url) {
        console.log('OK');
        ok++;
      } else {
        console.log('SKIP');
        fail++;
      }
    } catch (e) {
      console.log('ERR', e.message);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nXong: ${ok} thành công, ${fail} thất bại.`);
}

main();
