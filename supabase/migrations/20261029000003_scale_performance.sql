-- =====================================================================
-- Hiệu năng cho hàng chục triệu đơn / giao dịch
--
-- Nguyên tắc: mọi truy vấn của app đều theo MỘT hộ (business_id), nên chỉ cần
-- index bắt đầu bằng business_id là truy vấn không chậm đi khi tổng số dòng
-- toàn hệ thống tăng. Các con số tổng (sổ hôm nay, theo tháng) đọc từ bảng tổng
-- hợp nhỏ, không cộng lại hàng nghìn đơn mỗi lần mở màn hình.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RLS dạng tập hợp: danh sách hộ của người dùng được tính MỘT lần mỗi câu lệnh,
--    thay vì gọi is_member() cho từng dòng. Quan trọng với truy vấn quét nhiều dòng.
-- ---------------------------------------------------------------------
create or replace function public.my_business_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select business_id from public.business_members where user_id = auth.uid();
$$;

drop policy orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated using (business_id in (select public.my_business_ids()));

drop policy journal_select on public.journal_entries;
create policy journal_select on public.journal_entries
  for select to authenticated using (business_id in (select public.my_business_ids()));

drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated using (business_id in (select public.my_business_ids()));

create or replace function public.my_business_ids_with_role(p_roles text[])
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select business_id from public.business_members where user_id = auth.uid() and role = any (p_roles);
$$;

drop policy payment_events_select on public.payment_events;
create policy payment_events_select on public.payment_events
  for select to authenticated
  using (business_id in (select public.my_business_ids_with_role(array['OWNER','MANAGER','ACCOUNTANT'])));

-- Danh sách "Tiền cần xem lại": index nhỏ chỉ chứa giao dịch cần xử lý, đã sắp theo thời gian
drop index if exists public.payment_events_business_id_match_status_idx;
create index if not exists payment_events_needs_review on public.payment_events (business_id, received_at desc)
  where match_status in ('UNMATCHED','PARTIAL','ALREADY_PAID');

-- ---------------------------------------------------------------------
-- 2. Index phục vụ đúng từng màn hình
-- ---------------------------------------------------------------------
-- Sổ hôm nay / danh sách đơn: phân trang keyset theo (sold_at, id), không dùng OFFSET
create index if not exists orders_biz_sold_keyset on public.orders (business_id, sold_at desc, id desc);
-- Gán tiền vào đơn: đơn chưa trả cùng số tiền, mới nhất trước (index nhỏ vì chỉ chứa đơn UNPAID)
create index if not exists orders_unpaid_by_amount on public.orders (business_id, total_amount, created_at desc)
  where payment_status = 'UNPAID';
-- Danh sách đơn xác nhận tay chưa đối soát
create index if not exists orders_manual_unreconciled on public.orders (business_id, manual_confirmed_at)
  where manual_confirmed_at is not null and amount_received < total_amount;
-- Index cũ (business_id, created_at) và (business_id, payment_status, created_at) không còn
-- truy vấn nào dùng sau khi webhook khớp mã bằng index unique (xem mục 4) → bỏ để ghi nhanh hơn.
drop index if exists public.orders_business_id_created_at_idx;
drop index if exists public.orders_business_id_payment_status_created_at_idx;

-- ---------------------------------------------------------------------
-- 3. Bảng tổng hợp doanh thu theo ngày (đọc thay cho SUM trên hàng nghìn đơn)
-- ---------------------------------------------------------------------
create table public.daily_sales (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  sale_date    date not null,
  method       text not null check (method in ('VIETQR','CASH','CARD')),
  orders_count int not null default 0,
  amount       bigint not null default 0,
  primary key (business_id, sale_date, method)
);
alter table public.daily_sales enable row level security;
create policy daily_sales_select on public.daily_sales
  for select to authenticated using (business_id in (select public.my_business_ids()));
-- Không có policy ghi: chỉ trigger dưới đây ghi

create or replace function public.bump_daily_sales()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'PAID' and old.payment_status <> 'PAID' then
    insert into public.daily_sales as d (business_id, sale_date, method, orders_count, amount)
    values (new.business_id, (new.sold_at at time zone 'Asia/Ho_Chi_Minh')::date, new.payment_method, 1, new.total_amount)
    on conflict (business_id, sale_date, method)
    do update set orders_count = d.orders_count + 1, amount = d.amount + excluded.amount;
  elsif old.payment_status = 'PAID' and new.payment_status = 'REFUNDED' then
    update public.daily_sales
       set orders_count = orders_count - 1, amount = amount - old.total_amount
     where business_id = old.business_id
       and sale_date = (old.sold_at at time zone 'Asia/Ho_Chi_Minh')::date
       and method = old.payment_method;
  end if;
  return new;
end $$;
create trigger trg_orders_daily_sales after update of payment_status on public.orders
  for each row execute function public.bump_daily_sales();

-- Đối soát bảng tổng hợp với dữ liệu gốc (chạy hằng đêm; trả về các ngày bị lệch)
create or replace function public.check_daily_sales(p_from date, p_to date)
returns table (business_id uuid, sale_date date, method text, summary_amount bigint, actual_amount numeric)
language sql stable security definer set search_path = public as $$
  with actual as (
    select o.business_id, (o.sold_at at time zone 'Asia/Ho_Chi_Minh')::date as d, o.payment_method m,
           sum(o.total_amount) amt
      from public.orders o
     where o.payment_status = 'PAID'
       and o.sold_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
       and o.sold_at <  ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
     group by 1, 2, 3
  )
  select coalesce(a.business_id, s.business_id), coalesce(a.d, s.sale_date), coalesce(a.m, s.method),
         s.amount, a.amt
    from actual a
    full join public.daily_sales s
      on s.business_id = a.business_id and s.sale_date = a.d and s.method = a.m
   where coalesce(s.sale_date, a.d) between p_from and p_to
     and coalesce(s.amount, 0) <> coalesce(a.amt, 0);
$$;
revoke all on function public.check_daily_sales(date, date) from public, anon, authenticated;
grant execute on function public.check_daily_sales(date, date) to service_role;

-- ---------------------------------------------------------------------
-- 4. Webhook: khớp mã đơn bằng index thay vì quét chuỗi
--    Cắt nội dung chuyển khoản thành mọi đoạn 8 ký tự rồi tra index unique
--    (business_id, order_code). Thời gian không phụ thuộc hộ có bao nhiêu đơn.
-- ---------------------------------------------------------------------
create or replace function public.order_code_candidates(p_content text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct substr(n, i, 8)), '{}')
    from (select upper(regexp_replace(coalesce(p_content, ''), '[^A-Za-z0-9]', '', 'g')) n) s,
         generate_series(1, greatest(length(n) - 7, 0)) i;
$$;

-- ---------------------------------------------------------------------
-- 5. Tách payload thô của webhook (JSON lớn) sang bảng phân vùng theo tháng.
--    Bảng payment_events còn nhỏ gọn; payload cũ xóa theo tháng bằng DROP PARTITION.
-- ---------------------------------------------------------------------
create table public.payment_event_raw (
  event_id    uuid not null,
  received_at timestamptz not null,
  payload     jsonb not null,
  primary key (event_id, received_at)
) partition by range (received_at);

alter table public.payment_event_raw enable row level security;
-- Không có policy: chỉ server đọc/ghi

create or replace function public.ensure_month_partitions(p_months_ahead int default 3)
returns void language plpgsql security definer set search_path = public as $$
declare m date; i int;
begin
  for i in -1..p_months_ahead loop
    m := (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') + make_interval(months => i))::date;
    execute format(
      'create table if not exists public.%I partition of public.payment_event_raw for values from (%L) to (%L)',
      'payment_event_raw_' || to_char(m, 'YYYYMM'),
      (m::timestamp at time zone 'Asia/Ho_Chi_Minh'),
      ((m + interval '1 month')::timestamp at time zone 'Asia/Ho_Chi_Minh'));
  end loop;
end $$;

create or replace function public.drop_old_raw_partitions(p_keep_months int default 13)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
  v_cut text := to_char(date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - make_interval(months => p_keep_months), 'YYYYMM');
begin
  for r in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
            where i.inhparent = 'public.payment_event_raw'::regclass
              and c.relname ~ '^payment_event_raw_[0-9]{6}$'
              and substr(c.relname, 19) < v_cut loop
    execute format('drop table public.%I', r.relname);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ensure_month_partitions(int) from public, anon, authenticated;
revoke all on function public.drop_old_raw_partitions(int) from public, anon, authenticated;
grant execute on function public.ensure_month_partitions(int) to service_role;
grant execute on function public.drop_old_raw_partitions(int) to service_role;

select public.ensure_month_partitions(3);
-- Lịch chạy (Supabase có pg_cron):
--   select cron.schedule('raw-partitions', '0 1 25 * *', 'select public.ensure_month_partitions(3)');
--   select cron.schedule('raw-retention',  '0 2 1 * *',  'select public.drop_old_raw_partitions(13)');
--   select cron.schedule('daily-sales-check', '30 3 * * *', $$select * from public.check_daily_sales(current_date - 2, current_date - 1)$$);

alter table public.payment_events drop column raw_payload;

-- confirm_payment phiên bản dùng index cho mã đơn và bảng payload riêng
create or replace function public.confirm_payment(
  p_provider text, p_txn_id text, p_amount numeric, p_content text,
  p_bank_bin text, p_account_no text, p_raw jsonb
) returns table (event_id uuid, order_id uuid, match_status text)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_event   public.payment_events%rowtype;
  v_acct    public.payment_accounts%rowtype;
  v_order   uuid;
  v_status  text;
begin
  insert into public.payment_events (provider, provider_txn_id, amount, transfer_content, bank_bin, account_no)
  values (p_provider, p_txn_id, p_amount, p_content, p_bank_bin, p_account_no)
  on conflict (provider, provider_txn_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    return query select e.id, e.order_id, e.match_status
                 from public.payment_events e
                 where e.provider = p_provider and e.provider_txn_id = p_txn_id;
    return;
  end if;

  insert into public.payment_event_raw (event_id, received_at, payload)
  values (v_event.id, v_event.received_at, coalesce(p_raw, '{}'::jsonb));

  select * into v_acct from public.payment_accounts a
   where a.bank_bin = p_bank_bin and a.account_no = p_account_no and a.is_active;

  if v_acct.id is null then
    update public.payment_events set match_status = 'UNKNOWN_ACCOUNT' where id = v_event.id;
    return query select v_event.id, null::uuid, 'UNKNOWN_ACCOUNT'::text;
    return;
  end if;

  update public.payment_events set business_id = v_acct.business_id where id = v_event.id;

  if v_acct.order_id is not null then
    v_order := v_acct.order_id;
  else
    select o.id into v_order
      from public.orders o
     where o.business_id = v_acct.business_id
       and o.order_code = any (public.order_code_candidates(p_content))
       and o.created_at > now() - interval '3 days'
     order by (o.payment_status = 'UNPAID') desc, o.created_at desc
     limit 1;
  end if;

  if v_order is null then
    return query select v_event.id, null::uuid, 'UNMATCHED'::text;
    return;
  end if;

  v_status := public.apply_payment_to_order(v_event.id, v_order);
  return query select v_event.id, v_order, v_status;
end $$;
revoke all on function public.confirm_payment(text,text,numeric,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_payment(text,text,numeric,text,text,text,jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 6. Hàm đọc cho app (một lần gọi = một màn hình)
-- ---------------------------------------------------------------------
-- Hai hàm dưới chạy bằng quyền người gọi (RLS vẫn áp dụng) và ghi đủ tên schema, nên KHÔNG
-- đặt "set search_path": mệnh đề SET chặn PostgreSQL nhúng hàm vào truy vấn, làm trang sâu
-- của danh sách chậm từ 0,6 ms lên ~33 ms trên hộ có 1 triệu đơn (đã đo).
-- Sổ một ngày: tổng từ daily_sales (vài dòng), không SUM trên orders
create or replace function public.day_summary(p_business_id uuid, p_day date)
returns table (method text, orders_count int, amount bigint)
language sql stable as $$
  select method, orders_count, amount from public.daily_sales
   where business_id = p_business_id and sale_date = p_day;
$$;

-- Danh sách đơn, 20 đơn mỗi trang, phân trang keyset (truyền sold_at + id của dòng cuối trang trước)
create or replace function public.list_orders(
  p_business_id uuid, p_from timestamptz, p_to timestamptz,
  p_after_sold_at timestamptz default null, p_after_id uuid default null, p_limit int default 20
) returns setof public.orders
language sql stable as $$
  select * from public.orders
   where business_id = p_business_id
     and sold_at >= p_from and sold_at < p_to
     -- Không dùng "p_after is null OR ...": OR làm planner bỏ index, trang sâu chậm như OFFSET
     and (sold_at, id) < (coalesce(p_after_sold_at, 'infinity'::timestamptz),
                          coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by sold_at desc, id desc
   limit least(p_limit, 100);
$$;
