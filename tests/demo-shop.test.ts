import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClient } from '../src/lib/demoClient';
import { vnDayRange, vnDay } from '../src/lib/time';

test('dùng thử: bán theo món trừ kho, khách quen, ca bán, nhân viên, thu nợ QR, hóa đơn', async () => {
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

  const products = (await c.from('products').select('*').eq('business_id', 'b1').eq('is_active', true)).data;
  const banh = products.find((p: { name: string }) => p.name === 'Bánh mì');
  const cafe = products.find((p: { name: string }) => p.name === 'Cà phê sữa');
  assert.equal(banh.stock_qty, 20);

  // Ca bán mở trước khi bán
  await rpc('open_shift_v1', { p_shift_id: 's1', p_business_id: 'b1', p_opening_cash: 200000 });

  // Bán tiền mặt theo món + gắn khách quen → trừ kho, cộng điểm
  const items = [
    { name: 'Bánh mì', quantity: 3, unit_price: 15000, product_id: banh.id },
    { name: 'Cà phê sữa', quantity: 2, unit_price: 20000, product_id: cafe.id },
  ];
  const sale = await rpc('create_cash_sale_v1', { p_order_id: 'o1', p_business_id: 'b1', p_items: items });
  assert.equal(sale.data.total_amount, 85000);
  assert.equal((await c.from('products').select('*').eq('id', banh.id)).data[0].stock_qty, 17);
  const bay = (await c.from('crm_customers').select('*').eq('business_id', 'b1')).data[0];
  await rpc('set_order_customer_v1', { p_order_id: 'o1', p_customer_id: bay.id });
  await rpc('set_order_customer_v1', { p_order_id: 'o1', p_customer_id: bay.id });
  const bay2 = (await c.from('crm_customers').select('*').eq('id', bay.id)).data[0];
  assert.equal(bay2.points, 35 + 8);
  assert.equal(bay2.visits, 5);

  // Món bán chạy, theo giờ
  const r = vnDayRange(vnDay());
  const top = (await rpc('top_products', { p_business_id: 'b1', p_from: r.from, p_to: r.to })).data;
  assert.equal(top[0].name, 'Bánh mì');
  assert.equal(top[0].quantity, 3);
  const hours = (await rpc('sales_by_hour', { p_business_id: 'b1', p_from: r.from, p_to: r.to })).data;
  assert.ok(hours.reduce((s: number, h: { amount: number }) => s + h.amount, 0) >= 85000);

  // Nhập hàng ghi chi, kiểm kho
  await rpc('stock_in_v1', { p_movement_id: 'm1', p_product_id: banh.id, p_qty: 10, p_unit_cost: 8000, p_record_expense: true });
  await rpc('stock_in_v1', { p_movement_id: 'm1', p_product_id: banh.id, p_qty: 10, p_unit_cost: 8000, p_record_expense: true });
  assert.equal((await c.from('products').select('*').eq('id', banh.id)).data[0].stock_qty, 27);
  await rpc('stock_count_v1', { p_movement_id: 'm2', p_product_id: banh.id, p_actual_qty: 25 });
  assert.equal((await c.from('products').select('*').eq('id', banh.id)).data[0].stock_qty, 25);

  // Ca: 200.000 + 85.000 − 80.000 (nhập hàng ghi chi) − 35.000 (chi mẫu hôm nay, ghi trước khi mở ca → không tính)
  const cur = (await rpc('current_shift_v1', { p_business_id: 'b1' })).data[0];
  assert.equal(cur.cash_sales, 85000);
  assert.equal(cur.expected_cash, 200000 + 85000 - 80000);
  const closed = (await rpc('close_shift_v1', { p_shift_id: 's1', p_counted_cash: 200000 })).data;
  assert.equal(closed.counted_cash - closed.expected_cash, -5000);

  // Thu nợ bằng QR: tiền về → trừ sổ nợ
  const hoa = (await c.from('debt_balances').select('*').eq('business_id', 'b1')).data.find((d: { name: string }) => d.name === 'Chị Hoa');
  assert.equal((await rpc('create_debt_payment_order_v1', { p_order_id: 'q1', p_customer_id: hoa.customer_id, p_amount: 999999 })).error?.message, 'QP_PAYMENT_EXCEEDS_DEBT');
  await rpc('create_debt_payment_order_v1', { p_order_id: 'q1', p_customer_id: hoa.customer_id, p_amount: 50000 });
  await rpc('confirm_transfer_manually_v1', { p_order_id: 'q1' });
  assert.equal((await c.from('debt_balances').select('*').eq('customer_id', hoa.customer_id)).data[0].balance, 35000);

  // Hóa đơn điện tử: chưa cài → báo; cài bản thử → xuất số 1
  assert.equal((await rpc('create_invoice_from_order_v1', { p_invoice_id: 'i1', p_order_id: 'o1' })).error?.message, 'QP_EINVOICE_NOT_SETUP');
  await rpc('update_invoice_settings_v1', { p_business_id: 'b1', p_provider: 'DEMO', p_form_no: '2', p_symbol: 'c26maa' });
  await rpc('create_invoice_from_order_v1', { p_invoice_id: 'i1', p_order_id: 'o1', p_buyer_name: 'Công ty ABC' });
  const issued = await c.functions.invoke('issue-einvoice', { body: { invoice_id: 'i1' } });
  assert.equal(issued.data.invoice_no, 1);
  assert.equal(issued.data.total_amount, 85000);
  assert.match(issued.data.tax_authority_code, /^M1-\d{2}-DEMO0-0{10}1$/);

  // Nhân viên: mời số khác, người đó đăng nhập → vào quán làm thu ngân
  await rpc('invite_member_v1', { p_invite_id: 'v1', p_business_id: 'b1', p_phone: '0903 000 002', p_role: 'CASHIER' });
  await c.auth.signOut();
  await c.auth.verifyOtp({ phone: '+84903000002', token: '123456' });
  assert.equal((await rpc('accept_invites_v1')).data, 1);
  const mine = (await c.from('business_members').select('role').eq('business_id', 'b1')).data;
  assert.ok(mine.some((m: { role: string }) => m.role === 'CASHIER'));
  assert.equal((await rpc('upsert_product_v1', { p_product_id: 'x', p_business_id: 'b1', p_name: 'Trà', p_price: 1, p_unit: 'ly' })).error?.message, 'QP_FORBIDDEN');
  mock.timers.reset();
});
