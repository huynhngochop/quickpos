-- =====================================================================
-- API v1 cho app: tạo đơn nguyên khối, đồng bộ an toàn, thiết bị, phiên bản app,
-- đồng ý xử lý dữ liệu, yêu cầu xóa tài khoản.
--
-- Quy ước hợp đồng (chi tiết: docs/api.md)
--  * App chỉ GHI qua các hàm *_v1. Không insert/update trực tiếp bảng orders, order_items.
--  * Hàm lỗi bằng mã ổn định "QP_<TÊN>" trong message; câu tiếng Việt cho người dùng
--    nằm ở app (src/i18n/vi.ts), tra theo mã. detail chỉ để ghi log.
--  * Đổi tham số hay kết quả của một hàm = tạo hàm _v2 mới, giữ _v1 cho app cũ đến khi
--    app_config.min_version vượt qua phiên bản cuối cùng còn dùng _v1.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Đơn hàng: giờ máy sai thì đánh dấu, không từ chối; ghi máy tạo đơn
-- ---------------------------------------------------------------------
alter table public.orders
  add column client_sold_at    timestamptz,                  -- giờ máy gửi lên khi bị coi là sai
  add column clock_suspect     boolean not null default false,
  add column created_device_id text;                         -- chỉ máy này đọc to "Đã nhận"

-- Thay quy tắc cũ (từ chối đơn có giờ bán lệch): đơn bán lúc mất mạng KHÔNG bao giờ bị mất.
-- Giờ máy lệch > 5 phút về tương lai hoặc > 7 ngày về quá khứ → dùng giờ server, giữ giờ máy để đối chiếu.
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
  end if;
  if new.sold_at > now() + interval '5 minutes' or new.sold_at < now() - interval '7 days' then
    new.client_sold_at := new.sold_at;
    new.sold_at := now();
    new.clock_suspect := true;
  end if;
  return new;
end $$;

-- App không còn quyền ghi thẳng: mọi thay đổi đơn đi qua hàm v1 (một giao dịch, gửi lại an toàn)
revoke insert, update on public.orders from authenticated, anon;
revoke insert, update, delete on public.order_items from authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. create_order_v1: tạo đơn + dòng hàng trong MỘT giao dịch
--    p_order_id do app sinh (UUID) → gửi lại bao nhiêu lần cũng chỉ có một đơn.
--    p_items: [{"name":"Cà phê","quantity":2,"unit_price":15000,"product_id":null}, …]
--    Màn hình "nhập số tiền" không có danh mục → một dòng {"name":"Bán hàng","quantity":1,"unit_price":<số tiền>}
-- ---------------------------------------------------------------------
create or replace function public.create_order_v1(
  p_order_id uuid,
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text default 'VIETQR',
  p_sold_at timestamptz default now(),
  p_device_id text default null
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_n int;
  v_bad int;
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

  -- Gửi lại: đơn đã có → trả về nguyên trạng, không thêm dòng hàng
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
    from jsonb_to_recordset(p_items) as x(name text, quantity numeric, unit_price bigint, product_id uuid)
   where coalesce(length(trim(x.name)), 0) = 0 or length(x.name) > 200
      or x.quantity is null or x.quantity <= 0 or x.quantity > 100000
      or x.unit_price is null or x.unit_price < 0 or x.unit_price > 100000000000
      or (x.product_id is not null and not exists
            (select 1 from public.products p where p.id = x.product_id and p.business_id = p_business_id));
  if v_bad > 0 then
    raise exception 'QP_INVALID_ITEMS' using detail = v_bad || ' dòng hàng không hợp lệ';
  end if;

  begin
    insert into public.orders (id, business_id, payment_method, sold_at, created_by, created_device_id)
    values (p_order_id, p_business_id, p_payment_method, coalesce(p_sold_at, now()), auth.uid(), p_device_id);
  exception when unique_violation then
    -- Hai lần gửi cùng lúc: lần kia đã tạo xong → trả về đơn đó
    select * into v_order from public.orders where id = p_order_id;
    if v_order.business_id <> p_business_id then
      raise exception 'QP_ORDER_CONFLICT' using detail = 'Mã đơn đã dùng cho hộ khác';
    end if;
    return v_order;
  end;

  insert into public.order_items (order_id, product_id, name, quantity, unit_price)
  select p_order_id, x.product_id, trim(x.name), x.quantity, x.unit_price
    from jsonb_to_recordset(p_items) as x(name text, quantity numeric, unit_price bigint, product_id uuid);

  select * into v_order from public.orders where id = p_order_id;
  if v_order.total_amount <= 0 and p_payment_method = 'VIETQR' then
    raise exception 'QP_INVALID_ITEMS' using detail = 'Đơn chuyển khoản phải lớn hơn 0 đ';
  end if;
  return v_order;
end $$;
revoke all on function public.create_order_v1(uuid, uuid, jsonb, text, timestamptz, text) from public, anon;
grant execute on function public.create_order_v1(uuid, uuid, jsonb, text, timestamptz, text) to authenticated;

-- Bán tiền mặt (kể cả đồng bộ đơn bán lúc mất mạng): tạo + xác nhận trong một lần gọi, gửi lại an toàn
create or replace function public.create_cash_sale_v1(
  p_order_id uuid, p_business_id uuid, p_items jsonb,
  p_sold_at timestamptz default now(), p_device_id text default null
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders%rowtype;
begin
  v_order := public.create_order_v1(p_order_id, p_business_id, p_items, 'CASH', p_sold_at, p_device_id);
  if v_order.payment_method <> 'CASH' then
    raise exception 'QP_ORDER_CONFLICT' using detail = 'Mã đơn đã dùng cho đơn chuyển khoản';
  end if;
  perform public.confirm_cash_payment(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end $$;
revoke all on function public.create_cash_sale_v1(uuid, uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.create_cash_sale_v1(uuid, uuid, jsonb, timestamptz, text) to authenticated;

-- Hủy đơn chưa nhận tiền; gọi lại khi đã hủy thì không lỗi
create or replace function public.cancel_order_v1(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not public.is_member(v_order.business_id) then
    raise exception 'QP_NOT_FOUND' using detail = 'Không tìm thấy đơn hoặc không có quyền';
  end if;
  if v_order.payment_status = 'CANCELLED' then
    return v_order;
  end if;
  if v_order.payment_status <> 'UNPAID' or v_order.amount_received > 0 then
    raise exception 'QP_ORDER_NOT_CANCELLABLE' using detail = 'Đơn đã nhận ' || v_order.amount_received || ' đ';
  end if;
  update public.orders set payment_status = 'CANCELLED' where id = p_order_id returning * into v_order;
  return v_order;
end $$;
revoke all on function public.cancel_order_v1(uuid) from public, anon;
grant execute on function public.cancel_order_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Thiết bị: mã thông báo đẩy, phiên bản app, máy nào đọc to
-- ---------------------------------------------------------------------
create table public.device_registrations (
  device_id      text primary key check (length(device_id) between 8 and 128),
  user_id        uuid not null references auth.users(id) on delete cascade,
  business_id    uuid references public.businesses(id) on delete cascade,
  platform       text not null check (platform in ('android','ios')),
  push_token     text,
  app_version    text not null check (app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  speak_payments boolean not null default true,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index on public.device_registrations (business_id) where push_token is not null;
create index on public.device_registrations (user_id);

alter table public.device_registrations enable row level security;
create policy devices_select_own on public.device_registrations
  for select to authenticated using (user_id = auth.uid());
create policy devices_delete_own on public.device_registrations
  for delete to authenticated using (user_id = auth.uid());
-- Ghi qua register_device_v1. Edge Function gửi thông báo đọc bằng service_role.

create or replace function public.register_device_v1(
  p_device_id text, p_business_id uuid, p_platform text, p_app_version text,
  p_push_token text default null, p_speak_payments boolean default true
) returns public.device_registrations
language plpgsql security definer set search_path = public
as $$
declare v public.device_registrations%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if p_business_id is not null and not public.is_member(p_business_id) then
    raise exception 'QP_FORBIDDEN' using detail = 'Không phải thành viên của hộ';
  end if;
  insert into public.device_registrations (device_id, user_id, business_id, platform, push_token, app_version, speak_payments)
  values (p_device_id, auth.uid(), p_business_id, p_platform, p_push_token, p_app_version, p_speak_payments)
  on conflict (device_id) do update
     set user_id = excluded.user_id,             -- máy đổi người đăng nhập: chuyển cho người mới
         business_id = excluded.business_id,
         platform = excluded.platform,
         push_token = coalesce(excluded.push_token, public.device_registrations.push_token),
         app_version = excluded.app_version,
         speak_payments = excluded.speak_payments,
         last_seen_at = now()
  returning * into v;
  return v;
end $$;
revoke all on function public.register_device_v1(text, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.register_device_v1(text, uuid, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Phiên bản app: bắt cập nhật khi app quá cũ (người lớn tuổi ít tự cập nhật)
-- ---------------------------------------------------------------------
create table public.app_config (
  platform       text primary key check (platform in ('android','ios')),
  min_version    text not null check (min_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  latest_version text not null check (latest_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  store_url      text
);
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);
insert into public.app_config (platform, min_version, latest_version) values
  ('android', '1.0.0', '1.0.0'), ('ios', '1.0.0', '1.0.0');

create or replace function public.version_lt(a text, b text)
returns boolean language sql immutable as $$
  select string_to_array(a, '.')::int[] < string_to_array(b, '.')::int[];
$$;

-- Gọi khi mở app (kể cả chưa đăng nhập). must_update = true → app chỉ hiện màn hình "Cần cập nhật".
create or replace function public.check_app_version_v1(p_platform text, p_version text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'must_update',   public.version_lt(p_version, c.min_version),
    'should_update', public.version_lt(p_version, c.latest_version),
    'latest_version', c.latest_version,
    'store_url', c.store_url)
  from public.app_config c where c.platform = p_platform;
$$;
grant execute on function public.check_app_version_v1(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Đồng ý xử lý dữ liệu cá nhân (Luật BVDLCN 91/2025/QH15)
-- ---------------------------------------------------------------------
create table public.user_consents (
  user_id        uuid not null references auth.users(id) on delete cascade,
  policy_version text not null,
  accepted_at    timestamptz not null default now(),
  source         text not null default 'app' check (source in ('app','staff_assisted')),
  primary key (user_id, policy_version)
);
alter table public.user_consents enable row level security;
create policy consents_select_own on public.user_consents
  for select to authenticated using (user_id = auth.uid());

create or replace function public.record_consent_v1(p_policy_version text, p_source text default 'app')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  insert into public.user_consents (user_id, policy_version, source)
  values (auth.uid(), p_policy_version, p_source)
  on conflict (user_id, policy_version) do nothing;
end $$;
revoke all on function public.record_consent_v1(text, text) from public, anon;
grant execute on function public.record_consent_v1(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Yêu cầu xóa tài khoản ngay trong app (yêu cầu của Google Play / App Store)
--    Edge Function xử lý bằng service_role: xóa người dùng khỏi Auth, ẩn danh dữ liệu cá nhân.
--    Chứng từ kế toán của hộ (đơn, sổ, hóa đơn) vẫn phải giữ theo luật — chỉ tách khỏi người dùng.
-- ---------------------------------------------------------------------
create table public.account_deletion_requests (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status       text not null default 'REQUESTED' check (status in ('REQUESTED','PROCESSING','DONE','CANCELLED')),
  reason       text
);
alter table public.account_deletion_requests enable row level security;
create policy deletion_select_own on public.account_deletion_requests
  for select to authenticated using (user_id = auth.uid());

create or replace function public.request_account_deletion_v1(p_reason text default null)
returns public.account_deletion_requests
language plpgsql security definer set search_path = public as $$
declare v public.account_deletion_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  insert into public.account_deletion_requests (user_id, reason) values (auth.uid(), p_reason)
  on conflict (user_id) do update
     set status = 'REQUESTED', requested_at = now(), reason = excluded.reason
   where public.account_deletion_requests.status = 'CANCELLED'
  returning * into v;
  if v.user_id is null then
    select * into v from public.account_deletion_requests where user_id = auth.uid();
  end if;
  return v;
end $$;
revoke all on function public.request_account_deletion_v1(text) from public, anon;
grant execute on function public.request_account_deletion_v1(text) to authenticated;
