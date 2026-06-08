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
3. Thêm env trên Vercel → Settings → Environment Variables:

| Biến | Mô tả |
|------|--------|
| `ADMIN_PASSWORD` | Mật khẩu admin |
| `NOXAPI_TOKEN` | Token NoxAPI (sync giá/ảnh) |
| `POSTGRES_URL` | Connection string Neon (khuyến nghị) |
| `CRON_SECRET` | Chuỗi bí mật cho cron auto-sync |

4. **Neon Postgres**: Vercel Dashboard → Storage → Create Database → Neon → gắn vào project. Biến `POSTGRES_URL` được inject tự động.
5. Deploy — lần đầu app **tự tạo bảng** và **seed** từ `data/products.json` nếu DB trống.

Hoặc CLI:

```bash
npx vercel --prod
```

## Tự động sync NoxAPI

Ứng dụng tự cập nhật giá, giá gốc, ảnh cho SP thiếu dữ liệu:

- **Nền**: mỗi ~30 phút (khi có traffic), sync batch 15 SP
- **Cron Vercel**: mỗi 4 giờ gọi `/api/cron/auto-sync`
- **Admin**: nút Sync NoxAPI (batch thủ công)

Tùy chỉnh: `AUTO_SYNC_BATCH`, `AUTO_SYNC_INTERVAL_MS`.

## Database

- Có `POSTGRES_URL` → **Neon Postgres** (production, lưu lâu dài)
- Không có → **JSON file** (`data/products.json`, phù hợp local dev)
