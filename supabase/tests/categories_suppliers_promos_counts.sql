-- Kiểm thử migration 20261108000009 (danh mục, nhà cung cấp, phiếu nhập + công nợ, giá vốn theo lô, khuyến mãi,
-- giảm giá trên đơn, hàng tặng / mẫu, kiểm kê, doanh thu theo nhóm ngành). Chạy trong transaction, ROLLBACK ở cuối.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/categories_suppliers_promos_counts.sql

begin;

insert into auth.users (id, email, phone) values
 ('a9111111-1111-1111-1111-111111111111','g_owner@test','84905000001'),
 ('a9222222-2222-2222-2222-222222222222','g_staff@test','84905000002'),
 ('a9333333-3333-3333-3333-333333333333','g_other@test','84905000003')
on conflict (id) do nothing;

create temp table t_ctx (k text primary key, v uuid);
grant all on t_ctx to authenticated, service_role;
create or replace function pg_temp.oid(p_k text) returns uuid language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;
create or replace function pg_temp.expect_code(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — lẽ ra phải báo %', p_label, p_code;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm <> p_code then raise exception 'FAIL: % — báo "%" thay vì %', p_label, sqlerrm, p_code; end if;
  raise notice 'PASS: % (%)', p_label, p_code;
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

insert into t_ctx select k, gen_random_uuid() from unnest(array[
  'biz','biz_b','c_milk','c_food','c_dup','milk','noodle','candy','legacy','s1','pu0','pu1','pu2','l0','l1','l2','l3','l9','si1',
  'pay1','pay2','km1','km2','km3','o1','o2','o3','o4','o5','g1','g2','k1','k2','x1']) k;

set local role authenticated;
set local request.jwt.claim.sub = 'a9111111-1111-1111-1111-111111111111';
select create_business_v1(pg_temp.oid('biz'), 'Tạp hóa Chín', '0377777709', 'HCM');

-- ---------- 1. Danh mục ----------
select upsert_category_v1(pg_temp.oid('c_milk'), pg_temp.oid('biz'), 'Sữa', 0, null, true);
select upsert_category_v1(pg_temp.oid('c_food'), pg_temp.oid('biz'), 'Đồ ăn', 1, 'PRODUCTION', false);
select pg_temp.expect_code($q$ select upsert_category_v1(pg_temp.oid('c_dup'), pg_temp.oid('biz'), ' sữa ') $q$, 'QP_DUPLICATE_NAME', 'Không trùng tên danh mục');
select pg_temp.expect_code($q$ select upsert_category_v1(pg_temp.oid('c_dup'), pg_temp.oid('biz'), 'X', 0, 'BAD') $q$, 'QP_INVALID_INPUT', 'Nhóm ngành sai');
select upsert_product_v2(pg_temp.oid('milk'), pg_temp.oid('biz'), 'Sữa hộp', 10000, 'hộp', null, null, true, null, null, true, 7, pg_temp.oid('c_milk'));
select upsert_product_v2(pg_temp.oid('noodle'), pg_temp.oid('biz'), 'Mì ly', 30000, 'ly', null, null, false, null, null, false, 7, pg_temp.oid('c_food'));
select upsert_product_v2(pg_temp.oid('candy'), pg_temp.oid('biz'), 'Kẹo', 2000, 'cái', null, null, true);
select upsert_product_v2(pg_temp.oid('legacy'), pg_temp.oid('biz'), 'Bánh quy', 15000, 'gói', 'Bánh kẹo');
select pg_temp.ok((select category = 'Sữa' and category_id = pg_temp.oid('c_milk') from products where id = pg_temp.oid('milk')), 'Món gắn danh mục theo mã');
select pg_temp.ok((select category_id is not null and category = 'Bánh kẹo' from products where id = pg_temp.oid('legacy')), 'Bản cũ gửi tên chữ → tự tạo danh mục');
select upsert_category_v1(pg_temp.oid('c_milk'), pg_temp.oid('biz'), 'Sữa các loại', 0, null, true);
select pg_temp.ok((select category = 'Sữa các loại' from products where id = pg_temp.oid('milk')), 'Đổi tên danh mục → tên trên món đổi theo');

-- ---------- 2. Nhà cung cấp, phiếu nhập, công nợ ----------
select upsert_supplier_v1(pg_temp.oid('s1'), pg_temp.oid('biz'), 'Đại lý Vinamilk', '0903 000 111');
select pg_temp.expect_code($q$ select upsert_supplier_v1(gen_random_uuid(), pg_temp.oid('biz'), 'X', 'abc') $q$, 'QP_INVALID_INPUT', 'Số điện thoại nhà cung cấp sai');
select pg_temp.expect_code($q$ select create_purchase_v1(pg_temp.oid('pu0'), pg_temp.oid('biz'), pg_temp.oid('s1'),
  jsonb_build_array(jsonb_build_object('movement_id', pg_temp.oid('l0'), 'product_id', pg_temp.oid('milk'), 'qty', 10, 'unit_cost', 7000)), 0) $q$,
  'QP_EXPIRY_REQUIRED', 'Hàng có hạn dùng phải có ngày hết hạn trong phiếu nhập');
select create_purchase_v1(pg_temp.oid('pu1'), pg_temp.oid('biz'), pg_temp.oid('s1'), jsonb_build_array(
  jsonb_build_object('movement_id', pg_temp.oid('l1'), 'product_id', pg_temp.oid('milk'), 'qty', 10, 'unit_cost', 7000, 'expires_on', pg_temp.today() + 30),
  jsonb_build_object('movement_id', pg_temp.oid('l2'), 'product_id', pg_temp.oid('milk'), 'qty', 10, 'unit_cost', 8000, 'expires_on', pg_temp.today() + 10),
  jsonb_build_object('movement_id', pg_temp.oid('l3'), 'product_id', pg_temp.oid('candy'), 'qty', 100, 'unit_cost', 1000)), 100000, true);
select create_purchase_v1(pg_temp.oid('pu1'), pg_temp.oid('biz'), pg_temp.oid('s1'), jsonb_build_array(
  jsonb_build_object('movement_id', pg_temp.oid('l1'), 'product_id', pg_temp.oid('milk'), 'qty', 10, 'unit_cost', 7000, 'expires_on', pg_temp.today() + 30)), 100000, true);
select pg_temp.ok((select total_amount = 250000 and paid_amount = 100000 and line_count = 3 from purchases where id = pg_temp.oid('pu1')), 'Phiếu nhập 3 dòng 250.000, trả 100.000');
select pg_temp.ok((select stock_qty = 20 and supplier_id = pg_temp.oid('s1') and cost_price = 8000 from products where id = pg_temp.oid('milk')),
  'Gửi lại phiếu không cộng 2 lần; món nhận nhà cung cấp thường nhập, giá nhập gần nhất');
select pg_temp.ok((select count(*) = 3 and bool_and(unit_cost is not null and purchase_id = pg_temp.oid('pu1')) from stock_lots where purchase_id = pg_temp.oid('pu1')),
  'Mỗi dòng một lô có giá nhập');
select pg_temp.expect_code($q$ select create_purchase_v1(pg_temp.oid('pu2'), pg_temp.oid('biz'), pg_temp.oid('s1'),
  jsonb_build_array(jsonb_build_object('movement_id', pg_temp.oid('l9'), 'product_id', pg_temp.oid('candy'), 'qty', 1, 'unit_cost', 1000)), 999999) $q$,
  'QP_INVALID_INPUT', 'Trả ngay không quá tổng tiền hàng');
select stock_in_v2(pg_temp.oid('si1'), pg_temp.oid('candy'), 50, 1000, null, false, null, pg_temp.oid('s1'), 0);
select pg_temp.ok((select balance = 200000 from supplier_balances(pg_temp.oid('biz')) where supplier_id = pg_temp.oid('s1')),
  'Nhập lẻ ghi nợ hết → nợ 200.000');
select pay_supplier_v1(pg_temp.oid('pay1'), pg_temp.oid('s1'), 120000, null, true);
select pay_supplier_v1(pg_temp.oid('pay2'), pg_temp.oid('s1'), 30000);
select void_supplier_payment_v1(pg_temp.oid('pay2'));
select pg_temp.ok((select balance = 80000 and purchased = 300000 and paid = 220000 from supplier_balances(pg_temp.oid('biz'))), 'Trả 120.000, hủy lần trả 30.000 → còn nợ 80.000');
select pg_temp.ok((select sum(amount) = 220000 from journal_entries where business_id = pg_temp.oid('biz') and category = 'Nhập hàng' and voided_at is null),
  'Chi tiêu nhập hàng = tiền đã trả có chọn ghi chi');
select pg_temp.ok((select jsonb_array_length(supplier_detail(pg_temp.oid('s1')) -> 'products') = 2), 'Nhà cung cấp → các món đã giao');
select pg_temp.ok((select is_default and last_cost = 7000 from product_suppliers(pg_temp.oid('milk'))) is not null, 'Món → nhà cung cấp');

-- ---------- 3. Giá vốn theo lô khi bán ----------
select create_cash_sale_v1(pg_temp.oid('o1'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Sữa hộp','quantity',4,'unit_price',10000,'product_id',pg_temp.oid('milk'))));
select pg_temp.ok((select unit_cost = 8000 from stock_movements where order_id = pg_temp.oid('o1')), 'Bán lấy lô hết hạn sớm (8.000) làm giá vốn');
select pg_temp.ok((select qty_left = 6 from stock_lots where id = pg_temp.oid('l2')) and (select qty_left = 10 from stock_lots where id = pg_temp.oid('l1')),
  'Trừ lô hết hạn sớm trước');

-- ---------- 4. Khuyến mãi, giảm giá trên đơn, món tặng ----------
select upsert_promotion_v1(pg_temp.oid('km1'), pg_temp.oid('biz'), 'Mì giảm 10%', 'ITEM_DISCOUNT', pg_temp.oid('noodle'), null, 10);
select pg_temp.expect_code($q$ select upsert_promotion_v1(pg_temp.oid('km2'), pg_temp.oid('biz'), 'Sai', 'ITEM_DISCOUNT', pg_temp.oid('noodle'), null, 10, 1000) $q$,
  'QP_INVALID_INPUT', 'Không vừa % vừa số tiền');
select upsert_promotion_v1(pg_temp.oid('km3'), pg_temp.oid('biz'), 'Mua 2 mì tặng 1 kẹo', 'BUY_X_GET_Y', pg_temp.oid('noodle'), null, null, null, 2, 1, pg_temp.oid('candy'));
select create_cash_sale_v1(pg_temp.oid('o2'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Mì ly','quantity',2,'unit_price',30000,'product_id',pg_temp.oid('noodle'),'discount_amount',6000,'promotion_id',pg_temp.oid('km1')),
  jsonb_build_object('name','Kẹo','quantity',1,'unit_price',0,'product_id',pg_temp.oid('candy'),'is_gift',true,'promotion_id',pg_temp.oid('km3'))),
  now(), null, 2000, null, 'Khách quen');
select pg_temp.ok((select total_amount = 52000 and discount_amount = 2000 and tax_groups = '{"PRODUCTION": 52000}'::jsonb from orders where id = pg_temp.oid('o2')),
  'Đơn: 60.000 − giảm món 6.000 − giảm tay 2.000 = 52.000, nhóm ngành ăn uống');
select pg_temp.ok((select array_agg(line_amount order by line_amount desc) = array[54000::bigint, 0] from order_items where order_id = pg_temp.oid('o2')), 'Tiền dòng sau giảm; món tặng 0 đ');
select pg_temp.ok((select stock_qty = 149 from products where id = pg_temp.oid('candy')), 'Món tặng vẫn trừ kho');
select pg_temp.expect_code($q$ select create_cash_sale_v1(pg_temp.oid('o3'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Bán hàng','quantity',1,'unit_price',1000)), now(), null, 999999) $q$, 'QP_INVALID_INPUT', 'Giảm không quá tiền hàng');
select pg_temp.expect_code($q$ select create_cash_sale_v1(pg_temp.oid('o3'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Kẹo','quantity',1,'unit_price',2000,'is_gift',true))) $q$, 'QP_INVALID_ITEMS', 'Món tặng phải giá 0');

-- ---------- 5. Hàng tặng / hàng mẫu ----------
select stock_out_v1(pg_temp.oid('g1'), pg_temp.oid('candy'), 4, 'GIFT');
select stock_out_v1(pg_temp.oid('g2'), pg_temp.oid('candy'), 5, 'SAMPLE');
select pg_temp.ok((select stock_qty = 140 from products where id = pg_temp.oid('candy')), 'Xuất tặng 4, mẫu 5 → tồn 140');
select pg_temp.ok((select unit_cost = 1000 from stock_movements where id = pg_temp.oid('g1')), 'Xuất tặng ghi giá vốn');

-- ---------- 6. Kiểm kê ----------
select start_stock_count_v1(pg_temp.oid('k1'), pg_temp.oid('biz'));
select pg_temp.expect_code($q$ select start_stock_count_v1(pg_temp.oid('k2'), pg_temp.oid('biz')) $q$, 'QP_COUNT_ALREADY_OPEN', 'Mỗi lúc một lần kiểm');
select count_line_v1(pg_temp.oid('k1'), pg_temp.oid('milk'), 14);
select count_line_v1(pg_temp.oid('k1'), pg_temp.oid('candy'), 140);
select create_cash_sale_v1(pg_temp.oid('o4'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Sữa hộp','quantity',2,'unit_price',10000,'product_id',pg_temp.oid('milk'))));
select pg_temp.ok((select jsonb_array_length(stock_count_detail(pg_temp.oid('k1')) -> 'lines') = 2), 'Chi tiết kiểm kê có 2 món đã đếm');
select finish_stock_count_v1(pg_temp.oid('k1'));
select pg_temp.ok((select status = 'DONE' and lines_total = 2 and lines_diff = 1 from stock_counts where id = pg_temp.oid('k1')), 'Chốt: 2 món đếm, 1 món lệch');
select pg_temp.ok((select stock_qty = 12 from products where id = pg_temp.oid('milk')), 'Máy 16 đếm 14, bán thêm 2 → 12');
select pg_temp.expect_code($q$ select count_line_v1(pg_temp.oid('k1'), pg_temp.oid('milk'), 1) $q$, 'QP_COUNT_CLOSED', 'Không đếm vào lần đã chốt');

-- ---------- 7. Doanh thu theo nhóm ngành ----------
select pg_temp.ok((select (r ->> 'total')::bigint = 112000 and (r -> 'by_group' ->> 'GOODS')::bigint = 60000 and (r -> 'by_group' ->> 'PRODUCTION')::bigint = 52000
                     from revenue_notice(pg_temp.oid('biz'), pg_temp.today(), pg_temp.today()) r), 'Thông báo doanh thu tách nhóm ngành');

-- ---------- 8. Phân quyền, RLS ----------
select invite_member_v1(gen_random_uuid(), pg_temp.oid('biz'), '0905000002', 'CASHIER');
set local request.jwt.claim.sub = 'a9222222-2222-2222-2222-222222222222';
select accept_invites_v1();
select pg_temp.expect_code($q$ select create_cash_sale_v1(pg_temp.oid('o5'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Bán hàng','quantity',1,'unit_price',10000)), now(), null, 1000) $q$, 'QP_FORBIDDEN', 'Thu ngân không giảm tay khi quán chưa cho');
select create_cash_sale_v1(pg_temp.oid('o5'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Mì ly','quantity',1,'unit_price',30000,'product_id',pg_temp.oid('noodle'),'discount_amount',3000,'promotion_id',pg_temp.oid('km1'))));
select pg_temp.ok((select total_amount = 27000 from orders where id = pg_temp.oid('o5')), 'Thu ngân bán theo khuyến mãi đã cài');
select pg_temp.expect_code($q$ select pay_supplier_v1(gen_random_uuid(), pg_temp.oid('s1'), 1000) $q$, 'QP_FORBIDDEN', 'Thu ngân không trả nợ nhà cung cấp');
select pg_temp.expect_code($q$ select start_stock_count_v1(gen_random_uuid(), pg_temp.oid('biz')) $q$, 'QP_FORBIDDEN', 'Thu ngân không mở kiểm kê');
select pg_temp.expect_code($q$ select revenue_notice(pg_temp.oid('biz'), pg_temp.today(), pg_temp.today()) $q$, 'QP_FORBIDDEN', 'Thu ngân không xem thông báo doanh thu');
select create_purchase_v1(gen_random_uuid(), pg_temp.oid('biz'), null,
  jsonb_build_array(jsonb_build_object('movement_id', gen_random_uuid(), 'product_id', pg_temp.oid('candy'), 'qty', 10, 'unit_cost', 900)));
select pg_temp.ok((select stock_qty = 150 from products where id = pg_temp.oid('candy')), 'Thu ngân nhập hàng được (không chọn NCC → trả đủ)');

set local request.jwt.claim.sub = 'a9111111-1111-1111-1111-111111111111';
select update_business_settings_v1(pg_temp.oid('biz'), null, true);
set local request.jwt.claim.sub = 'a9222222-2222-2222-2222-222222222222';
select create_cash_sale_v1(pg_temp.oid('x1'), pg_temp.oid('biz'), jsonb_build_array(
  jsonb_build_object('name','Bán hàng','quantity',1,'unit_price',10000)), now(), null, 1000);
select pg_temp.ok((select total_amount = 9000 from orders where id = pg_temp.oid('x1')), 'Quán cho phép → thu ngân giảm tay được');

set local request.jwt.claim.sub = 'a9333333-3333-3333-3333-333333333333';
select create_business_v1(pg_temp.oid('biz_b'), 'Quán khác', '0377777710', 'HN');
select pg_temp.ok((select count(*) = 0 from suppliers) and (select count(*) = 0 from purchases) and (select count(*) = 0 from supplier_payments)
               and (select count(*) = 0 from promotions) and (select count(*) = 0 from stock_counts) and (select count(*) = 0 from product_categories),
  'RLS: hộ khác không thấy nhà cung cấp, phiếu nhập, khuyến mãi, kiểm kê, danh mục');
select pg_temp.expect_code($q$ select create_purchase_v1(gen_random_uuid(), pg_temp.oid('biz'), null, '[]'::jsonb) $q$, 'QP_FORBIDDEN', 'Hộ khác không nhập hàng');
select pg_temp.expect_code($q$ select pay_supplier_v1(gen_random_uuid(), pg_temp.oid('s1'), 1000) $q$, 'QP_NOT_FOUND', 'Hộ khác không trả nợ');
select pg_temp.expect_code($q$ insert into promotions (id, business_id, name, kind, percent) values (gen_random_uuid(), pg_temp.oid('biz_b'), 'x', 'ORDER_DISCOUNT', 5) $q$,
  'permission denied for table promotions', 'App không ghi thẳng bảng khuyến mãi');

reset role;
rollback;
