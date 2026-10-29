-- Sinh dữ liệu lớn để đo hiệu năng (bỏ qua trigger để nạp nhanh)
\timing on
set session_replication_role = replica;
set synchronous_commit = off;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid, 'u' || i || '@bench'
from generate_series(1, 2000) i;

insert into public.businesses (id, owner_id, business_name, tax_code, address, revenue_group)
select ('10000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
       'Quán ' || i, lpad((3100000000 + i)::text, 10, '0'), 'TP.HCM', 'OVER_1B'
from generate_series(1, 2000) i;

insert into public.business_members (business_id, user_id, role)
select id, owner_id, 'OWNER' from public.businesses;

insert into public.payment_accounts (business_id, provider, bank_bin, account_no, kind)
select id, 'SEPAY', '970422', 'ACC' || right(id::text, 6), 'MAIN' from public.businesses;

-- 5 triệu đơn: hộ số 1 có 1 triệu đơn, 1.999 hộ còn lại chia 4 triệu
create temp table gen as
select i,
       case when i <= 1000000 then 1 else 2 + ((i - 1000001) % 1999) end as biz,
       now() - (random() * interval '365 days') as ts,
       (10 + floor(random() * 190))::int * 1000 as amt,
       random() as r1, random() as r2
from generate_series(1, 5000000) i;

insert into public.orders (id, business_id, order_code, total_amount, amount_received, payment_method,
                           payment_status, paid_at, sold_at, created_by, created_at, updated_at)
select gen_random_uuid(),
       ('10000000-0000-0000-0000-' || lpad(to_hex(biz), 12, '0'))::uuid,
       upper(lpad(to_hex(i), 8, '0')),
       amt,
       case when r1 < 0.97 then amt else 0 end,
       case when r2 < 0.8 then 'VIETQR' else 'CASH' end,
       case when r1 < 0.97 then 'PAID' when r1 < 0.99 then 'UNPAID' else 'CANCELLED' end,
       case when r1 < 0.97 then ts end,
       ts,
       ('00000000-0000-0000-0000-' || lpad(to_hex(biz), 12, '0'))::uuid,
       ts, ts
from gen;

insert into public.order_items (order_id, name, quantity, unit_price)
select id, 'Món', 1, total_amount from public.orders;

insert into public.payment_events (business_id, order_id, provider, provider_txn_id, bank_bin, account_no,
                                   amount, transfer_content, match_status, received_at)
select business_id, id, 'SEPAY', 'T' || order_code, '970422', 'ACC' || right(business_id::text, 6),
       total_amount, 'CK ' || order_code, 'MATCHED', sold_at
from public.orders where payment_status = 'PAID' and payment_method = 'VIETQR';

-- Một ít giao dịch chưa rõ đơn
insert into public.payment_events (business_id, provider, provider_txn_id, bank_bin, account_no,
                                   amount, transfer_content, match_status, received_at)
select ('10000000-0000-0000-0000-' || lpad(to_hex(1 + (i % 2000)), 12, '0'))::uuid, 'SEPAY', 'U' || i, '970422', 'X',
       18000, 'chuyen tien', 'UNMATCHED', now() - (random() * interval '30 days')
from generate_series(1, 20000) i;

insert into public.journal_entries (business_id, entry_type, amount, category, description, source, source_id, entry_date, created_by)
select business_id, 'REVENUE', total_amount, 'Bán hàng', 'Đơn ' || order_code, 'ORDER', id,
       (sold_at at time zone 'Asia/Ho_Chi_Minh')::date, created_by
from public.orders where payment_status = 'PAID';

insert into public.daily_sales (business_id, sale_date, method, orders_count, amount)
select business_id, (sold_at at time zone 'Asia/Ho_Chi_Minh')::date, payment_method, count(*), sum(total_amount)
from public.orders where payment_status = 'PAID' group by 1, 2, 3;

set session_replication_role = origin;
vacuum analyze;
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as size
from pg_stat_user_tables where schemaname = 'public' and n_live_tup > 1000 order by n_live_tup desc;
