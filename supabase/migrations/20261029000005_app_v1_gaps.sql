-- =====================================================================
-- Migration 5 — những lời gọi app cần mà chưa có (phát hiện khi bắt đầu code app)
--   1. create_business_v1: tạo hộ khi cài đặt ban đầu (thay cho insert trực tiếp)
--   2. Bản *_v1 báo lỗi bằng mã QP_* cho xác nhận tay và gán tiền
--   3. Cài đặt của hộ: thu ngân có được bấm "Tôi đã thấy tiền về" không
--   4. Khóa ngoại tới auth.users cho phép xóa người dùng mà vẫn giữ chứng từ kế toán
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tạo hộ (idempotent theo mã do app sinh)
-- ---------------------------------------------------------------------
create or replace function public.create_business_v1(
  p_business_id uuid, p_business_name text, p_tax_code text, p_address text
) returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if p_business_id is null
     or length(trim(coalesce(p_business_name, ''))) not between 1 and 200
     or coalesce(p_tax_code, '') !~ '^[0-9]{10}([0-9]{2}|-[0-9]{3})?$'
     or length(trim(coalesce(p_address, ''))) not between 1 and 500 then
    raise exception 'QP_INVALID_INPUT';
  end if;

  select * into v from public.businesses where id = p_business_id;
  if v.id is not null then
    if v.owner_id <> auth.uid() then raise exception 'QP_FORBIDDEN'; end if;
    return v;                       -- gửi lại: trả bản đã tạo
  end if;

  begin
    insert into public.businesses (id, owner_id, business_name, tax_code, address)
    values (p_business_id, auth.uid(), trim(p_business_name), p_tax_code, trim(p_address))
    returning * into v;
  exception when unique_violation then
    raise exception 'QP_TAX_CODE_TAKEN';
  end;
  return v;
end $$;
revoke all on function public.create_business_v1(uuid, text, text, text) from public, anon;
grant execute on function public.create_business_v1(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Cài đặt của hộ
-- ---------------------------------------------------------------------
alter table public.businesses
  add column allow_cashier_manual_confirm boolean not null default true;

create or replace function public.update_business_settings_v1(
  p_business_id uuid, p_allow_cashier_manual_confirm boolean
) returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then
    raise exception 'QP_FORBIDDEN';
  end if;
  update public.businesses
     set allow_cashier_manual_confirm = coalesce(p_allow_cashier_manual_confirm, allow_cashier_manual_confirm)
   where id = p_business_id
  returning * into v;
  return v;
end $$;
revoke all on function public.update_business_settings_v1(uuid, boolean) from public, anon;
grant execute on function public.update_business_settings_v1(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Xác nhận tay và gán tiền — bản v1 báo lỗi bằng mã
-- ---------------------------------------------------------------------
create or replace function public.confirm_transfer_manually_v1(p_order_id uuid, p_note text default null)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders%rowtype; v_role text; v_allow boolean;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  -- Không phân biệt "không có" và "không có quyền" để không lộ đơn của hộ khác
  if v_order.id is null then raise exception 'QP_NOT_FOUND'; end if;
  select m.role into v_role from public.business_members m
   where m.business_id = v_order.business_id and m.user_id = auth.uid();
  if v_role is null then raise exception 'QP_NOT_FOUND'; end if;
  if v_role not in ('OWNER','MANAGER','CASHIER') then raise exception 'QP_FORBIDDEN'; end if;
  if v_role = 'CASHIER' then
    select b.allow_cashier_manual_confirm into v_allow from public.businesses b where b.id = v_order.business_id;
    if not v_allow then raise exception 'QP_FORBIDDEN'; end if;
  end if;

  if v_order.payment_status = 'PAID' then return v_order; end if;       -- bấm 2 lần / webhook tới trước
  if v_order.payment_status <> 'UNPAID' then raise exception 'QP_ORDER_NOT_CONFIRMABLE'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'QP_INVALID_INPUT'; end if;

  update public.orders
     set payment_status = 'PAID', payment_method = 'VIETQR', paid_at = now(),
         manual_confirmed_by = auth.uid(), manual_confirmed_at = now(), manual_note = p_note
   where id = p_order_id
  returning * into v_order;
  return v_order;
end $$;
revoke all on function public.confirm_transfer_manually_v1(uuid, text) from public, anon;
grant execute on function public.confirm_transfer_manually_v1(uuid, text) to authenticated;

create or replace function public.assign_payment_event_v1(p_event_id uuid, p_order_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_event public.payment_events%rowtype; v_order_biz uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v_event from public.payment_events where id = p_event_id for update;
  if v_event.id is null or v_event.business_id is null
     or not public.is_member(v_event.business_id) then
    raise exception 'QP_NOT_FOUND';
  end if;
  if not public.has_role(v_event.business_id, array['OWNER','MANAGER']) then
    raise exception 'QP_FORBIDDEN';
  end if;
  if v_event.match_status <> 'UNMATCHED' then raise exception 'QP_ALREADY_ASSIGNED'; end if;
  select o.business_id into v_order_biz from public.orders o where o.id = p_order_id;
  if v_order_biz is distinct from v_event.business_id then raise exception 'QP_NOT_FOUND'; end if;

  v_status := public.apply_payment_to_order(p_event_id, p_order_id);
  update public.payment_events set resolved_by = auth.uid() where id = p_event_id;
  return v_status;
end $$;
revoke all on function public.assign_payment_event_v1(uuid, uuid) from public, anon;
grant execute on function public.assign_payment_event_v1(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Xóa người dùng mà vẫn giữ chứng từ: cột "người tạo/người bấm" thành NULL
--    (đơn, hóa đơn, bút toán vẫn còn; chỉ không còn gắn với người đã xóa).
--    Chủ hộ (businesses.owner_id) vẫn "restrict": phải giao quán hoặc xử lý qua hỗ trợ.
-- ---------------------------------------------------------------------
alter table public.orders alter column created_by drop not null;
alter table public.orders drop constraint orders_created_by_fkey,
  add constraint orders_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.orders drop constraint orders_manual_confirmed_by_fkey,
  add constraint orders_manual_confirmed_by_fkey foreign key (manual_confirmed_by) references auth.users(id) on delete set null;
alter table public.payment_events drop constraint payment_events_resolved_by_fkey,
  add constraint payment_events_resolved_by_fkey foreign key (resolved_by) references auth.users(id) on delete set null;
alter table public.invoices alter column created_by drop not null;
alter table public.invoices drop constraint invoices_created_by_fkey,
  add constraint invoices_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.journal_entries alter column created_by drop not null;
alter table public.journal_entries drop constraint journal_entries_created_by_fkey,
  add constraint journal_entries_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.trips drop constraint trips_driver_user_id_fkey,
  add constraint trips_driver_user_id_fkey foreign key (driver_user_id) references auth.users(id) on delete set null;
alter table public.crm_messages drop constraint crm_messages_sent_by_fkey,
  add constraint crm_messages_sent_by_fkey foreign key (sent_by) references auth.users(id) on delete set null;
