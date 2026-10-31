import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, monthStart, vnDay, vnDayRange } from '../src/lib/time';

// Bản thử với 1 triệu đơn cũ: phải đặt biến môi trường trước khi nạp module
process.env.EXPO_PUBLIC_DEMO_BULK_ORDERS = '1000000';

test('dùng thử 1 triệu đơn: tổng đúng, phân trang keyset đủ và không trùng, hôm nay/hôm qua không đổi', async () => {
  const { createDemoClient, BULK_ORDERS } = await import('../src/lib/demoClient');
  assert.equal(BULK_ORDERS, 1_000_000);
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = createDemoClient();
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const p = c.rpc(name, args).then((x) => x);
    mock.timers.tick(300);
    await new Promise((r) => setImmediate(r));
    return p;
  };
  await c.auth.verifyOtp({ phone: '+84903456789', token: '123456' });
  await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: 'Quán lớn', p_tax_code: '0312345678', p_address: 'HCM' });

  const today = vnDay();
  const sumOf = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
  const countOf = (rows: { orders_count: number }[]) => rows.reduce((s, r) => s + r.orders_count, 0);
  assert.equal(sumOf((await rpc('day_summary', { p_business_id: 'b1', p_day: today })).data), 130000, 'hôm nay giữ dữ liệu mẫu');
  assert.equal((await rpc('day_summary', { p_business_id: 'b1', p_day: addDays(today, -1) })).data.length, 0, 'hôm qua trống');

  // Cả năm qua daily_sales: số đơn đã trả ≈ 98,5% của 1 triệu
  const t0 = Date.now();
  const year = await c.from('daily_sales').select('*').eq('business_id', 'b1').gte('sale_date', addDays(today, -400)).lte('sale_date', today);
  const yearMs = Date.now() - t0;
  const paidCount = countOf(year.data) - 5; // trừ 5 đơn mẫu đã trả hôm nay
  assert.ok(paidCount > 980_000 && paidCount < 990_000, `số đơn đã trả cả năm: ${paidCount}`);
  assert.ok(yearMs < 20_000, `tính tổng cả năm lần đầu: ${yearMs} ms`);

  // Tổng một ngày cũ khớp với từng đơn của ngày đó (qua phân trang 100 đơn/trang)
  const day = addDays(today, -10);
  const r = vnDayRange(day);
  const summary = (await rpc('day_summary', { p_business_id: 'b1', p_day: day })).data;
  let after: { s?: string; i?: string } = {};
  const seen = new Set<string>();
  let paidSum = 0;
  let pages = 0;
  for (;;) {
    const page = (await rpc('list_orders', { p_business_id: 'b1', p_from: r.from, p_to: r.to, p_limit: 100, p_after_sold_at: after.s, p_after_id: after.i })).data;
    if (page.length === 0) break;
    pages++;
    for (const o of page) {
      assert.ok(!seen.has(o.id), 'không trùng đơn giữa các trang');
      seen.add(o.id);
      assert.ok(o.sold_at >= r.from && o.sold_at < r.to);
      if (o.payment_status === 'PAID') paidSum += o.total_amount;
    }
    for (let i = 1; i < page.length; i++) assert.ok(page[i - 1].sold_at >= page[i].sold_at, 'mới nhất trước');
    after = { s: page[page.length - 1].sold_at, i: page[page.length - 1].id };
  }
  assert.ok(seen.size === 2739 || seen.size === 2740, `số đơn một ngày: ${seen.size}`);
  assert.equal(paidSum, sumOf(summary), 'tổng ngày = cộng từng đơn');
  assert.ok(pages >= 28);

  // Sổ cả tháng (màn hình "Cả tháng này") và trang đầu của khoảng cả năm
  const month = await c.from('daily_sales').select('*').eq('business_id', 'b1').gte('sale_date', monthStart(today)).lte('sale_date', today);
  assert.ok(sumOf(month.data) > 0);
  const firstPage = (await rpc('list_orders', { p_business_id: 'b1', p_from: vnDayRange(addDays(today, -400)).from, p_to: vnDayRange(today).to })).data;
  assert.equal(firstPage.length, 20);
  const todayFrom = vnDayRange(today).from;
  const twoDaysAgo = vnDayRange(addDays(today, -2));
  assert.ok(firstPage.slice(0, 6).every((o: { sold_at: string }) => o.sold_at >= todayFrom), '6 đơn hôm nay đứng đầu');
  assert.ok(firstPage.slice(6).every((o: { sold_at: string }) => o.sold_at >= twoDaysAgo.from && o.sold_at < twoDaysAgo.to), 'sau đó là hôm kia');
  mock.timers.reset();
});
