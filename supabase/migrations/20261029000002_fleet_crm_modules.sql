-- =====================================================================
-- Mô-đun tùy chọn: Vận tải (FleetLogi) và Zalo CRM (ZaloFlow)
-- Phụ thuộc migration lõi (businesses, is_member, has_role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Vận tải
-- ---------------------------------------------------------------------
create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  license_plate varchar(15) not null check (license_plate ~ '^[0-9]{2}[A-Z]{1,2}[0-9]?-?[0-9]{3,5}(\.[0-9]{2})?$'),
  vehicle_type  text not null check (vehicle_type in ('TRUCK','VAN','BUS','CAR','MOTORBIKE','OTHER')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (business_id, license_plate)   -- duy nhất theo hộ, không toàn hệ thống
);

create table public.trips (
  id              uuid primary key,     -- client tự sinh UUID khi offline để đồng bộ idempotent
  business_id     uuid not null references public.businesses(id) on delete cascade,
  vehicle_id      uuid not null references public.vehicles(id) on delete restrict,
  driver_user_id  uuid references auth.users(id),
  driver_name     text not null,
  start_location  text not null,
  end_location    text not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  fare_amount     bigint not null check (fare_amount >= 0),
  fuel_cost       bigint not null default 0 check (fuel_cost >= 0),
  toll_cost       bigint not null default 0 check (toll_cost >= 0),
  other_cost      bigint not null default 0 check (other_cost >= 0),
  status          text not null default 'COMPLETED' check (status in ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  invoice_id      uuid references public.invoices(id) on delete set null,
  client_updated_at timestamptz not null default now(),  -- dùng cho đồng bộ "last write wins"
  created_at      timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index on public.trips (business_id, started_at desc);
create index on public.trips (vehicle_id);

create table public.trip_receipts (
  id           uuid primary key,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  kind         text not null check (kind in ('FUEL','TOLL','PARKING','OTHER')),
  amount       bigint not null check (amount >= 0),
  receipt_path text not null,   -- Storage bucket 'receipts': {business_id}/trips/...
  created_at   timestamptz not null default now()
);

-- Bản tổng hợp theo kỳ để đối chiếu / nộp cùng tờ khai.
-- CẢNH BÁO: biểu mẫu cụ thể (tên mẫu, trường dữ liệu, kỳ nộp) cho ngành vận tải phải được
-- đối chiếu với NĐ 254/2026/NĐ-CP và TT 91/2026/TT-BTC trước khi dùng thật.
create table public.tax_period_summaries (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  period_type   text not null check (period_type in ('MONTH','QUARTER')),
  period_year   int not null check (period_year between 2020 and 2100),
  period_index  int not null check (period_index between 1 and 12),
  total_trips   int not null default 0,
  total_revenue bigint not null default 0,
  total_vat     bigint not null default 0,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','ACCEPTED','REJECTED')),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (business_id, period_type, period_year, period_index),
  check (period_type = 'MONTH' or period_index between 1 and 4)
);

alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_receipts enable row level security;
alter table public.tax_period_summaries enable row level security;

create policy vehicles_select on public.vehicles for select to authenticated using (public.is_member(business_id));
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER']))
  with check (public.has_role(business_id, array['OWNER','MANAGER']));

create policy trips_select on public.trips for select to authenticated using (public.is_member(business_id));
create policy trips_insert on public.trips for insert to authenticated with check (public.is_member(business_id));
-- Tài xế chỉ sửa chuyến của mình; quản lý sửa tất cả; không sửa chuyến đã gắn hóa đơn
create policy trips_update on public.trips for update to authenticated
  using (invoice_id is null and (driver_user_id = auth.uid() or public.has_role(business_id, array['OWNER','MANAGER'])))
  with check (public.is_member(business_id));
create policy trips_delete on public.trips for delete to authenticated
  using (invoice_id is null and public.has_role(business_id, array['OWNER','MANAGER']));

create policy trip_receipts_all on public.trip_receipts for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and public.is_member(t.business_id)))
  with check (exists (select 1 from public.trips t where t.id = trip_id and public.is_member(t.business_id)));

create policy summaries_select on public.tax_period_summaries for select to authenticated
  using (public.is_member(business_id));
create policy summaries_write on public.tax_period_summaries for all to authenticated
  using (status = 'DRAFT' and public.has_role(business_id, array['OWNER','MANAGER','ACCOUNTANT']))
  with check (status = 'DRAFT' and public.has_role(business_id, array['OWNER','MANAGER','ACCOUNTANT']));

-- Gom số liệu một kỳ thành bản nháp (logic biểu mẫu chi tiết đặt ở Edge Function)
create or replace function public.build_period_summary(
  p_business_id uuid, p_period_type text, p_year int, p_index int
) returns public.tax_period_summaries
language plpgsql security definer set search_path = public as $$
declare
  v_from date; v_to date; v_row public.tax_period_summaries%rowtype;
begin
  if not public.has_role(p_business_id, array['OWNER','MANAGER','ACCOUNTANT']) then
    raise exception 'Không có quyền';
  end if;
  if p_period_type = 'MONTH' then
    v_from := make_date(p_year, p_index, 1); v_to := (v_from + interval '1 month')::date;
  else
    v_from := make_date(p_year, (p_index - 1) * 3 + 1, 1); v_to := (v_from + interval '3 months')::date;
  end if;

  insert into public.tax_period_summaries (business_id, period_type, period_year, period_index,
                                           total_trips, total_revenue, payload)
  select p_business_id, p_period_type, p_year, p_index, count(*), coalesce(sum(fare_amount),0),
         jsonb_build_object('from', v_from, 'to', v_to, 'trip_ids', coalesce(jsonb_agg(id), '[]'::jsonb))
    from public.trips
   where business_id = p_business_id and status = 'COMPLETED'
     and (started_at at time zone 'Asia/Ho_Chi_Minh') >= v_from
     and (started_at at time zone 'Asia/Ho_Chi_Minh') <  v_to
  on conflict (business_id, period_type, period_year, period_index) do update
     set total_trips = excluded.total_trips, total_revenue = excluded.total_revenue, payload = excluded.payload
   where public.tax_period_summaries.status = 'DRAFT'
  returning * into v_row;

  if v_row.id is null then raise exception 'Kỳ này đã nộp, không thể tổng hợp lại'; end if;
  return v_row;
end $$;
revoke all on function public.build_period_summary(uuid,text,int,int) from public, anon;
grant execute on function public.build_period_summary(uuid,text,int,int) to authenticated;

-- ---------------------------------------------------------------------
-- B. Zalo CRM
-- ---------------------------------------------------------------------
-- Token Zalo OA KHÔNG lưu ở bảng client đọc được. Lưu trong Supabase Vault /
-- secrets của Edge Function; bảng này chỉ lưu định danh OA.
create table public.zalo_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  oa_id       text not null unique,
  oa_name     text,
  connected_at timestamptz not null default now()
);

create table public.crm_customers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  zalo_user_id   varchar(64),
  display_name   text not null,
  phone_number   varchar(15),
  segment        text not null default 'NEW' check (segment in ('NEW','ACTIVE','VIP','DORMANT','BLOCKED')),
  tags           text[] not null default '{}',
  -- Luật BVDLCN 91/2025/QH15: lưu căn cứ và thời điểm đồng ý xử lý dữ liệu
  consent_at     timestamptz,
  consent_source text,
  created_at     timestamptz not null default now(),
  unique (business_id, zalo_user_id),
  unique (business_id, phone_number)
);
create index on public.crm_customers using gin (tags);

create table public.crm_messages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  customer_id     uuid not null references public.crm_customers(id) on delete cascade,
  direction       text not null check (direction in ('IN','OUT')),
  sender_type     text not null check (sender_type in ('CUSTOMER','STAFF','AI_BOT','SYSTEM')),
  channel         text not null default 'ZALO_OA' check (channel in ('ZALO_OA','ZNS')),
  provider_msg_id text,
  body            text not null,
  intent          varchar(50),
  sent_by         uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (business_id, provider_msg_id)   -- webhook Zalo gửi lại không bị lưu trùng
);
create index on public.crm_messages (customer_id, created_at desc);

create table public.crm_automations (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  trigger_event    text not null check (trigger_event in ('ORDER_PAID','INVOICE_ISSUED','NEW_FOLLOWER','KEYWORD')),
  keyword          text,
  zns_template_id  varchar(64),
  reply_text       text,
  ai_enabled       boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  check (zns_template_id is not null or reply_text is not null or ai_enabled)
);

alter table public.zalo_connections enable row level security;
alter table public.crm_customers enable row level security;
alter table public.crm_messages enable row level security;
alter table public.crm_automations enable row level security;

create policy zalo_conn_select on public.zalo_connections for select to authenticated
  using (public.is_member(business_id));
-- Kết nối OA chỉ tạo qua Edge Function OAuth (service_role); không có policy ghi cho client

create policy crm_customers_select on public.crm_customers for select to authenticated
  using (public.is_member(business_id));
create policy crm_customers_write on public.crm_customers for all to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER','CASHIER']))
  with check (public.has_role(business_id, array['OWNER','MANAGER','CASHIER']));

create policy crm_messages_select on public.crm_messages for select to authenticated
  using (public.is_member(business_id));
-- Nhân viên chỉ ghi tin OUT do chính mình gửi; tin IN và tin AI do service_role ghi
create policy crm_messages_insert on public.crm_messages for insert to authenticated
  with check (public.is_member(business_id) and direction = 'OUT'
              and sender_type = 'STAFF' and sent_by = auth.uid()
              and exists (select 1 from public.crm_customers c
                          where c.id = customer_id and c.business_id = crm_messages.business_id));

create policy crm_automations_select on public.crm_automations for select to authenticated
  using (public.is_member(business_id));
create policy crm_automations_write on public.crm_automations for all to authenticated
  using (public.has_role(business_id, array['OWNER','MANAGER']))
  with check (public.has_role(business_id, array['OWNER','MANAGER']));

alter publication supabase_realtime add table public.crm_messages;
