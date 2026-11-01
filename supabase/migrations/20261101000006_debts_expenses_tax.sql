-- =====================================================================
-- Migration 6 — chức năng thêm sau góp ý người dùng thử (01/11/2026)
--   1. Sổ nợ khách: debt_customers, debt_entries, view debt_balances
--   2. Chi tiêu (sổ chi): ghi/hủy khoản chi tay vào journal_entries
--   3. Ngành nghề tính thuế của hộ (để ước tính thuế theo tỷ lệ trên doanh thu)
-- Mọi lệnh ghi qua hàm *_v1 (security definer, set search_path, mã lỗi QP_*). App không insert/update trực tiếp.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sổ nợ khách
-- ---------------------------------------------------------------------
create table public.debt_customers (
  id             uuid primary key,                      -- app sinh sẵn (gửi lại an toàn)
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 100),
  phone          text check (phone is null or phone ~ '^0[0-9]{9}$'),
  -- Luật BVDLCN: có số điện thoại thì phải có thời điểm và nguồn đồng ý
  consent_at     timestamptz,
  consent_source text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  check (phone is null or consent_at is not null)
);
create index on public.debt_customers (business_id, name);

create table public.debt_entries (
  id           uuid primary key,                        -- app sinh sẵn (gửi lại an toàn)
  business_id  uuid not null references public.businesses(id) on delete cascade,
  customer_id  uuid not null references public.debt_customers(id) on delete cascade,
  kind         text not null check (kind in ('DEBT','PAYMENT')),   -- DEBT: khách lấy hàng nợ; PAYMENT: khách trả
  amount       bigint not null check (amount > 0 and amount <= 100000000000),
  note         text check (note is null or length(note) <= 200),
  entry_date   date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,                             -- ghi nhầm: đánh dấu hủy, không xóa
  voided_by    uuid references auth.users(id) on delete set null
);
create index on public.debt_entries (business_id, customer_id, created_at desc);

alter table public.debt_customers enable row level security;
alter table public.debt_entries enable row level security;
-- Chỉ đọc; ghi qua hàm. RLS dạng tập hợp (xem CLAUDE.md mục hiệu năng).
create policy debt_customers_select on public.debt_customers
  for select to authenticated using (business_id in (select public.my_business_ids()));
create policy debt_entries_select on public.debt_entries
  for select to authenticated using (business_id in (select public.my_business_ids()));

-- Số dư nợ từng khách (chạy quyền người gọi → RLS của hai bảng vẫn áp dụng)
create view public.debt_balances with (security_invoker = true) as
select c.id as customer_id, c.business_id, c.name, c.phone,
       coalesce(sum(case e.kind when 'DEBT' then e.amount else -e.amount end)
                filter (where e.voided_at is null), 0)::bigint as balance,
       max(e.created_at) filter (where e.voided_at is null) as last_entry_at
  from public.debt_customers c
  left join public.debt_entries e on e.customer_id = c.id
 group by c.id;
grant select on public.debt_customers, public.debt_entries, public.debt_balances to authenticated;
-- Supabase cấp sẵn mọi quyền cho authenticated trên bảng mới: rút quyền ghi, chỉ ghi qua hàm
revoke insert, update, delete, truncate on public.debt_customers, public.debt_entries from authenticated, anon;

create or replace function public.add_debt_customer_v1(
  p_customer_id uuid, p_business_id uuid, p_name text, p_phone text default null, p_phone_consent boolean default false
) returns public.debt_customers
language plpgsql security definer set search_path = public
as $$
declare v public.debt_customers%rowtype; v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\s', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  if p_customer_id is null or length(trim(coalesce(p_name, ''))) not between 1 and 100
     or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then
    raise exception 'QP_INVALID_INPUT';
  end if;
  if v_phone is not null and not coalesce(p_phone_consent, false) then raise exception 'QP_CONSENT_REQUIRED'; end if;

  select * into v from public.debt_customers where id = p_customer_id;
  if v.id is not null then
    if v.business_id <> p_business_id then raise exception 'QP_FORBIDDEN'; end if;
    return v;
  end if;
  insert into public.debt_customers (id, business_id, name, phone, consent_at, consent_source)
  values (p_customer_id, p_business_id, trim(p_name), v_phone,
          case when v_phone is not null then now() end, case when v_phone is not null then 'app_so_no' end)
  returning * into v;
  return v;
end $$;
revoke all on function public.add_debt_customer_v1(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.add_debt_customer_v1(uuid, uuid, text, text, boolean) to authenticated;

create or replace function public.record_debt_v1(
  p_entry_id uuid, p_customer_id uuid, p_kind text, p_amount bigint, p_note text default null
) returns public.debt_entries
language plpgsql security definer set search_path = public
as $$
declare v public.debt_entries%rowtype; v_biz uuid; v_balance bigint;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select business_id into v_biz from public.debt_customers where id = p_customer_id for update;  -- khóa khách: hai máy trả nợ cùng lúc
  if v_biz is null or not public.is_member(v_biz) then raise exception 'QP_NOT_FOUND'; end if;
  if p_entry_id is null or p_kind not in ('DEBT','PAYMENT') or coalesce(p_amount, 0) <= 0 or p_amount > 100000000000
     or length(coalesce(p_note, '')) > 200 then
    raise exception 'QP_INVALID_INPUT';
  end if;

  select * into v from public.debt_entries where id = p_entry_id;
  if v.id is not null then
    if v.customer_id <> p_customer_id then raise exception 'QP_INVALID_INPUT'; end if;
    return v;                                            -- gửi lại: trả bản đã ghi
  end if;

  if p_kind = 'PAYMENT' then
    select coalesce(sum(case kind when 'DEBT' then amount else -amount end), 0) into v_balance
      from public.debt_entries where customer_id = p_customer_id and voided_at is null;
    if p_amount > v_balance then raise exception 'QP_PAYMENT_EXCEEDS_DEBT'; end if;
  end if;

  insert into public.debt_entries (id, business_id, customer_id, kind, amount, note)
  values (p_entry_id, v_biz, p_customer_id, p_kind, p_amount, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v;
  return v;
end $$;
revoke all on function public.record_debt_v1(uuid, uuid, text, bigint, text) from public, anon;
grant execute on function public.record_debt_v1(uuid, uuid, text, bigint, text) to authenticated;

create or replace function public.void_debt_entry_v1(p_entry_id uuid)
returns public.debt_entries
language plpgsql security definer set search_path = public
as $$
declare v public.debt_entries%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.debt_entries where id = p_entry_id for update;
  if v.id is null or not public.is_member(v.business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(v.business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if v.voided_at is not null then return v; end if;
  update public.debt_entries set voided_at = now(), voided_by = auth.uid() where id = p_entry_id returning * into v;
  return v;
end $$;
revoke all on function public.void_debt_entry_v1(uuid) from public, anon;
grant execute on function public.void_debt_entry_v1(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Chi tiêu: khoản chi ghi tay vào sổ thu chi
-- ---------------------------------------------------------------------
alter table public.journal_entries
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id) on delete set null;

create or replace function public.add_expense_v1(
  p_entry_id uuid, p_business_id uuid, p_amount bigint, p_category text, p_note text default null, p_entry_date date default null
) returns public.journal_entries
language plpgsql security definer set search_path = public
as $$
declare v public.journal_entries%rowtype;
        v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
        v_date date := coalesce(p_entry_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  -- Thu ngân cũng ghi được (mua đá, gas lúc chủ vắng); hủy thì chỉ chủ/quản lý
  if not public.is_member(p_business_id) then raise exception 'QP_FORBIDDEN'; end if;
  if p_entry_id is null or coalesce(p_amount, 0) <= 0 or p_amount > 100000000000
     or length(trim(coalesce(p_category, ''))) not between 1 and 50 or length(coalesce(p_note, '')) > 200
     or v_date > v_today or v_date < v_today - 62 then
    raise exception 'QP_INVALID_INPUT';
  end if;

  select * into v from public.journal_entries where business_id = p_business_id and source = 'MANUAL' and source_id = p_entry_id;
  if v.id is not null then return v; end if;

  insert into public.journal_entries (business_id, entry_type, amount, category, description, source, source_id, entry_date)
  values (p_business_id, 'EXPENSE', p_amount, trim(p_category), nullif(trim(coalesce(p_note, '')), ''), 'MANUAL', p_entry_id, v_date)
  returning * into v;
  return v;
end $$;
revoke all on function public.add_expense_v1(uuid, uuid, bigint, text, text, date) from public, anon;
grant execute on function public.add_expense_v1(uuid, uuid, bigint, text, text, date) to authenticated;

create or replace function public.void_expense_v1(p_business_id uuid, p_entry_id uuid)
returns public.journal_entries
language plpgsql security definer set search_path = public
as $$
declare v public.journal_entries%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  select * into v from public.journal_entries
   where business_id = p_business_id and source = 'MANUAL' and source_id = p_entry_id and entry_type = 'EXPENSE' for update;
  if v.id is null or not public.is_member(p_business_id) then raise exception 'QP_NOT_FOUND'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if v.voided_at is not null then return v; end if;
  update public.journal_entries set voided_at = now(), voided_by = auth.uid() where id = v.id returning * into v;
  return v;
end $$;
revoke all on function public.void_expense_v1(uuid, uuid) from public, anon;
grant execute on function public.void_expense_v1(uuid, uuid) to authenticated;

-- Doanh thu từ đơn không bao giờ bị hủy bằng đường này (chỉ khoản chi MANUAL); chặn luôn ở trigger cho chắc
create or replace function public.guard_journal_void()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is distinct from old.voided_at and (old.source <> 'MANUAL' or old.entry_type <> 'EXPENSE') then
    raise exception 'QP_FORBIDDEN';
  end if;
  return new;
end $$;
create trigger journal_guard_void before update of voided_at on public.journal_entries
  for each row execute function public.guard_journal_void();

-- ---------------------------------------------------------------------
-- 3. Ngành nghề tính thuế (tỷ lệ % trên doanh thu theo NĐ 68/2026, sửa đổi bởi NĐ 141/2026)
--    GOODS: phân phối, cung cấp hàng hóa · PRODUCTION: sản xuất, vận tải, dịch vụ gắn với hàng hóa (ăn uống)
--    SERVICE: dịch vụ không kèm nguyên vật liệu · LEASING: cho thuê tài sản · OTHER: hoạt động khác
-- ---------------------------------------------------------------------
alter table public.businesses
  add column tax_industry text not null default 'GOODS'
    check (tax_industry in ('GOODS','PRODUCTION','SERVICE','LEASING','OTHER'));

create or replace function public.update_tax_settings_v1(p_business_id uuid, p_tax_industry text)
returns public.businesses
language plpgsql security definer set search_path = public
as $$
declare v public.businesses%rowtype;
begin
  if auth.uid() is null then raise exception 'QP_UNAUTHENTICATED'; end if;
  if not public.has_role(p_business_id, array['OWNER','MANAGER']) then raise exception 'QP_FORBIDDEN'; end if;
  if p_tax_industry not in ('GOODS','PRODUCTION','SERVICE','LEASING','OTHER') then raise exception 'QP_INVALID_INPUT'; end if;
  update public.businesses set tax_industry = p_tax_industry where id = p_business_id returning * into v;
  return v;
end $$;
revoke all on function public.update_tax_settings_v1(uuid, text) from public, anon;
grant execute on function public.update_tax_settings_v1(uuid, text) to authenticated;
