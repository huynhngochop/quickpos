-- =====================================================================
-- Migration 7 — đủ bộ chức năng bán hàng cho hộ kinh doanh (yêu cầu 01/11/2026: làm hết, không chia giai đoạn)
--   1. Hàng hóa: thêm nhóm, giá vốn, theo dõi tồn kho; ghi qua hàm
--   2. Tồn kho: nhập hàng, kiểm kho, tự trừ kho khi đơn đã trả
--   3. Báo cáo theo giờ và món bán chạy
--   4. Ca bán / két tiền mặt: mở ca, đóng ca, chênh lệch
--   5. Nhân viên: mời bằng số điện thoại, nhận lời mời khi đăng nhập, đổi quyền, cho nghỉ
--   6. Khách quen tích điểm (dùng crm_customers), gắn khách vào đơn, đổi điểm
--   7. Thu nợ bằng mã QR: đơn chuyển khoản gắn khách nợ, trả xong tự trừ sổ nợ
--   8. Hóa đơn điện tử: cài đặt nhà cung cấp/ký hiệu, lập hóa đơn từ đơn, ghi kết quả phát hành
-- Mọi lệnh ghi qua hàm *_v1 (security definer, set search_path, mã lỗi QP_*).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Hàng hóa
-- ---------------------------------------------------------------------
alter table public.products
  add column category     text check (category is null or length(category) <= 50),
  add column cost_price   bigint check (cost_price is null or cost_price >= 0),
  add column track_stock  boolean not null default false,
  add column stock_qty    numeric(14,3) not null default 0,
  add column low_stock_at numeric(14,3) check (low_stock_at is null or low_stock_at >= 0),
  add column sort_order   int not null default 0;
create index on public.products (business_id, sort_order, name) where is_active;

-- App ghi hàng hóa qua hàm (tồn kho chỉ đổi qua phiếu nhập/kiểm/bán)
drop policy if exists products_write on public.products;
revoke insert, update, delete, truncate on public.products from authenticated, anon;

create or replace function public.upsert_product_v1(
  p_product_id uuid, p_business_id uuid, p_name text, p_price bigint, p_unit text default 'cái',
  p_category text default null, p_cost_price bigint default null, p_track_stock boolean default false,
  p_low_stock_at numeric default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_product_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 100
     or coalesce(p_price, -1) < 0 or p_price > 100000000000
     or length(trim(coalesce(p_unit, ''))) not between 1 and 20
     or (p_cost_price is not null and p_cost_price < 0) or (p_low_stock_at is not null and p_low_stock_at < 0) then
    raise exception 'QP_INVALID_INPUT';
  end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is not null and v.business_id <> p_business_id then raise exception 'QP_FORBIDDEN'; end if;
  if v.id is null then
    insert into public.products (id, business_id, name, price, unit, category, cost_price, track_stock, low_stock_at)
    values (p_product_id, p_business_id, trim(p_name), p_price, trim(p_unit), nullif(trim(coalesce(p_category, '')), ''),
            p_cost_price, coalesce(p_track_stock, false), p_low_stock_at)
    returning * into v;
  else
    update public.products set name = trim(p_name), price = p_price, unit = trim(p_unit),
           category = nullif(trim(coalesce(p_category, '')), ''), cost_price = p_cost_price,
           track_stock = coalesce(p_track_stock, false), low_stock_at = p_low_stock_at, is_active = true
     where id = p_product_id returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.upsert_product_v1(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric) from public, anon;
grant execute on function public.upsert_product_v1(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric) to authenticated;

-- Ngừng bán (không xóa: đơn cũ vẫn trỏ tới món)
create or replace function public.set_product_active_v1(p_product_id uuid, p_active boolean)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  update public.products set is_active = coalesce(p_active, true) where id = p_product_id returning * into v;
  return v;
end $$;
revoke all on function public.set_product_active_v1(uuid, boolean) from public, anon;
grant execute on function public.set_product_active_v1(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Tồn kho
-- ---------------------------------------------------------------------
create table public.stock_movements (
  id          uuid primary key,                      -- app sinh (nhập/kiểm); bán: sinh tự động
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  kind        text not null check (kind in ('IN','SALE','COUNT')),
  qty         numeric(14,3) not null,                -- IN: +; SALE: −; COUNT: chênh lệch (+/−)
  unit_cost   bigint check (unit_cost is null or unit_cost >= 0),
  order_id    uuid references public.orders(id) on delete set null,
  note        text check (note is null or length(note) <= 200),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.stock_movements (business_id, product_id, created_at desc);
create unique index stock_sale_once on public.stock_movements (order_id, product_id) where kind = 'SALE';

alter table public.stock_movements enable row level security;
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.stock_movements to authenticated;
revoke insert, update, delete, truncate on public.stock_movements from authenticated, anon;

create or replace function public.stock_in_v1(
  p_movement_id uuid, p_product_id uuid, p_qty numeric, p_unit_cost bigint default null,
  p_note text default null, p_record_expense boolean default false
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; v_amount bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if p_movement_id is null or coalesce(p_qty, 0) <= 0 or p_qty > 1000000 or (p_unit_cost is not null and p_unit_cost < 0)
     or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;  -- gửi lại

  insert into public.stock_movements (id, business_id, product_id, kind, qty, unit_cost, note)
  values (p_movement_id, v.business_id, p_product_id, 'IN', p_qty, p_unit_cost, nullif(trim(coalesce(p_note, '')), ''));
  update public.products set stock_qty = stock_qty + p_qty, track_stock = true,
         cost_price = coalesce(p_unit_cost, cost_price)
   where id = p_product_id returning * into v;

  -- Ghi luôn tiền nhập hàng vào sổ chi (để báo cáo ra lãi)
  if coalesce(p_record_expense, false) and p_unit_cost is not null then
    v_amount := round(p_qty * p_unit_cost)::bigint;
    if v_amount > 0 then
      insert into public.journal_entries (business_id, entry_type, amount, category, description, source, source_id)
      values (v.business_id, 'EXPENSE', v_amount, 'Nhập hàng', 'Nhập ' || p_qty::text || ' ' || v.unit || ' ' || v.name, 'MANUAL', p_movement_id)
      on conflict (business_id, source, source_id) do nothing;
    end if;
  end if;
  return v;
end $$;
revoke all on function public.stock_in_v1(uuid, uuid, numeric, bigint, text, boolean) from public, anon;
grant execute on function public.stock_in_v1(uuid, uuid, numeric, bigint, text, boolean) to authenticated;

-- Kiểm kho: đếm thực tế → ghi chênh lệch
create or replace function public.stock_count_v1(p_movement_id uuid, p_product_id uuid, p_actual_qty numeric, p_note text default null)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_movement_id is null or p_actual_qty is null or p_actual_qty < 0 or p_actual_qty > 100000000 then raise exception 'QP_INVALID_INPUT'; end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;
  insert into public.stock_movements (id, business_id, product_id, kind, qty, note)
  values (p_movement_id, v.business_id, p_product_id, 'COUNT', p_actual_qty - v.stock_qty, nullif(trim(coalesce(p_note, '')), ''));
  update public.products set stock_qty = p_actual_qty, track_stock = true where id = p_product_id returning * into v;
  return v;
end $$;
revoke all on function public.stock_count_v1(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.stock_count_v1(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6–7 (cột cần cho trigger): khách quen + khách nợ trên đơn
-- ---------------------------------------------------------------------
alter table public.crm_customers
  add column points        int not null default 0 check (points >= 0),
  add column total_spent   bigint not null default 0,
  add column visits        int not null default 0,
  add column last_visit_at timestamptz;
alter table public.orders
  add column customer_id      uuid references public.crm_customers(id) on delete set null,
  add column debt_customer_id uuid references public.debt_customers(id) on delete set null;
alter table public.businesses
  add column loyalty_vnd_per_point int not null default 10000 check (loyalty_vnd_per_point between 0 and 10000000);

create table public.loyalty_events (
  id          uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.crm_customers(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  kind        text not null check (kind in ('EARN','REDEEM')),
  points      int not null check (points > 0),
  note        text check (note is null or length(note) <= 200),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index loyalty_earn_once on public.loyalty_events (order_id) where kind = 'EARN';
create index on public.loyalty_events (customer_id, created_at desc);
alter table public.loyalty_events enable row level security;
create policy loyalty_events_select on public.loyalty_events
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.loyalty_events to authenticated;
revoke insert, update, delete, truncate on public.loyalty_events from authenticated, anon;

-- Cộng điểm cho một đơn đã trả (gọi từ trigger hoặc khi gắn khách sau khi trả). Một lần mỗi đơn.
create or replace function public.award_order_points(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v_rate int; v_points int; v_rows int;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.customer_id is null or o.payment_status <> 'PAID' then return; end if;
  select loyalty_vnd_per_point into v_rate from public.businesses where id = o.business_id;
  v_points := case when coalesce(v_rate, 0) > 0 then (o.total_amount / v_rate)::int else 0 end;
  insert into public.loyalty_events (id, business_id, customer_id, order_id, kind, points, note)
  select gen_random_uuid(), o.business_id, o.customer_id, o.id, 'EARN', greatest(v_points, 1), 'Đơn ' || o.order_code
  on conflict (order_id) where kind = 'EARN' do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;   -- đã cộng rồi
  update public.crm_customers
     set points = points + case when v_points > 0 then v_points else 0 end,
         total_spent = total_spent + o.total_amount, visits = visits + 1,
         last_visit_at = greatest(coalesce(last_visit_at, o.sold_at), o.sold_at)
   where id = o.customer_id;
end $$;
revoke all on function public.award_order_points(uuid) from public, anon, authenticated;

-- Khi đơn chuyển sang PAID: trừ kho, cộng điểm, trừ sổ nợ (đơn thu nợ)
create or replace function public.on_order_paid_extras()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; v_id uuid;
begin
  if new.payment_status <> 'PAID' or old.payment_status = 'PAID' then return null; end if;

  for it in
    select oi.product_id, sum(oi.quantity) as qty
      from public.order_items oi join public.products p on p.id = oi.product_id
     where oi.order_id = new.id and p.track_stock
     group by oi.product_id
  loop
    insert into public.stock_movements (id, business_id, product_id, kind, qty, order_id, created_by)
    values (gen_random_uuid(), new.business_id, it.product_id, 'SALE', -it.qty, new.id, new.created_by)
    on conflict (order_id, product_id) where kind = 'SALE' do nothing
    returning id into v_id;
    if v_id is not null then
      update public.products set stock_qty = stock_qty - it.qty where id = it.product_id;
    end if;
    v_id := null;
  end loop;

  perform public.award_order_points(new.id);

  if new.debt_customer_id is not null then
    insert into public.debt_entries (id, business_id, customer_id, kind, amount, note, created_by)
    values (new.id, new.business_id, new.debt_customer_id, 'PAYMENT', new.total_amount, 'Trả nợ qua chuyển khoản · đơn ' || new.order_code, new.created_by)
    on conflict (id) do nothing;
  end if;
  return null;
end $$;
create trigger trg_orders_paid_extras after update of payment_status on public.orders
  for each row execute function public.on_order_paid_extras();

-- ---------------------------------------------------------------------
-- 3. Báo cáo theo giờ và món bán chạy (chạy quyền người gọi → RLS; khoảng tối đa 93 ngày)
-- ---------------------------------------------------------------------
create or replace function public.sales_by_hour(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns table (hour int, orders bigint, amount bigint)
language plpgsql stable
as $$
begin
  if p_to <= p_from or p_to - p_from > interval '93 days' then raise exception 'QP_INVALID_INPUT'; end if;
  return query
    select extract(hour from (o.sold_at at time zone 'Asia/Ho_Chi_Minh'))::int, count(*), coalesce(sum(o.total_amount), 0)::bigint
      from public.orders o
     where o.business_id = p_business_id and o.sold_at >= p_from and o.sold_at < p_to and o.payment_status = 'PAID'
     group by 1 order by 1;
end $$;
grant execute on function public.sales_by_hour(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.top_products(p_business_id uuid, p_from timestamptz, p_to timestamptz, p_limit int default 10)
returns table (product_id uuid, name text, quantity numeric, amount bigint)
language plpgsql stable
as $$
begin
  if p_to <= p_from or p_to - p_from > interval '93 days' then raise exception 'QP_INVALID_INPUT'; end if;
  return query
    select max(oi.product_id::text)::uuid, min(oi.name), sum(oi.quantity), sum(oi.line_amount)::bigint
      from public.orders o join public.order_items oi on oi.order_id = o.id
     where o.business_id = p_business_id and o.sold_at >= p_from and o.sold_at < p_to and o.payment_status = 'PAID'
       and oi.product_id is not null
     group by oi.product_id
     order by 4 desc
     limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;
grant execute on function public.top_products(uuid, timestamptz, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Ca bán / két tiền mặt
-- ---------------------------------------------------------------------
create table public.cash_shifts (
  id            uuid primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  opened_by     uuid references auth.users(id) on delete set null default auth.uid(),
  opened_at     timestamptz not null default now(),
  opening_cash  bigint not null check (opening_cash >= 0),
  closed_by     uuid references auth.users(id) on delete set null,
  closed_at     timestamptz,
  cash_sales    bigint,           -- tiền mặt bán được trong ca (chốt lúc đóng)
  cash_expenses bigint,           -- chi tiền mặt trong ca (khoản chi ghi trong ca)
  expected_cash bigint,           -- đầu ca + bán − chi
  counted_cash  bigint check (counted_cash is null or counted_cash >= 0),
  note          text check (note is null or length(note) <= 200)
);
create unique index cash_shift_one_open on public.cash_shifts (business_id) where closed_at is null;
create index on public.cash_shifts (business_id, opened_at desc);
alter table public.cash_shifts enable row level security;
create policy cash_shifts_select on public.cash_shifts
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.cash_shifts to authenticated;
revoke insert, update, delete, truncate on public.cash_shifts from authenticated, anon;

create or replace function public.shift_totals(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns table (cash_sales bigint, cash_orders bigint, cash_expenses bigint)
language sql stable security definer set search_path = public as $$
  select
    (select coalesce(sum(total_amount), 0)::bigint from public.orders
      where business_id = p_business_id and payment_method = 'CASH' and payment_status = 'PAID' and sold_at >= p_from and sold_at < p_to),
    (select count(*) from public.orders
      where business_id = p_business_id and payment_method = 'CASH' and payment_status = 'PAID' and sold_at >= p_from and sold_at < p_to),
    (select coalesce(sum(amount), 0)::bigint from public.journal_entries
      where business_id = p_business_id and entry_type = 'EXPENSE' and voided_at is null and source = 'MANUAL'
        and created_at >= p_from and created_at < p_to);
$$;
revoke all on function public.shift_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.open_shift_v1(p_shift_id uuid, p_business_id uuid, p_opening_cash bigint)
returns public.cash_shifts
language plpgsql security definer set search_path = public
as $$
declare v public.cash_shifts%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  if p_shift_id is null or coalesce(p_opening_cash, -1) < 0 or p_opening_cash > 10000000000 then raise exception 'QP_INVALID_INPUT'; end if;
  select * into v from public.cash_shifts where business_id = p_business_id and closed_at is null;
  if v.id is not null then return v; end if;          -- đang có ca mở (máy khác vừa mở, hoặc gửi lại)
  insert into public.cash_shifts (id, business_id, opening_cash) values (p_shift_id, p_business_id, p_opening_cash)
  returning * into v;
  return v;
end $$;
revoke all on function public.open_shift_v1(uuid, uuid, bigint) from public, anon;
grant execute on function public.open_shift_v1(uuid, uuid, bigint) to authenticated;

-- Ca đang mở + số tạm tính tới hiện tại
create or replace function public.current_shift_v1(p_business_id uuid)
returns table (shift_id uuid, opened_at timestamptz, opening_cash bigint, cash_sales bigint, cash_orders bigint, cash_expenses bigint, expected_cash bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  return query
    select s.id, s.opened_at, s.opening_cash, t.cash_sales, t.cash_orders, t.cash_expenses,
           s.opening_cash + t.cash_sales - t.cash_expenses
      from public.cash_shifts s, public.shift_totals(s.business_id, s.opened_at, clock_timestamp()) t
     where s.business_id = p_business_id and s.closed_at is null;
end $$;
revoke all on function public.current_shift_v1(uuid) from public, anon;
grant execute on function public.current_shift_v1(uuid) to authenticated;

create or replace function public.close_shift_v1(p_shift_id uuid, p_counted_cash bigint, p_note text default null)
returns public.cash_shifts
language plpgsql security definer set search_path = public
as $$
declare v public.cash_shifts%rowtype; t record; v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.cash_shifts where id = p_shift_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if v.closed_at is not null then return v; end if;   -- gửi lại
  if coalesce(p_counted_cash, -1) < 0 or length(coalesce(p_note, '')) > 200 then raise exception 'QP_INVALID_INPUT'; end if;
  select * into t from public.shift_totals(v.business_id, v.opened_at, v_now);
  update public.cash_shifts
     set closed_at = v_now, closed_by = auth.uid(), cash_sales = t.cash_sales, cash_expenses = t.cash_expenses,
         expected_cash = opening_cash + t.cash_sales - t.cash_expenses, counted_cash = p_counted_cash,
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_shift_id returning * into v;
  return v;
end $$;
revoke all on function public.close_shift_v1(uuid, bigint, text) from public, anon;
grant execute on function public.close_shift_v1(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Nhân viên: mời bằng số điện thoại
-- ---------------------------------------------------------------------
alter table public.business_members add column member_phone text;

create table public.business_invites (
  id          uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone       text not null check (phone ~ '^84[0-9]{9}$'),     -- dạng Supabase Auth lưu (không có dấu +)
  role        text not null check (role in ('MANAGER','CASHIER','ACCOUNTANT')),
  invited_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz
);
create unique index invite_one_open on public.business_invites (business_id, phone) where accepted_at is null and revoked_at is null;
create index on public.business_invites (phone) where accepted_at is null and revoked_at is null;
alter table public.business_invites enable row level security;
create policy invites_select on public.business_invites
  for select to authenticated using (public.has_role(business_id, array['OWNER','MANAGER']));
grant select on public.business_invites to authenticated;
revoke insert, update, delete, truncate on public.business_invites from authenticated, anon;

create or replace function public.vn_phone_to_auth(p_phone text)
returns text language sql immutable as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') ~ '^0[0-9]{9}$' then '84' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2)
    when regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') ~ '^84[0-9]{9}$' then regexp_replace(p_phone, '\D', '', 'g')
  end
$$;

create or replace function public.invite_member_v1(p_invite_id uuid, p_business_id uuid, p_phone text, p_role text)
returns public.business_invites
language plpgsql security definer set search_path = public
as $$
declare v public.business_invites%rowtype; v_phone text := public.vn_phone_to_auth(p_phone);
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_invite_id is null or v_phone is null or p_role not in ('MANAGER','CASHIER','ACCOUNTANT') then raise exception 'QP_INVALID_INPUT'; end if;
  if exists (select 1 from public.business_members m join auth.users u on u.id = m.user_id
              where m.business_id = p_business_id and u.phone = v_phone) then
    raise exception 'QP_ALREADY_MEMBER';
  end if;
  select * into v from public.business_invites
   where business_id = p_business_id and phone = v_phone and accepted_at is null and revoked_at is null;
  if v.id is not null then
    update public.business_invites set role = p_role where id = v.id returning * into v;  -- mời lại: đổi quyền
    return v;
  end if;
  insert into public.business_invites (id, business_id, phone, role) values (p_invite_id, p_business_id, v_phone, p_role)
  returning * into v;
  return v;
end $$;
revoke all on function public.invite_member_v1(uuid, uuid, text, text) from public, anon;
grant execute on function public.invite_member_v1(uuid, uuid, text, text) to authenticated;

create or replace function public.revoke_invite_v1(p_invite_id uuid)
returns public.business_invites
language plpgsql security definer set search_path = public
as $$
declare v public.business_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.business_invites where id = p_invite_id for update;
  if v.id is null or not public.has_role(v.business_id, array['OWNER']) then raise exception 'QP_NOT_FOUND'; end if;
  if v.accepted_at is null and v.revoked_at is null then
    update public.business_invites set revoked_at = now() where id = p_invite_id returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.revoke_invite_v1(uuid) from public, anon;
grant execute on function public.revoke_invite_v1(uuid) to authenticated;

-- Người vừa đăng nhập: nhận mọi lời mời gửi tới số điện thoại của mình. Trả về số quán vừa vào.
create or replace function public.accept_invites_v1()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_phone text; v_n int := 0; r record;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select phone into v_phone from auth.users where id = auth.uid();
  if v_phone is null then return 0; end if;
  for r in select * from public.business_invites where phone = v_phone and accepted_at is null and revoked_at is null for update loop
    insert into public.business_members (business_id, user_id, role, member_phone)
    values (r.business_id, auth.uid(), r.role, '0' || substr(v_phone, 3))
    on conflict (business_id, user_id) do nothing;
    update public.business_invites set accepted_at = now(), accepted_by = auth.uid() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.accept_invites_v1() from public, anon;
grant execute on function public.accept_invites_v1() to authenticated;

create or replace function public.set_member_role_v1(p_business_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_role not in ('MANAGER','CASHIER','ACCOUNTANT') then raise exception 'QP_INVALID_INPUT'; end if;
  update public.business_members set role = p_role where business_id = p_business_id and user_id = p_user_id and role <> 'OWNER';
  if not found then raise exception 'QP_NOT_FOUND'; end if;
end $$;
revoke all on function public.set_member_role_v1(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role_v1(uuid, uuid, text) to authenticated;

create or replace function public.remove_member_v1(p_business_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER']) then raise exception 'QP_FORBIDDEN'; end if;
  delete from public.business_members where business_id = p_business_id and user_id = p_user_id and role <> 'OWNER';
  if not found then raise exception 'QP_NOT_FOUND'; end if;
end $$;
revoke all on function public.remove_member_v1(uuid, uuid) from public, anon;
grant execute on function public.remove_member_v1(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Khách quen tích điểm
-- ---------------------------------------------------------------------
create or replace function public.upsert_customer_v1(
  p_customer_id uuid, p_business_id uuid, p_name text, p_phone text default null, p_consent boolean default false
) returns public.crm_customers
language plpgsql security definer set search_path = public
as $$
declare v public.crm_customers%rowtype; v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  if p_customer_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 100
     or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if v_phone is not null and not coalesce(p_consent, false) then raise exception 'QP_CONSENT_REQUIRED'; end if;
  select * into v from public.crm_customers where id = p_customer_id for update;
  if v.id is not null and v.business_id <> p_business_id then raise exception 'QP_FORBIDDEN'; end if;
  begin
    if v.id is null then
      insert into public.crm_customers (id, business_id, display_name, phone_number, consent_at, consent_source)
      values (p_customer_id, p_business_id, trim(p_name), v_phone,
              case when v_phone is not null then now() end, case when v_phone is not null then 'app_khach_quen' end)
      returning * into v;
    else
      update public.crm_customers set display_name = trim(p_name), phone_number = v_phone,
             consent_at = case when v_phone is not null then coalesce(consent_at, now()) end,
             consent_source = case when v_phone is not null then coalesce(consent_source, 'app_khach_quen') end
       where id = p_customer_id returning * into v;
    end if;
  exception when unique_violation then
    raise exception 'QP_PHONE_TAKEN';
  end;
  return v;
end $$;
revoke all on function public.upsert_customer_v1(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.upsert_customer_v1(uuid, uuid, text, text, boolean) to authenticated;

create or replace function public.set_order_customer_v1(p_order_id uuid, p_customer_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or not public.is_member(o.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not exists (select 1 from public.crm_customers where id = p_customer_id and business_id = o.business_id) then
    raise exception 'QP_NOT_FOUND';
  end if;
  if o.customer_id is not null and o.customer_id <> p_customer_id then raise exception 'QP_ALREADY_ASSIGNED'; end if;
  if o.customer_id is null then
    update public.orders set customer_id = p_customer_id where id = p_order_id returning * into o;
    perform public.award_order_points(p_order_id);   -- đơn đã trả (tiền mặt): cộng điểm ngay
  end if;
  return o;
end $$;
revoke all on function public.set_order_customer_v1(uuid, uuid) from public, anon;
grant execute on function public.set_order_customer_v1(uuid, uuid) to authenticated;

create or replace function public.redeem_points_v1(p_event_id uuid, p_customer_id uuid, p_points int, p_note text default null)
returns public.crm_customers
language plpgsql security definer set search_path = public
as $$
declare v public.crm_customers%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.crm_customers where id = p_customer_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if p_event_id is null or coalesce(p_points, 0) <= 0 or length(coalesce(p_note, '')) > 200 then raise exception 'QP_INVALID_INPUT'; end if;
  if exists (select 1 from public.loyalty_events where id = p_event_id) then return v; end if;
  if p_points > v.points then raise exception 'QP_NOT_ENOUGH_POINTS'; end if;
  insert into public.loyalty_events (id, business_id, customer_id, kind, points, note)
  values (p_event_id, v.business_id, p_customer_id, 'REDEEM', p_points, nullif(trim(coalesce(p_note, '')), ''));
  update public.crm_customers set points = points - p_points where id = p_customer_id returning * into v;
  return v;
end $$;
revoke all on function public.redeem_points_v1(uuid, uuid, int, text) from public, anon;
grant execute on function public.redeem_points_v1(uuid, uuid, int, text) to authenticated;

create or replace function public.update_loyalty_settings_v1(p_business_id uuid, p_vnd_per_point int)
returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_vnd_per_point is null or p_vnd_per_point < 0 or p_vnd_per_point > 10000000 then raise exception 'QP_INVALID_INPUT'; end if;
  update public.businesses set loyalty_vnd_per_point = p_vnd_per_point where id = p_business_id returning * into v;
  return v;
end $$;
revoke all on function public.update_loyalty_settings_v1(uuid, int) from public, anon;
grant execute on function public.update_loyalty_settings_v1(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Thu nợ bằng mã QR
-- ---------------------------------------------------------------------
create or replace function public.create_debt_payment_order_v1(p_order_id uuid, p_customer_id uuid, p_amount bigint, p_device_id text default null)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare c public.debt_customers%rowtype; o public.orders%rowtype; v_balance bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into c from public.debt_customers where id = p_customer_id for update;
  if c.id is null or not public.is_member(c.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  select * into o from public.orders where id = p_order_id;
  if o.id is not null then
    if o.debt_customer_id is distinct from p_customer_id then raise exception 'QP_ORDER_CONFLICT'; end if;
    return o;
  end if;
  select coalesce(sum(case kind when 'DEBT' then amount else -amount end), 0) into v_balance
    from public.debt_entries where customer_id = p_customer_id and voided_at is null;
  if coalesce(p_amount, 0) <= 0 then raise exception 'QP_INVALID_INPUT'; end if;
  if p_amount > v_balance then raise exception 'QP_PAYMENT_EXCEEDS_DEBT'; end if;
  o := public.create_order_v1(p_order_id, c.business_id,
         jsonb_build_array(jsonb_build_object('name', 'Trả nợ', 'quantity', 1, 'unit_price', p_amount)), 'VIETQR', now(), p_device_id);
  update public.orders set debt_customer_id = p_customer_id where id = p_order_id returning * into o;
  return o;
end $$;
revoke all on function public.create_debt_payment_order_v1(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.create_debt_payment_order_v1(uuid, uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Hóa đơn điện tử
-- ---------------------------------------------------------------------
-- Cột einvoice_provider đã có từ migration 1 (chữ tự do): chuẩn hóa về danh sách cố định, giữ nhà cung cấp khác là OTHER
update public.businesses
   set einvoice_provider = case
     when einvoice_provider is null or trim(einvoice_provider) = '' then 'NONE'
     when upper(trim(einvoice_provider)) in ('MISA','VIETTEL','VNPT') then upper(trim(einvoice_provider))
     else 'OTHER' end;
alter table public.businesses
  alter column einvoice_provider set default 'NONE',
  alter column einvoice_provider set not null,
  add constraint businesses_einvoice_provider_check check (einvoice_provider in ('NONE','DEMO','MISA','VIETTEL','VNPT','OTHER'));
alter table public.businesses
  add column invoice_form_no   char(1) not null default '2' check (invoice_form_no in ('1','2')),
  add column invoice_symbol    varchar(6) check (invoice_symbol is null or invoice_symbol ~ '^[A-Z0-9]{6}$');
alter table public.invoices add column buyer_email text check (buyer_email is null or buyer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create unique index invoices_one_per_order on public.invoices (order_id) where order_id is not null and status not in ('REPLACED','REJECTED');

create or replace function public.update_invoice_settings_v1(p_business_id uuid, p_provider text, p_form_no text, p_symbol text)
returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_provider not in ('NONE','DEMO','MISA','VIETTEL','VNPT','OTHER') or p_form_no not in ('1','2')
     or (p_provider <> 'NONE' and coalesce(upper(p_symbol), '') !~ '^[A-Z0-9]{6}$') then
    raise exception 'QP_INVALID_INPUT';
  end if;
  update public.businesses set einvoice_provider = p_provider, invoice_form_no = p_form_no,
         invoice_symbol = nullif(upper(coalesce(p_symbol, '')), '')
   where id = p_business_id returning * into v;
  return v;
end $$;
revoke all on function public.update_invoice_settings_v1(uuid, text, text, text) from public, anon;
grant execute on function public.update_invoice_settings_v1(uuid, text, text, text) to authenticated;

-- Lập hóa đơn nháp từ đơn đã trả (dòng hàng chép từ đơn). Một đơn một hóa đơn còn hiệu lực.
create or replace function public.create_invoice_from_order_v1(
  p_invoice_id uuid, p_order_id uuid, p_buyer_name text default null, p_buyer_tax_code text default null,
  p_buyer_email text default null, p_buyer_address text default null
) returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; b public.businesses%rowtype; v public.invoices%rowtype;
        v_rate numeric;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into o from public.orders where id = p_order_id;
  if o.id is null or not public.is_member(o.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if o.payment_status <> 'PAID' then raise exception 'QP_ORDER_NOT_PAID'; end if;
  select * into b from public.businesses where id = o.business_id;
  if b.einvoice_provider = 'NONE' or b.invoice_symbol is null then raise exception 'QP_EINVOICE_NOT_SETUP'; end if;
  if p_buyer_tax_code is not null and p_buyer_tax_code !~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$' then raise exception 'QP_INVALID_INPUT'; end if;
  if p_buyer_email is not null and p_buyer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'QP_INVALID_INPUT'; end if;

  select * into v from public.invoices where order_id = p_order_id and status not in ('REPLACED','REJECTED');
  if v.id is not null then return v; end if;

  insert into public.invoices (id, business_id, order_id, form_no, symbol, buyer_name, buyer_tax_code, buyer_email, buyer_address, created_by)
  values (p_invoice_id, o.business_id, o.id, b.invoice_form_no, b.invoice_symbol,
          nullif(trim(coalesce(p_buyer_name, '')), ''), p_buyer_tax_code, p_buyer_email, nullif(trim(coalesce(p_buyer_address, '')), ''), auth.uid())
  returning * into v;
  -- Mẫu 1 (GTGT): thuế suất theo hàng hóa chưa khai báo → để trống (KCT do kế toán chỉnh nếu cần); mẫu 2 không ghi thuế suất
  v_rate := null;
  insert into public.invoice_lines (invoice_id, line_no, name, unit, quantity, unit_price, vat_rate)
  select v.id, row_number() over (order by oi.id), oi.name, coalesce(p.unit, 'lần'), oi.quantity, oi.unit_price, v_rate
    from public.order_items oi left join public.products p on p.id = oi.product_id
   where oi.order_id = o.id;
  return v;
end $$;
revoke all on function public.create_invoice_from_order_v1(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.create_invoice_from_order_v1(uuid, uuid, text, text, text, text) to authenticated;

-- Ghi kết quả phát hành do nhà cung cấp trả về (chỉ Edge Function issue-einvoice, service_role).
-- Nhà cung cấp tự cấp số (hóa đơn máy tính tiền) → lưu số của họ, KHÔNG gọi issue_invoice (CLAUDE.md).
create or replace function public.record_einvoice_result(
  p_invoice_id uuid, p_invoice_no int, p_tax_authority_code text, p_provider_ref text, p_lookup_url text, p_response jsonb
) returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare v public.invoices%rowtype; y int := extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if v.id is null then raise exception 'QP_NOT_FOUND'; end if;
  if v.status <> 'DRAFT' then return v; end if;
  update public.invoices i set
    status = 'ISSUED', invoice_no = p_invoice_no, fiscal_year = y, issued_at = now(),
    tax_authority_code = p_tax_authority_code, provider_ref = p_provider_ref, lookup_url = p_lookup_url, provider_response = p_response,
    subtotal_amount = t.sub, vat_amount = t.vat, total_amount = t.sub + t.vat
  from (select coalesce(sum(line_amount), 0) sub, coalesce(sum(vat_amount), 0) vat from public.invoice_lines where invoice_id = p_invoice_id) t
  where i.id = p_invoice_id
  returning i.* into v;
  return v;
end $$;
revoke all on function public.record_einvoice_result(uuid, int, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_einvoice_result(uuid, int, text, text, text, jsonb) to service_role;
