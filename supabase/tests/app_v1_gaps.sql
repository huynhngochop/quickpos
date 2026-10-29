-- Kiểm thử migration 20261029000005_app_v1_gaps.sql
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/app_v1_gaps.sql
-- Chạy trong một transaction và ROLLBACK ở cuối.

begin;

insert into auth.users (id, email) values
 ('a1111111-1111-1111-1111-111111111111','g_owner_a@test'),
 ('a2222222-2222-2222-2222-222222222222','g_cashier_a@test'),
 ('a3333333-3333-3333-3333-333333333333','g_owner_b@test')
on conflict (id) do nothing;

create temp table t_ctx (k text primary key, v uuid);
grant all on t_ctx to authenticated, service_role;

create or replace function pg_temp.oid(p_k text) returns uuid language sql as $$
  select v from t_ctx where k = p_k $$;

create or replace function pg_temp.ok(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

-- Lỗi phải đúng mã QP_* (app tra mã → câu tiếng Việt)
create or replace function pg_temp.expect_code(p_sql text, p_code text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — lẽ ra phải báo %', p_label, p_code;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm <> p_code then raise exception 'FAIL: % — báo "%" thay vì %', p_label, sqlerrm, p_code; end if;
  raise notice 'PASS: % (%)', p_label, p_code;
end $$;

create or replace function pg_temp.mk(p_k text, p_biz text, p_price bigint)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform public.create_order_v1(v, pg_temp.oid(p_biz),
    jsonb_build_array(jsonb_build_object('name', 'Bán hàng', 'quantity', 1, 'unit_price', p_price)));
  insert into t_ctx values (p_k, v);
  return v;
end $$;

insert into t_ctx values ('biz_a', gen_random_uuid()), ('biz_b', gen_random_uuid());

-- ---------- 1. Tạo hộ ----------
set local role authenticated;
set local request.jwt.claim.sub = '';
select pg_temp.expect_code(
  $q$ select create_business_v1(gen_random_uuid(), 'X', '0300000001', 'HCM') $q$,
  'QP_UNAUTHENTICATED', 'Chưa đăng nhập không tạo được hộ');

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select create_business_v1(pg_temp.oid('biz_a'), '  Quán Cô Ba  ', '0399999901', 'Q.3, TP.HCM');
select pg_temp.ok(
  (select business_name = 'Quán Cô Ba' from businesses where id = pg_temp.oid('biz_a'))
  and (select role = 'OWNER' from business_members where business_id = pg_temp.oid('biz_a')
         and user_id = 'a1111111-1111-1111-1111-111111111111'),
  'Tạo hộ: cắt khoảng trắng, người tạo thành chủ hộ');
select pg_temp.ok(
  (select (create_business_v1(pg_temp.oid('biz_a'), 'Tên khác', '0399999901', 'HCM')).business_name = 'Quán Cô Ba'),
  'Gửi lại cùng mã hộ trả bản đã tạo, không tạo thêm');
select pg_temp.ok((select count(*) = 1 from businesses where tax_code = '0399999901'), 'Chỉ có một hộ sau khi gửi lại');
select pg_temp.expect_code(
  $q$ select create_business_v1(gen_random_uuid(), 'Quán khác', '0399999901', 'HCM') $q$,
  'QP_TAX_CODE_TAKEN', 'Mã số thuế đã có hộ khác dùng');
select pg_temp.expect_code(
  $q$ select create_business_v1(gen_random_uuid(), 'Quán', '12345', 'HCM') $q$,
  'QP_INVALID_INPUT', 'Mã số thuế sai định dạng');
select pg_temp.expect_code(
  $q$ select create_business_v1(gen_random_uuid(), '   ', '0399999902', 'HCM') $q$,
  'QP_INVALID_INPUT', 'Tên quán trống');

set local request.jwt.claim.sub = 'a3333333-3333-3333-3333-333333333333';
select pg_temp.expect_code(
  $q$ select create_business_v1(pg_temp.oid('biz_a'), 'Chiếm', '0399999903', 'HCM') $q$,
  'QP_FORBIDDEN', 'Người khác gửi trùng mã hộ không chiếm được hộ');
select create_business_v1(pg_temp.oid('biz_b'), 'Quán B', '0399999904', 'Hà Nội');

-- Chủ A thêm thu ngân
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
insert into business_members (business_id, user_id, role)
values (pg_temp.oid('biz_a'), 'a2222222-2222-2222-2222-222222222222', 'CASHIER');

-- ---------- 2. Xác nhận tay ----------
set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
select pg_temp.mk('o1', 'biz_a', 18000);
select pg_temp.mk('o2', 'biz_a', 25000);
select pg_temp.mk('o3', 'biz_a', 30000);
select pg_temp.ok(
  (select (confirm_transfer_manually_v1(pg_temp.oid('o1'), 'Khách cho xem màn hình')).payment_status = 'PAID'),
  'Thu ngân xác nhận tay → đơn đã trả');
select pg_temp.ok(
  (select (confirm_transfer_manually_v1(pg_temp.oid('o1'), null)).manual_note = 'Khách cho xem màn hình'),
  'Bấm lần 2 không đổi gì');
select pg_temp.expect_code(
  $q$ select update_business_settings_v1(pg_temp.oid('biz_a'), false) $q$,
  'QP_FORBIDDEN', 'Thu ngân không đổi được cài đặt của quán');

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select update_business_settings_v1(pg_temp.oid('biz_a'), false);
select cancel_order_v1(pg_temp.oid('o3'));

set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
select pg_temp.expect_code(
  $q$ select confirm_transfer_manually_v1(pg_temp.oid('o2'), null) $q$,
  'QP_FORBIDDEN', 'Chủ quán tắt quyền → thu ngân không xác nhận tay được');

set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select pg_temp.expect_code(
  $q$ select confirm_transfer_manually_v1(pg_temp.oid('o3'), null) $q$,
  'QP_ORDER_NOT_CONFIRMABLE', 'Đơn đã hủy không xác nhận được');
select pg_temp.expect_code(
  $q$ select confirm_transfer_manually_v1(gen_random_uuid(), null) $q$,
  'QP_NOT_FOUND', 'Đơn không tồn tại');

set local request.jwt.claim.sub = 'a3333333-3333-3333-3333-333333333333';
select pg_temp.expect_code(
  $q$ select confirm_transfer_manually_v1(pg_temp.oid('o2'), null) $q$,
  'QP_NOT_FOUND', 'Chủ hộ B không xác nhận được đơn hộ A (và không biết đơn có tồn tại)');
select pg_temp.mk('ob', 'biz_b', 25000);

-- ---------- 3. Gán tiền chưa rõ đơn ----------
reset role;
insert into payment_accounts (business_id, provider, bank_bin, account_no, kind)
values (pg_temp.oid('biz_a'), 'SEPAY', '970422', '0903999001', 'MAIN');
set local role service_role;
insert into t_ctx
select 'ev1', event_id from confirm_payment('SEPAY', 'gap-1', 25000, 'chuyen tien', '970422', '0903999001', '{}'::jsonb);
reset role;
select pg_temp.ok((select match_status = 'UNMATCHED' from payment_events where id = pg_temp.oid('ev1')),
  'Nội dung không có mã đơn → tiền chưa rõ đơn');

set local role authenticated;
set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';
select pg_temp.expect_code(
  $q$ select assign_payment_event_v1(pg_temp.oid('ev1'), pg_temp.oid('o2')) $q$,
  'QP_FORBIDDEN', 'Thu ngân không gán tiền');
set local request.jwt.claim.sub = 'a3333333-3333-3333-3333-333333333333';
select pg_temp.expect_code(
  $q$ select assign_payment_event_v1(pg_temp.oid('ev1'), pg_temp.oid('ob')) $q$,
  'QP_NOT_FOUND', 'Hộ B không gán được tiền của hộ A');
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select pg_temp.expect_code(
  $q$ select assign_payment_event_v1(pg_temp.oid('ev1'), pg_temp.oid('ob')) $q$,
  'QP_NOT_FOUND', 'Không gán tiền hộ A vào đơn hộ B');
select pg_temp.ok((select assign_payment_event_v1(pg_temp.oid('ev1'), pg_temp.oid('o2')) = 'MATCHED'),
  'Chủ hộ gán đúng đơn → khớp');
select pg_temp.ok((select payment_status = 'PAID' from orders where id = pg_temp.oid('o2')), 'Đơn được gán đã trả');
select pg_temp.expect_code(
  $q$ select assign_payment_event_v1(pg_temp.oid('ev1'), pg_temp.oid('o2')) $q$,
  'QP_ALREADY_ASSIGNED', 'Gán lần 2 báo đã gán');

-- ---------- 4. Xóa người dùng vẫn giữ chứng từ ----------
reset role;
delete from auth.users where id = 'a2222222-2222-2222-2222-222222222222';
select pg_temp.ok(
  (select count(*) = 3 and bool_and(created_by is null) from orders where business_id = pg_temp.oid('biz_a'))
  and (select manual_confirmed_by is null and manual_confirmed_at is not null from orders where id = pg_temp.oid('o1')),
  'Xóa thu ngân: đơn vẫn còn, chỉ bỏ liên kết người tạo/người bấm');
select pg_temp.ok((select count(*) from check_daily_sales(current_date - 1, current_date + 1)) = 0,
  'Sổ tổng hợp ngày không đổi sau khi xóa người dùng');
select pg_temp.ok(
  (select count(*) = 0 from business_members where user_id = 'a2222222-2222-2222-2222-222222222222'),
  'Thu ngân bị xóa khỏi danh sách nhân viên');
do $$
begin
  delete from auth.users where id = 'a1111111-1111-1111-1111-111111111111';
  raise exception 'FAIL: Xóa chủ hộ lẽ ra phải bị chặn';
exception when foreign_key_violation then
  raise notice 'PASS: Không xóa được chủ hộ khi quán còn (phải giao quán trước)';
end $$;

rollback;
