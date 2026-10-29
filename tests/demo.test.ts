import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoClient } from '../src/lib/demoClient';
import { vnDay, vnDayRange } from '../src/lib/time';

test('chế độ dùng thử: đăng nhập → tạo quán → bán → khách chuyển tiền', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = createDemoClient();
  const tick = async (ms: number) => {
    mock.timers.tick(ms);
    await new Promise((r) => setImmediate(r));
  };
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    await tick(300);
    return p;
  };

  assert.equal((await c.auth.getSession()).data.session, null);
  assert.equal((await rpc('create_business_v1', { p_business_id: 'b1' })).error?.message, 'QP_UNAUTHENTICATED');
  const v = await c.auth.verifyOtp({ phone: '+84903456789', token: '123456' });
  assert.ok(v.data.user);

  const biz = await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: ' Quán thử ', p_tax_code: '0312345678', p_address: 'HCM' });
  assert.equal(biz.data.business_name, 'Quán thử');
  const members = await c.from('business_members').select('role, business:businesses(id)').eq('user_id', v.data.user!.id);
  assert.equal(members.data[0].role, 'OWNER');
  assert.equal(members.data[0].business.id, 'b1');

  const today = vnDay();
  const sum = await rpc('day_summary', { p_business_id: 'b1', p_day: today });
  const total0 = sum.data.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
  assert.equal(total0, 130000, 'dữ liệu mẫu: 5 đơn hôm nay');

  // Đơn VietQR: 8 giây sau khách "chuyển tiền", kênh realtime nhận được
  const events: { payment_status: string }[] = [];
  c.channel('business:b1').on('postgres_changes', {}, (p) => events.push(p.new as { payment_status: string })).subscribe();
  const order = await rpc('create_order_v1', { p_order_id: 'o1', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }], p_device_id: 'd1' });
  assert.equal(order.data.payment_status, 'UNPAID');
  const again = await rpc('create_order_v1', { p_order_id: 'o1', p_business_id: 'b1', p_items: [{ name: 'x', quantity: 1, unit_price: 1 }] });
  assert.equal(again.data.total_amount, 18000, 'gửi lại cùng mã không tạo đơn mới');
  const qr = await c.functions.invoke('qr-for-order', { body: { order_id: 'o1' } });
  assert.match((qr.data as { qr_payload: string }).qr_payload, /^000201/);
  await tick(12000);
  assert.equal(events.at(-1)?.payment_status, 'PAID');
  assert.equal((await rpc('cancel_order_v1', { p_order_id: 'o1' })).error?.message, 'QP_ORDER_NOT_CANCELLABLE');

  // Tiền mặt, sổ, danh sách phân trang
  await rpc('create_cash_sale_v1', { p_order_id: 'o2', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 20000 }] });
  const sum2 = await rpc('day_summary', { p_business_id: 'b1', p_day: today });
  assert.equal(sum2.data.reduce((s: number, r: { amount: number }) => s + r.amount, 0), 168000);
  const { from, to } = vnDayRange(today);
  const page1 = await rpc('list_orders', { p_business_id: 'b1', p_from: from, p_to: to, p_limit: 3 });
  const last = page1.data[2];
  const page2 = await rpc('list_orders', { p_business_id: 'b1', p_from: from, p_to: to, p_after_sold_at: last.sold_at, p_after_id: last.id, p_limit: 3 });
  assert.equal(page1.data.length + page2.data.length, 6, 'hai trang đầy');
  const unpaidSeed = await c.from('orders').select('*').eq('business_id', 'b1').eq('payment_status', 'UNPAID').eq('total_amount', 18000);
  assert.equal(unpaidSeed.data.length, 1, 'có sẵn một đơn chưa trả để thử gán tiền');
  assert.ok(!page2.data.some((o: { id: string }) => page1.data.some((p: { id: string }) => p.id === o.id)), 'trang sau không lặp');

  // Gán khoản tiền chưa rõ đơn
  const ev = await c.from('payment_events').select('*, order:orders(order_code)').eq('business_id', 'b1').in('match_status', ['UNMATCHED']);
  assert.equal(ev.data.length, 1);
  await rpc('create_order_v1', { p_order_id: 'o3', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }] });
  assert.equal((await rpc('assign_payment_event_v1', { p_event_id: ev.data[0].id, p_order_id: 'o3' })).data, 'MATCHED');
  assert.equal((await rpc('assign_payment_event_v1', { p_event_id: ev.data[0].id, p_order_id: 'o3' })).error?.message, 'QP_ALREADY_ASSIGNED');
  mock.timers.reset();
});

test('dữ liệu mẫu không lùi qua nửa đêm (mở app lúc 00:05 giờ VN)', async () => {
  // 00:05 ngày 30/10 giờ VN = 17:05 UTC ngày 29/10
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-29T17:05:00Z') });
  const c = createDemoClient();
  const settle = async () => {
    mock.timers.tick(300);
    await new Promise((r) => setImmediate(r));
  };
  await c.auth.verifyOtp({ phone: '+84903456789', token: '123456' });
  const p = c.rpc('create_business_v1', { p_business_id: 'night', p_business_name: 'Quán đêm', p_tax_code: '0312345679', p_address: 'HCM' }).then((x) => x);
  await settle();
  await p;
  const q = c.rpc('day_summary', { p_business_id: 'night', p_day: '2026-10-30' }).then((x) => x);
  await settle();
  const sum = await q;
  assert.equal(sum.data.reduce((s: number, r: { amount: number }) => s + r.amount, 0), 130000);
  mock.timers.reset();
});
