import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClient, setSampleMode } from '../src/lib/demoClient';
import { applyPromotions, orderPayload, type Promotion } from '../src/features/promo/engine';
import { form01Html, form01Rows, form01Sheet, form01Range, fmtNum, type Form01Data } from '../src/features/tax/form01';
import { buildXlsx } from '../src/lib/xlsx';
import { crc32 } from '../src/lib/zip';
import { addMonthsDay } from '../src/features/shop/inventory';
import { addDays, vnDay } from '../src/lib/time';

const promo = (p: Partial<Promotion>): Promotion => ({
  id: 'x', name: 'KM', kind: 'ITEM_DISCOUNT', product_id: null, category_id: null, percent: null, amount: null, buy_qty: null, get_qty: null,
  get_product_id: null, min_total: null, starts_on: null, ends_on: null, is_active: true, ...p,
});

test('khuyến mãi: giảm món lấy mức lợi nhất, mua X tặng Y, giảm tổng đơn, giảm tay', () => {
  const products = new Map([
    ['cf', { name: 'Cà phê', price: 20000, category_id: 'drink' }],
    ['tea', { name: 'Trà', price: 10000, category_id: 'drink' }],
    ['cake', { name: 'Bánh', price: 15000, category_id: null }],
  ]);
  const cart = [
    { product_id: 'cf', category_id: 'drink', name: 'Cà phê', quantity: 2, unit_price: 20000 },
    { product_id: 'tea', category_id: 'drink', name: 'Trà', quantity: 4, unit_price: 10000 },
  ];
  const promos = [
    promo({ id: 'p10', name: 'Đồ uống 10%', category_id: 'drink', percent: 10 }),
    promo({ id: 'cf5k', name: 'Cà phê giảm 5k', product_id: 'cf', amount: 5000 }),
    promo({ id: 'b3', name: 'Mua 3 trà tặng 1 bánh', kind: 'BUY_X_GET_Y', product_id: 'tea', buy_qty: 3, get_qty: 1, get_product_id: 'cake' }),
    promo({ id: 'o', name: 'Đơn từ 50k giảm 3k', kind: 'ORDER_DISCOUNT', amount: 3000, min_total: 50000 }),
    promo({ id: 'old', name: 'Hết hạn', category_id: 'drink', percent: 50, ends_on: '2020-01-01' }),
    promo({ id: 'off', name: 'Tạm dừng', category_id: 'drink', percent: 50, is_active: false }),
  ];
  const r = applyPromotions(cart, promos, '2026-11-08', products, 2000);
  // Cà phê: 10% = 4.000 < 5.000/ly × 2 = 10.000 → lấy 10.000; trà 10% = 4.000
  assert.deepEqual(r.lines.map((l) => [l.name, l.discount_amount, l.line_amount, l.is_gift]), [
    ['Cà phê', 10000, 30000, false],
    ['Trà', 4000, 36000, false],
    ['Bánh', 0, 0, true],
  ]);
  assert.equal(r.subtotal, 66000);
  assert.equal(r.orderDiscount.amount, 3000);
  assert.equal(r.manualDiscount, 2000);
  assert.equal(r.total, 61000);
  const pay = orderPayload(r);
  assert.equal(pay.discount_amount, 5000);
  assert.equal(pay.promotion_id, null, 'có giảm tay → không gắn chương trình cho phần giảm cả đơn');
  assert.equal(pay.items[2]!.promotion_id, 'b3');
  // Không đủ mức tối thiểu → không giảm tổng đơn
  assert.equal(applyPromotions(cart.slice(0, 1), promos, '2026-11-08', products).orderDiscount.amount, 0);
});

test('hạn dùng cộng tháng, mẫu 01 theo kỳ, định dạng số', () => {
  assert.equal(addMonthsDay('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsDay('2026-11-08', 12), '2027-11-08');
  assert.deepEqual(form01Range('H2', 2026), { from: '2026-07-01', to: '2026-12-31' });
  assert.equal(fmtNum(1234567), '1.234.567');
  assert.equal(fmtNum(null), '');
});

test('mẫu 01/TKN-CNKD: dòng theo nhóm ngành, HTML in, file Excel hợp lệ', () => {
  const d: Form01Data = {
    period: 'YEAR', year: 2026, first: true, supplementNo: null, taxpayer: 'Nguyễn Thị Ba', taxCode: '0312345678', address: 'Q1 <HCM>',
    phone: '', byGroup: { GOODS: 600000000, PRODUCTION: 150000000 }, total: 750000000, signDay: '2027-01-15',
  };
  const rows = form01Rows(d);
  assert.deepEqual(rows.filter((r) => r.revenue).map((r) => [r.code, r.revenue]), [['[08]', 600000000], ['', 150000000], ['[13]', 750000000]]);
  const html = form01Html(d);
  assert.match(html, /Mẫu số: 01\/TKN-CNKD/);
  assert.match(html, /89\/2026\/TT-BTC/);
  assert.match(html, /☒ \[01a\] Năm 2026/);
  assert.match(html, /600\.000\.000/);
  assert.match(html, /Q1 &lt;HCM&gt;/);
  assert.match(html, /ngày 15 tháng 01 năm 2027/);
  const sheet = form01Sheet(d);
  assert.ok(sheet.rows.some((r) => r.some((c) => c?.v === 750000000)));
  const x = buildXlsx(sheet);
  // ZIP: chữ ký đầu file, cuối có bản ghi kết thúc thư mục
  assert.deepEqual([...x.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const end = new DataView(x.buffer, x.length - 22, 22);
  assert.equal(end.getUint32(0, true), 0x06054b50);
  assert.equal(end.getUint16(10, true), 6);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('danh mục, nhà cung cấp, phiếu nhập có nợ, giá vốn theo lô, giảm giá khi bán, kiểm kê, doanh thu theo nhóm ngành', async () => {
  setSampleMode(false);
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = createDemoClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    mock.timers.tick(300);
    await new Promise((r) => setImmediate(r));
    return p;
  };
  const okRpc = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc(name, args);
    assert.equal(r.error, null, `${name}: ${r.error?.message}`);
    return r.data;
  };
  await c.auth.verifyOtp({ phone: '+84903111222', token: '123456' });
  await okRpc('create_business_v1', { p_business_id: 'b9', p_business_name: 'Tạp hóa Chín', p_tax_code: '0312345678', p_address: 'HCM' });
  const today = vnDay();

  // ---- Danh mục ----
  await okRpc('upsert_category_v1', { p_category_id: 'c-milk', p_business_id: 'b9', p_name: 'Sữa', p_track_expiry_default: true });
  await okRpc('upsert_category_v1', { p_category_id: 'c-food', p_business_id: 'b9', p_name: 'Đồ ăn', p_tax_group: 'PRODUCTION' });
  assert.equal((await rpc('upsert_category_v1', { p_category_id: 'c-x', p_business_id: 'b9', p_name: 'sữa' })).error?.message, 'QP_DUPLICATE_NAME');
  await okRpc('upsert_product_v2', { p_product_id: 'milk', p_business_id: 'b9', p_name: 'Sữa hộp', p_price: 10000, p_unit: 'hộp', p_category_id: 'c-milk',
    p_track_stock: true, p_track_expiry: true });
  await okRpc('upsert_product_v2', { p_product_id: 'noodle', p_business_id: 'b9', p_name: 'Mì ly', p_price: 30000, p_unit: 'ly', p_category_id: 'c-food' });
  // Bản cũ gửi tên chữ → tự tạo danh mục
  const legacy = await okRpc('upsert_product_v2', { p_product_id: 'candy', p_business_id: 'b9', p_name: 'Kẹo', p_price: 2000, p_unit: 'cái', p_category: 'Bánh kẹo', p_track_stock: true });
  assert.ok(legacy.category_id);
  assert.equal(legacy.category, 'Bánh kẹo');
  // Đổi tên danh mục → tên trên hàng đổi theo
  await okRpc('upsert_category_v1', { p_category_id: 'c-milk', p_business_id: 'b9', p_name: 'Sữa các loại', p_track_expiry_default: true });
  assert.equal((await c.from('products').select('*').eq('id', 'milk').single()).data.category, 'Sữa các loại');

  // ---- Nhà cung cấp + phiếu nhập: 2 lô sữa giá khác nhau, trả 100k còn nợ ----
  await okRpc('upsert_supplier_v1', { p_supplier_id: 's1', p_business_id: 'b9', p_name: 'Đại lý Vinamilk', p_phone: '0903 000 111' });
  const lineMissingExpiry = await rpc('create_purchase_v1', { p_purchase_id: 'pu0', p_business_id: 'b9', p_supplier_id: 's1', p_paid_amount: 0,
    p_lines: [{ movement_id: 'l0', product_id: 'milk', qty: 10, unit_cost: 7000 }] });
  assert.equal(lineMissingExpiry.error?.message, 'QP_EXPIRY_REQUIRED');
  const pu = await okRpc('create_purchase_v1', {
    p_purchase_id: 'pu1', p_business_id: 'b9', p_supplier_id: 's1', p_paid_amount: 100000, p_record_expense: true,
    p_lines: [
      { movement_id: 'l1', product_id: 'milk', qty: 10, unit_cost: 7000, expires_on: addDays(today, 30) },
      { movement_id: 'l2', product_id: 'milk', qty: 10, unit_cost: 8000, expires_on: addDays(today, 10) },
      { movement_id: 'l3', product_id: 'candy', qty: 100, unit_cost: 1000 },
    ],
  });
  assert.equal(pu.total_amount, 250000);
  // Gửi lại cùng mã phiếu không nhập hai lần
  await okRpc('create_purchase_v1', { p_purchase_id: 'pu1', p_business_id: 'b9', p_supplier_id: 's1', p_paid_amount: 100000,
    p_lines: [{ movement_id: 'l1', product_id: 'milk', qty: 10, unit_cost: 7000, expires_on: addDays(today, 30) }] });
  assert.equal((await c.from('products').select('*').eq('id', 'milk').single()).data.stock_qty, 20);
  let bal = (await okRpc('supplier_balances', { p_business_id: 'b9' }))[0];
  assert.deepEqual([bal.purchased, bal.paid, bal.balance], [250000, 100000, 150000]);
  assert.equal((await rpc('create_purchase_v1', { p_purchase_id: 'pu2', p_business_id: 'b9', p_supplier_id: 's1', p_paid_amount: 999999,
    p_lines: [{ movement_id: 'l9', product_id: 'candy', qty: 1, unit_cost: 1000 }] })).error?.message, 'QP_INVALID_INPUT');
  // Nhập lẻ một món qua stock_in_v2 có nhà cung cấp, ghi nợ hết
  await okRpc('stock_in_v2', { p_movement_id: 'si1', p_product_id: 'candy', p_qty: 50, p_unit_cost: 1000, p_supplier_id: 's1', p_paid_amount: 0 });
  bal = (await okRpc('supplier_balances', { p_business_id: 'b9' }))[0];
  assert.equal(bal.balance, 200000);
  // Trả nợ, hủy một lần trả
  await okRpc('pay_supplier_v1', { p_payment_id: 'pay1', p_supplier_id: 's1', p_amount: 120000, p_record_expense: true });
  await okRpc('pay_supplier_v1', { p_payment_id: 'pay2', p_supplier_id: 's1', p_amount: 30000 });
  await okRpc('void_supplier_payment_v1', { p_payment_id: 'pay2' });
  bal = (await okRpc('supplier_balances', { p_business_id: 'b9' }))[0];
  assert.equal(bal.balance, 80000);
  const det = await okRpc('supplier_detail', { p_supplier_id: 's1' });
  assert.deepEqual(det.products.map((p: { name: string; qty_total: number }) => [p.name, p.qty_total]).sort(), [['Kẹo', 150], ['Sữa hộp', 20]]);
  const ps = await okRpc('product_suppliers', { p_product_id: 'milk' });
  assert.deepEqual([ps[0].name, ps[0].is_default], ['Đại lý Vinamilk', true]);
  // Chi tiêu "Nhập hàng": 100k trả khi nhập + 120k trả nợ (lần 30k không ghi chi)
  const exp = (await c.from('journal_entries').select('*').eq('business_id', 'b9').eq('category', 'Nhập hàng')).data
    .filter((j: { voided_at: string | null }) => !j.voided_at);
  assert.equal(exp.reduce((t: number, j: { amount: number }) => t + j.amount, 0), 220000);

  // ---- Bán: lô hết hạn sớm (8.000đ) trừ trước → giá vốn 8.000 ----
  await okRpc('create_cash_sale_v1', { p_order_id: 'o1', p_business_id: 'b9', p_items: [{ product_id: 'milk', name: 'Sữa hộp', quantity: 4, unit_price: 10000 }] });
  const mv = (await c.from('stock_movements').select('*').eq('order_id', 'o1')).data[0];
  assert.deepEqual([mv.qty, mv.unit_cost], [-4, 8000]);
  const lots = (await c.from('stock_lots').select('*').eq('product_id', 'milk').gt('qty_left', 0).order('expires_on')).data;
  assert.deepEqual(lots.map((l: { qty_left: number }) => l.qty_left), [6, 10]);

  // ---- Giảm giá: khuyến mãi + giảm tay; thu ngân không được giảm tay khi quán chưa cho ----
  await okRpc('upsert_promotion_v1', { p_promotion_id: 'km1', p_business_id: 'b9', p_name: 'Mì giảm 10%', p_kind: 'ITEM_DISCOUNT', p_product_id: 'noodle', p_percent: 10 });
  assert.equal((await rpc('upsert_promotion_v1', { p_promotion_id: 'km2', p_business_id: 'b9', p_name: 'Sai', p_kind: 'ITEM_DISCOUNT', p_product_id: 'noodle', p_percent: 10, p_amount: 1000 })).error?.message, 'QP_INVALID_INPUT');
  const o2 = await okRpc('create_cash_sale_v1', {
    p_order_id: 'o2', p_business_id: 'b9', p_discount_amount: 2000, p_promotion_id: null,
    p_items: [
      { product_id: 'noodle', name: 'Mì ly', quantity: 2, unit_price: 30000, discount_amount: 6000, promotion_id: 'km1' },
      { product_id: 'candy', name: 'Kẹo', quantity: 1, unit_price: 0, is_gift: true, promotion_id: 'km1' },
    ],
  });
  assert.equal(o2.total_amount, 52000);
  assert.equal(o2.discount_amount, 2000);
  assert.deepEqual(o2.tax_groups, { PRODUCTION: 52000 });
  const items = (await c.from('order_items').select('*').eq('order_id', 'o2')).data;
  assert.deepEqual(items.map((i: { line_amount: number; is_gift: boolean }) => [i.line_amount, i.is_gift]), [[54000, false], [0, true]]);
  assert.equal((await c.from('products').select('*').eq('id', 'candy').single()).data.stock_qty, 149, 'món tặng vẫn trừ kho');
  assert.equal((await rpc('create_cash_sale_v1', { p_order_id: 'o3', p_business_id: 'b9', p_discount_amount: 999999,
    p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 1000 }] })).error?.message, 'QP_INVALID_INPUT');

  // ---- Hàng tặng / hàng mẫu xuất kho ----
  await okRpc('stock_out_v1', { p_movement_id: 'g1', p_product_id: 'candy', p_qty: 4, p_reason: 'GIFT' });
  await okRpc('stock_out_v1', { p_movement_id: 'g2', p_product_id: 'candy', p_qty: 5, p_reason: 'SAMPLE' });
  assert.equal((await c.from('products').select('*').eq('id', 'candy').single()).data.stock_qty, 140);

  // ---- Kiểm kê: đếm sữa 14 (máy 16), bán thêm 2 trong lúc đếm, chốt → 12 ----
  await okRpc('start_stock_count_v1', { p_count_id: 'k1', p_business_id: 'b9' });
  assert.equal((await rpc('start_stock_count_v1', { p_count_id: 'k2', p_business_id: 'b9' })).error?.message, 'QP_COUNT_ALREADY_OPEN');
  await okRpc('count_line_v1', { p_count_id: 'k1', p_product_id: 'milk', p_counted_qty: 14 });
  await okRpc('count_line_v1', { p_count_id: 'k1', p_product_id: 'candy', p_counted_qty: 140 });
  await okRpc('create_cash_sale_v1', { p_order_id: 'o4', p_business_id: 'b9', p_items: [{ product_id: 'milk', name: 'Sữa hộp', quantity: 2, unit_price: 10000 }] });
  const detail = await okRpc('stock_count_detail', { p_count_id: 'k1' });
  assert.equal(detail.lines.length, 2);
  const done = await okRpc('finish_stock_count_v1', { p_count_id: 'k1' });
  assert.deepEqual([done.status, done.lines_total, done.lines_diff], ['DONE', 2, 1]);
  assert.equal((await c.from('products').select('*').eq('id', 'milk').single()).data.stock_qty, 12);
  assert.equal((await rpc('count_line_v1', { p_count_id: 'k1', p_product_id: 'milk', p_counted_qty: 1 })).error?.message, 'QP_COUNT_CLOSED');

  // ---- Doanh thu theo nhóm ngành cho mẫu 01/TKN-CNKD ----
  const rn = await okRpc('revenue_notice', { p_business_id: 'b9', p_from_day: today, p_to_day: today });
  assert.equal(rn.total, 40000 + 52000 + 20000);
  assert.deepEqual(rn.by_group, { GOODS: 60000, PRODUCTION: 52000 });

  // ---- Bỏ danh mục / nhà cung cấp ----
  await okRpc('archive_category_v1', { p_category_id: 'c-food' });
  assert.equal((await c.from('products').select('*').eq('id', 'noodle').single()).data.category_id, null);
  await okRpc('archive_supplier_v1', { p_supplier_id: 's1' });
  assert.equal((await okRpc('supplier_balances', { p_business_id: 'b9' })).length, 0);

  mock.timers.reset();
  setSampleMode(true);
});
