-- =====================================================================
-- Micro SaaS VN — migration lõi: hộ kinh doanh, POS + VietQR, hóa đơn điện tử, sổ thu chi
-- Áp dụng cho Supabase (PostgreSQL 15+). Chạy bằng: supabase db push
--
-- Nguyên tắc thiết kế
--  1. Mọi bảng nghiệp vụ gắn với business_id (tenant), KHÔNG gắn trực tiếp auth.users,
--     để một hộ có thể có nhiều người dùng (chủ hộ, thu ngân, kế toán dịch vụ).
--  2. RLS bật trên MỌI bảng public. Client (anon/authenticated) chỉ thấy dữ liệu
--     của hộ mình là thành viên.
--  3. Những thao tác có ý nghĩa tiền/thuế (xác nhận thanh toán, cấp số hóa đơn)
--     chỉ chạy qua hàm SECURITY DEFINER; client không thể tự đổi trạng thái.
--  4. Đối soát chuyển khoản luôn bắt đầu từ TÀI KHOẢN NHẬN TIỀN (payment_accounts) để xác định
--     hộ, rồi mới tìm đơn trong hộ đó. Không bao giờ tìm mã đơn trên toàn hệ thống.
--  5. Số hóa đơn: 8 chữ số, liên tục theo (hộ, mẫu số, ký hiệu, năm), quay về 1 khi sang năm
--     (Phụ lục nội dung hóa đơn kèm NĐ 254/2026/NĐ-CP). Số chỉ được cấp khi phát hành,
--     không cấp lúc tạo nháp, để không sinh lỗ hổng dãy số.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tiện ích chung
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. Hộ kinh doanh (tenant) và thành viên
-- ---------------------------------------------------------------------
create table public.businesses (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete restrict,
  business_name     text not null check (length(trim(business_name)) > 0),
  tax_code          varchar(14) not null
                    check (tax_code ~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$'),
                    -- MST 10 số, 12 số (định danh cá nhân) hoặc 10-3 (chi nhánh)
  address           text not null,
  -- Nhóm doanh thu theo NĐ 68/2026 sửa đổi bởi NĐ 141/2026 (ngưỡng 1 tỷ).
  -- Lưu ý: đây là khai báo của người dùng, ứng dụng không tự kết luận nghĩa vụ thuế.
  revenue_group     text not null default 'UNDER_1B'
                    check (revenue_group in ('UNDER_1B', 'OVER_1B')),
  -- Nhà cung cấp hóa đơn điện tử mà hộ đã đăng ký (MISA, Viettel, VNPT, EasyInvoice...)
  einvoice_provider text,
  -- Tài khoản nhận tiền để sinh VietQR
  bank_bin          varchar(8),
  bank_account_no   varchar(30),
  bank_account_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tax_code)
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('OWNER', 'MANAGER', 'CASHIER', 'ACCOUNTANT')),
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index on public.business_members (user_id);

-- Hàm kiểm tra quyền. SECURITY DEFINER để tránh đệ quy RLS khi policy
-- của business_members tự tham chiếu chính nó.
create or replace function public.is_member(p_business_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_role(p_business_id uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = p_business_id and user_id = auth.uid() and role = any (p_roles)
  );
$$;

-- Chủ hộ tự động thành thành viên OWNER khi tạo hộ
create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.business_members (business_id, user_id, role)
  values (new.id, new.owner_id, 'OWNER');
  return new;
end $$;

create trigger trg_businesses_owner after insert on public.businesses
  for each row execute function public.add_owner_membership();
create trigger trg_businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

-- Không cho đổi chủ hộ qua UPDATE thường
create or replace function public.lock_business_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id không được thay đổi trực tiếp';
  end if;
  return new;
end $$;
create trigger trg_businesses_lock_owner before update on public.businesses
  for each row execute function public.lock_business_owner();

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;

create policy businesses_select on public.businesses
  for select to authenticated using (public.is_member(id));
create policy businesses_insert on public.businesses
  for insert to authenticated with check (owner_id = auth.uid());
create policy businesses_update on public.businesses
  for update to authenticated
  using (public.has_role(id, array['OWNER','MANAGER']))
  with check (public.has_role(id, array['OWNER','MANAGER']));
create policy businesses_delete on public.businesses
  for delete to authenticated using (owner_id = auth.uid());

create policy members_select on public.business_members
  for select to authenticated using (public.is_member(business_id));
-- Chỉ OWNER thêm/xóa/đổi vai trò thành viên; không ai tự gán mình là OWNER
create policy members_insert on public.business_members
  for insert to authenticated
  with check (public.has_role(business_id, array['OWNER']) and role <> 'OWNER');
create policy members_update on public.business_members
  for update to authenticated
  using (public.has_role(business_id, array['OWNER']) and role <> 'OWNER')
  with check (public.has_role(business_id, array['OWNER']) and role <> 'OWNER');
create policy members_delete on public.business_members
  for delete to authenticated
  using (public.has_role(business_id, array['OWNER']) and role <> 'OWNER');

-- ---------------------------------------------------------------------
-- 2. Danh mục hàng hóa/dịch vụ
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  unit        text not null default 'cái',
  price       bigint not null check (price >= 0),   -- VND không có phần lẻ; bigint (không dùng numeric) để so sánh dùng được index khi có RLS
  sku         varchar(50),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, sku)
);
create index on public.products (business_id) where is_active;
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;
create policy products_select on public.products
  for select to authenticated using (public.is_member(business_id));
create policy products_write on public.products
  for all to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER']))
  with check (public.has_role(business_id, array['OWNER','MANAGER']));

-- ---------------------------------------------------------------------
-- 3. Đơn hàng POS
-- ---------------------------------------------------------------------
-- Mã đơn 8 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I/L) vì khách có thể phải gõ tay
create or replace function public.gen_order_code()
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),  -- client có thể tự sinh khi offline
  business_id         uuid not null references public.businesses(id) on delete cascade,
  order_code          varchar(16) not null default public.gen_order_code(),
  total_amount        bigint not null default 0 check (total_amount >= 0),
  amount_received     bigint not null default 0 check (amount_received >= 0),
  overpaid_amount     bigint generated always as (greatest(amount_received - total_amount, 0)) stored,
  payment_method      text not null default 'VIETQR' check (payment_method in ('VIETQR','CASH','CARD')),
  payment_status      text not null default 'UNPAID'
                      check (payment_status in ('UNPAID','PAID','CANCELLED','REFUNDED')),
  paid_at             timestamptz,
  -- Thu ngân bấm "Tôi đã thấy tiền về" khi webhook chậm: ghi lại ai, lúc nào, vì sao
  manual_confirmed_by uuid references auth.users(id),
  manual_confirmed_at timestamptz,
  manual_note         text,
  -- Thời điểm bán thực tế trên máy (đơn tạo khi mất mạng sẽ đồng bộ sau)
  sold_at             timestamptz not null default now(),
  created_by          uuid not null default auth.uid() references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, order_code)
);
create index on public.orders (business_id, created_at desc);
create index on public.orders (business_id, payment_status, created_at desc);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,                       -- chụp lại tên tại thời điểm bán
  quantity    numeric(12,3) not null check (quantity > 0),
  unit_price  bigint not null check (unit_price >= 0),
  line_amount bigint generated always as (round(quantity * unit_price)::bigint) stored
);
create index on public.order_items (order_id);

-- Tổng tiền đơn luôn tính lại từ dòng hàng, client không tự đặt
create or replace function public.recalc_order_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set total_amount = coalesce((select sum(line_amount) from public.order_items where order_id = v_order), 0)
   where o.id = v_order;
  return null;
end $$;
create trigger trg_order_items_total after insert or update or delete on public.order_items
  for each row execute function public.recalc_order_total();

-- Client không được tự chuyển đơn sang PAID/REFUNDED, không sửa tiền đã nhận,
-- không sửa đơn đã đóng. Chỉ các hàm confirm_* (SECURITY DEFINER) mới làm được.
create or replace function public.guard_order_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    if old.payment_status <> 'UNPAID' then
      raise exception 'Đơn % đã ở trạng thái %, không thể sửa', old.order_code, old.payment_status;
    end if;
    if new.payment_status not in ('UNPAID','CANCELLED') then
      raise exception 'Client không được đặt payment_status = %', new.payment_status;
    end if;
    if new.order_code <> old.order_code or new.business_id <> old.business_id
       or new.paid_at is distinct from old.paid_at
       or new.amount_received <> old.amount_received
       or new.manual_confirmed_by is distinct from old.manual_confirmed_by
       or new.manual_confirmed_at is distinct from old.manual_confirmed_at
       or new.sold_at <> old.sold_at then
      raise exception 'Không được sửa mã đơn, tiền đã nhận, thông tin xác nhận hoặc giờ bán';
    end if;
    if new.payment_status = 'CANCELLED' and old.amount_received > 0 then
      raise exception 'Đơn đã nhận % đ, không hủy được — cần hoàn tiền', old.amount_received;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

-- Khi insert, client không được tạo đơn đã trả tiền; giờ bán chỉ được lùi tối đa 7 ngày
create or replace function public.guard_order_insert()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    new.payment_status := 'UNPAID';
    new.paid_at := null;
    new.total_amount := 0;
    new.amount_received := 0;
    new.manual_confirmed_by := null; new.manual_confirmed_at := null; new.manual_note := null;
    new.created_by := auth.uid();
    if new.sold_at > now() + interval '5 minutes' or new.sold_at < now() - interval '7 days' then
      raise exception 'Giờ bán không hợp lệ (%). Kiểm tra lại giờ trên điện thoại.', new.sold_at;
    end if;
  end if;
  return new;
end $$;
create trigger trg_orders_guard_insert before insert on public.orders
  for each row execute function public.guard_order_insert();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy orders_select on public.orders
  for select to authenticated using (public.is_member(business_id));
create policy orders_insert on public.orders
  for insert to authenticated with check (public.is_member(business_id));
create policy orders_update on public.orders
  for update to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
-- Không có policy DELETE: đơn chỉ được hủy (CANCELLED), không xóa

create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.is_member(o.business_id)));
create policy order_items_write on public.order_items
  for all to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and o.payment_status = 'UNPAID' and o.amount_received = 0
                   and public.is_member(o.business_id)))
  with check (exists (select 1 from public.orders o
                 where o.id = order_id and o.payment_status = 'UNPAID' and o.amount_received = 0
                   and public.is_member(o.business_id)));

-- ---------------------------------------------------------------------
-- 4. Tài khoản nhận tiền và đối soát
-- ---------------------------------------------------------------------
-- Mọi tài khoản nhận tiền (tài khoản chính, tài khoản ảo theo quầy, tài khoản ảo theo đơn)
-- được ghi ở đây. CHỈ server (service_role) ghi, sau khi cổng thanh toán đã xác minh
-- tài khoản thuộc hộ — client không tự khai số tài khoản để "nhận" giao dịch của người khác.
create table public.payment_accounts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider    text not null,
  bank_bin    varchar(8) not null,
  account_no  varchar(30) not null,
  kind        text not null check (kind in ('MAIN','COUNTER','ORDER_VA')),
  label       text,                                   -- ví dụ "Quầy 1"
  order_id    uuid references public.orders(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (bank_bin, account_no),
  check (kind <> 'ORDER_VA' or order_id is not null)
);
create index on public.payment_accounts (business_id);
create index on public.payment_accounts (order_id) where order_id is not null;

alter table public.payment_accounts enable row level security;
create policy payment_accounts_select on public.payment_accounts
  for select to authenticated using (public.is_member(business_id));

create table public.payment_events (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references public.businesses(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  provider         text not null,                -- 'SEPAY' | 'PAYOS' | 'CASSO' ...
  provider_txn_id  text not null,                -- mã giao dịch phía cổng
  bank_bin         varchar(8),
  account_no       varchar(30),                  -- tài khoản NHẬN tiền
  amount           bigint not null check (amount > 0),
  transfer_content text,
  match_status     text not null default 'UNMATCHED'
                   check (match_status in ('MATCHED','OVERPAID','PARTIAL','UNMATCHED','UNKNOWN_ACCOUNT',
                                           'ALREADY_PAID','ORDER_CLOSED','LATE_CONFIRMED')),
  resolved_by      uuid references auth.users(id),   -- người gán tay giao dịch chưa rõ đơn
  raw_payload      jsonb not null,
  received_at      timestamptz not null default now(),
  unique (provider, provider_txn_id)             -- chống xử lý trùng khi webhook gửi lại
);
create index on public.payment_events (business_id, received_at desc);
create index on public.payment_events (business_id, match_status) where match_status in ('UNMATCHED','PARTIAL','ALREADY_PAID');

alter table public.payment_events enable row level security;
create policy payment_events_select on public.payment_events
  for select to authenticated
  using (business_id is not null and public.has_role(business_id, array['OWNER','MANAGER','ACCOUNTANT']));
-- Không có policy ghi: chỉ các hàm bên dưới ghi

-- Lõi đối soát: áp một giao dịch vào một đơn. Hàm nội bộ, không cấp quyền gọi trực tiếp.
--   Đủ tiền      → MATCHED, đơn PAID
--   Chuyển dư    → OVERPAID, đơn PAID, phần dư ghi ở overpaid_amount
--   Chuyển thiếu → PARTIAL, đơn vẫn UNPAID, cộng dồn amount_received; lần chuyển sau đủ thì PAID
--   Đơn đã xác nhận tay, tiền về sau → LATE_CONFIRMED (đối soát xong, không ghi sổ lần 2)
create or replace function public.apply_payment_to_order(p_event_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_event  public.payment_events%rowtype;
  v_order  public.orders%rowtype;
  v_status text;
begin
  select * into v_event from public.payment_events where id = p_event_id for update;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_event.business_id is distinct from v_order.business_id then
    raise exception 'Giao dịch và đơn không cùng một hộ';
  end if;

  if v_order.payment_status in ('CANCELLED','REFUNDED') then
    v_status := 'ORDER_CLOSED';
  elsif v_order.payment_status = 'PAID' then
    if v_order.manual_confirmed_at is not null and v_order.amount_received < v_order.total_amount then
      v_status := 'LATE_CONFIRMED';
      update public.orders set amount_received = amount_received + v_event.amount where id = v_order.id;
    else
      v_status := 'ALREADY_PAID';   -- khách trả 2 lần cho một đơn: chủ hộ cần hoàn tiền
    end if;
  else
    update public.orders set amount_received = amount_received + v_event.amount
     where id = v_order.id returning * into v_order;
    if v_order.amount_received >= v_order.total_amount then
      v_status := case when v_order.amount_received = v_order.total_amount then 'MATCHED' else 'OVERPAID' end;
      update public.orders set payment_status = 'PAID', payment_method = 'VIETQR', paid_at = now()
       where id = v_order.id;
    else
      v_status := 'PARTIAL';
    end if;
  end if;

  update public.payment_events set order_id = v_order.id, match_status = v_status where id = p_event_id;
  return v_status;
end $$;
revoke all on function public.apply_payment_to_order(uuid, uuid) from public, anon, authenticated, service_role;

-- Ghi nhận một giao dịch từ webhook. Gọi từ Edge Function bằng service_role
-- SAU KHI đã xác thực chữ ký/API key của webhook.
-- Thứ tự khớp: (1) tài khoản nhận → hộ; (2) tài khoản ảo theo đơn → đơn;
-- (3) nếu không có, tìm mã đơn trong nội dung — CHỈ trong đơn của hộ đó, 3 ngày gần nhất.
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
  v_norm    text := upper(regexp_replace(coalesce(p_content, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  insert into public.payment_events (provider, provider_txn_id, amount, transfer_content, bank_bin, account_no, raw_payload)
  values (p_provider, p_txn_id, p_amount, p_content, p_bank_bin, p_account_no, p_raw)
  on conflict (provider, provider_txn_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    -- Webhook gửi lại: trả về kết quả cũ, không xử lý lần hai
    return query select e.id, e.order_id, e.match_status
                 from public.payment_events e
                 where e.provider = p_provider and e.provider_txn_id = p_txn_id;
    return;
  end if;

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
  elsif length(v_norm) >= 8 then
    select o.id into v_order
      from public.orders o
     where o.business_id = v_acct.business_id
       and o.created_at > now() - interval '3 days'
       and position(o.order_code in v_norm) > 0
     order by (o.payment_status = 'UNPAID') desc, o.created_at desc
     limit 1;
  end if;

  if v_order is null then
    -- Tiền đã vào tài khoản của hộ nhưng chưa rõ đơn: hiện trong mục "Tiền chưa rõ đơn"
    return query select v_event.id, null::uuid, 'UNMATCHED'::text;
    return;
  end if;

  v_status := public.apply_payment_to_order(v_event.id, v_order);
  return query select v_event.id, v_order, v_status;
end $$;
revoke all on function public.confirm_payment(text,text,numeric,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_payment(text,text,numeric,text,text,text,jsonb) to service_role;

-- Chủ hộ gán tay một khoản "tiền chưa rõ đơn" vào đơn đúng
create or replace function public.assign_payment_event(p_event_id uuid, p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_event public.payment_events%rowtype; v_status text;
begin
  select * into v_event from public.payment_events where id = p_event_id for update;
  if v_event.id is null or v_event.business_id is null
     or not public.has_role(v_event.business_id, array['OWNER','MANAGER']) then
    raise exception 'Không tìm thấy giao dịch hoặc không có quyền';
  end if;
  if v_event.match_status <> 'UNMATCHED' then
    raise exception 'Giao dịch này đã được gán (%)', v_event.match_status;
  end if;
  v_status := public.apply_payment_to_order(p_event_id, p_order_id);
  update public.payment_events set resolved_by = auth.uid() where id = p_event_id;
  return v_status;
end $$;
revoke all on function public.assign_payment_event(uuid, uuid) from public, anon;
grant execute on function public.assign_payment_event(uuid, uuid) to authenticated;

-- Thu ngân bấm "Tôi đã thấy tiền về" khi webhook chậm. Ghi lại người bấm;
-- khi webhook tới sau, đơn được đối soát (LATE_CONFIRMED). Đơn xác nhận tay mà
-- quá 15 phút chưa có tiền về sẽ hiện trong unreconciled_manual_confirmations.
create or replace function public.confirm_transfer_manually(p_order_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not public.has_role(v_order.business_id, array['OWNER','MANAGER','CASHIER']) then
    raise exception 'Không tìm thấy đơn hoặc không có quyền';
  end if;
  if v_order.payment_status = 'PAID' then
    return;   -- bấm hai lần hoặc webhook đã tới trước: không làm gì
  end if;
  if v_order.payment_status <> 'UNPAID' then
    raise exception 'Đơn đã ở trạng thái %', v_order.payment_status;
  end if;
  update public.orders
     set payment_status = 'PAID', payment_method = 'VIETQR', paid_at = now(),
         manual_confirmed_by = auth.uid(), manual_confirmed_at = now(), manual_note = p_note
   where id = p_order_id;
end $$;
revoke all on function public.confirm_transfer_manually(uuid, text) from public, anon;
grant execute on function public.confirm_transfer_manually(uuid, text) to authenticated;

-- Thu tiền mặt. Gọi lại nhiều lần (đồng bộ sau khi mất mạng) vẫn an toàn.
create or replace function public.confirm_cash_payment(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not public.is_member(v_order.business_id) then
    raise exception 'Không tìm thấy đơn hoặc không có quyền';
  end if;
  if v_order.payment_status = 'PAID' and v_order.payment_method = 'CASH' then
    return;
  end if;
  if v_order.payment_status <> 'UNPAID' or v_order.amount_received > 0 then
    raise exception 'Đơn đã ở trạng thái % hoặc đã nhận chuyển khoản', v_order.payment_status;
  end if;
  update public.orders
     set payment_status = 'PAID', payment_method = 'CASH', paid_at = now(),
         amount_received = total_amount
   where id = p_order_id;
end $$;
revoke all on function public.confirm_cash_payment(uuid) from public, anon;
grant execute on function public.confirm_cash_payment(uuid) to authenticated;

-- Đơn xác nhận tay quá 15 phút mà tiền chưa về đủ — chủ hộ cần kiểm tra
create view public.unreconciled_manual_confirmations
with (security_invoker = true) as
select o.id, o.business_id, o.order_code, o.total_amount, o.amount_received,
       o.manual_confirmed_by, o.manual_confirmed_at, o.manual_note
  from public.orders o
 where o.manual_confirmed_at is not null
   and o.amount_received < o.total_amount
   and o.manual_confirmed_at < now() - interval '15 minutes';

-- ---------------------------------------------------------------------
-- 5. Hóa đơn điện tử
-- ---------------------------------------------------------------------
-- Dãy hóa đơn: mỗi (hộ, mẫu số, ký hiệu, năm) một bộ đếm riêng
create table public.invoice_series (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  form_no     char(1) not null check (form_no in ('1','2')),    -- 1: HĐ GTGT, 2: HĐ bán hàng
  symbol      varchar(6) not null check (symbol ~ '^[A-Z0-9]{6}$'),
  fiscal_year int not null check (fiscal_year between 2020 and 2100),
  last_number int not null default 0 check (last_number between 0 and 99999999),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, form_no, symbol, fiscal_year)
);

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete restrict,
  order_id           uuid references public.orders(id) on delete set null,
  form_no            char(1) not null check (form_no in ('1','2')),
  symbol             varchar(6) not null check (symbol ~ '^[A-Z0-9]{6}$'),
  fiscal_year        int,
  invoice_no         int check (invoice_no between 1 and 99999999),  -- null khi còn nháp
  series_id          uuid references public.invoice_series(id) on delete restrict,
  status             text not null default 'DRAFT'
                     check (status in ('DRAFT','ISSUED','SENT_TO_PROVIDER','ACCEPTED','REJECTED','REPLACED','ADJUSTED')),
  -- Người mua: không bắt buộc đầy đủ với hóa đơn máy tính tiền bán lẻ; kiểm tra lại
  -- quy định về thông tin người mua theo NĐ 254/2026 và hướng dẫn của cơ quan thuế.
  buyer_name         text,
  buyer_tax_code     varchar(14) check (buyer_tax_code is null or buyer_tax_code ~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$'),
  buyer_id_number    varchar(12),   -- số định danh cá nhân nếu người mua cung cấp
  buyer_phone        varchar(15),
  buyer_address      text,
  subtotal_amount    bigint not null default 0,
  vat_amount         bigint not null default 0,
  total_amount       bigint not null default 0,
  issued_at          timestamptz,
  tax_authority_code varchar(64),   -- mã của cơ quan thuế (do nhà cung cấp HĐĐT trả về)
  provider_ref       text,          -- mã tham chiếu phía nhà cung cấp HĐĐT
  lookup_url         text,          -- đường dẫn tra cứu cho người mua
  provider_response  jsonb,
  replaces_invoice_id uuid references public.invoices(id),
  created_by         uuid not null default auth.uid() references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (series_id, invoice_no),
  check ((status = 'DRAFT') = (invoice_no is null))
);
create index on public.invoices (business_id, issued_at desc);
create index on public.invoices (order_id);

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  line_no     int not null check (line_no > 0),
  name        text not null,
  unit        text,
  quantity    numeric(12,3) not null check (quantity > 0),
  unit_price  bigint not null check (unit_price >= 0),
  -- Hóa đơn GTGT (mẫu 1): thuế suất 0/5/8/10 hoặc KCT/KKKNT.
  -- Hóa đơn bán hàng (mẫu 2): không ghi thuế suất -> để null.
  vat_rate    numeric(4,2) check (vat_rate is null or vat_rate in (0,5,8,10)),
  vat_note    text check (vat_note is null or vat_note in ('KCT','KKKNT')),
  line_amount bigint generated always as (round(quantity * unit_price)::bigint) stored,
  vat_amount  bigint generated always as (round(round(quantity * unit_price) * coalesce(vat_rate,0) / 100)::bigint) stored,
  unique (invoice_id, line_no)
);

-- Khóa nội dung hóa đơn sau khi phát hành. Sửa sai phải lập hóa đơn
-- điều chỉnh/thay thế mới, không sửa đè hóa đơn cũ.
create or replace function public.guard_invoice_update()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    if old.status <> 'DRAFT' then
      raise exception 'Hóa đơn đã phát hành, không được sửa. Hãy lập hóa đơn điều chỉnh/thay thế.';
    end if;
    if new.status <> 'DRAFT' or new.invoice_no is not null or new.issued_at is not null
       or new.tax_authority_code is distinct from old.tax_authority_code then
      raise exception 'Chỉ hàm issue_invoice / Edge Function mới được phát hành hóa đơn';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_invoices_guard before update on public.invoices
  for each row execute function public.guard_invoice_update();

create or replace function public.guard_invoice_insert()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then
    new.status := 'DRAFT'; new.invoice_no := null; new.series_id := null; new.fiscal_year := null;
    new.issued_at := null; new.tax_authority_code := null; new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_invoices_guard_insert before insert on public.invoices
  for each row execute function public.guard_invoice_insert();

create or replace function public.guard_invoice_lines()
returns trigger language plpgsql as $$
declare v_status text; v_form char(1);
begin
  select status, form_no into v_status, v_form
    from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status <> 'DRAFT' and current_user in ('authenticated','anon') then
    raise exception 'Không được sửa dòng hàng của hóa đơn đã phát hành';
  end if;
  if tg_op <> 'DELETE' and v_form = '2' and new.vat_rate is not null then
    raise exception 'Hóa đơn bán hàng (mẫu 2) không ghi thuế suất GTGT';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function public.guard_invoice_lines();

alter table public.invoice_series enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;

create policy series_select on public.invoice_series
  for select to authenticated using (public.is_member(business_id));
create policy series_write on public.invoice_series
  for insert to authenticated
  with check (public.has_role(business_id, array['OWNER','MANAGER']) and last_number = 0);
create policy series_toggle on public.invoice_series
  for update to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER']))
  with check (public.has_role(business_id, array['OWNER','MANAGER']));
-- Chặn client sửa bộ đếm last_number
revoke update on public.invoice_series from authenticated;
grant update (is_active) on public.invoice_series to authenticated;

create policy invoices_select on public.invoices
  for select to authenticated using (public.is_member(business_id));
create policy invoices_insert on public.invoices
  for insert to authenticated with check (public.is_member(business_id));
create policy invoices_update on public.invoices
  for update to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy invoices_delete_draft on public.invoices
  for delete to authenticated using (public.is_member(business_id) and status = 'DRAFT');

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_member(i.business_id)));
create policy invoice_lines_write on public.invoice_lines
  for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'DRAFT' and public.is_member(i.business_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'DRAFT' and public.is_member(i.business_id)));

-- Cấp số và phát hành hóa đơn. Khóa hàng dãy số (FOR UPDATE) để hai thiết bị
-- phát hành cùng lúc không bao giờ nhận trùng số.
-- Nếu nhà cung cấp HĐĐT tự cấp số (nhiều giải pháp máy tính tiền làm vậy),
-- KHÔNG dùng hàm này: lưu số phía nhà cung cấp trả về qua Edge Function.
create or replace function public.issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare
  v_inv    public.invoices%rowtype;
  v_series public.invoice_series%rowtype;
  v_year   int := extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::int;
  v_lines  int;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if v_inv.id is null or not public.has_role(v_inv.business_id, array['OWNER','MANAGER','CASHIER']) then
    raise exception 'Không tìm thấy hóa đơn hoặc không có quyền phát hành';
  end if;
  if v_inv.status <> 'DRAFT' then
    raise exception 'Hóa đơn đã phát hành (số %)', v_inv.invoice_no;
  end if;

  select count(*) into v_lines from public.invoice_lines where invoice_id = p_invoice_id;
  if v_lines = 0 then raise exception 'Hóa đơn chưa có dòng hàng'; end if;

  -- Lấy (hoặc tạo) dãy của năm hiện tại, rồi khóa
  insert into public.invoice_series (business_id, form_no, symbol, fiscal_year)
  values (v_inv.business_id, v_inv.form_no, v_inv.symbol, v_year)
  on conflict (business_id, form_no, symbol, fiscal_year) do nothing;

  select * into v_series from public.invoice_series
   where business_id = v_inv.business_id and form_no = v_inv.form_no
     and symbol = v_inv.symbol and fiscal_year = v_year
   for update;

  if not v_series.is_active then raise exception 'Dãy hóa đơn % đang bị khóa', v_inv.symbol; end if;
  if v_series.last_number >= 99999999 then raise exception 'Dãy hóa đơn đã hết số'; end if;

  update public.invoice_series set last_number = last_number + 1
   where id = v_series.id returning * into v_series;

  update public.invoices i set
    series_id       = v_series.id,
    fiscal_year     = v_year,
    invoice_no      = v_series.last_number,
    status          = 'ISSUED',
    issued_at       = now(),
    subtotal_amount = t.sub,
    vat_amount      = t.vat,
    total_amount    = t.sub + t.vat
  from (select coalesce(sum(line_amount),0) sub, coalesce(sum(vat_amount),0) vat
          from public.invoice_lines where invoice_id = p_invoice_id) t
  where i.id = p_invoice_id
  returning i.* into v_inv;

  return v_inv;
end $$;
revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- Hiển thị số hóa đơn dạng 8 chữ số, ví dụ 00000042
create or replace function public.format_invoice_no(n int)
returns text language sql immutable as $$ select lpad(n::text, 8, '0') $$;

-- ---------------------------------------------------------------------
-- 6. Sổ thu chi (ghi chép doanh thu - chi phí)
-- ---------------------------------------------------------------------
create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  entry_type   text not null check (entry_type in ('REVENUE','EXPENSE')),
  amount       bigint not null check (amount > 0),
  category     text not null,
  description  text,
  source       text not null default 'MANUAL' check (source in ('MANUAL','ORDER','INVOICE','IMPORT')),
  source_id    uuid,
  receipt_path text,   -- đường dẫn trong Storage bucket 'receipts': {business_id}/...
  entry_date   date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  created_by   uuid not null default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (business_id, source, source_id)
);
create index on public.journal_entries (business_id, entry_date desc);

alter table public.journal_entries enable row level security;
create policy journal_select on public.journal_entries
  for select to authenticated using (public.is_member(business_id));
create policy journal_write on public.journal_entries
  for all to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER','ACCOUNTANT']))
  with check (public.has_role(business_id, array['OWNER','MANAGER','ACCOUNTANT']));

-- Đơn đã thanh toán tự động ghi doanh thu (một lần duy nhất nhờ unique source_id)
create or replace function public.post_paid_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'PAID' and old.payment_status <> 'PAID' then
    -- Ngày ghi sổ = ngày bán thực tế (đơn bán lúc mất mạng đồng bộ hôm sau vẫn vào đúng ngày)
    insert into public.journal_entries (business_id, entry_type, amount, category, description,
                                        source, source_id, entry_date, created_by)
    values (new.business_id, 'REVENUE', new.total_amount, 'Bán hàng',
            'Đơn ' || new.order_code, 'ORDER', new.id,
            (new.sold_at at time zone 'Asia/Ho_Chi_Minh')::date, new.created_by)
    on conflict (business_id, source, source_id) do nothing;
  end if;
  return new;
end $$;
create trigger trg_orders_post_revenue after update of payment_status on public.orders
  for each row execute function public.post_paid_order();

-- ---------------------------------------------------------------------
-- 7. Storage: ảnh chứng từ, mỗi hộ một thư mục
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_read on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy receipts_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy receipts_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts'
         and public.has_role(((storage.foldername(name))[1])::uuid, array['OWNER','MANAGER']));

-- ---------------------------------------------------------------------
-- 8. Realtime: thu ngân lắng nghe đơn đổi trạng thái (RLS vẫn áp dụng)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.orders;
