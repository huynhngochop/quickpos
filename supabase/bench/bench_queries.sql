-- Đo thời gian các truy vấn theo màn hình, trên hộ có 1 triệu đơn (trung bình 30 lần, sau 3 lần làm nóng)
\pset format aligned
create or replace function pg_temp.bench(p_label text, p_sql text, p_n int default 30)
returns table (screen text, avg_ms numeric, max_ms numeric)
language plpgsql as $$
declare i int; t0 timestamptz; d numeric; tot numeric := 0; mx numeric := 0;
begin
  for i in 1..3 loop execute p_sql; end loop;
  for i in 1..p_n loop
    t0 := clock_timestamp();
    execute p_sql;
    d := extract(epoch from clock_timestamp() - t0) * 1000;
    tot := tot + d; mx := greatest(mx, d);
  end loop;
  return query select p_label, round(tot / p_n, 2), round(mx, 2);
end $$;

-- con trỏ trang thứ 2.501 (sau 50.000 đơn) cho phân trang keyset
create temp table cur as
select sold_at, id from public.orders
 where business_id = '10000000-0000-0000-0000-000000000001'
 order by sold_at desc, id desc offset 49999 limit 1;
grant select on cur to authenticated;
select sold_at as cur_s, id as cur_i from cur \gset

create temp table results (screen text, avg_ms numeric, max_ms numeric);
grant all on results to authenticated, service_role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

insert into results select * from pg_temp.bench('Trang chính: tổng hôm nay (daily_sales)',
  $q$ select * from public.day_summary('10000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Ho_Chi_Minh')::date) $q$);
insert into results select * from pg_temp.bench('Sổ: 20 đơn mới nhất (keyset)',
  $q$ select * from public.list_orders('10000000-0000-0000-0000-000000000001', now() - interval '365 days', now() + interval '1 day') $q$);
insert into results select * from pg_temp.bench('Sổ: trang sau 50.000 đơn (keyset)',
  $q$ select * from public.list_orders('10000000-0000-0000-0000-000000000001', now() - interval '365 days', now() + interval '1 day', $q$ || quote_literal(:'cur_s') || $q$::timestamptz, $q$ || quote_literal(:'cur_i') || $q$::uuid) $q$);
insert into results select * from pg_temp.bench('SO SÁNH — trang sau 50.000 đơn (OFFSET)',
  $q$ select * from public.orders where business_id = '10000000-0000-0000-0000-000000000001' order by sold_at desc, id desc offset 50000 limit 20 $q$, 10);
insert into results select * from pg_temp.bench('Sổ: tổng tháng này (daily_sales)',
  $q$ select method, sum(amount) from public.daily_sales where business_id = '10000000-0000-0000-0000-000000000001' and sale_date >= date_trunc('month', now())::date group by 1 $q$);
insert into results select * from pg_temp.bench('SO SÁNH — tổng tháng này (SUM trên orders)',
  $q$ select payment_method, sum(total_amount) from public.orders where business_id = '10000000-0000-0000-0000-000000000001' and payment_status = 'PAID' and sold_at >= date_trunc('month', now()) group by 1 $q$, 10);
insert into results select * from pg_temp.bench('Sổ: tổng cả năm (daily_sales)',
  $q$ select sum(amount) from public.daily_sales where business_id = '10000000-0000-0000-0000-000000000001' and sale_date >= (now() - interval '365 days')::date $q$);
insert into results select * from pg_temp.bench('SO SÁNH — tổng cả năm (SUM trên orders)',
  $q$ select sum(total_amount) from public.orders where business_id = '10000000-0000-0000-0000-000000000001' and payment_status = 'PAID' $q$, 5);
insert into results select * from pg_temp.bench('Tiền cần xem lại: 20 khoản chưa rõ đơn',
  $q$ select * from public.payment_events where business_id = '10000000-0000-0000-0000-000000000001' and match_status = 'UNMATCHED' order by received_at desc limit 20 $q$);
insert into results select * from pg_temp.bench('Gán đơn: đơn chưa trả cùng số tiền',
  $q$ select * from public.orders where business_id = '10000000-0000-0000-0000-000000000001' and payment_status = 'UNPAID' and total_amount = 18000 order by created_at desc limit 5 $q$);
reset role;

-- So sánh RLS: gọi is_member() từng dòng (cách cũ) và danh sách hộ tính một lần (cách mới)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into results select * from pg_temp.bench('SO SÁNH — đếm đơn 30 ngày, RLS is_member() từng dòng',
  $q$ select count(*) from public.orders where business_id = '10000000-0000-0000-0000-000000000001' and sold_at >= now() - interval '30 days' and public.is_member(business_id) $q$, 10);
set role authenticated;
insert into results select * from pg_temp.bench('Đếm đơn 30 ngày, RLS tập hợp (cách mới)',
  $q$ select count(*) from public.orders where business_id = '10000000-0000-0000-0000-000000000001' and sold_at >= now() - interval '30 days' $q$, 10);
reset role;

-- Webhook: 300 lần xác nhận chuyển khoản trên hộ 1 triệu đơn
create temp table wh_orders as
with o as (
  insert into public.orders (business_id, total_amount, created_by)
  select '10000000-0000-0000-0000-000000000001', 0, '00000000-0000-0000-0000-000000000001'
  from generate_series(1, 300) returning id, order_code
)
select * from o;
insert into public.order_items (order_id, name, quantity, unit_price) select id, 'Món', 1, 25000 from wh_orders;
grant select on wh_orders to service_role;

set role service_role;
do $$
declare r record; t0 timestamptz; tot numeric := 0; mx numeric := 0; d numeric; n int := 0; v text;
begin
  for r in select * from wh_orders loop
    t0 := clock_timestamp();
    select match_status into v from public.confirm_payment('SEPAY', 'W' || r.order_code, 25000,
      'MBVCB.8812.' || lower(r.order_code) || '.CT tu NGUYEN VAN A', '970422', 'ACC000001', '{"bench":true}');
    d := extract(epoch from clock_timestamp() - t0) * 1000;
    if v <> 'MATCHED' then raise exception 'webhook không khớp: %', v; end if;
    tot := tot + d; mx := greatest(mx, d); n := n + 1;
  end loop;
  insert into results values ('Webhook: xác nhận 1 chuyển khoản (300 lần)', round(tot / n, 2), round(mx, 2));
end $$;
reset role;

-- Cách khớp cũ (quét chuỗi trong đơn 3 ngày gần nhất) để so sánh
insert into results select * from pg_temp.bench('SO SÁNH — khớp mã kiểu cũ (quét chuỗi)',
  $q$ select id from public.orders o where o.business_id = '10000000-0000-0000-0000-000000000001' and o.created_at > now() - interval '3 days' and position(o.order_code in 'MBVCB8812ABCDEFGHCTTUNGUYENVANA') > 0 limit 1 $q$, 5);

-- Các thao tác ghi của app (hàm *_v1) trên hộ 1 triệu đơn: mỗi loại 200 lần, gọi như người dùng thật
create temp table wr (k text, ms numeric);
grant all on wr to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare
  b uuid := '10000000-0000-0000-0000-000000000001';
  i int; t0 timestamptz; o public.orders; ids uuid[] := '{}'; ev uuid; s text;
begin
  for i in 1..200 loop
    t0 := clock_timestamp();
    o := public.create_order_v1(gen_random_uuid(), b, '[{"name":"Bán hàng","quantity":1,"unit_price":18000}]', 'VIETQR', now(), 'bench');
    insert into wr values ('Thu tiền: tạo đơn QR (create_order_v1)', extract(epoch from clock_timestamp() - t0) * 1000);
    ids := ids || o.id;
  end loop;
  for i in 1..200 loop
    t0 := clock_timestamp();
    perform public.create_cash_sale_v1(gen_random_uuid(), b, '[{"name":"Bán hàng","quantity":1,"unit_price":25000}]', now(), 'bench');
    insert into wr values ('Tiền mặt: ghi đơn (create_cash_sale_v1)', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  for i in 1..100 loop
    t0 := clock_timestamp();
    perform public.confirm_transfer_manually_v1(ids[i]);
    insert into wr values ('Xác nhận tay (confirm_transfer_manually_v1)', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  for i in 101..150 loop
    t0 := clock_timestamp();
    perform public.cancel_order_v1(ids[i]);
    insert into wr values ('Hủy đơn (cancel_order_v1)', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  for i in 151..200 loop
    select id into ev from public.payment_events
     where business_id = b and match_status = 'UNMATCHED' and order_id is null order by received_at desc limit 1;
    exit when ev is null;
    t0 := clock_timestamp();
    s := public.assign_payment_event_v1(ev, ids[i]);
    insert into wr values ('Gán tiền chưa rõ vào đơn (assign_payment_event_v1)', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;
reset role;
insert into results select k, round(avg(ms), 2), round(max(ms), 2) from wr group by k;

-- Bảng tổng hợp vẫn khớp với đơn sau mọi thao tác ghi (phải 0 dòng)
insert into results select 'Đối soát daily_sales (số dòng lệch: ' || count(*) || ')', null, null from public.check_daily_sales();

select * from results;
