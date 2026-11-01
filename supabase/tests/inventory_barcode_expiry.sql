-- Kiểm thử migration 20261102000008 (mã vạch, lô có hạn dùng, xuất hủy, xóa món, xuất nhập tồn).
-- Chạy trong một transaction và ROLLBACK ở cuối.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/inventory_barcode_expiry.sql

begin;

insert into auth.users (id, email, phone) values
 ('f1111111-1111-1111-1111-111111111111','f_owner@test','84904000001'),
 ('f2222222-2222-2222-2222-222222222222','f_staff@test','84904000002'),
 ('f3333333-3333-3333-3333-333333333333','f_other@test','84904000003')
on conflict (id) do nothing;

create temp table t_ctx (k text primary key, v uuid);
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.oid(p_k text) returns uuid language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;
create or replace function pg_temp.expect_code(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — lẽ ra phải báo %', p_label, p_code;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm <> p_code then raise exception 'FAIL: % — báo "%" thay vì %', p_label, sqlerrm, p_code; end if;
  raise notice 'PASS: % (%)', p_label, p_code;
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

insert into t_ctx select k, gen_random_uuid() from unnest(array[
  'biz','biz_b','sua','mi','keo','tmp','lot1','lot2','lot3','in4','o1','out1','out2','cnt1','other']) k;

set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-1111-1111-111111111111';
select create_business_v1(pg_temp.oid('biz'), 'Tạp hóa Cô Tư', '0377777702', 'HCM');

-- ---------- 1. Mã vạch ----------
select upsert_product_v2(pg_temp.oid('sua'), pg_temp.oid('biz'), 'Sữa tươi hộp', 9000, 'hộp', 'Sữa', 7000, true, 5,
                         '8934673573189', true, 10);
select pg_temp.ok((select barcode = '8934673573189' and track_expiry and track_stock and expiry_warn_days = 10
                     from products where id = pg_temp.oid('sua')), 'Thêm món có mã vạch, theo dõi hạn dùng');
select upsert_product_v2(pg_temp.oid('mi'), pg_temp.oid('biz'), 'Mì gói', 4000, 'gói', 'Đồ khô', 3000, true, 10, ' 8934563138165 ');
select pg_temp.ok((select barcode = '8934563138165' and not track_expiry from products where id = pg_temp.oid('mi')), 'Mã vạch bỏ khoảng trắng');
select pg_temp.expect_code($q$ select upsert_product_v2(pg_temp.oid('keo'), pg_temp.oid('biz'), 'Kẹo', 2000, 'cái', null, null, false, null, '8934563138165') $q$,
  'QP_DUPLICATE_BARCODE', 'Hai món không trùng mã vạch');
select pg_temp.expect_code($q$ select upsert_product_v2(pg_temp.oid('keo'), pg_temp.oid('biz'), 'Kẹo', 2000, 'cái', null, null, false, null, 'mã có dấu') $q$,
  'QP_INVALID_INPUT', 'Mã vạch ký tự lạ');
select upsert_product_v2(pg_temp.oid('keo'), pg_temp.oid('biz'), 'Kẹo', 2000, 'cái', null, null, false, null, 'KEO-01');
select upsert_product_v2(pg_temp.oid('keo'), pg_temp.oid('biz'), 'Kẹo dẻo', 2500, 'cái', null, null, false, null, null);
select pg_temp.ok((select name = 'Kẹo dẻo' and price = 2500 and barcode is null from products where id = pg_temp.oid('keo')), 'Sửa tên, giá, bỏ mã');

-- ---------- 2. Lô có hạn dùng ----------
select pg_temp.expect_code($q$ select stock_in_v2(pg_temp.oid('lot1'), pg_temp.oid('sua'), 10) $q$, 'QP_EXPIRY_REQUIRED', 'Hàng có hạn phải nhập ngày hết hạn');
select stock_in_v2(pg_temp.oid('lot1'), pg_temp.oid('sua'), 10, 7000, null, false, pg_temp.today() + 3);
select stock_in_v2(pg_temp.oid('lot1'), pg_temp.oid('sua'), 10, 7000, null, false, pg_temp.today() + 3);   -- gửi lại
select stock_in_v2(pg_temp.oid('lot2'), pg_temp.oid('sua'), 12, 7000, null, false, pg_temp.today() + 60);
select pg_temp.ok((select stock_qty = 22 from products where id = pg_temp.oid('sua')), 'Nhập 2 lô 10 + 12 (gửi lại không cộng 2 lần)');
select pg_temp.ok((select count(*) = 2 and sum(qty_left) = 22 from stock_lots where product_id = pg_temp.oid('sua')), 'Có 2 lô');
select pg_temp.ok((select count(*) = 1 from expiring_lots(pg_temp.oid('biz')) where lot_id = pg_temp.oid('lot1') and days_left = 3),
  'Lô còn 3 ngày nằm trong cảnh báo (ngưỡng 10 ngày)');
select pg_temp.ok((select count(*) = 0 from expiring_lots(pg_temp.oid('biz')) where lot_id = pg_temp.oid('lot2')), 'Lô còn 60 ngày chưa cảnh báo');

-- Bán 4 hộp → trừ lô hết hạn sớm trước
select create_cash_sale_v1(pg_temp.oid('o1'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Sữa tươi hộp','quantity',4,'unit_price',9000,'product_id',pg_temp.oid('sua'))));
select pg_temp.ok((select stock_qty = 18 from products where id = pg_temp.oid('sua')), 'Bán 4 → tồn 18');
select pg_temp.ok((select qty_left = 6 from stock_lots where id = pg_temp.oid('lot1'))
               and (select qty_left = 12 from stock_lots where id = pg_temp.oid('lot2')), 'Bán trừ lô gần hết hạn trước');

-- Xuất hủy lô gần hết hạn
select pg_temp.expect_code($q$ select stock_out_v1(pg_temp.oid('out1'), pg_temp.oid('sua'), 7, 'EXPIRED', pg_temp.oid('lot1')) $q$,
  'QP_OUT_EXCEEDS_STOCK', 'Không xuất quá số còn trong lô');
select pg_temp.expect_code($q$ select stock_out_v1(pg_temp.oid('out1'), pg_temp.oid('sua'), 1, 'LOST') $q$, 'QP_INVALID_INPUT', 'Lý do xuất không hợp lệ');
select stock_out_v1(pg_temp.oid('out1'), pg_temp.oid('sua'), 6, 'EXPIRED', pg_temp.oid('lot1'), 'Hết hạn');
select stock_out_v1(pg_temp.oid('out1'), pg_temp.oid('sua'), 6, 'EXPIRED', pg_temp.oid('lot1'), 'Hết hạn');   -- gửi lại
select pg_temp.ok((select stock_qty = 12 from products where id = pg_temp.oid('sua')), 'Xuất hủy 6 → tồn 12 (gửi lại không trừ thêm)');
select pg_temp.ok((select qty_left = 0 from stock_lots where id = pg_temp.oid('lot1'))
               and (select qty_left = 12 from stock_lots where id = pg_temp.oid('lot2')), 'Xuất đúng lô đã chọn, lô khác giữ nguyên');
select pg_temp.ok((select count(*) = 0 from expiring_lots(pg_temp.oid('biz'))), 'Hết cảnh báo khi lô đã hủy hết');

-- Kiểm kho thấy thiếu → trừ lô; xuất không chỉ lô → trừ lô gần hết hạn
select stock_count_v1(pg_temp.oid('cnt1'), pg_temp.oid('sua'), 10);
select pg_temp.ok((select qty_left = 10 from stock_lots where id = pg_temp.oid('lot2')), 'Kiểm kho còn 10 → lô còn 10');
select stock_out_v1(pg_temp.oid('out2'), pg_temp.oid('sua'), 2, 'DAMAGED');
select pg_temp.ok((select qty_left = 8 from stock_lots where id = pg_temp.oid('lot2')), 'Xuất hư hỏng 2 → lô còn 8');
select pg_temp.expect_code($q$ select stock_out_v1(gen_random_uuid(), pg_temp.oid('sua'), 9, 'OTHER') $q$, 'QP_OUT_EXCEEDS_STOCK', 'Không xuất quá tồn kho');

-- Lô đã quá hạn hiện số ngày âm
select stock_in_v2(pg_temp.oid('lot3'), pg_temp.oid('sua'), 2, null, null, false, pg_temp.today() - 1);
select pg_temp.ok((select days_left = -1 from expiring_lots(pg_temp.oid('biz')) where lot_id = pg_temp.oid('lot3')), 'Lô đã quá hạn 1 ngày');

-- ---------- 3. Xuất nhập tồn ----------
select stock_in_v2(pg_temp.oid('in4'), pg_temp.oid('mi'), 30, 3000);
select pg_temp.ok((select opening = 0 and qty_in = 24 and qty_sold = 4 and qty_out = 8 and qty_adjust = -2 and closing = 10
                     from stock_report(pg_temp.oid('biz'), now() - interval '1 day', now() + interval '1 day')
                    where product_id = pg_temp.oid('sua')), 'Sữa: đầu 0 + nhập 24 − bán 4 − xuất 8 − kiểm 2 = cuối 10');
select pg_temp.ok((select closing = 30 and closing_value = 90000
                     from stock_report(pg_temp.oid('biz'), now() - interval '1 day', now() + interval '1 day')
                    where product_id = pg_temp.oid('mi')), 'Mì: tồn cuối 30, giá trị 90.000');
select pg_temp.ok((select opening = 10 and qty_in = 0 and closing = 10
                     from stock_report(pg_temp.oid('biz'), now() + interval '1 day', now() + interval '2 days')
                    where product_id = pg_temp.oid('sua')), 'Kỳ sau: tồn đầu = tồn cuối kỳ trước');
select pg_temp.ok((select opening = 0 and closing = 0
                     from stock_report(pg_temp.oid('biz'), now() - interval '3 days', now() - interval '2 days')
                    where product_id = pg_temp.oid('sua')), 'Kỳ trước khi nhập: tồn 0');
select pg_temp.ok((select count(*) = 0 from stock_report(pg_temp.oid('biz'), now(), now() + interval '500 days')), 'Kỳ quá 400 ngày bị chặn');

-- ---------- 4. Xóa món ----------
select upsert_product_v2(pg_temp.oid('tmp'), pg_temp.oid('biz'), 'Món thử', 1000, 'cái');
select pg_temp.ok((select delete_product_v1(pg_temp.oid('tmp')) = 'DELETED'), 'Món chưa dùng → xóa hẳn');
select pg_temp.ok((select count(*) = 0 from products where id = pg_temp.oid('tmp')), 'Không còn trong bảng');
select pg_temp.ok((select delete_product_v1(pg_temp.oid('tmp')) = 'DELETED'), 'Gửi lại lệnh xóa vẫn ổn');
select pg_temp.ok((select delete_product_v1(pg_temp.oid('mi')) = 'ARCHIVED'), 'Món đã có phiếu kho → ẩn');
select pg_temp.ok((select archived_at is not null and not is_active from products where id = pg_temp.oid('mi')), 'Món ẩn: có thời điểm xóa');
select pg_temp.expect_code($q$ select upsert_product_v2(pg_temp.oid('mi'), pg_temp.oid('biz'), 'Mì', 4000) $q$, 'QP_NOT_FOUND', 'Không sửa được món đã xóa');
select pg_temp.expect_code($q$ select set_product_active_v1(pg_temp.oid('mi'), true) $q$, 'QP_NOT_FOUND', 'Không bật bán lại món đã xóa');
select upsert_product_v2(gen_random_uuid(), pg_temp.oid('biz'), 'Mì gói mới', 4500, 'gói', null, null, false, null, '8934563138165');
select pg_temp.ok(true, 'Món đã xóa trả lại mã vạch cho món mới');

-- ---------- 5. Phân quyền ----------
select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '0904000002', 'CASHIER');
set local request.jwt.claim.sub = 'f2222222-2222-2222-2222-222222222222';
select accept_invites_v1();
select pg_temp.expect_code($q$ select upsert_product_v2(gen_random_uuid(), pg_temp.oid('biz'), 'Trà', 10000) $q$, 'QP_FORBIDDEN', 'Thu ngân không thêm món');
select pg_temp.expect_code($q$ select delete_product_v1(pg_temp.oid('sua')) $q$, 'QP_FORBIDDEN', 'Thu ngân không xóa món');
select pg_temp.expect_code($q$ select stock_out_v1(gen_random_uuid(), pg_temp.oid('sua'), 1, 'OTHER') $q$, 'QP_FORBIDDEN', 'Thu ngân không xuất hủy');
select pg_temp.ok((select count(*) >= 1 from expiring_lots(pg_temp.oid('biz'))), 'Thu ngân xem được cảnh báo hết hạn');

set local request.jwt.claim.sub = 'f3333333-3333-3333-3333-333333333333';
select create_business_v1(pg_temp.oid('biz_b'), 'Quán khác', '0377777703', 'HN');
select pg_temp.ok((select count(*) = 0 from expiring_lots(pg_temp.oid('biz'))), 'Hộ khác không thấy lô hàng');
select pg_temp.ok((select count(*) = 0 from stock_report(pg_temp.oid('biz'), now() - interval '1 day', now() + interval '1 day')), 'Hộ khác không thấy xuất nhập tồn');
select pg_temp.ok((select count(*) = 0 from stock_lots), 'RLS: không đọc được bảng lô của hộ khác');
select pg_temp.expect_code($q$ select stock_out_v1(gen_random_uuid(), pg_temp.oid('sua'), 1, 'OTHER') $q$, 'QP_NOT_FOUND', 'Hộ khác không xuất hàng');
select pg_temp.expect_code($q$ select delete_product_v1(pg_temp.oid('sua')) $q$, 'QP_NOT_FOUND', 'Hộ khác không xóa món');
select pg_temp.expect_code($q$ insert into stock_lots (id, business_id, product_id, qty_in, qty_left) values (gen_random_uuid(), pg_temp.oid('biz_b'), pg_temp.oid('sua'), 1, 1) $q$,
  'permission denied for table stock_lots', 'App không ghi thẳng bảng lô');

reset role;
rollback;
