-- =====================================================================
-- Migration 8 — quản lý hàng hóa đầy đủ (yêu cầu người dùng thử 01/11/2026)
--   1. Mã vạch / mã QR in sẵn trên hàng (quét để tìm, bán, nhập), duy nhất trong một hộ
--   2. Hàng có hạn dùng: nhập theo lô có ngày hết hạn, tự trừ lô sắp hết hạn trước, cảnh báo sắp hết hạn
--   3. Xuất hủy (hết hạn, hư hỏng, dùng nội bộ) — có lý do, có thể chỉ rõ lô
--   4. Xóa hàng: chưa từng dùng thì xóa hẳn; đã có đơn/phiếu kho thì ẩn (giữ số liệu kế toán)
--   5. Báo cáo xuất – nhập – tồn theo kỳ
-- Mọi lệnh ghi qua hàm *_v1/_v2 (security definer, set search_path, mã lỗi QP_*).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột mới của hàng hóa
-- ---------------------------------------------------------------------
alter table public.products
  add column barcode          text check (barcode is null or barcode ~ '^[0-9A-Za-z._/:+-]{3,64}$'),
  add column track_expiry     boolean not null default false,
  add column expiry_warn_days int not null default 7 check (expiry_warn_days between 1 and 365),
  add column archived_at      timestamptz;
-- Mỗi mã chỉ thuộc một món đang dùng trong hộ (món đã xóa trả mã lại)
create unique index products_barcode_unique on public.products (business_id, barcode)
  where barcode is not null and archived_at is null;

-- ---------------------------------------------------------------------
-- 2. Lô hàng có hạn dùng
-- ---------------------------------------------------------------------
create table public.stock_lots (
  id          uuid primary key,                      -- = id phiếu nhập
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  expires_on  date,
  qty_in      numeric(14,3) not null check (qty_in > 0),
  qty_left    numeric(14,3) not null check (qty_left >= 0),
  created_at  timestamptz not null default now()
);
create index on public.stock_lots (business_id, expires_on) where qty_left > 0;
create index on public.stock_lots (product_id, expires_on) where qty_left > 0;

alter table public.stock_lots enable row level security;
create policy stock_lots_select on public.stock_lots
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.stock_lots to authenticated;
revoke insert, update, delete, truncate on public.stock_lots from authenticated, anon;

-- Phiếu kho: thêm loại OUT (xuất hủy) với lý do và lô
alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements
  add constraint stock_movements_kind_check check (kind in ('IN','SALE','COUNT','OUT')),
  add column reason text check (reason is null or reason in ('EXPIRED','DAMAGED','USED','OTHER')),
  add column lot_id uuid references public.stock_lots(id) on delete set null;
-- Báo cáo xuất nhập tồn lọc theo hộ + thời gian
create index on public.stock_movements (business_id, created_at);

-- Tồn kho giảm (bán, kiểm kho, xuất) → trừ lô theo hạn gần nhất trước, để tổng lô không vượt tồn kho.
-- Một quy tắc cho mọi đường giảm kho: không phải sửa từng hàm cũ.
create or replace function public.trim_lots_to_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_excess numeric; l record; v_take numeric;
begin
  if new.stock_qty >= old.stock_qty then return null; end if;
  select coalesce(sum(qty_left), 0) - greatest(new.stock_qty, 0) into v_excess
    from public.stock_lots where product_id = new.id and qty_left > 0;
  if v_excess <= 0 then return null; end if;
  for l in
    select id, qty_left from public.stock_lots
     where product_id = new.id and qty_left > 0
     order by expires_on nulls last, created_at
     for update
  loop
    exit when v_excess <= 0;
    v_take := least(l.qty_left, v_excess);
    update public.stock_lots set qty_left = qty_left - v_take where id = l.id;
    v_excess := v_excess - v_take;
  end loop;
  return null;
end $$;
revoke all on function public.trim_lots_to_stock() from public, anon, authenticated;
create trigger trg_products_trim_lots after update of stock_qty on public.products
  for each row execute function public.trim_lots_to_stock();

-- ---------------------------------------------------------------------
-- 3. Thêm/sửa món (bản 2: có mã vạch, hạn dùng)
-- ---------------------------------------------------------------------
create or replace function public.upsert_product_v2(
  p_product_id uuid, p_business_id uuid, p_name text, p_price bigint, p_unit text default 'cái',
  p_category text default null, p_cost_price bigint default null, p_track_stock boolean default false,
  p_low_stock_at numeric default null, p_barcode text default null, p_track_expiry boolean default false,
  p_expiry_warn_days int default 7
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; v_code text := nullif(trim(coalesce(p_barcode, '')), '');
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_product_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 100
     or coalesce(p_price, -1) < 0 or p_price > 100000000000
     or length(trim(coalesce(p_unit, ''))) not between 1 and 20
     or length(coalesce(p_category, '')) > 50
     or (p_cost_price is not null and p_cost_price < 0) or (p_low_stock_at is not null and p_low_stock_at < 0)
     or (v_code is not null and v_code !~ '^[0-9A-Za-z._/:+-]{3,64}$')
     or coalesce(p_expiry_warn_days, 7) not between 1 and 365 then
    raise exception 'QP_INVALID_INPUT';
  end if;

  select * into v from public.products where id = p_product_id for update;
  if v.id is not null and (v.business_id <> p_business_id or v.archived_at is not null) then raise exception 'QP_NOT_FOUND'; end if;
  if v_code is not null and exists (
    select 1 from public.products
     where business_id = p_business_id and barcode = v_code and archived_at is null and id <> p_product_id) then
    raise exception 'QP_DUPLICATE_BARCODE';
  end if;

  if v.id is null then
    insert into public.products (id, business_id, name, price, unit, category, cost_price, track_stock, low_stock_at,
                                 barcode, track_expiry, expiry_warn_days)
    values (p_product_id, p_business_id, trim(p_name), p_price, trim(p_unit), nullif(trim(coalesce(p_category, '')), ''),
            p_cost_price, coalesce(p_track_stock, false) or coalesce(p_track_expiry, false), p_low_stock_at,
            v_code, coalesce(p_track_expiry, false), coalesce(p_expiry_warn_days, 7))
    returning * into v;
  else
    update public.products set name = trim(p_name), price = p_price, unit = trim(p_unit),
           category = nullif(trim(coalesce(p_category, '')), ''), cost_price = p_cost_price,
           track_stock = coalesce(p_track_stock, false) or coalesce(p_track_expiry, false), low_stock_at = p_low_stock_at,
           barcode = v_code, track_expiry = coalesce(p_track_expiry, false), expiry_warn_days = coalesce(p_expiry_warn_days, 7)
     where id = p_product_id returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.upsert_product_v2(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric, text, boolean, int) from public, anon;
grant execute on function public.upsert_product_v2(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric, text, boolean, int) to authenticated;

-- Bản 1 không được sửa món đã xóa
create or replace function public.guard_archived_product()
returns trigger language plpgsql as $$
begin
  if old.archived_at is not null and new.archived_at is not null and (new.name, new.price, new.is_active) is distinct from (old.name, old.price, old.is_active) then
    raise exception 'QP_NOT_FOUND';
  end if;
  return new;
end $$;
create trigger trg_products_guard_archived before update on public.products
  for each row execute function public.guard_archived_product();

-- ---------------------------------------------------------------------
-- 4. Xóa món
-- ---------------------------------------------------------------------
create or replace function public.delete_product_v1(p_product_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null then return 'DELETED'; end if;                       -- gửi lại sau khi đã xóa hẳn
  if not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if v.archived_at is not null then return 'ARCHIVED'; end if;

  if not exists (select 1 from public.order_items where product_id = p_product_id)
     and not exists (select 1 from public.stock_movements where product_id = p_product_id) then
    delete from public.products where id = p_product_id;
    return 'DELETED';
  end if;
  -- Đã có đơn hoặc phiếu kho: ẩn khỏi mọi danh sách, giữ cho sổ sách và báo cáo
  update public.products set archived_at = now(), is_active = false where id = p_product_id;
  return 'ARCHIVED';
end $$;
revoke all on function public.delete_product_v1(uuid) from public, anon;
grant execute on function public.delete_product_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Nhập hàng theo lô có hạn dùng
-- ---------------------------------------------------------------------
create or replace function public.stock_in_v2(
  p_movement_id uuid, p_product_id uuid, p_qty numeric, p_unit_cost bigint default null,
  p_note text default null, p_record_expense boolean default false, p_expires_on date default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id;
  if v.id is null or not public.is_member(v.business_id) or v.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;   -- gửi lại
  if v.track_expiry and p_expires_on is null then raise exception 'QP_EXPIRY_REQUIRED'; end if;
  if p_expires_on is not null and (p_expires_on < v_today - 3650 or p_expires_on > v_today + 3650 * 3) then
    raise exception 'QP_INVALID_INPUT';
  end if;

  v := public.stock_in_v1(p_movement_id, p_product_id, p_qty, p_unit_cost, p_note, p_record_expense);
  if p_expires_on is not null or v.track_expiry then
    insert into public.stock_lots (id, business_id, product_id, expires_on, qty_in, qty_left)
    values (p_movement_id, v.business_id, v.id, p_expires_on, p_qty, p_qty)
    on conflict (id) do nothing;
    update public.stock_movements set lot_id = p_movement_id where id = p_movement_id;
  end if;
  return v;
end $$;
revoke all on function public.stock_in_v2(uuid, uuid, numeric, bigint, text, boolean, date) from public, anon;
grant execute on function public.stock_in_v2(uuid, uuid, numeric, bigint, text, boolean, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Xuất hủy / xuất dùng
-- ---------------------------------------------------------------------
create or replace function public.stock_out_v1(
  p_movement_id uuid, p_product_id uuid, p_qty numeric, p_reason text,
  p_lot_id uuid default null, p_note text default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; l public.stock_lots%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null or not public.is_member(v.business_id) or v.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;   -- gửi lại
  if p_movement_id is null or coalesce(p_qty, 0) <= 0 or p_qty > 100000000
     or coalesce(p_reason, '') not in ('EXPIRED','DAMAGED','USED','OTHER') or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if p_qty > greatest(v.stock_qty, 0) then raise exception 'QP_OUT_EXCEEDS_STOCK'; end if;

  if p_lot_id is not null then
    select * into l from public.stock_lots where id = p_lot_id and product_id = p_product_id for update;
    if l.id is null then raise exception 'QP_NOT_FOUND'; end if;
    if p_qty > l.qty_left then raise exception 'QP_OUT_EXCEEDS_STOCK'; end if;
    update public.stock_lots set qty_left = qty_left - p_qty where id = p_lot_id;   -- trừ đúng lô trước
  end if;

  insert into public.stock_movements (id, business_id, product_id, kind, qty, reason, lot_id, note)
  values (p_movement_id, v.business_id, p_product_id, 'OUT', -p_qty, p_reason, p_lot_id, nullif(trim(coalesce(p_note, '')), ''));
  update public.products set stock_qty = stock_qty - p_qty where id = p_product_id returning * into v;
  return v;
end $$;
revoke all on function public.stock_out_v1(uuid, uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.stock_out_v1(uuid, uuid, numeric, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Đọc: hàng sắp hết hạn, xuất nhập tồn (chạy quyền người gọi, RLS lọc theo hộ; không đặt search_path)
-- ---------------------------------------------------------------------
-- Lô còn hàng đã hết hạn hoặc sẽ hết hạn trong số ngày cảnh báo của món. days_left < 0: đã quá hạn.
create or replace function public.expiring_lots(p_business_id uuid)
returns table (lot_id uuid, product_id uuid, name text, unit text, expires_on date, qty_left numeric, days_left int)
language sql stable
as $$
  select l.id, p.id, p.name, p.unit, l.expires_on, l.qty_left,
         (l.expires_on - (now() at time zone 'Asia/Ho_Chi_Minh')::date)::int
    from public.stock_lots l
    join public.products p on p.id = l.product_id
   where l.business_id = p_business_id
     and l.qty_left > 0
     and l.expires_on is not null
     and p.archived_at is null
     and l.expires_on <= (now() at time zone 'Asia/Ho_Chi_Minh')::date + p.expiry_warn_days
   order by l.expires_on, p.name
   limit 200
$$;
grant execute on function public.expiring_lots(uuid) to authenticated;

-- Xuất – nhập – tồn trong [p_from, p_to): tồn đầu = tồn hiện tại − mọi biến động từ p_from;
-- tồn cuối = tồn hiện tại − biến động từ p_to. Chỉ đọc phiếu kho của kỳ trở về sau (index business_id, created_at).
create or replace function public.stock_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns table (product_id uuid, name text, unit text, opening numeric, qty_in numeric, qty_sold numeric,
               qty_out numeric, qty_adjust numeric, closing numeric, cost_price bigint, closing_value bigint)
language sql stable
as $$
  with m as (
    select sm.product_id,
           sum(sm.qty) as since_from,
           sum(sm.qty) filter (where sm.created_at >= p_to) as after_to,
           sum(sm.qty) filter (where sm.created_at < p_to and sm.kind = 'IN') as q_in,
           sum(-sm.qty) filter (where sm.created_at < p_to and sm.kind = 'SALE') as q_sold,
           sum(-sm.qty) filter (where sm.created_at < p_to and sm.kind = 'OUT') as q_out,
           sum(sm.qty) filter (where sm.created_at < p_to and sm.kind = 'COUNT') as q_adj
      from public.stock_movements sm
     where sm.business_id = p_business_id and sm.created_at >= p_from
     group by sm.product_id
  )
  select p.id, p.name, p.unit,
         p.stock_qty - coalesce(m.since_from, 0),
         coalesce(m.q_in, 0), coalesce(m.q_sold, 0), coalesce(m.q_out, 0), coalesce(m.q_adj, 0),
         p.stock_qty - coalesce(m.after_to, 0),
         p.cost_price,
         case when p.cost_price is null then null
              else round(greatest(p.stock_qty - coalesce(m.after_to, 0), 0) * p.cost_price)::bigint end
    from public.products p
    left join m on m.product_id = p.id
   where p.business_id = p_business_id
     and (p.track_stock or m.product_id is not null)
     and (p.archived_at is null or m.product_id is not null)
     and p_to > p_from and p_to - p_from <= interval '400 days'
   order by p.name
   limit 1000
$$;
grant execute on function public.stock_report(uuid, timestamptz, timestamptz) to authenticated;
