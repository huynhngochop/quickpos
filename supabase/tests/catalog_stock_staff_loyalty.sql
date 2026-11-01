-- Kiểm thử migration 20261101000007 (hàng hóa, tồn kho, báo cáo theo giờ/món, ca bán, nhân viên, khách quen,
-- thu nợ bằng QR, hóa đơn điện tử). Chạy trong một transaction và ROLLBACK ở cuối.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/catalog_stock_staff_loyalty.sql

begin;

insert into auth.users (id, email, phone) values
 ('e1111111-1111-1111-1111-111111111111','e_owner@test','84903000001'),
 ('e2222222-2222-2222-2222-222222222222','e_staff@test','84903000002'),
 ('e3333333-3333-3333-3333-333333333333','e_other@test','84903000003')
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

insert into t_ctx select k, gen_random_uuid() from unnest(array[
  'biz','biz_b','cafe','banh','m1','m2','m3','o1','o2','o3','qr1','sh1','inv1','cus','ev1','dc','dq','invd']) k;

set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select create_business_v1(pg_temp.oid('biz'), 'Quán Cà Phê Cô Ba', '0377777701', 'HCM');

-- ---------- 1. Hàng hóa ----------
select upsert_product_v1(pg_temp.oid('cafe'), pg_temp.oid('biz'), 'Cà phê sữa', 20000, 'ly', 'Đồ uống');
select upsert_product_v1(pg_temp.oid('banh'), pg_temp.oid('biz'), 'Bánh mì', 15000, 'ổ', 'Đồ ăn', 8000, true, 5);
select pg_temp.ok((select count(*) = 2 from products where business_id = pg_temp.oid('biz') and is_active), 'Chủ thêm 2 món');
select pg_temp.ok((select (upsert_product_v1(pg_temp.oid('cafe'), pg_temp.oid('biz'), 'Cà phê sữa đá', 22000, 'ly', 'Đồ uống')).price = 22000),
  'Sửa giá món (cùng mã)');
select pg_temp.expect_code($q$ select upsert_product_v1(gen_random_uuid(), pg_temp.oid('biz'), '', 1000) $q$, 'QP_INVALID_INPUT', 'Tên món trống');
select pg_temp.expect_code($q$ insert into products (business_id, name, price) values (pg_temp.oid('biz'), 'X', 1) $q$,
  'permission denied for table products', 'App không ghi thẳng vào bảng hàng hóa');

-- ---------- 2. Tồn kho ----------
select stock_in_v1(pg_temp.oid('m1'), pg_temp.oid('banh'), 30, 8000, 'Lò bánh giao', true);
select stock_in_v1(pg_temp.oid('m1'), pg_temp.oid('banh'), 30, 8000, 'Lò bánh giao', true);   -- gửi lại
select pg_temp.ok((select stock_qty = 30 from products where id = pg_temp.oid('banh')), 'Nhập 30 ổ (gửi lại không cộng 2 lần)');
select pg_temp.ok((select amount = 240000 and category = 'Nhập hàng' from journal_entries where source_id = pg_temp.oid('m1')),
  'Nhập hàng ghi luôn vào sổ chi 240.000');

-- Bán tiền mặt 3 ổ + 2 ly → kho còn 27; món không theo dõi kho thì không đổi
select create_cash_sale_v1(pg_temp.oid('o1'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Bánh mì','quantity',3,'unit_price',15000,'product_id',pg_temp.oid('banh')),
  jsonb_build_object('name','Cà phê sữa đá','quantity',2,'unit_price',22000,'product_id',pg_temp.oid('cafe'))));
select create_cash_sale_v1(pg_temp.oid('o1'), pg_temp.oid('biz'), '[]'::jsonb);   -- gửi lại đơn tiền mặt
select pg_temp.ok((select stock_qty = 27 from products where id = pg_temp.oid('banh')), 'Bán 3 ổ → còn 27 (gửi lại không trừ thêm)');
select pg_temp.ok((select stock_qty = 0 and not track_stock from products where id = pg_temp.oid('cafe')), 'Món không theo dõi kho không bị trừ');
select pg_temp.ok((select count(*) = 1 from stock_movements where order_id = pg_temp.oid('o1')), 'Một dòng xuất kho cho đơn');

-- QR: trừ kho lúc tiền về, không phải lúc tạo đơn
select create_order_v1(pg_temp.oid('o2'), pg_temp.oid('biz'),
  jsonb_build_array(jsonb_build_object('name','Bánh mì','quantity',2,'unit_price',15000,'product_id',pg_temp.oid('banh'))));
select pg_temp.ok((select stock_qty = 27 from products where id = pg_temp.oid('banh')), 'Đơn QR chưa trả chưa trừ kho');
select confirm_transfer_manually_v1(pg_temp.oid('o2'), 'Khách cho xem');
select pg_temp.ok((select stock_qty = 25 from products where id = pg_temp.oid('banh')), 'Đơn QR đã trả → trừ 2 ổ');

select stock_count_v1(pg_temp.oid('m2'), pg_temp.oid('banh'), 24, 'Đếm cuối ngày');
select pg_temp.ok((select stock_qty = 24 from products where id = pg_temp.oid('banh'))
  and (select qty = -1 and kind = 'COUNT' from stock_movements where id = pg_temp.oid('m2')), 'Kiểm kho: thiếu 1 ổ ghi chênh lệch −1');

-- ---------- 3. Báo cáo theo giờ, món bán chạy ----------
select pg_temp.ok((select sum(orders) = 2 and sum(amount) = 119000 from sales_by_hour(pg_temp.oid('biz'), now() - interval '1 day', now() + interval '1 hour')),
  'Theo giờ: 2 đơn, 119.000');
select pg_temp.ok((select name = 'Bánh mì' and quantity = 5 and amount = 75000 from top_products(pg_temp.oid('biz'), now() - interval '1 day', now() + interval '1 hour') limit 1),
  'Món bán chạy nhất: Bánh mì 5 ổ');
select pg_temp.expect_code($q$ select * from sales_by_hour(pg_temp.oid('biz'), now() - interval '200 days', now()) $q$,
  'QP_INVALID_INPUT', 'Khoảng quá 93 ngày bị từ chối');

-- ---------- 4. Ca bán ----------
-- Trong một transaction now() không đổi: lùi giờ các đơn/chi trước đó 1 giờ để chúng nằm ngoài ca
reset role;
update orders set sold_at = sold_at - interval '1 hour' where id in (pg_temp.oid('o1'), pg_temp.oid('o2'));
update journal_entries set created_at = created_at - interval '1 hour' where source_id = pg_temp.oid('m1');
set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select open_shift_v1(pg_temp.oid('sh1'), pg_temp.oid('biz'), 500000);
select pg_temp.ok((select (open_shift_v1(gen_random_uuid(), pg_temp.oid('biz'), 1)).id = pg_temp.oid('sh1')), 'Mở ca lần 2 trả ca đang mở');
select create_cash_sale_v1(pg_temp.oid('o3'), pg_temp.oid('biz'), '[{"name":"Bán hàng","quantity":1,"unit_price":50000}]'::jsonb);
select add_expense_v1(gen_random_uuid(), pg_temp.oid('biz'), 20000, 'Khác', 'Mua đá');
select pg_temp.ok((select cash_sales = 50000 and cash_expenses = 20000 and expected_cash = 530000 from current_shift_v1(pg_temp.oid('biz'))),
  'Ca đang mở: đầu ca 500.000 + bán 50.000 − chi 20.000 = 530.000');
select close_shift_v1(pg_temp.oid('sh1'), 525000, 'Thiếu 5 nghìn');
select pg_temp.ok((select expected_cash = 530000 and counted_cash = 525000 and closed_at is not null from cash_shifts where id = pg_temp.oid('sh1')),
  'Đóng ca: lưu tiền phải có và tiền đếm được');
select pg_temp.ok((select count(*) = 0 from current_shift_v1(pg_temp.oid('biz'))), 'Đóng ca xong không còn ca mở');

-- ---------- 5. Nhân viên ----------
select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '0903 000 002', 'CASHIER');
select pg_temp.ok((select count(*) = 1 from business_invites where business_id = pg_temp.oid('biz') and phone = '84903000002'), 'Mời thu ngân bằng số điện thoại');
select pg_temp.expect_code($q$ select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '12345', 'CASHIER') $q$, 'QP_INVALID_INPUT', 'Số điện thoại sai');
select pg_temp.expect_code($q$ select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '0903000001', 'CASHIER') $q$, 'QP_ALREADY_MEMBER', 'Mời chính chủ quán');

set local request.jwt.claim.sub = 'e2222222-2222-2222-2222-222222222222';
select pg_temp.ok((select accept_invites_v1() = 1), 'Thu ngân đăng nhập → vào quán');
select pg_temp.ok((select role = 'CASHIER' and member_phone = '0903000002' from business_members
                    where business_id = pg_temp.oid('biz') and user_id = 'e2222222-2222-2222-2222-222222222222'), 'Có quyền thu ngân, lưu số điện thoại');
select pg_temp.ok((select accept_invites_v1() = 0), 'Nhận lời mời lần 2 không có gì thêm');
select pg_temp.expect_code($q$ select upsert_product_v1(gen_random_uuid(), pg_temp.oid('biz'), 'Trà', 10000) $q$, 'QP_FORBIDDEN', 'Thu ngân không sửa hàng hóa');
select pg_temp.expect_code($q$ select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '0903000003', 'CASHIER') $q$, 'QP_FORBIDDEN', 'Thu ngân không mời người khác');
-- Thu ngân vẫn nhập hàng được
select stock_in_v1(gen_random_uuid(), pg_temp.oid('banh'), 6);
select pg_temp.ok((select stock_qty = 30 from products where id = pg_temp.oid('banh')), 'Thu ngân nhập 6 ổ → 30');

set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select set_member_role_v1(pg_temp.oid('biz'), 'e2222222-2222-2222-2222-222222222222', 'MANAGER');
select pg_temp.ok((select role = 'MANAGER' from business_members where user_id = 'e2222222-2222-2222-2222-222222222222'), 'Chủ nâng thành quản lý');
select pg_temp.expect_code($q$ select remove_member_v1(pg_temp.oid('biz'), 'e1111111-1111-1111-1111-111111111111') $q$, 'QP_NOT_FOUND', 'Không cho chủ tự xóa mình');
select remove_member_v1(pg_temp.oid('biz'), 'e2222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) = 1 from business_members where business_id = pg_temp.oid('biz')), 'Cho nhân viên nghỉ');
select invite_member_v1(pg_temp.oid('invd'), pg_temp.oid('biz'), '0903000003', 'ACCOUNTANT');
select revoke_invite_v1(pg_temp.oid('invd'));
set local request.jwt.claim.sub = 'e3333333-3333-3333-3333-333333333333';
select pg_temp.ok((select accept_invites_v1() = 0), 'Lời mời đã thu hồi thì không vào được');

-- ---------- 6. Khách quen ----------
set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select pg_temp.expect_code($q$ select upsert_customer_v1(gen_random_uuid(), pg_temp.oid('biz'), 'Anh Bảy', '0911222333', false) $q$,
  'QP_CONSENT_REQUIRED', 'Lưu số điện thoại khách quen cần đồng ý');
select upsert_customer_v1(pg_temp.oid('cus'), pg_temp.oid('biz'), 'Anh Bảy', '0911222333', true);
select pg_temp.expect_code($q$ select upsert_customer_v1(gen_random_uuid(), pg_temp.oid('biz'), 'Trùng', '0911222333', true) $q$,
  'QP_PHONE_TAKEN', 'Số điện thoại đã có khách khác');
-- Đơn tiền mặt (đã trả) gắn khách sau → cộng điểm ngay; gắn lại không cộng thêm
select set_order_customer_v1(pg_temp.oid('o1'), pg_temp.oid('cus'));
select set_order_customer_v1(pg_temp.oid('o1'), pg_temp.oid('cus'));
select pg_temp.ok((select points = 8 and visits = 1 and total_spent = 89000 from crm_customers where id = pg_temp.oid('cus')),
  'Đơn 89.000 → 8 điểm (10.000 đ/điểm), 1 lần ghé');
-- Đơn QR gắn khách trước khi trả → cộng lúc tiền về
select create_order_v1(pg_temp.oid('qr1'), pg_temp.oid('biz'), '[{"name":"Bán hàng","quantity":1,"unit_price":120000}]'::jsonb);
select set_order_customer_v1(pg_temp.oid('qr1'), pg_temp.oid('cus'));
select pg_temp.ok((select points = 8 from crm_customers where id = pg_temp.oid('cus')), 'Chưa trả chưa cộng điểm');
select confirm_transfer_manually_v1(pg_temp.oid('qr1'), null);
select pg_temp.ok((select points = 20 and visits = 2 from crm_customers where id = pg_temp.oid('cus')), 'Tiền về → +12 điểm');
select pg_temp.expect_code($q$ select redeem_points_v1(gen_random_uuid(), pg_temp.oid('cus'), 50, 'Ly miễn phí') $q$, 'QP_NOT_ENOUGH_POINTS', 'Đổi quá số điểm');
select redeem_points_v1(pg_temp.oid('ev1'), pg_temp.oid('cus'), 15, 'Ly cà phê miễn phí');
select redeem_points_v1(pg_temp.oid('ev1'), pg_temp.oid('cus'), 15, 'Ly cà phê miễn phí');
select pg_temp.ok((select points = 5 from crm_customers where id = pg_temp.oid('cus')), 'Đổi 15 điểm (gửi lại không trừ 2 lần) → còn 5');

-- ---------- 7. Thu nợ bằng QR ----------
select add_debt_customer_v1(pg_temp.oid('dc'), pg_temp.oid('biz'), 'Chị Hoa');
select record_debt_v1(gen_random_uuid(), pg_temp.oid('dc'), 'DEBT', 100000);
select pg_temp.expect_code($q$ select create_debt_payment_order_v1(gen_random_uuid(), pg_temp.oid('dc'), 150000) $q$,
  'QP_PAYMENT_EXCEEDS_DEBT', 'Mã QR trả nợ không vượt số nợ');
select create_debt_payment_order_v1(pg_temp.oid('dq'), pg_temp.oid('dc'), 60000);
select pg_temp.ok((select balance = 100000 from debt_balances where customer_id = pg_temp.oid('dc')), 'Chưa chuyển tiền: nợ vẫn 100.000');
select confirm_transfer_manually_v1(pg_temp.oid('dq'), null);
select pg_temp.ok((select balance = 40000 from debt_balances where customer_id = pg_temp.oid('dc')), 'Tiền về → nợ còn 40.000');
select pg_temp.ok((select count(*) = 1 from debt_entries where id = pg_temp.oid('dq')), 'Một dòng trả nợ cho đơn');

-- ---------- 8. Hóa đơn điện tử ----------
select pg_temp.expect_code($q$ select create_invoice_from_order_v1(gen_random_uuid(), pg_temp.oid('o1')) $q$,
  'QP_EINVOICE_NOT_SETUP', 'Chưa cài nhà cung cấp hóa đơn');
select pg_temp.expect_code($q$ select update_invoice_settings_v1(pg_temp.oid('biz'), 'DEMO', '2', 'abc') $q$, 'QP_INVALID_INPUT', 'Ký hiệu sai');
select update_invoice_settings_v1(pg_temp.oid('biz'), 'DEMO', '2', 'c26maa');
select pg_temp.ok((select invoice_symbol = 'C26MAA' from businesses where id = pg_temp.oid('biz')), 'Ký hiệu viết hoa');
select create_invoice_from_order_v1(pg_temp.oid('inv1'), pg_temp.oid('o1'), 'Công ty ABC', '0312345678', 'ketoan@abc.vn');
select pg_temp.ok((select (create_invoice_from_order_v1(gen_random_uuid(), pg_temp.oid('o1'))).id = pg_temp.oid('inv1')), 'Một đơn chỉ một hóa đơn');
select pg_temp.ok((select count(*) = 2 and sum(line_amount) = 89000 from invoice_lines where invoice_id = pg_temp.oid('inv1')), 'Chép 2 dòng hàng từ đơn');
select pg_temp.expect_code($q$ select create_invoice_from_order_v1(gen_random_uuid(), pg_temp.oid('o2b')) $q$, 'QP_NOT_FOUND', 'Đơn không có');
reset role;
set local role service_role;
select record_einvoice_result(pg_temp.oid('inv1'), 1, 'M1-26-DEMO-000001', 'demo-1', null, '{}'::jsonb);
reset role;
select pg_temp.ok((select status = 'ISSUED' and invoice_no = 1 and total_amount = 89000 and tax_authority_code is not null from invoices where id = pg_temp.oid('inv1')),
  'Ghi kết quả phát hành: số 1, mã cơ quan thuế');
set local role authenticated;
set local request.jwt.claim.sub = 'e1111111-1111-1111-1111-111111111111';
select pg_temp.expect_code($q$ select record_einvoice_result(pg_temp.oid('inv1'), 2, 'x', 'x', null, '{}'::jsonb) $q$,
  'permission denied for function record_einvoice_result', 'App không tự ghi kết quả phát hành');

rollback;
