import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClient } from '../src/lib/demoClient';
import { addDays, vnDay } from '../src/lib/time';
import {
  cleanCode, daysUntil, expiryTone, findByBarcode, fold, maskDate, matchProduct, nearestExpiryByProduct, parseDateVN,
  stockPeriodRange, stockReportCsv,
} from '../src/features/shop/inventory';

test('tìm hàng không dấu, theo nhóm, theo mã vạch', () => {
  const p = { name: 'Sữa tươi hộp', category: 'Sữa', barcode: '8934673573189' };
  assert.equal(fold('Đường Sữa'), 'duong sua');
  assert.ok(matchProduct(p, 'sua tuoi'));
  assert.ok(matchProduct(p, 'HỘP'));
  assert.ok(matchProduct(p, '89346735'));
  assert.ok(!matchProduct(p, 'bánh'));
  assert.ok(matchProduct(p, '  '));
  assert.equal(cleanCode(' 893 4673\n573189 '), '8934673573189');
  assert.equal(findByBarcode([p], '8934673573189 ')?.name, 'Sữa tươi hộp');
  assert.equal(findByBarcode([{ barcode: 'KEO-01' }], 'keo-01')?.barcode, 'KEO-01');
  assert.equal(findByBarcode([p], ''), undefined);
});

test('nhập ngày hết hạn dd/mm/yyyy', () => {
  assert.equal(maskDate('05122026'), '05/12/2026');
  assert.equal(maskDate('051'), '05/1');
  assert.equal(parseDateVN('05/12/2026'), '2026-12-05');
  assert.equal(parseDateVN('31/02/2026'), null);
  assert.equal(parseDateVN('5/12/2026'), null);
  assert.equal(daysUntil('2026-11-01', '2026-11-03'), 2);
  assert.equal(daysUntil('2026-11-01', '2026-10-31'), -1);
  assert.equal(expiryTone(-1, 7), 'danger');
  assert.equal(expiryTone(3, 7), 'warn');
  assert.equal(expiryTone(30, 7), 'success');
  const m = nearestExpiryByProduct([
    { lot_id: 'a', product_id: 'p', name: 'x', unit: 'hộp', expires_on: '2026-11-05', qty_left: 1, days_left: 4 },
    { lot_id: 'b', product_id: 'p', name: 'x', unit: 'hộp', expires_on: '2026-11-02', qty_left: 1, days_left: 1 },
  ]);
  assert.equal(m.get('p')?.lot_id, 'b');
});

test('kỳ xuất nhập tồn theo giờ Việt Nam', () => {
  const r = stockPeriodRange('LAST_MONTH', '2026-11-01');
  assert.equal(r.fromDay, '2026-10-01');
  assert.equal(r.toDay, '2026-10-31');
  assert.equal(r.from, '2026-09-30T17:00:00.000Z');
  assert.equal(r.to, '2026-10-31T17:00:00.000Z');
  assert.equal(stockPeriodRange('D7', '2026-11-01').fromDay, '2026-10-26');
  const csv = stockReportCsv([{ product_id: 'p', name: 'Sữa, hộp', unit: 'hộp', opening: 0, qty_in: 18, qty_sold: 2, qty_out: 1.5,
    qty_adjust: 0, closing: 14.5, cost_price: 7000, closing_value: 101500 }], '2026-11-01', '2026-11-01');
  assert.match(csv, /^Xuất nhập tồn 01\/11\/2026 - 01\/11\/2026/);
  assert.match(csv, /"Sữa, hộp",hộp,0,18,2,1.5,0,14.5,7000,101500/);
});

test('dùng thử: mã vạch, lô có hạn dùng, xuất hủy, xóa món, xuất nhập tồn', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = createDemoClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    mock.timers.tick(300);
    await new Promise((r) => setImmediate(r));
    return p;
  };
  await c.auth.verifyOtp({ phone: '+84903456789', token: '123456' });
  await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: 'Quán', p_tax_code: '0312345678', p_address: 'HCM' });
  const today = vnDay();

  // Dữ liệu mẫu: sữa có lô còn 2 ngày → cảnh báo
  const exp = (await rpc('expiring_lots', { p_business_id: 'b1' })).data;
  assert.equal(exp.length, 1);
  assert.equal(exp[0].name, 'Sữa tươi hộp');
  assert.equal(exp[0].days_left, 2);
  const products = (await c.from('products').select('*').eq('business_id', 'b1').is('archived_at', null)).data;
  const sua = products.find((p: { name: string }) => p.name === 'Sữa tươi hộp');
  assert.equal(sua.barcode, '8934673573189');

  // Trùng mã vạch bị chặn
  const dup = await rpc('upsert_product_v2', { p_product_id: 'n1', p_business_id: 'b1', p_name: 'Kẹo', p_price: 2000, p_unit: 'cái', p_barcode: '8934673573189' });
  assert.equal(dup.error?.message, 'QP_DUPLICATE_BARCODE');

  // Hàng có hạn phải có ngày hết hạn; nhập lô mới
  assert.equal((await rpc('stock_in_v2', { p_movement_id: 'm1', p_product_id: sua.id, p_qty: 5 })).error?.message, 'QP_EXPIRY_REQUIRED');
  await rpc('stock_in_v2', { p_movement_id: 'm1', p_product_id: sua.id, p_qty: 5, p_expires_on: addDays(today, 90) });
  await rpc('stock_in_v2', { p_movement_id: 'm1', p_product_id: sua.id, p_qty: 5, p_expires_on: addDays(today, 90) });
  let lots = (await c.from('stock_lots').select('*').eq('product_id', sua.id).gt('qty_left', 0).order('expires_on')).data;
  assert.equal(lots.length, 3);

  // Hủy lô sắp hết hạn → hết cảnh báo, tồn giảm
  await rpc('stock_out_v1', { p_movement_id: 'o1', p_product_id: sua.id, p_qty: 6, p_reason: 'EXPIRED', p_lot_id: lots[0].id });
  assert.equal((await rpc('expiring_lots', { p_business_id: 'b1' })).data.length, 0);
  assert.equal((await c.from('products').select('*').eq('id', sua.id)).data[0].stock_qty, 17);
  assert.equal((await rpc('stock_out_v1', { p_movement_id: 'o2', p_product_id: sua.id, p_qty: 99, p_reason: 'DAMAGED' })).error?.message, 'QP_OUT_EXCEEDS_STOCK');

  // Kiểm kho thiếu → trừ lô gần hạn trước
  await rpc('stock_count_v1', { p_movement_id: 'c1', p_product_id: sua.id, p_actual_qty: 10 });
  lots = (await c.from('stock_lots').select('*').eq('product_id', sua.id).gt('qty_left', 0).order('expires_on')).data;
  assert.deepEqual(lots.map((l: { qty_left: number }) => l.qty_left), [5, 5]);

  // Xuất nhập tồn hôm nay: đầu 0, nhập 23, xuất 6, kiểm −7, cuối 10
  const { vnDayRange } = await import('../src/lib/time');
  const r = vnDayRange(today);
  const rep = (await rpc('stock_report', { p_business_id: 'b1', p_from: r.from, p_to: r.to })).data;
  const row = rep.find((x: { name: string }) => x.name === 'Sữa tươi hộp');
  assert.deepEqual([row.opening, row.qty_in, row.qty_out, row.qty_adjust, row.closing, row.closing_value], [0, 23, 6, -7, 10, 70000]);

  // Xóa: món mới chưa dùng → xóa hẳn; món đã có phiếu kho → ẩn
  await rpc('upsert_product_v2', { p_product_id: 'n2', p_business_id: 'b1', p_name: 'Món thử', p_price: 1000, p_unit: 'cái', p_barcode: 'TEST-1' });
  assert.equal((await rpc('delete_product_v1', { p_product_id: 'n2' })).data, 'DELETED');
  assert.equal((await rpc('delete_product_v1', { p_product_id: sua.id })).data, 'ARCHIVED');
  const left = (await c.from('products').select('*').eq('business_id', 'b1').is('archived_at', null)).data;
  assert.ok(!left.some((p: { id: string }) => p.id === sua.id || p.id === 'n2'));
  assert.equal((await rpc('upsert_product_v2', { p_product_id: sua.id, p_business_id: 'b1', p_name: 'Sữa', p_price: 1, p_unit: 'hộp' })).error?.message, 'QP_NOT_FOUND');
  // Mã của món đã xóa dùng lại được
  assert.equal((await rpc('upsert_product_v2', { p_product_id: 'n3', p_business_id: 'b1', p_name: 'Sữa mới', p_price: 9500, p_unit: 'hộp', p_barcode: '8934673573189' })).error, null);
  mock.timers.reset();
});
