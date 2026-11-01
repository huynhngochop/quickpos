-- Kiểm thử RLS, đối soát thanh toán và đánh số hóa đơn.
-- Chạy trên DB local (supabase start) bằng psql với quyền postgres:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_numbering.sql
-- Toàn bộ chạy trong một transaction và ROLLBACK ở cuối, không để lại dữ liệu.
-- Cần 3 user trong auth.users (script tự tạo nếu chưa có).

begin;

insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111','owner_a@test'),
 ('22222222-2222-2222-2222-222222222222','cashier_a@test'),
 ('33333333-3333-3333-3333-333333333333','owner_b@test')
on conflict (id) do nothing;

create temp table t_ctx (k text primary key, v uuid);
grant all on t_ctx to authenticated, service_role;

create or replace function pg_temp.oid(p_k text) returns uuid language sql as $$
  select v from t_ctx where k = p_k $$;
create or replace function pg_temp.code(p_k text) returns text language sql as $$
  select order_code from public.orders where id = (select v from t_ctx where k = p_k) $$;

create or replace function pg_temp.mk(p_k text, p_biz text, p_name text, p_qty numeric, p_price bigint)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform public.create_order_v1(v, (select t.v from t_ctx t where t.k = p_biz),
    jsonb_build_array(jsonb_build_object('name', p_name, 'quantity', p_qty, 'unit_price', p_price)));
  insert into t_ctx values (p_k, v);
  return v;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — lẽ ra phải bị chặn', p_label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: % (bị chặn: %)', p_label, sqlerrm;
end $$;

create or replace function pg_temp.ok(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_cond then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

-- ---------- Chủ hộ A tạo hộ, thêm thu ngân ----------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into businesses (owner_id, business_name, tax_code, address, revenue_group)
values ('11111111-1111-1111-1111-111111111111', 'Tạp hóa Cô Ba', '0312345678', 'Q.3, TP.HCM', 'OVER_1B');
insert into t_ctx select 'biz_a', id from businesses where tax_code = '0312345678';

insert into business_members (business_id, user_id, role)
select v, '22222222-2222-2222-2222-222222222222', 'CASHIER' from t_ctx where k = 'biz_a';

select pg_temp.expect_error(
  $q$ insert into business_members (business_id, user_id, role)
      select v, '33333333-3333-3333-3333-333333333333', 'OWNER' from t_ctx where k='biz_a' $q$,
  'Không ai được thêm thành viên vai trò OWNER');

-- Từ migration 7 hàng hóa ghi qua hàm upsert_product_v1
select upsert_product_v1(gen_random_uuid(), v, 'Nước suối 500ml', 6000, 'chai') from t_ctx where k = 'biz_a';

-- ---------- Chủ hộ B không thấy dữ liệu hộ A ----------
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into businesses (owner_id, business_name, tax_code, address)
values ('33333333-3333-3333-3333-333333333333', 'Quán Chú Tư', '0398765432', 'Thủ Đức');
select pg_temp.ok((select count(*) from businesses) = 1, 'Hộ B chỉ thấy 1 hộ của mình');
select pg_temp.ok((select count(*) from products) = 0, 'Hộ B không thấy sản phẩm của hộ A');
select pg_temp.expect_error(
  $q$ insert into products (business_id, name, price) select v, 'Hack', 1 from t_ctx where k='biz_a' $q$,
  'Hộ B không ghi được vào hộ A');
select pg_temp.expect_error(
  $q$ insert into businesses (owner_id, business_name, tax_code, address)
      values ('11111111-1111-1111-1111-111111111111','Giả mạo','0300000001','x') $q$,
  'Không tạo hộ đứng tên người khác');

-- ---------- Thu ngân A tạo đơn ----------
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect_error(
  $q$ insert into orders (business_id, payment_status, total_amount) select v, 'PAID', 999999 from t_ctx where k = 'biz_a' $q$,
  'Client không ghi thẳng vào bảng orders, chỉ qua create_order_v1');
select pg_temp.mk('order1', 'biz_a', 'Nước suối 500ml', 3, 6000);
select pg_temp.ok((select payment_status = 'UNPAID' and created_by = '22222222-2222-2222-2222-222222222222' from orders where id = pg_temp.oid('order1')),
  'create_order_v1: đơn chưa trả, đúng người tạo');
select pg_temp.ok((select order_code !~ '[01OIL]' and length(order_code) = 8 from orders where id = pg_temp.oid('order1')),
  'Mã đơn 8 ký tự, không có ký tự dễ nhầm 0/O/1/I/L');
select pg_temp.ok((select total_amount = 18000 from orders where id = pg_temp.oid('order1')), 'Tổng đơn tự tính = 18.000đ');
-- Mạng chập chờn: app gửi lại cùng mã đơn
select create_order_v1(pg_temp.oid('order1'), pg_temp.oid('biz_a'), '[{"name":"Nước suối 500ml","quantity":3,"unit_price":6000}]');
select pg_temp.ok((select count(*) from order_items where order_id = pg_temp.oid('order1')) = 1,
  'Gửi lại cùng mã đơn không tạo dòng hàng trùng');
select pg_temp.ok((select total_amount = 18000 from orders where id = pg_temp.oid('order1')),
  'Gửi lại không nhân đôi tổng tiền');
select pg_temp.expect_error(
  $q$ insert into order_items (order_id, name, quantity, unit_price) values (pg_temp.oid('order1'), 'Thêm', 1, 1000) $q$,
  'Client không ghi thẳng dòng hàng');
select pg_temp.expect_error(
  $q$ select create_order_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[{"name":"","quantity":1,"unit_price":1000}]') $q$,
  'Dòng hàng không có tên bị từ chối');
select pg_temp.expect_error(
  $q$ select create_order_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[{"name":"X","quantity":-1,"unit_price":1000}]') $q$,
  'Số lượng âm bị từ chối');
select pg_temp.expect_error(
  $q$ select create_order_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[]') $q$,
  'Đơn không có dòng hàng bị từ chối');
select pg_temp.expect_error(
  $q$ select create_order_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[{"name":"X","quantity":1,"unit_price":0}]') $q$,
  'Đơn chuyển khoản 0 đ bị từ chối');

select pg_temp.expect_error(
  $q$ update orders set payment_status = 'PAID' where id = pg_temp.oid('order1') $q$, 'Thu ngân không tự đặt PAID');
select pg_temp.expect_error(
  $q$ update orders set amount_received = 18000 where id = pg_temp.oid('order1') $q$, 'Thu ngân không tự sửa tiền đã nhận');
select pg_temp.expect_error(
  $q$ select confirm_payment('SEPAY','x',1,'x','970436','1111','{}') $q$,
  'Client không gọi được confirm_payment');
select pg_temp.expect_error(
  $q$ select apply_payment_to_order(gen_random_uuid(), gen_random_uuid()) $q$,
  'Client không gọi được hàm lõi apply_payment_to_order');
delete from orders;   -- không có policy DELETE nên xóa 0 dòng
select pg_temp.ok((select count(*) from orders where id = pg_temp.oid('order1')) = 1, 'Không xóa được đơn (không có policy DELETE)');

-- Hộ B cũng có một đơn 18.000đ
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into t_ctx select 'biz_b', id from businesses where tax_code = '0398765432';
select pg_temp.mk('order_b', 'biz_b', 'Cà phê', 1, 18000);
select pg_temp.expect_error(
  $q$ select create_order_v1(gen_random_uuid(), pg_temp.oid('biz_a'), '[{"name":"X","quantity":1,"unit_price":1000}]') $q$,
  'Hộ B không tạo đơn trong hộ A');
select pg_temp.expect_error(
  $q$ select create_order_v1(pg_temp.oid('order1'), pg_temp.oid('biz_b'), '[{"name":"X","quantity":1,"unit_price":1000}]') $q$,
  'Dùng lại mã đơn của hộ khác bị từ chối');

-- Tài khoản nhận tiền do server ghi (sau khi cổng thanh toán xác minh)
reset role;
insert into payment_accounts (business_id, provider, bank_bin, account_no, kind) values
  (pg_temp.oid('biz_a'), 'SEPAY', '970436', '1111', 'MAIN'),
  (pg_temp.oid('biz_b'), 'SEPAY', '970422', '2222', 'MAIN');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect_error(
  $q$ insert into payment_accounts (business_id, provider, bank_bin, account_no, kind)
      values (pg_temp.oid('biz_a'), 'SEPAY', '970422', '9999', 'MAIN') $q$,
  'Client không tự khai tài khoản nhận tiền');

-- ---------- Webhook (service_role) ----------
reset role;
set local role service_role;

select pg_temp.ok((select match_status = 'UNKNOWN_ACCOUNT' and order_id is null
                     from confirm_payment('SEPAY','TXN-000',18000, pg_temp.code('order1'),'970436','0000','{}')),
  'Tiền vào tài khoản lạ → UNKNOWN_ACCOUNT, không chạm đơn nào');

select pg_temp.ok((select match_status = 'UNMATCHED' from
                     confirm_payment('SEPAY','TXN-X',18000,'CK ' || pg_temp.code('order_b'),'970436','1111','{}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select payment_status = 'UNPAID' from orders where id = pg_temp.oid('order_b')),
  'Tiền vào tài khoản hộ A mang mã đơn hộ B → KHÔNG xác nhận đơn hộ B');

select pg_temp.ok((select match_status = 'PARTIAL' from
                     confirm_payment('SEPAY','TXN-001',10000,'CK ' || pg_temp.code('order1') || ' thanh toan','970436','1111','{"id":1}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select payment_status = 'UNPAID' and amount_received = 10000 from orders where id = pg_temp.oid('order1')),
  'Chuyển thiếu → PARTIAL, đơn vẫn chờ, đã ghi nhận 10.000đ');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect_error(
  $q$ select cancel_order_v1(pg_temp.oid('order1')) $q$,
  'Không hủy được đơn đã nhận một phần tiền');
select pg_temp.expect_error(
  $q$ update order_items set quantity = 1 where order_id = pg_temp.oid('order1') $q$,
  'Client không sửa thẳng dòng hàng');
select pg_temp.ok((select quantity = 3 from order_items where order_id = pg_temp.oid('order1')),
  'Không sửa dòng hàng khi đơn đã nhận một phần tiền');

reset role;
set local role service_role;
select pg_temp.ok((select match_status = 'MATCHED' from
                     confirm_payment('SEPAY','TXN-002',8000,'MBVCB.123.' || lower(pg_temp.code('order1')) || '.CT tu','970436','1111','{"id":2}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select payment_status = 'PAID' and amount_received = 18000 from orders where id = pg_temp.oid('order1')),
  'Chuyển thêm phần thiếu → đủ 18.000đ, đơn PAID (khớp cả chữ thường, có tiền tố ngân hàng)');

select pg_temp.ok((select match_status = 'MATCHED' from confirm_payment('SEPAY','TXN-002',8000,'retry','970436','1111','{"id":2}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select count(*) from payment_events where provider_txn_id = 'TXN-002') = 1,
  'Webhook gửi lại không tạo bản ghi trùng');
select pg_temp.ok((select count(*) from journal_entries where source_id = pg_temp.oid('order1')) = 1,
  'Doanh thu tự ghi sổ đúng 1 lần');

select pg_temp.ok((select match_status = 'ALREADY_PAID' from
                     confirm_payment('SEPAY','TXN-003',18000, pg_temp.code('order1'),'970436','1111','{}')),
  'Khách trả lần 2 cho đơn đã PAID → ALREADY_PAID để chủ hộ hoàn tiền');

-- Chuyển dư "khỏi thối"
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.mk('order2', 'biz_a', 'Bánh mì', 1, 25000);
reset role;
set local role service_role;
select pg_temp.ok((select match_status = 'OVERPAID' from
                     confirm_payment('SEPAY','TXN-004',30000, pg_temp.code('order2'),'970436','1111','{}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select payment_status = 'PAID' and overpaid_amount = 5000 from orders where id = pg_temp.oid('order2')),
  'Chuyển dư → OVERPAID, đơn PAID, ghi tiền thừa 5.000đ');

-- Webhook chậm: thu ngân xác nhận tay, tiền về sau
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.mk('order3', 'biz_a', 'Trà đá', 6, 3000);
select confirm_transfer_manually(pg_temp.oid('order3'), 'Khách đưa màn hình chuyển khoản');
select confirm_transfer_manually(pg_temp.oid('order3'));   -- bấm hai lần không lỗi
select pg_temp.ok((select payment_status = 'PAID' and manual_confirmed_by = '22222222-2222-2222-2222-222222222222'
                     from orders where id = pg_temp.oid('order3')),
  'Xác nhận tay: đơn PAID, ghi lại người bấm');

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect_error(
  $q$ select confirm_transfer_manually(pg_temp.oid('order1')) $q$,
  'Hộ B không xác nhận tay được đơn hộ A');

reset role;
update orders set manual_confirmed_at = now() - interval '20 minutes' where id = pg_temp.oid('order3');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok((select count(*) from unreconciled_manual_confirmations) = 1,
  'Chủ hộ thấy đơn xác nhận tay quá 15 phút chưa có tiền về');
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from unreconciled_manual_confirmations) = 0,
  'Hộ B không thấy danh sách đối soát của hộ A');

reset role;
set local role service_role;
select pg_temp.ok((select match_status = 'LATE_CONFIRMED' from
                     confirm_payment('SEPAY','TXN-005',18000, pg_temp.code('order3'),'970436','1111','{}')), 'Webhook trả đúng trạng thái giao dịch');
select pg_temp.ok((select count(*) from journal_entries where source_id = pg_temp.oid('order3')) = 1,
  'Tiền về sau xác nhận tay → LATE_CONFIRMED, không ghi sổ lần 2');
select pg_temp.ok((select count(*) from unreconciled_manual_confirmations) = 0,
  'Đơn đã đối soát biến khỏi danh sách cần kiểm tra');

-- Tài khoản ảo theo đơn: khớp không cần nội dung chuyển khoản
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.mk('order4', 'biz_a', 'Phở', 1, 45000);
reset role;
insert into payment_accounts (business_id, provider, bank_bin, account_no, kind, order_id)
values (pg_temp.oid('biz_a'), 'SEPAY', '970436', 'VA0004', 'ORDER_VA', pg_temp.oid('order4'));
set local role service_role;
select pg_temp.ok((select match_status = 'MATCHED' from
                     confirm_payment('SEPAY','TXN-006',45000, null,'970436','VA0004','{}')),
  'Tài khoản ảo theo đơn: khách xóa nội dung chuyển khoản vẫn khớp đúng đơn');

-- Tiền chưa rõ đơn: chủ hộ gán tay
select pg_temp.ok((select match_status = 'UNMATCHED' from
                     confirm_payment('SEPAY','TXN-007',18000,'chuyen tien','970436','1111','{}')),
  'Nội dung không có mã đơn → UNMATCHED, nằm trong mục tiền chưa rõ đơn của hộ A');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.mk('order5', 'biz_a', 'Cơm', 1, 18000);
select pg_temp.expect_error(
  $q$ select assign_payment_event((select id from payment_events where provider_txn_id = 'TXN-007'), pg_temp.oid('order5')) $q$,
  'Thu ngân không gán tay được giao dịch');
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok(assign_payment_event((select id from payment_events where provider_txn_id = 'TXN-007'), pg_temp.oid('order5')) = 'MATCHED',
  'Gán tay trả về MATCHED');
select pg_temp.ok((select payment_status = 'PAID' from orders where id = pg_temp.oid('order5')),
  'Chủ hộ gán tay giao dịch chưa rõ đơn → đơn PAID');
select pg_temp.expect_error(
  $q$ select assign_payment_event((select id from payment_events where provider_txn_id = 'TXN-007'), pg_temp.oid('order1')) $q$,
  'Không gán một giao dịch hai lần');

-- Bán tiền mặt lúc mất mạng: client tự sinh id, đồng bộ hôm sau
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_cash_sale_v1('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.oid('biz_a'),
  '[{"name":"Nước ngọt","quantity":2,"unit_price":10000}]', now() - interval '1 day', 'device-lan-01');
select create_cash_sale_v1('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.oid('biz_a'),
  '[{"name":"Nước ngọt","quantity":2,"unit_price":10000}]', now() - interval '1 day', 'device-lan-01');   -- đồng bộ lại không lỗi
select pg_temp.ok((select entry_date = ((now() - interval '1 day') at time zone 'Asia/Ho_Chi_Minh')::date and amount = 20000
                     from journal_entries where source_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Đơn tiền mặt bán lúc mất mạng ghi sổ đúng ngày bán');
select pg_temp.ok((select count(*) from order_items where order_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1
                  and (select created_device_id = 'device-lan-01' from orders where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Đồng bộ lại đơn tiền mặt không tạo dòng trùng; ghi máy tạo đơn');
select create_cash_sale_v1('aaaaaaaa-0000-0000-0000-000000000002', pg_temp.oid('biz_a'),
  '[{"name":"Bánh","quantity":1,"unit_price":5000}]', now() - interval '10 days');
select pg_temp.ok((select clock_suspect and client_sold_at < now() - interval '9 days'
                          and sold_at > now() - interval '1 minute' and payment_status = 'PAID'
                     from orders where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'Giờ máy sai: đơn vẫn được ghi (không mất doanh thu), đánh dấu và dùng giờ server');
select pg_temp.expect_error(
  $q$ select create_cash_sale_v1(pg_temp.oid('order1'), pg_temp.oid('biz_a'), '[{"name":"X","quantity":1,"unit_price":1}]') $q$,
  'Không dùng mã của đơn chuyển khoản để bán tiền mặt');
select pg_temp.mk('order6', 'biz_a', 'Kẹo', 1, 2000);
select cancel_order_v1(pg_temp.oid('order6'));
select cancel_order_v1(pg_temp.oid('order6'));   -- bấm hai lần
select pg_temp.ok((select payment_status = 'CANCELLED' from orders where id = pg_temp.oid('order6')),
  'Hủy đơn chưa trả tiền; gọi lại không lỗi');

-- ---------- Thiết bị, phiên bản app, đồng ý dữ liệu, xóa tài khoản ----------
select register_device_v1('device-lan-01', pg_temp.oid('biz_a'), 'android', '1.0.0', 'ExponentPushToken[abc]');
select register_device_v1('device-lan-01', pg_temp.oid('biz_a'), 'android', '1.0.1');
select pg_temp.ok((select count(*) from device_registrations) = 1
                  and (select push_token = 'ExponentPushToken[abc]' and app_version = '1.0.1' from device_registrations),
  'Đăng ký lại thiết bị: cập nhật phiên bản, giữ mã thông báo cũ');
select pg_temp.expect_error(
  $q$ select register_device_v1('device-x-0001', pg_temp.oid('biz_b'), 'android', '1.0.0') $q$,
  'Không đăng ký máy vào hộ không phải của mình');
select record_consent_v1('2026-10');
select record_consent_v1('2026-10');
select pg_temp.ok((select count(*) from user_consents) = 1, 'Ghi nhận đồng ý xử lý dữ liệu một lần cho mỗi phiên bản chính sách');
select request_account_deletion_v1('Không dùng nữa');
select request_account_deletion_v1();
select pg_temp.ok((select count(*) = 1 and bool_and(status = 'REQUESTED') from account_deletion_requests),
  'Yêu cầu xóa tài khoản ghi một lần, gọi lại không lỗi');
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from device_registrations) = 0 and (select count(*) from user_consents) = 0
                  and (select count(*) from account_deletion_requests) = 0,
  'Người khác không thấy thiết bị, đồng ý, yêu cầu xóa của thu ngân A');
reset role;
update app_config set min_version = '1.2.0', latest_version = '1.3.0' where platform = 'android';
set local role anon;
select pg_temp.ok((check_app_version_v1('android', '1.1.9') ->> 'must_update')::boolean,
  'App cũ hơn phiên bản tối thiểu: bắt cập nhật (gọi được khi chưa đăng nhập)');
select pg_temp.ok(not (check_app_version_v1('android', '1.2.0') ->> 'must_update')::boolean
                  and (check_app_version_v1('android', '1.2.0') ->> 'should_update')::boolean,
  'Đủ phiên bản tối thiểu: chỉ gợi ý cập nhật');
select pg_temp.ok(not version_lt('1.10.0', '1.9.0'), 'So phiên bản theo số (1.10 mới hơn 1.9)');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Hóa đơn: đánh số ----------
insert into invoices (business_id, form_no, symbol, invoice_no, status, buyer_name)
select v, '2', 'C26MAA', 77, 'ISSUED', 'Khách lẻ' from t_ctx where k = 'biz_a';  -- cố đặt số
select pg_temp.ok((select status = 'DRAFT' and invoice_no is null from invoices),
  'Client tạo hóa đơn bị ép về DRAFT, chưa có số');
insert into t_ctx select 'inv1', id from invoices;

select pg_temp.expect_error(
  $q$ insert into invoice_lines (invoice_id, line_no, name, quantity, unit_price, vat_rate)
      select v, 1, 'Nước suối', 3, 6000, 10 from t_ctx where k='inv1' $q$,
  'Hóa đơn bán hàng (mẫu 2) không nhận thuế suất');
insert into invoice_lines (invoice_id, line_no, name, unit, quantity, unit_price)
select v, 1, 'Nước suối 500ml', 'chai', 3, 6000 from t_ctx where k = 'inv1';

select pg_temp.expect_error(
  $q$ update invoices set status = 'ISSUED', invoice_no = 1 $q$, 'Client không tự phát hành');

select issue_invoice(v) from t_ctx where k = 'inv1';
select pg_temp.ok((select invoice_no = 1 and status = 'ISSUED' and total_amount = 18000
                     and format_invoice_no(invoice_no) = '00000001' from invoices),
  'Phát hành: số 00000001, tổng 18.000đ');

select pg_temp.expect_error(
  $q$ select issue_invoice(v) from t_ctx where k='inv1' $q$, 'Không phát hành lại lần 2');
select pg_temp.expect_error(
  $q$ update invoices set buyer_name = 'Sửa sau' $q$, 'Không sửa hóa đơn đã phát hành');
select pg_temp.expect_error(
  $q$ update invoice_series set last_number = 0 $q$, 'Client không sửa được bộ đếm số');

-- Phát hành thêm 2 hóa đơn → số 2, 3 liên tục
do $$
declare i int; v_id uuid;
begin
  for i in 1..2 loop
    insert into invoices (business_id, form_no, symbol)
    select v, '2', 'C26MAA' from t_ctx where k = 'biz_a' returning id into v_id;
    insert into invoice_lines (invoice_id, line_no, name, quantity, unit_price) values (v_id, 1, 'Hàng', 1, 1000);
    perform issue_invoice(v_id);
  end loop;
end $$;
select pg_temp.ok((select array_agg(invoice_no order by invoice_no) = '{1,2,3}' from invoices),
  'Dãy số liên tục 1, 2, 3');

-- Ký hiệu khác có bộ đếm riêng
do $$
declare v_id uuid;
begin
  insert into invoices (business_id, form_no, symbol)
  select v, '2', 'C26MBB' from t_ctx where k = 'biz_a' returning id into v_id;
  insert into invoice_lines (invoice_id, line_no, name, quantity, unit_price) values (v_id, 1, 'Hàng', 1, 1000);
  perform issue_invoice(v_id);
end $$;
select pg_temp.ok((select invoice_no = 1 from invoices where symbol = 'C26MBB'),
  'Ký hiệu C26MBB bắt đầu lại từ số 1');

-- Sang năm mới: giả lập dãy năm cũ đã dùng tới 500, năm nay vẫn bắt đầu từ 1
reset role;
insert into invoice_series (business_id, form_no, symbol, fiscal_year, last_number)
select v, '2', 'C25MCC', extract(year from now())::int - 1, 500 from t_ctx where k = 'biz_a';
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v_id uuid;
begin
  insert into invoices (business_id, form_no, symbol)
  select v, '2', 'C25MCC' from t_ctx where k = 'biz_a' returning id into v_id;
  insert into invoice_lines (invoice_id, line_no, name, quantity, unit_price) values (v_id, 1, 'Hàng', 1, 1000);
  perform issue_invoice(v_id);
end $$;
select pg_temp.ok((select invoice_no = 1 from invoices where symbol = 'C25MCC'),
  'Năm mới quay vòng về số 1');

-- Hộ B không thấy hóa đơn hộ A
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from invoices) = 0 and (select count(*) from payment_events) = 0,
  'Hộ B không thấy hóa đơn / giao dịch của hộ A');
select pg_temp.expect_error(
  $q$ select issue_invoice((select v from t_ctx where k='inv1')) $q$,
  'Hộ B không phát hành được hóa đơn hộ A');

-- Thu ngân không xem được sổ giao dịch ngân hàng (chỉ OWNER/MANAGER/ACCOUNTANT)
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok((select count(*) from payment_events) = 0, 'Thu ngân không xem payment_events');

-- Storage: chỉ ghi vào thư mục hộ mình
select pg_temp.expect_error(
  $q$ insert into storage.objects (bucket_id, name)
      values ('receipts', '00000000-0000-0000-0000-000000000000/a.jpg') $q$,
  'Không upload chứng từ vào thư mục hộ khác');
insert into storage.objects (bucket_id, name)
select 'receipts', v || '/2026/10/hoadon.jpg' from t_ctx where k = 'biz_a';
select pg_temp.ok(true, 'Upload chứng từ vào thư mục hộ mình');


-- ---------- Hiệu năng: bảng tổng hợp ngày, khớp mã bằng index ----------
reset role;
select pg_temp.ok((select count(*) from check_daily_sales(current_date - 3, current_date + 1)) = 0,
  'Bảng tổng hợp ngày khớp đúng với dữ liệu đơn gốc');
select pg_temp.ok('K7MP3QXA' = any(order_code_candidates('MBVCB.123.k7mp3qxa.CT tu')),
  'Tách nội dung chuyển khoản ra mã đơn để tra index');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok((select sum(amount) from daily_sales) = (select sum(total_amount) from orders where payment_status = 'PAID'),
  'Chủ hộ A: tổng trong bảng ngày bằng tổng đơn đã trả');
select pg_temp.ok((select count(*) from list_orders(pg_temp.oid('biz_a'), now() - interval '30 days', now() + interval '1 day', null, null, 3)) = 3,
  'Danh sách đơn trả đúng 3 dòng/trang');
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from daily_sales where business_id = pg_temp.oid('biz_a')) = 0
                  and (select count(*) from list_orders(pg_temp.oid('biz_a'), now() - interval '30 days', now() + interval '1 day')) = 0,
  'Hộ B không đọc được tổng ngày và danh sách đơn của hộ A');

reset role;
rollback;
