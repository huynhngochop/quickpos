-- Kiểm thử migration 20261101000006_debts_expenses_tax.sql (sổ nợ, chi tiêu, ngành nghề tính thuế)
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/debts_expenses_tax.sql
-- Chạy trong một transaction và ROLLBACK ở cuối.

begin;

insert into auth.users (id, email) values
 ('d1111111-1111-1111-1111-111111111111','d_owner_a@test'),
 ('d2222222-2222-2222-2222-222222222222','d_cashier_a@test'),
 ('d3333333-3333-3333-3333-333333333333','d_owner_b@test')
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

insert into t_ctx values ('biz_a', gen_random_uuid()), ('biz_b', gen_random_uuid()),
  ('c1', gen_random_uuid()), ('c2', gen_random_uuid()), ('cb', gen_random_uuid()),
  ('e1', gen_random_uuid()), ('e2', gen_random_uuid()), ('e3', gen_random_uuid()),
  ('x1', gen_random_uuid()), ('x2', gen_random_uuid());

set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-1111-1111-111111111111';
select create_business_v1(pg_temp.oid('biz_a'), 'Tạp hóa Cô Ba', '0388888801', 'HCM');
insert into business_members (business_id, user_id, role)
values (pg_temp.oid('biz_a'), 'd2222222-2222-2222-2222-222222222222', 'CASHIER');
set local request.jwt.claim.sub = 'd3333333-3333-3333-3333-333333333333';
select create_business_v1(pg_temp.oid('biz_b'), 'Quán B', '0388888802', 'HN');

-- ---------- 1. Sổ nợ ----------
set local request.jwt.claim.sub = 'd2222222-2222-2222-2222-222222222222';
select pg_temp.expect_code(
  $q$ select add_debt_customer_v1(pg_temp.oid('c1'), pg_temp.oid('biz_a'), 'Chị Hoa', '0903 111 222', false) $q$,
  'QP_CONSENT_REQUIRED', 'Có số điện thoại mà khách chưa đồng ý lưu');
select pg_temp.ok(
  (select (add_debt_customer_v1(pg_temp.oid('c1'), pg_temp.oid('biz_a'), ' Chị Hoa ', '0903 111 222', true)).phone = '0903111222'),
  'Thu ngân thêm khách nợ, số điện thoại bỏ khoảng trắng');
select pg_temp.ok((select consent_at is not null and consent_source = 'app_so_no' from debt_customers where id = pg_temp.oid('c1')),
  'Lưu thời điểm và nguồn đồng ý');
select pg_temp.ok((select (add_debt_customer_v1(pg_temp.oid('c1'), pg_temp.oid('biz_a'), 'Tên khác')).name = 'Chị Hoa'),
  'Gửi lại cùng mã khách trả bản cũ');
select add_debt_customer_v1(pg_temp.oid('c2'), pg_temp.oid('biz_a'), 'Anh Tư xe ôm');
select pg_temp.expect_code(
  $q$ select add_debt_customer_v1(gen_random_uuid(), pg_temp.oid('biz_a'), 'X', '12345', true) $q$,
  'QP_INVALID_INPUT', 'Số điện thoại sai');
select pg_temp.expect_code(
  $q$ select add_debt_customer_v1(gen_random_uuid(), pg_temp.oid('biz_b'), 'X') $q$,
  'QP_FORBIDDEN', 'Không thêm khách vào quán khác');

select record_debt_v1(pg_temp.oid('e1'), pg_temp.oid('c1'), 'DEBT', 150000, 'Gạo, nước mắm');
select record_debt_v1(pg_temp.oid('e1'), pg_temp.oid('c1'), 'DEBT', 150000, 'Gạo, nước mắm');  -- gửi lại
select record_debt_v1(pg_temp.oid('e2'), pg_temp.oid('c1'), 'DEBT', 50000, null);
select pg_temp.ok((select balance = 200000 from debt_balances where customer_id = pg_temp.oid('c1')),
  'Ghi nợ 2 lần (một lần gửi lại) → nợ 200.000');
select pg_temp.expect_code(
  $q$ select record_debt_v1(gen_random_uuid(), pg_temp.oid('c1'), 'PAYMENT', 250000) $q$,
  'QP_PAYMENT_EXCEEDS_DEBT', 'Trả nhiều hơn số nợ');
select record_debt_v1(pg_temp.oid('e3'), pg_temp.oid('c1'), 'PAYMENT', 120000, 'Trả bớt');
select pg_temp.ok((select balance = 80000 from debt_balances where customer_id = pg_temp.oid('c1')), 'Trả 120.000 → còn 80.000');
select pg_temp.ok((select balance = 0 from debt_balances where customer_id = pg_temp.oid('c2')), 'Khách chưa nợ → 0');
select pg_temp.expect_code(
  $q$ select record_debt_v1(gen_random_uuid(), pg_temp.oid('c1'), 'DEBT', 0) $q$,
  'QP_INVALID_INPUT', 'Số tiền 0');
select pg_temp.expect_code(
  $q$ select void_debt_entry_v1(pg_temp.oid('e2')) $q$,
  'QP_FORBIDDEN', 'Thu ngân không hủy được dòng nợ');
select pg_temp.expect_code(
  $q$ insert into debt_entries (id, business_id, customer_id, kind, amount) values (gen_random_uuid(), pg_temp.oid('biz_a'), pg_temp.oid('c1'), 'PAYMENT', 80000) $q$,
  'permission denied for table debt_entries', 'App không ghi thẳng vào bảng nợ');

set local request.jwt.claim.sub = 'd1111111-1111-1111-1111-111111111111';
select void_debt_entry_v1(pg_temp.oid('e2'));
select pg_temp.ok((select balance = 30000 from debt_balances where customer_id = pg_temp.oid('c1')),
  'Chủ hủy dòng nợ 50.000 ghi nhầm → còn 30.000, dòng vẫn lưu');
select pg_temp.ok((select count(*) = 3 from debt_entries where customer_id = pg_temp.oid('c1')), 'Không xóa dòng nào');

set local request.jwt.claim.sub = 'd3333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) = 0 from debt_balances where business_id = pg_temp.oid('biz_a')), 'Quán khác không thấy sổ nợ');
select pg_temp.expect_code(
  $q$ select record_debt_v1(gen_random_uuid(), pg_temp.oid('c1'), 'DEBT', 1000) $q$,
  'QP_NOT_FOUND', 'Không ghi nợ vào khách của quán khác');

-- ---------- 2. Chi tiêu ----------
set local request.jwt.claim.sub = 'd2222222-2222-2222-2222-222222222222';
select add_expense_v1(pg_temp.oid('x1'), pg_temp.oid('biz_a'), 300000, 'Nhập hàng', 'Bia, nước ngọt');
select add_expense_v1(pg_temp.oid('x1'), pg_temp.oid('biz_a'), 300000, 'Nhập hàng', 'Bia, nước ngọt');
select add_expense_v1(pg_temp.oid('x2'), pg_temp.oid('biz_a'), 45000, 'Khác', 'Đá', current_date - 1);
select pg_temp.ok(
  (select count(*) = 2 and sum(amount) = 345000 from journal_entries where business_id = pg_temp.oid('biz_a') and entry_type = 'EXPENSE'),
  'Thu ngân ghi 2 khoản chi (một lần gửi lại)');
select pg_temp.expect_code(
  $q$ select add_expense_v1(gen_random_uuid(), pg_temp.oid('biz_a'), 1000, 'Khác', null, current_date + 3) $q$,
  'QP_INVALID_INPUT', 'Ngày chi ở tương lai');
select pg_temp.expect_code(
  $q$ select add_expense_v1(gen_random_uuid(), pg_temp.oid('biz_a'), 1000, '  ') $q$,
  'QP_INVALID_INPUT', 'Thiếu loại chi');
select pg_temp.expect_code(
  $q$ select void_expense_v1(pg_temp.oid('biz_a'), pg_temp.oid('x2')) $q$,
  'QP_FORBIDDEN', 'Thu ngân không hủy được khoản chi');

set local request.jwt.claim.sub = 'd1111111-1111-1111-1111-111111111111';
select void_expense_v1(pg_temp.oid('biz_a'), pg_temp.oid('x2'));
select pg_temp.ok(
  (select sum(amount) = 300000 from journal_entries where business_id = pg_temp.oid('biz_a') and entry_type = 'EXPENSE' and voided_at is null),
  'Chủ hủy khoản chi nhập nhầm, tổng chi còn 300.000');
-- Doanh thu từ đơn không hủy được bằng cột voided_at
select create_cash_sale_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[{"name":"Bán hàng","quantity":1,"unit_price":20000}]'::jsonb);
reset role;
select pg_temp.expect_code(
  $q$ update journal_entries set voided_at = now() where business_id = pg_temp.oid('biz_a') and source = 'ORDER' $q$,
  'QP_FORBIDDEN', 'Không hủy được doanh thu từ đơn (kể cả quyền cao)');
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-1111-1111-111111111111';

-- ---------- 3. Ngành nghề tính thuế ----------
select pg_temp.ok((select tax_industry = 'GOODS' from businesses where id = pg_temp.oid('biz_a')), 'Mặc định: phân phối hàng hóa');
select pg_temp.ok((select (update_tax_settings_v1(pg_temp.oid('biz_a'), 'PRODUCTION')).tax_industry = 'PRODUCTION'),
  'Chủ đổi sang ăn uống / sản xuất');
select pg_temp.expect_code(
  $q$ select update_tax_settings_v1(pg_temp.oid('biz_a'), 'ABC') $q$, 'QP_INVALID_INPUT', 'Ngành nghề không hợp lệ');
set local request.jwt.claim.sub = 'd2222222-2222-2222-2222-222222222222';
select pg_temp.expect_code(
  $q$ select update_tax_settings_v1(pg_temp.oid('biz_a'), 'GOODS') $q$, 'QP_FORBIDDEN', 'Thu ngân không đổi ngành nghề');

rollback;
