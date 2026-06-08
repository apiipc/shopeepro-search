# ShopeePro — Săn deal Shopee

Web tìm kiếm sản phẩm Shopee affiliate: giá rõ, tag khuyến mãi, link mua qua `s.shopee.vn`.

## Chạy local

```bash
npm install
npm run import   # nạp CSV từ thư mục link sản phẩm (local)
npm start        # http://localhost:3000
```

Admin: `/admin.html` — đặt mật khẩu qua biến môi trường `ADMIN_PASSWORD`.

## Deploy Vercel

1. Import repo GitHub vào [Vercel](https://vercel.com)
2. Root directory: repo root (chứa `package.json`)
3. Thêm env: `ADMIN_PASSWORD` = mật khẩu admin mạnh
4. Deploy

Hoặc CLI:

```bash
npx vercel --prod
```

### Lưu ý Vercel

- Dữ liệu sản phẩm nằm trong `data/products.json` (đóng gói khi deploy).
- **Sửa / import CSV trên Admin** trên Vercel có thể **không lưu lâu dài** (filesystem serverless). Cập nhật dữ liệu: sửa local → commit `products.json` → redeploy, hoặc dùng DB ngoài (KV/Postgres) sau này.
