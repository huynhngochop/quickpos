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
