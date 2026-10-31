# Đo hiệu năng với dữ liệu lớn

Chạy trên một database **thử nghiệm riêng** (không bao giờ chạy trên production — `bench_data.sql` tắt trigger để nạp nhanh).

```bash
# 1. DB mới, áp toàn bộ migration
supabase db reset            # hoặc tạo DB trống rồi chạy lần lượt supabase/migrations/*.sql

# 2. Nạp dữ liệu: 2.000 hộ, 5 triệu đơn (hộ đầu tiên 1 triệu đơn), ~3,9 triệu giao dịch, ~4,8 triệu bút toán
psql "$DB_URL" -f supabase/bench/bench_data.sql        # ~5 phút trên máy 2 CPU

# 3. Đo từng màn hình (trung bình 30 lần, sau 3 lần làm nóng)
psql "$DB_URL" -f supabase/bench/bench_queries.sql
```

Các dòng bắt đầu bằng `SO SÁNH —` là cách làm cũ hoặc cách không nên dùng, để thấy chênh lệch.
Thêm một truy vấn mới cho app thì thêm một dòng `pg_temp.bench(...)` vào `bench_queries.sql`.

## Kết quả gần nhất (31/10/2026, Postgres 16, máy 2 CPU, hộ có 1 triệu đơn trong DB 5 triệu đơn)

| Màn hình / thao tác | Trung bình | Chậm nhất |
| --- | --- | --- |
| Trang chính: tổng hôm nay | 0,34 ms | 4,5 ms |
| Sổ: 20 đơn mới nhất / trang sau 50.000 đơn (keyset) | 0,35 / 0,43 ms | 0,7 ms |
| Sổ: tổng tháng / cả năm (daily_sales) | 0,41 / 0,57 ms | 0,7 ms |
| Tiền cần xem lại · Gán đơn (tìm đơn) | 0,09 · 0,41 ms | 0,5 ms |
| Tạo đơn QR · Tiền mặt · Hủy · Xác nhận tay · Gán tiền | 0,64 · 1,25 · 0,18 · 0,50 · 1,03 ms | 8 ms |
| Webhook xác nhận chuyển khoản (300 lần) | 1,64 ms | 11 ms |
| Đối soát daily_sales sau mọi thao tác ghi | 0 dòng lệch | |

Cách không nên dùng (để so sánh): OFFSET 176 ms, SUM cả năm trên orders 1.308 ms, RLS từng dòng 827 ms, khớp mã bằng quét chuỗi 1.167 ms.
