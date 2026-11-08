-- =====================================================================
-- Migration 9 — yêu cầu người dùng thử 08/11/2026
--   1. Danh mục hàng hóa (bảng riêng, nhóm ngành khi kê khai thuế, hàng có hạn dùng mặc định)
--   2. Nhà cung cấp, phiếu nhập nhiều món, mỗi dòng một lô (giá nhập, nhà cung cấp, hạn dùng), công nợ nhà cung cấp
--   3. Giá vốn theo lô khi bán / xuất (hàng cũ chưa có lô trước, rồi lô hết hạn sớm, rồi lô nhập trước)
--   4. Khuyến mãi (giảm món, mua X tặng Y, giảm tổng đơn), giảm tay có quyền, món tặng giá 0
--   5. Xuất kho hàng tặng (GIFT), hàng mẫu (SAMPLE) — không tính doanh thu
--   6. Kiểm kê nhiều món một lần, chốt chỉnh tồn theo chênh lệch lúc đếm
--   7. Doanh thu theo nhóm ngành cho mẫu 01/TKN-CNKD (TT 89/2026/TT-BTC)
-- Mọi lệnh ghi qua hàm *_v1/_v2 (security definer, set search_path, mã lỗi QP_*). Hàm đọc chạy quyền người gọi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Danh mục
-- ---------------------------------------------------------------------
create table public.product_categories (
  id                   uuid primary key,
  business_id          uuid not null references public.businesses(id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 50),
  sort_order           int not null default 0,
  -- Nhóm ngành khi kê khai (null = theo ngành của quán): 1 hàng hóa … 6 khác
  tax_group            text check (tax_group is null or tax_group in ('GOODS','SERVICE','LEASING','PRODUCTION','DIGITAL','OTHER')),
  track_expiry_default boolean not null default false,
  archived_at          timestamptz,
  created_at           timestamptz not null default now()
);
create unique index product_categories_name on public.product_categories (business_id, lower(name)) where archived_at is null;
alter table public.product_categories enable row level security;
create policy product_categories_select on public.product_categories
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.product_categories to authenticated;
revoke insert, update, delete, truncate on public.product_categories from authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. Nhà cung cấp, phiếu nhập, trả nợ
-- ---------------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 100),
  phone       text check (phone is null or phone ~ '^[0-9+ .-]{6,20}$'),
  address     text check (address is null or length(address) <= 200),
  tax_code    varchar(14) check (tax_code is null or tax_code ~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$'),
  note        text check (note is null or length(note) <= 200),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.suppliers (business_id, name);
alter table public.suppliers enable row level security;
create policy suppliers_select on public.suppliers
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.suppliers to authenticated;
revoke insert, update, delete, truncate on public.suppliers from authenticated, anon;

alter table public.products
  add column category_id uuid references public.product_categories(id) on delete set null,
  add column supplier_id uuid references public.suppliers(id) on delete set null;
create index on public.products (business_id, category_id);

-- Hàng cũ chỉ có tên nhóm dạng chữ → tạo danh mục và gắn mã
insert into public.product_categories (id, business_id, name)
select gen_random_uuid(), x.business_id, x.name
  from (select distinct on (business_id, lower(trim(category))) business_id, trim(category) as name
          from public.products where category is not null and length(trim(category)) > 0) x;
update public.products p set category_id = c.id
  from public.product_categories c
 where c.business_id = p.business_id and lower(c.name) = lower(trim(p.category)) and p.category_id is null;

create table public.purchases (
  id           uuid primary key,                                   -- app sinh, gửi lại an toàn
  business_id  uuid not null references public.businesses(id) on delete cascade,
  supplier_id  uuid references public.suppliers(id) on delete set null,
  purchased_on date not null,
  total_amount bigint not null check (total_amount >= 0),
  paid_amount  bigint not null check (paid_amount >= 0 and paid_amount <= total_amount),
  line_count   int not null check (line_count between 1 and 200),
  note         text check (note is null or length(note) <= 200),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.purchases (business_id, purchased_on desc);
create index on public.purchases (supplier_id, purchased_on desc);
alter table public.purchases enable row level security;
create policy purchases_select on public.purchases
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.purchases to authenticated;
revoke insert, update, delete, truncate on public.purchases from authenticated, anon;

-- Trả tiền nhà cung cấp (lần trả ngay khi nhập có id = id phiếu nhập). Sai thì hủy (voided_at), không xóa.
create table public.supplier_payments (
  id          uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  amount      bigint not null check (amount > 0),
  paid_on     date not null,
  note        text check (note is null or length(note) <= 200),
  purchase_id uuid references public.purchases(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz
);
create index on public.supplier_payments (supplier_id, paid_on desc);
alter table public.supplier_payments enable row level security;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.supplier_payments to authenticated;
revoke insert, update, delete, truncate on public.supplier_payments from authenticated, anon;

-- Lô: thêm giá nhập, nhà cung cấp, phiếu nhập, ngày nhận
alter table public.stock_lots
  add column unit_cost   bigint check (unit_cost is null or unit_cost >= 0),
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add column purchase_id uuid references public.purchases(id) on delete set null,
  add column received_on date;
create index on public.stock_lots (supplier_id) where supplier_id is not null;

-- ---------------------------------------------------------------------
-- 3. Kiểm kê
-- ---------------------------------------------------------------------
create table public.stock_counts (
  id          uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status      text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  note        text check (note is null or length(note) <= 200),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  lines_total int not null default 0,
  lines_diff  int not null default 0,
  value_diff  bigint not null default 0,
  created_by  uuid references auth.users(id) on delete set null default auth.uid()
);
-- Mỗi quán chỉ một lần kiểm đang mở
create unique index stock_counts_one_open on public.stock_counts (business_id) where status = 'OPEN';
create index on public.stock_counts (business_id, started_at desc);
alter table public.stock_counts enable row level security;
create policy stock_counts_select on public.stock_counts
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.stock_counts to authenticated;
revoke insert, update, delete, truncate on public.stock_counts from authenticated, anon;

create table public.stock_count_lines (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.stock_counts(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  expected_qty numeric(14,3) not null,           -- số trên máy lúc đếm
  counted_qty  numeric(14,3) not null check (counted_qty >= 0),
  diff         numeric(14,3) not null,
  counted_at   timestamptz not null default now(),
  counted_by   uuid references auth.users(id) on delete set null default auth.uid(),
  unique (count_id, product_id)
);
alter table public.stock_count_lines enable row level security;
create policy stock_count_lines_select on public.stock_count_lines
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.stock_count_lines to authenticated;
revoke insert, update, delete, truncate on public.stock_count_lines from authenticated, anon;

-- Phiếu kho: lý do xuất thêm tặng / mẫu; gắn nhà cung cấp, phiếu nhập, lần kiểm kê
alter table public.stock_movements drop constraint stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check check (reason is null or reason in ('EXPIRED','DAMAGED','USED','GIFT','SAMPLE','OTHER')),
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add column purchase_id uuid references public.purchases(id) on delete set null,
  add column count_id    uuid references public.stock_counts(id) on delete set null;

-- ---------------------------------------------------------------------
-- 4. Khuyến mãi, giảm giá trên đơn
-- ---------------------------------------------------------------------
create table public.promotions (
  id             uuid primary key,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 80),
  kind           text not null check (kind in ('ITEM_DISCOUNT','BUY_X_GET_Y','ORDER_DISCOUNT')),
  product_id     uuid references public.products(id) on delete cascade,
  category_id    uuid references public.product_categories(id) on delete cascade,
  percent        int check (percent is null or percent between 1 and 100),
  amount         bigint check (amount is null or amount > 0),
  buy_qty        int check (buy_qty is null or buy_qty >= 1),
  get_qty        int check (get_qty is null or get_qty >= 1),
  get_product_id uuid references public.products(id) on delete cascade,
  min_total      bigint check (min_total is null or min_total >= 0),
  starts_on      date,
  ends_on        date,
  is_active      boolean not null default true,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on),
  check (
    (kind = 'ITEM_DISCOUNT' and (product_id is null) <> (category_id is null) and (percent is null) <> (amount is null))
    or (kind = 'BUY_X_GET_Y' and product_id is not null and buy_qty is not null and get_qty is not null and get_product_id is not null)
    or (kind = 'ORDER_DISCOUNT' and (percent is null) <> (amount is null))
  )
);
create index on public.promotions (business_id) where archived_at is null;
alter table public.promotions enable row level security;
create policy promotions_select on public.promotions
  for select to authenticated using (business_id in (select public.my_business_ids()));
grant select on public.promotions to authenticated;
revoke insert, update, delete, truncate on public.promotions from authenticated, anon;

alter table public.businesses
  add column allow_cashier_discount boolean not null default false,
  add column owner_name text check (owner_name is null or length(owner_name) <= 100);

alter table public.orders
  add column discount_amount bigint not null default 0 check (discount_amount >= 0),
  add column promotion_id    uuid references public.promotions(id) on delete set null,
  add column discount_note   text check (discount_note is null or length(discount_note) <= 100),
  -- Doanh thu theo nhóm ngành khi quán có danh mục đặt nhóm riêng (null = cả đơn theo ngành của quán)
  add column tax_groups      jsonb;

-- Dòng hàng: giảm giá dòng, chương trình, món tặng. Tiền dòng = số lượng × đơn giá − giảm giá dòng.
alter table public.order_items
  add column discount_amount bigint not null default 0 check (discount_amount >= 0),
  add column promotion_id    uuid references public.promotions(id) on delete set null,
  add column is_gift         boolean not null default false,
  add constraint order_items_gift_free check (not is_gift or unit_price = 0);
alter table public.order_items drop column line_amount;
alter table public.order_items
  add column line_amount bigint generated always as (greatest(round(quantity * unit_price)::bigint - discount_amount, 0)) stored;

-- Tổng đơn = tổng tiền dòng − giảm giá cả đơn
create or replace function public.recalc_order_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set total_amount = greatest(coalesce((select sum(line_amount) from public.order_items where order_id = v_order), 0) - o.discount_amount, 0)
   where o.id = v_order;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 5. Tạo đơn có giảm giá (thay create_order_v1 / create_cash_sale_v1; gọi kiểu cũ vẫn chạy nhờ tham số mặc định)
-- ---------------------------------------------------------------------
drop function public.create_cash_sale_v1(uuid, uuid, jsonb, timestamptz, text);
drop function public.create_order_v1(uuid, uuid, jsonb, text, timestamptz, text);

create or replace function public.create_order_v1(
  p_order_id uuid,
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text default 'VIETQR',
  p_sold_at timestamptz default now(),
  p_device_id text default null,
  p_discount_amount bigint default 0,
  p_promotion_id uuid default null,
  p_discount_note text default null
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_n int;
  v_bad int;
  v_manual boolean;
  v_sub bigint;
  v_disc bigint := coalesce(p_discount_amount, 0);
begin
  if p_order_id is null or p_business_id is null then
    raise exception 'QP_INVALID_INPUT' using detail = 'Thiếu mã đơn hoặc mã hộ';
  end if;
  if not public.is_member(p_business_id) then
    raise exception 'QP_FORBIDDEN' using detail = 'Không phải thành viên của hộ';
  end if;
  if p_payment_method not in ('VIETQR','CASH') then
    raise exception 'QP_INVALID_INPUT' using detail = 'payment_method phải là VIETQR hoặc CASH';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is not null then
    if v_order.business_id <> p_business_id then
      raise exception 'QP_ORDER_CONFLICT' using detail = 'Mã đơn đã dùng cho hộ khác';
    end if;
    return v_order;
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'QP_INVALID_ITEMS' using detail = 'p_items phải là mảng';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 200 then
    raise exception 'QP_INVALID_ITEMS' using detail = 'Cần 1–200 dòng hàng';
  end if;
  select count(*) into v_bad
    from jsonb_to_recordset(p_items) as x(name text, quantity numeric, unit_price bigint, product_id uuid,
                                          discount_amount bigint, promotion_id uuid, is_gift boolean)
   where coalesce(length(trim(x.name)), 0) = 0 or length(x.name) > 200
      or x.quantity is null or x.quantity <= 0 or x.quantity > 100000
      or x.unit_price is null or x.unit_price < 0 or x.unit_price > 100000000000
      or coalesce(x.discount_amount, 0) < 0 or coalesce(x.discount_amount, 0) > round(x.quantity * x.unit_price)
      or (coalesce(x.is_gift, false) and x.unit_price <> 0)
      or (x.product_id is not null and not exists
            (select 1 from public.products p where p.id = x.product_id and p.business_id = p_business_id))
      or (x.promotion_id is not null and not exists
            (select 1 from public.promotions m where m.id = x.promotion_id and m.business_id = p_business_id));
  if v_bad > 0 then
    raise exception 'QP_INVALID_ITEMS' using detail = v_bad || ' dòng hàng không hợp lệ';
  end if;
  if v_disc < 0 or (p_promotion_id is not null and not exists
        (select 1 from public.promotions m where m.id = p_promotion_id and m.business_id = p_business_id))
     or length(coalesce(p_discount_note, '')) > 100 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  -- Giảm tay (không theo chương trình): chủ / quản lý, hoặc thu ngân khi quán cho phép
  select (v_disc > 0 and p_promotion_id is null) or exists (
           select 1 from jsonb_to_recordset(p_items) as x(discount_amount bigint, promotion_id uuid)
            where coalesce(x.discount_amount, 0) > 0 and x.promotion_id is null)
    into v_manual;
  if v_manual and not public.has_role(p_business_id, array['OWNER','MANAGER'])
     and not coalesce((select allow_cashier_discount from public.businesses where id = p_business_id), false) then
    raise exception 'QP_FORBIDDEN' using detail = 'Không được giảm giá tay';
  end if;

  begin
    insert into public.orders (id, business_id, payment_method, sold_at, created_by, created_device_id,
                               discount_amount, promotion_id, discount_note)
    values (p_order_id, p_business_id, p_payment_method, coalesce(p_sold_at, now()), auth.uid(), p_device_id,
            v_disc, p_promotion_id, case when v_disc > 0 then nullif(trim(coalesce(p_discount_note, '')), '') end);
  exception when unique_violation then
    select * into v_order from public.orders where id = p_order_id;
    if v_order.business_id <> p_business_id then
      raise exception 'QP_ORDER_CONFLICT' using detail = 'Mã đơn đã dùng cho hộ khác';
    end if;
    return v_order;
  end;

  insert into public.order_items (order_id, product_id, name, quantity, unit_price, discount_amount, promotion_id, is_gift)
  select p_order_id, x.product_id, trim(x.name), x.quantity, x.unit_price, coalesce(x.discount_amount, 0), x.promotion_id,
         coalesce(x.is_gift, false)
    from jsonb_to_recordset(p_items) as x(name text, quantity numeric, unit_price bigint, product_id uuid,
                                          discount_amount bigint, promotion_id uuid, is_gift boolean);

  select coalesce(sum(line_amount), 0) into v_sub from public.order_items where order_id = p_order_id;
  if v_disc > v_sub then raise exception 'QP_INVALID_INPUT' using detail = 'Giảm giá lớn hơn tiền hàng'; end if;
  update public.orders set tax_groups = public.order_tax_groups(p_order_id) where id = p_order_id;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.total_amount <= 0 and p_payment_method = 'VIETQR' then
    raise exception 'QP_INVALID_ITEMS' using detail = 'Đơn chuyển khoản phải lớn hơn 0 đ';
  end if;
  return v_order;
end $$;

create or replace function public.create_cash_sale_v1(
  p_order_id uuid, p_business_id uuid, p_items jsonb,
  p_sold_at timestamptz default now(), p_device_id text default null,
  p_discount_amount bigint default 0, p_promotion_id uuid default null, p_discount_note text default null
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders%rowtype;
begin
  v_order := public.create_order_v1(p_order_id, p_business_id, p_items, 'CASH', p_sold_at, p_device_id,
                                    p_discount_amount, p_promotion_id, p_discount_note);
  if v_order.payment_method <> 'CASH' then
    raise exception 'QP_ORDER_CONFLICT' using detail = 'Mã đơn đã dùng cho đơn chuyển khoản';
  end if;
  perform public.confirm_cash_payment(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end $$;

-- Doanh thu từng nhóm ngành của một đơn (theo danh mục có đặt nhóm riêng), giảm giá cả đơn chia theo tỷ lệ.
-- Null khi cả đơn thuộc ngành của quán (đa số quán) → không tốn chỗ.
create or replace function public.order_tax_groups(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_base text; v_disc bigint; v_sum bigint; v_left bigint; v_out jsonb := '{}'::jsonb; r record; v_n int; v_i int := 0; v_cut bigint;
begin
  select coalesce(b.tax_industry, 'GOODS'), o.discount_amount into v_base, v_disc
    from public.orders o join public.businesses b on b.id = o.business_id where o.id = p_order_id;
  if not exists (select 1 from public.order_items oi join public.products p on p.id = oi.product_id
                   join public.product_categories c on c.id = p.category_id
                  where oi.order_id = p_order_id and c.tax_group is not null and c.archived_at is null) then
    return null;
  end if;
  select sum(line_amount) into v_sum from public.order_items where order_id = p_order_id;
  if coalesce(v_sum, 0) <= 0 then return null; end if;
  select count(*) into v_n from (
    select coalesce(c.tax_group, v_base) g
      from public.order_items oi left join public.products p on p.id = oi.product_id
      left join public.product_categories c on c.id = p.category_id and c.archived_at is null
     where oi.order_id = p_order_id and oi.line_amount > 0 group by 1) t;
  v_left := v_disc;
  for r in
    select coalesce(c.tax_group, v_base) g, sum(oi.line_amount) amt
      from public.order_items oi left join public.products p on p.id = oi.product_id
      left join public.product_categories c on c.id = p.category_id and c.archived_at is null
     where oi.order_id = p_order_id and oi.line_amount > 0 group by 1 order by 1
  loop
    v_i := v_i + 1;
    v_cut := case when v_i = v_n then v_left else round(v_disc * r.amt / v_sum)::bigint end;
    v_left := v_left - v_cut;
    v_out := v_out || jsonb_build_object(r.g, r.amt - v_cut);
  end loop;
  if v_n = 1 and v_out ? v_base then return null; end if;
  return v_out;
end $$;
revoke all on function public.order_tax_groups(uuid) from public, anon, authenticated;

revoke all on function public.create_order_v1(uuid, uuid, jsonb, text, timestamptz, text, bigint, uuid, text) from public, anon;
grant execute on function public.create_order_v1(uuid, uuid, jsonb, text, timestamptz, text, bigint, uuid, text) to authenticated;
revoke all on function public.create_cash_sale_v1(uuid, uuid, jsonb, timestamptz, text, bigint, uuid, text) from public, anon;
grant execute on function public.create_cash_sale_v1(uuid, uuid, jsonb, timestamptz, text, bigint, uuid, text) to authenticated;

-- Cài đặt quán: thêm "thu ngân được giảm giá tay"
drop function public.update_business_settings_v1(uuid, boolean);
create or replace function public.update_business_settings_v1(
  p_business_id uuid, p_allow_cashier_manual_confirm boolean, p_allow_cashier_discount boolean default null
) returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  update public.businesses
     set allow_cashier_manual_confirm = coalesce(p_allow_cashier_manual_confirm, allow_cashier_manual_confirm),
         allow_cashier_discount = coalesce(p_allow_cashier_discount, allow_cashier_discount)
   where id = p_business_id
  returning * into v;
  return v;
end $$;
revoke all on function public.update_business_settings_v1(uuid, boolean, boolean) from public, anon;
grant execute on function public.update_business_settings_v1(uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Giá vốn theo lô
-- ---------------------------------------------------------------------
-- Giá vốn bình quân khi xuất p_qty (chỉ đọc; trigger trim_lots_to_stock trừ lô sau khi tồn giảm):
-- phần tồn không thuộc lô nào (hàng cũ) trước theo giá nhập của món, rồi lô hết hạn sớm / nhập trước.
create or replace function public.lot_cost_for(p_product_id uuid, p_qty numeric)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  v_stock numeric; v_fallback bigint; v_in_lots numeric; v_rest numeric := p_qty; v_cost numeric := 0; v_known boolean := false;
  v_loose numeric; l record; v_take numeric; v_c bigint;
begin
  if coalesce(p_qty, 0) <= 0 then return null; end if;
  select stock_qty, cost_price into v_stock, v_fallback from public.products where id = p_product_id;
  select coalesce(sum(qty_left), 0) into v_in_lots from public.stock_lots where product_id = p_product_id and qty_left > 0;
  v_loose := least(greatest(v_stock - v_in_lots, 0), v_rest);
  if v_loose > 0 then
    if v_fallback is not null then v_cost := v_cost + v_loose * v_fallback; v_known := true; end if;
    v_rest := v_rest - v_loose;
  end if;
  for l in select qty_left, unit_cost from public.stock_lots
            where product_id = p_product_id and qty_left > 0 order by expires_on nulls last, created_at
  loop
    exit when v_rest <= 0;
    v_take := least(l.qty_left, v_rest);
    v_c := coalesce(l.unit_cost, v_fallback);
    if v_c is not null then v_cost := v_cost + v_take * v_c; v_known := true; end if;
    v_rest := v_rest - v_take;
  end loop;
  if v_rest > 0 and v_fallback is not null then v_cost := v_cost + v_rest * v_fallback; v_known := true; end if;
  return case when v_known then round(v_cost / p_qty)::bigint end;
end $$;
revoke all on function public.lot_cost_for(uuid, numeric) from public, anon, authenticated;

-- Đơn trả xong: trừ kho kèm giá vốn theo lô
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
    insert into public.stock_movements (id, business_id, product_id, kind, qty, unit_cost, order_id, created_by)
    values (gen_random_uuid(), new.business_id, it.product_id, 'SALE', -it.qty, public.lot_cost_for(it.product_id, it.qty), new.id, new.created_by)
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

-- ---------------------------------------------------------------------
-- 7. Danh mục: thêm / sửa / bỏ
-- ---------------------------------------------------------------------
create or replace function public.upsert_category_v1(
  p_category_id uuid, p_business_id uuid, p_name text, p_sort_order int default null,
  p_tax_group text default null, p_track_expiry_default boolean default false
) returns public.product_categories
language plpgsql security definer set search_path = public
as $$
declare v public.product_categories%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_category_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 50
     or (p_tax_group is not null and p_tax_group not in ('GOODS','SERVICE','LEASING','PRODUCTION','DIGITAL','OTHER')) then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if exists (select 1 from public.product_categories where business_id = p_business_id and archived_at is null
              and lower(name) = lower(trim(p_name)) and id <> p_category_id) then
    raise exception 'QP_DUPLICATE_NAME';
  end if;
  select * into v from public.product_categories where id = p_category_id for update;
  if v.id is not null and (v.business_id <> p_business_id or v.archived_at is not null) then raise exception 'QP_NOT_FOUND'; end if;
  if v.id is null then
    insert into public.product_categories (id, business_id, name, sort_order, tax_group, track_expiry_default)
    values (p_category_id, p_business_id, trim(p_name), coalesce(p_sort_order, 0), p_tax_group, coalesce(p_track_expiry_default, false))
    returning * into v;
  else
    update public.product_categories set name = trim(p_name), sort_order = coalesce(p_sort_order, sort_order), tax_group = p_tax_group,
           track_expiry_default = coalesce(p_track_expiry_default, false)
     where id = p_category_id returning * into v;
    update public.products set category = v.name where category_id = v.id and category is distinct from v.name;
  end if;
  return v;
end $$;
revoke all on function public.upsert_category_v1(uuid, uuid, text, int, text, boolean) from public, anon;
grant execute on function public.upsert_category_v1(uuid, uuid, text, int, text, boolean) to authenticated;

create or replace function public.archive_category_v1(p_category_id uuid)
returns public.product_categories
language plpgsql security definer set search_path = public
as $$
declare v public.product_categories%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.product_categories where id = p_category_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if v.archived_at is null then
    update public.product_categories set archived_at = now() where id = p_category_id returning * into v;
    update public.products set category_id = null, category = null where category_id = p_category_id;
  end if;
  return v;
end $$;
revoke all on function public.archive_category_v1(uuid) from public, anon;
grant execute on function public.archive_category_v1(uuid) to authenticated;

-- Thêm/sửa món: thêm danh mục theo mã và nhà cung cấp thường nhập (bản 2 thay chữ ký)
drop function public.upsert_product_v2(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric, text, boolean, int);
create or replace function public.upsert_product_v2(
  p_product_id uuid, p_business_id uuid, p_name text, p_price bigint, p_unit text default 'cái',
  p_category text default null, p_cost_price bigint default null, p_track_stock boolean default false,
  p_low_stock_at numeric default null, p_barcode text default null, p_track_expiry boolean default false,
  p_expiry_warn_days int default 7, p_category_id uuid default null, p_supplier_id uuid default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare
  v public.products%rowtype; v_code text := nullif(trim(coalesce(p_barcode, '')), '');
  c public.product_categories%rowtype; v_cat uuid := p_category_id;
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
  if v_cat is not null then
    select * into c from public.product_categories where id = v_cat;
    if c.id is null or c.business_id <> p_business_id or c.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  elsif length(trim(coalesce(p_category, ''))) > 0 then
    -- Bản cũ gửi tên chữ: tìm hoặc tạo danh mục cùng tên
    select * into c from public.product_categories
     where business_id = p_business_id and archived_at is null and lower(name) = lower(trim(p_category));
    if c.id is null then
      insert into public.product_categories (id, business_id, name) values (gen_random_uuid(), p_business_id, trim(p_category)) returning * into c;
    end if;
    v_cat := c.id;
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and business_id = p_business_id and archived_at is null) then
    raise exception 'QP_NOT_FOUND';
  end if;

  select * into v from public.products where id = p_product_id for update;
  if v.id is not null and (v.business_id <> p_business_id or v.archived_at is not null) then raise exception 'QP_NOT_FOUND'; end if;
  if v_code is not null and exists (
    select 1 from public.products
     where business_id = p_business_id and barcode = v_code and archived_at is null and id <> p_product_id) then
    raise exception 'QP_DUPLICATE_BARCODE';
  end if;

  if v.id is null then
    insert into public.products (id, business_id, name, price, unit, category, category_id, supplier_id, cost_price, track_stock,
                                 low_stock_at, barcode, track_expiry, expiry_warn_days)
    values (p_product_id, p_business_id, trim(p_name), p_price, trim(p_unit), c.name, v_cat, p_supplier_id,
            p_cost_price, coalesce(p_track_stock, false) or coalesce(p_track_expiry, false), p_low_stock_at,
            v_code, coalesce(p_track_expiry, false), coalesce(p_expiry_warn_days, 7))
    returning * into v;
  else
    update public.products set name = trim(p_name), price = p_price, unit = trim(p_unit),
           category = c.name, category_id = v_cat, supplier_id = coalesce(p_supplier_id, supplier_id), cost_price = p_cost_price,
           track_stock = coalesce(p_track_stock, false) or coalesce(p_track_expiry, false), low_stock_at = p_low_stock_at,
           barcode = v_code, track_expiry = coalesce(p_track_expiry, false), expiry_warn_days = coalesce(p_expiry_warn_days, 7)
     where id = p_product_id returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.upsert_product_v2(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric, text, boolean, int, uuid, uuid) from public, anon;
grant execute on function public.upsert_product_v2(uuid, uuid, text, bigint, text, text, bigint, boolean, numeric, text, boolean, int, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Nhà cung cấp, phiếu nhập, trả nợ
-- ---------------------------------------------------------------------
create or replace function public.upsert_supplier_v1(
  p_supplier_id uuid, p_business_id uuid, p_name text, p_phone text default null, p_address text default null,
  p_tax_code text default null, p_note text default null
) returns public.suppliers
language plpgsql security definer set search_path = public
as $$
declare v public.suppliers%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_supplier_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 100
     or (nullif(trim(coalesce(p_phone, '')), '') is not null and trim(p_phone) !~ '^[0-9+ .-]{6,20}$')
     or (nullif(p_tax_code, '') is not null and p_tax_code !~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$')
     or length(coalesce(p_address, '')) > 200 or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  select * into v from public.suppliers where id = p_supplier_id for update;
  if v.id is not null and (v.business_id <> p_business_id or v.archived_at is not null) then raise exception 'QP_NOT_FOUND'; end if;
  insert into public.suppliers (id, business_id, name, phone, address, tax_code, note)
  values (p_supplier_id, p_business_id, trim(p_name), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
          nullif(p_tax_code, ''), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, address = excluded.address,
          tax_code = excluded.tax_code, note = excluded.note
  returning * into v;
  return v;
end $$;
revoke all on function public.upsert_supplier_v1(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.upsert_supplier_v1(uuid, uuid, text, text, text, text, text) to authenticated;

create or replace function public.archive_supplier_v1(p_supplier_id uuid)
returns public.suppliers
language plpgsql security definer set search_path = public
as $$
declare v public.suppliers%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.suppliers where id = p_supplier_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  update public.suppliers set archived_at = coalesce(archived_at, now()) where id = p_supplier_id returning * into v;
  update public.products set supplier_id = null where supplier_id = p_supplier_id;
  return v;
end $$;
revoke all on function public.archive_supplier_v1(uuid) from public, anon;
grant execute on function public.archive_supplier_v1(uuid) to authenticated;

-- Phiếu nhập: p_lines [{movement_id, product_id, qty, unit_cost, expires_on}], mỗi dòng một lô. Gửi lại cùng mã phiếu → trả phiếu cũ.
create or replace function public.create_purchase_v1(
  p_purchase_id uuid, p_business_id uuid, p_supplier_id uuid, p_lines jsonb, p_paid_amount bigint default null,
  p_record_expense boolean default false, p_note text default null, p_purchased_on date default null
) returns public.purchases
language plpgsql security definer set search_path = public
as $$
declare
  v public.purchases%rowtype; s public.suppliers%rowtype; l record; p public.products%rowtype;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_day date := coalesce(p_purchased_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_total bigint := 0; v_paid bigint; v_n int; v_expense bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  select * into v from public.purchases where id = p_purchase_id;
  if v.id is not null then
    if v.business_id <> p_business_id then raise exception 'QP_NOT_FOUND'; end if;
    return v;   -- gửi lại
  end if;
  if p_purchase_id is null or jsonb_typeof(p_lines) <> 'array' or v_day > v_today or v_day < v_today - 366
     or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  v_n := jsonb_array_length(p_lines);
  if v_n < 1 or v_n > 200 then raise exception 'QP_INVALID_INPUT'; end if;
  if p_supplier_id is not null then
    select * into s from public.suppliers where id = p_supplier_id;
    if s.id is null or s.business_id <> p_business_id or s.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  end if;

  for l in select * from jsonb_to_recordset(p_lines) as x(movement_id uuid, product_id uuid, qty numeric, unit_cost bigint, expires_on date)
  loop
    select * into p from public.products where id = l.product_id;
    if p.id is null or p.business_id <> p_business_id or p.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
    if l.movement_id is null or coalesce(l.qty, 0) <= 0 or l.qty > 1000000 or (l.unit_cost is not null and l.unit_cost < 0)
       or exists (select 1 from public.stock_movements where id = l.movement_id)
       or (l.expires_on is not null and (l.expires_on < v_today - 3650 or l.expires_on > v_today + 3650 * 3)) then
      raise exception 'QP_INVALID_INPUT';
    end if;
    if p.track_expiry and l.expires_on is null then raise exception 'QP_EXPIRY_REQUIRED'; end if;
    v_total := v_total + coalesce(round(l.qty * l.unit_cost)::bigint, 0);
  end loop;
  if (select count(distinct x.movement_id) from jsonb_to_recordset(p_lines) as x(movement_id uuid)) <> v_n then
    raise exception 'QP_INVALID_INPUT';
  end if;
  -- Không có nhà cung cấp thì không có công nợ: coi như trả đủ
  v_paid := case when p_supplier_id is null then v_total else coalesce(p_paid_amount, 0) end;
  if v_paid < 0 or v_paid > v_total then raise exception 'QP_INVALID_INPUT'; end if;

  insert into public.purchases (id, business_id, supplier_id, purchased_on, total_amount, paid_amount, line_count, note)
  values (p_purchase_id, p_business_id, p_supplier_id, v_day, v_total, v_paid, v_n, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v;

  for l in select * from jsonb_to_recordset(p_lines) as x(movement_id uuid, product_id uuid, qty numeric, unit_cost bigint, expires_on date)
  loop
    insert into public.stock_lots (id, business_id, product_id, expires_on, qty_in, qty_left, unit_cost, supplier_id, purchase_id, received_on)
    values (l.movement_id, p_business_id, l.product_id, l.expires_on, l.qty, l.qty, l.unit_cost, p_supplier_id, p_purchase_id, v_day);
    insert into public.stock_movements (id, business_id, product_id, kind, qty, unit_cost, note, lot_id, supplier_id, purchase_id)
    values (l.movement_id, p_business_id, l.product_id, 'IN', l.qty, l.unit_cost, nullif(trim(coalesce(p_note, '')), ''), l.movement_id,
            p_supplier_id, p_purchase_id);
    update public.products set stock_qty = stock_qty + l.qty, track_stock = true, cost_price = coalesce(l.unit_cost, cost_price),
           supplier_id = coalesce(supplier_id, p_supplier_id)
     where id = l.product_id;
  end loop;

  if p_supplier_id is not null and v_paid > 0 then
    insert into public.supplier_payments (id, business_id, supplier_id, amount, paid_on, note, purchase_id)
    values (p_purchase_id, p_business_id, p_supplier_id, v_paid, v_day, 'Trả khi nhập hàng', p_purchase_id);
  end if;
  v_expense := case when p_supplier_id is null then v_total else v_paid end;
  if coalesce(p_record_expense, false) and v_expense > 0 then
    insert into public.journal_entries (business_id, entry_type, amount, category, description, source, source_id, entry_date)
    values (p_business_id, 'EXPENSE', v_expense, 'Nhập hàng',
            case when p_supplier_id is null then 'Nhập ' || v_n || ' mặt hàng' else 'Nhập hàng · ' || s.name end, 'MANUAL', p_purchase_id, v_day)
    on conflict (business_id, source, source_id) do nothing;
  end if;
  return v;
end $$;
revoke all on function public.create_purchase_v1(uuid, uuid, uuid, jsonb, bigint, boolean, text, date) from public, anon;
grant execute on function public.create_purchase_v1(uuid, uuid, uuid, jsonb, bigint, boolean, text, date) to authenticated;

-- Nhập một món (màn một món) = phiếu nhập một dòng; thêm nhà cung cấp, trả ngay
drop function public.stock_in_v2(uuid, uuid, numeric, bigint, text, boolean, date);
create or replace function public.stock_in_v2(
  p_movement_id uuid, p_product_id uuid, p_qty numeric, p_unit_cost bigint default null,
  p_note text default null, p_record_expense boolean default false, p_expires_on date default null,
  p_supplier_id uuid default null, p_paid_amount bigint default null, p_received_on date default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; v_total bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id;
  if v.id is null or not public.is_member(v.business_id) or v.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;   -- gửi lại
  v_total := coalesce(round(p_qty * p_unit_cost)::bigint, 0);
  perform public.create_purchase_v1(
    p_movement_id, v.business_id, p_supplier_id,
    jsonb_build_array(jsonb_build_object('movement_id', p_movement_id, 'product_id', p_product_id, 'qty', p_qty,
                                         'unit_cost', p_unit_cost, 'expires_on', p_expires_on)),
    coalesce(p_paid_amount, v_total), p_record_expense, p_note, p_received_on);
  select * into v from public.products where id = p_product_id;
  return v;
end $$;
revoke all on function public.stock_in_v2(uuid, uuid, numeric, bigint, text, boolean, date, uuid, bigint, date) from public, anon;
grant execute on function public.stock_in_v2(uuid, uuid, numeric, bigint, text, boolean, date, uuid, bigint, date) to authenticated;

create or replace function public.pay_supplier_v1(
  p_payment_id uuid, p_supplier_id uuid, p_amount bigint, p_note text default null,
  p_record_expense boolean default false, p_paid_on date default null
) returns public.supplier_payments
language plpgsql security definer set search_path = public
as $$
declare v public.supplier_payments%rowtype; s public.suppliers%rowtype;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_day date := coalesce(p_paid_on, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into s from public.suppliers where id = p_supplier_id;
  if s.id is null or s.archived_at is not null or not public.is_member(s.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(s.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  select * into v from public.supplier_payments where id = p_payment_id;
  if v.id is not null then return v; end if;   -- gửi lại
  if p_payment_id is null or coalesce(p_amount, 0) <= 0 or p_amount > 100000000000 or v_day > v_today
     or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  insert into public.supplier_payments (id, business_id, supplier_id, amount, paid_on, note)
  values (p_payment_id, s.business_id, s.id, p_amount, v_day, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v;
  if coalesce(p_record_expense, false) then
    insert into public.journal_entries (business_id, entry_type, amount, category, description, source, source_id, entry_date)
    values (s.business_id, 'EXPENSE', p_amount, 'Nhập hàng', 'Trả nợ ' || s.name, 'MANUAL', p_payment_id, v_day)
    on conflict (business_id, source, source_id) do nothing;
  end if;
  return v;
end $$;
revoke all on function public.pay_supplier_v1(uuid, uuid, bigint, text, boolean, date) from public, anon;
grant execute on function public.pay_supplier_v1(uuid, uuid, bigint, text, boolean, date) to authenticated;

create or replace function public.void_supplier_payment_v1(p_payment_id uuid)
returns public.supplier_payments
language plpgsql security definer set search_path = public
as $$
declare v public.supplier_payments%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.supplier_payments where id = p_payment_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if v.voided_at is null then
    update public.supplier_payments set voided_at = now() where id = p_payment_id returning * into v;
    update public.journal_entries set voided_at = now()
     where business_id = v.business_id and source = 'MANUAL' and source_id = p_payment_id and category = 'Nhập hàng' and voided_at is null;
  end if;
  return v;
end $$;
revoke all on function public.void_supplier_payment_v1(uuid) from public, anon;
grant execute on function public.void_supplier_payment_v1(uuid) to authenticated;

-- Đọc (quyền người gọi, RLS lọc theo hộ)
create or replace function public.supplier_balances(p_business_id uuid)
returns table (supplier_id uuid, name text, phone text, purchased bigint, paid bigint, balance bigint, last_purchase_on date)
language sql stable as $$
  select s.id, s.name, s.phone, coalesce(pu.total, 0)::bigint, coalesce(pa.total, 0)::bigint,
         (coalesce(pu.total, 0) - coalesce(pa.total, 0))::bigint, pu.last_on
    from public.suppliers s
    left join lateral (select sum(total_amount) total, max(purchased_on) last_on from public.purchases where supplier_id = s.id) pu on true
    left join lateral (select sum(amount) total from public.supplier_payments where supplier_id = s.id and voided_at is null) pa on true
   where s.business_id = p_business_id and s.archived_at is null
   order by 6 desc, 2;
$$;

create or replace function public.supplier_detail(p_supplier_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'supplier', to_jsonb(s),
    'purchased', coalesce((select sum(total_amount) from public.purchases where supplier_id = s.id), 0),
    'paid', coalesce((select sum(amount) from public.supplier_payments where supplier_id = s.id and voided_at is null), 0),
    'balance', coalesce((select sum(total_amount) from public.purchases where supplier_id = s.id), 0)
               - coalesce((select sum(amount) from public.supplier_payments where supplier_id = s.id and voided_at is null), 0),
    'purchases', coalesce((select jsonb_agg(to_jsonb(x) order by x.purchased_on desc, x.created_at desc)
                             from (select * from public.purchases where supplier_id = s.id order by purchased_on desc, created_at desc limit 100) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.paid_on desc, x.created_at desc)
                            from (select * from public.supplier_payments where supplier_id = s.id order by paid_on desc, created_at desc limit 100) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'qty_total', t.qty,
                                                              'last_cost', t.last_cost, 'last_on', t.last_on, 'archived', p.archived_at is not null)
                                           order by t.last_on desc nulls last)
                            from (select product_id, sum(qty_in) qty, max(received_on) last_on,
                                         (array_agg(unit_cost order by received_on desc, created_at desc))[1] last_cost
                                    from public.stock_lots where supplier_id = s.id group by product_id) t
                            join public.products p on p.id = t.product_id), '[]'::jsonb))
  from public.suppliers s where s.id = p_supplier_id;
$$;

create or replace function public.product_suppliers(p_product_id uuid)
returns table (supplier_id uuid, name text, qty_total numeric, last_cost bigint, last_on date, is_default boolean)
language sql stable as $$
  select s.id, s.name, sum(l.qty_in), (array_agg(l.unit_cost order by l.received_on desc, l.created_at desc))[1], max(l.received_on),
         bool_or(p.supplier_id = s.id)
    from public.stock_lots l join public.suppliers s on s.id = l.supplier_id join public.products p on p.id = l.product_id
   where l.product_id = p_product_id
   group by s.id, s.name
   order by 5 desc nulls last;
$$;

-- ---------------------------------------------------------------------
-- 9. Khuyến mãi
-- ---------------------------------------------------------------------
create or replace function public.upsert_promotion_v1(
  p_promotion_id uuid, p_business_id uuid, p_name text, p_kind text,
  p_product_id uuid default null, p_category_id uuid default null, p_percent int default null, p_amount bigint default null,
  p_buy_qty int default null, p_get_qty int default null, p_get_product_id uuid default null, p_min_total bigint default null,
  p_starts_on date default null, p_ends_on date default null, p_is_active boolean default true
) returns public.promotions
language plpgsql security definer set search_path = public
as $$
declare v public.promotions%rowtype; v_get uuid := coalesce(p_get_product_id, p_product_id);
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_promotion_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 80
     or coalesce(p_kind, '') not in ('ITEM_DISCOUNT','BUY_X_GET_Y','ORDER_DISCOUNT')
     or (p_product_id is not null and not exists (select 1 from public.products where id = p_product_id and business_id = p_business_id and archived_at is null))
     or (p_kind = 'BUY_X_GET_Y' and not exists (select 1 from public.products where id = v_get and business_id = p_business_id and archived_at is null))
     or (p_category_id is not null and not exists (select 1 from public.product_categories where id = p_category_id and business_id = p_business_id and archived_at is null)) then
    raise exception 'QP_INVALID_INPUT';
  end if;
  select * into v from public.promotions where id = p_promotion_id for update;
  if v.id is not null and (v.business_id <> p_business_id or v.archived_at is not null) then raise exception 'QP_NOT_FOUND'; end if;
  begin
    insert into public.promotions (id, business_id, name, kind, product_id, category_id, percent, amount, buy_qty, get_qty, get_product_id,
                                   min_total, starts_on, ends_on, is_active)
    values (p_promotion_id, p_business_id, trim(p_name), p_kind,
            case when p_kind = 'ORDER_DISCOUNT' then null else p_product_id end,
            case when p_kind = 'ITEM_DISCOUNT' then p_category_id end,
            case when p_kind <> 'BUY_X_GET_Y' then p_percent end, case when p_kind <> 'BUY_X_GET_Y' then p_amount end,
            case when p_kind = 'BUY_X_GET_Y' then p_buy_qty end, case when p_kind = 'BUY_X_GET_Y' then p_get_qty end,
            case when p_kind = 'BUY_X_GET_Y' then v_get end,
            case when p_kind = 'ORDER_DISCOUNT' then coalesce(p_min_total, 0) end,
            p_starts_on, p_ends_on, coalesce(p_is_active, true))
    on conflict (id) do update set name = excluded.name, kind = excluded.kind, product_id = excluded.product_id,
           category_id = excluded.category_id, percent = excluded.percent, amount = excluded.amount, buy_qty = excluded.buy_qty,
           get_qty = excluded.get_qty, get_product_id = excluded.get_product_id, min_total = excluded.min_total,
           starts_on = excluded.starts_on, ends_on = excluded.ends_on, is_active = excluded.is_active
    returning * into v;
  exception when check_violation then
    raise exception 'QP_INVALID_INPUT';
  end;
  return v;
end $$;
revoke all on function public.upsert_promotion_v1(uuid, uuid, text, text, uuid, uuid, int, bigint, int, int, uuid, bigint, date, date, boolean) from public, anon;
grant execute on function public.upsert_promotion_v1(uuid, uuid, text, text, uuid, uuid, int, bigint, int, int, uuid, bigint, date, date, boolean) to authenticated;

create or replace function public.archive_promotion_v1(p_promotion_id uuid)
returns public.promotions
language plpgsql security definer set search_path = public
as $$
declare v public.promotions%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.promotions where id = p_promotion_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  update public.promotions set archived_at = coalesce(archived_at, now()), is_active = false where id = p_promotion_id returning * into v;
  return v;
end $$;
revoke all on function public.archive_promotion_v1(uuid) from public, anon;
grant execute on function public.archive_promotion_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Xuất kho: thêm hàng tặng / hàng mẫu, ghi giá vốn
-- ---------------------------------------------------------------------
create or replace function public.stock_out_v1(
  p_movement_id uuid, p_product_id uuid, p_qty numeric, p_reason text,
  p_lot_id uuid default null, p_note text default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v public.products%rowtype; l public.stock_lots%rowtype; v_cost bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.products where id = p_product_id for update;
  if v.id is null or not public.is_member(v.business_id) or v.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if exists (select 1 from public.stock_movements where id = p_movement_id) then return v; end if;   -- gửi lại
  if p_movement_id is null or coalesce(p_qty, 0) <= 0 or p_qty > 100000000
     or coalesce(p_reason, '') not in ('EXPIRED','DAMAGED','USED','GIFT','SAMPLE','OTHER') or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if p_qty > greatest(v.stock_qty, 0) then raise exception 'QP_OUT_EXCEEDS_STOCK'; end if;

  if p_lot_id is not null then
    select * into l from public.stock_lots where id = p_lot_id and product_id = p_product_id for update;
    if l.id is null then raise exception 'QP_NOT_FOUND'; end if;
    if p_qty > l.qty_left then raise exception 'QP_OUT_EXCEEDS_STOCK'; end if;
    v_cost := coalesce(l.unit_cost, v.cost_price);
    update public.stock_lots set qty_left = qty_left - p_qty where id = p_lot_id;
  else
    v_cost := public.lot_cost_for(p_product_id, p_qty);
  end if;

  insert into public.stock_movements (id, business_id, product_id, kind, qty, unit_cost, reason, lot_id, note)
  values (p_movement_id, v.business_id, p_product_id, 'OUT', -p_qty, v_cost, p_reason, p_lot_id, nullif(trim(coalesce(p_note, '')), ''));
  update public.products set stock_qty = stock_qty - p_qty where id = p_product_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 11. Kiểm kê
-- ---------------------------------------------------------------------
create or replace function public.start_stock_count_v1(p_count_id uuid, p_business_id uuid, p_note text default null)
returns public.stock_counts
language plpgsql security definer set search_path = public
as $$
declare v public.stock_counts%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  select * into v from public.stock_counts where id = p_count_id;
  if v.id is not null then
    if v.business_id <> p_business_id then raise exception 'QP_NOT_FOUND'; end if;
    return v;
  end if;
  if length(coalesce(p_note, '')) > 200 then raise exception 'QP_INVALID_INPUT'; end if;
  if exists (select 1 from public.stock_counts where business_id = p_business_id and status = 'OPEN') then
    raise exception 'QP_COUNT_ALREADY_OPEN';
  end if;
  insert into public.stock_counts (id, business_id, note) values (p_count_id, p_business_id, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v;
  return v;
end $$;
revoke all on function public.start_stock_count_v1(uuid, uuid, text) from public, anon;
grant execute on function public.start_stock_count_v1(uuid, uuid, text) to authenticated;

-- Ghi số đếm một món (đếm lại thì ghi đè); số trên máy chụp lúc đếm
create or replace function public.count_line_v1(p_count_id uuid, p_product_id uuid, p_counted_qty numeric)
returns public.stock_count_lines
language plpgsql security definer set search_path = public
as $$
declare c public.stock_counts%rowtype; p public.products%rowtype; v public.stock_count_lines%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into c from public.stock_counts where id = p_count_id;
  if c.id is null or not public.is_member(c.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if c.status <> 'OPEN' then raise exception 'QP_COUNT_CLOSED'; end if;
  select * into p from public.products where id = p_product_id;
  if p.id is null or p.business_id <> c.business_id or p.archived_at is not null then raise exception 'QP_NOT_FOUND'; end if;
  if p_counted_qty is null or p_counted_qty < 0 or p_counted_qty > 1000000 then raise exception 'QP_INVALID_INPUT'; end if;
  insert into public.stock_count_lines (count_id, business_id, product_id, expected_qty, counted_qty, diff)
  values (c.id, c.business_id, p.id, p.stock_qty, p_counted_qty, p_counted_qty - p.stock_qty)
  on conflict (count_id, product_id) do update set expected_qty = excluded.expected_qty, counted_qty = excluded.counted_qty,
         diff = excluded.diff, counted_at = now(), counted_by = auth.uid()
  returning * into v;
  return v;
end $$;
revoke all on function public.count_line_v1(uuid, uuid, numeric) from public, anon;
grant execute on function public.count_line_v1(uuid, uuid, numeric) to authenticated;

-- Chốt: áp chênh lệch lúc đếm vào tồn hiện tại (hàng bán sau khi đếm vẫn được trừ đúng); món chưa đếm giữ nguyên
create or replace function public.finish_stock_count_v1(p_count_id uuid)
returns public.stock_counts
language plpgsql security definer set search_path = public
as $$
declare c public.stock_counts%rowtype; l record; v_diffs int := 0; v_value bigint := 0; v_lines int;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into c from public.stock_counts where id = p_count_id for update;
  if c.id is null or not public.is_member(c.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(c.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if c.status <> 'OPEN' then return c; end if;
  select count(*) into v_lines from public.stock_count_lines where count_id = c.id;
  for l in select cl.product_id, cl.diff, p.cost_price from public.stock_count_lines cl join public.products p on p.id = cl.product_id
            where cl.count_id = c.id and cl.diff <> 0
  loop
    v_diffs := v_diffs + 1;
    v_value := v_value + round(l.diff * coalesce(l.cost_price, 0))::bigint;
    insert into public.stock_movements (id, business_id, product_id, kind, qty, unit_cost, note, count_id)
    values (gen_random_uuid(), c.business_id, l.product_id, 'COUNT', l.diff, l.cost_price, 'Kiểm kê', c.id);
    update public.products set stock_qty = stock_qty + l.diff, track_stock = true where id = l.product_id;
  end loop;
  update public.stock_counts set status = 'DONE', finished_at = now(), lines_total = v_lines, lines_diff = v_diffs, value_diff = v_value
   where id = c.id returning * into c;
  return c;
end $$;
revoke all on function public.finish_stock_count_v1(uuid) from public, anon;
grant execute on function public.finish_stock_count_v1(uuid) to authenticated;

create or replace function public.cancel_stock_count_v1(p_count_id uuid)
returns public.stock_counts
language plpgsql security definer set search_path = public
as $$
declare c public.stock_counts%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into c from public.stock_counts where id = p_count_id for update;
  if c.id is null or not public.is_member(c.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(c.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if c.status = 'OPEN' then
    update public.stock_counts set status = 'CANCELLED', finished_at = now() where id = c.id returning * into c;
  end if;
  return c;
end $$;
revoke all on function public.cancel_stock_count_v1(uuid) from public, anon;
grant execute on function public.cancel_stock_count_v1(uuid) to authenticated;

create or replace function public.stock_count_detail(p_count_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'count', to_jsonb(c),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', cl.id, 'product_id', cl.product_id, 'name', p.name, 'unit', p.unit,
                                                          'expected_qty', cl.expected_qty, 'counted_qty', cl.counted_qty, 'diff', cl.diff,
                                                          'counted_at', cl.counted_at, 'cost_price', p.cost_price) order by p.name)
                         from public.stock_count_lines cl join public.products p on p.id = cl.product_id where cl.count_id = c.id), '[]'::jsonb),
    'pending', case when c.status = 'OPEN' then coalesce((
        select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'stock_qty', p.stock_qty,
                                            'category_id', p.category_id, 'barcode', p.barcode) order by p.name)
          from public.products p
         where p.business_id = c.business_id and p.archived_at is null and p.track_stock
           and not exists (select 1 from public.stock_count_lines cl where cl.count_id = c.id and cl.product_id = p.id)), '[]'::jsonb)
      else '[]'::jsonb end)
  from public.stock_counts c where c.id = p_count_id;
$$;

-- ---------------------------------------------------------------------
-- 12. Doanh thu theo nhóm ngành (mẫu 01/TKN-CNKD). Chỉ chủ / quản lý. Đọc đơn đã trả trong kỳ (theo ngày Việt Nam).
-- ---------------------------------------------------------------------
create or replace function public.revenue_notice(p_business_id uuid, p_from_day date, p_to_day date)
returns jsonb language plpgsql stable as $$
declare b public.businesses%rowtype; v_from timestamptz; v_to timestamptz; v_groups jsonb; v_total bigint; v_orders int;
begin
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_from_day is null or p_to_day is null or p_from_day > p_to_day or p_to_day - p_from_day > 400 then raise exception 'QP_INVALID_INPUT'; end if;
  select * into b from public.businesses where id = p_business_id;
  v_from := (p_from_day::timestamp at time zone 'Asia/Ho_Chi_Minh');
  v_to := ((p_to_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  select coalesce(sum(total_amount), 0), count(*) into v_total, v_orders
    from public.orders where business_id = p_business_id and payment_status = 'PAID' and sold_at >= v_from and sold_at < v_to;
  select coalesce(jsonb_object_agg(g, amt), '{}'::jsonb) into v_groups from (
    select e.key g, sum(e.value::bigint) amt
      from public.orders o,
           jsonb_each_text(coalesce(o.tax_groups, jsonb_build_object(coalesce(b.tax_industry, 'GOODS'), o.total_amount))) e
     where o.business_id = p_business_id and o.payment_status = 'PAID' and o.sold_at >= v_from and o.sold_at < v_to
     group by 1) t;
  return jsonb_build_object('business_name', b.business_name, 'owner_name', b.owner_name, 'tax_code', b.tax_code, 'address', b.address,
                            'tax_industry', coalesce(b.tax_industry, 'GOODS'), 'from', p_from_day, 'to', p_to_day,
                            'total', v_total, 'orders', v_orders, 'by_group', v_groups);
end $$;
