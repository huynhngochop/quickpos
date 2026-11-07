import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveCutoffDay, archiveOldOrders, attachRowStore, createDemoClient, exportBackup, persistNow, restoreBackup,
  setSampleMode, type ArchiveRow, type RowStoreAdapter,
} from '../src/lib/demoClient';

/** Kho SQLite giả trong bộ nhớ, có bảng lưu trữ */
function memStore() {
  const rows = new Map<string, { t: string; k: string; n: number; j: string }>();
  const arc = new Map<string, ArchiveRow>();
  let meta: string | null = null;
  const rs: RowStoreAdapter = {
    loadRows: () => [...rows.values()].sort((a, b) => (a.t === b.t ? a.n - b.n : a.t < b.t ? -1 : 1)),
    loadMeta: () => meta,
    apply({ replace, upsert, meta: m, archive }) {
      for (const r of archive ?? []) {
        arc.set(`${r.t}\u0000${r.k}`, r);
        rows.delete(`${r.t}\u0000${r.k}`);
      }
      for (const tb of replace) {
        for (const key of [...rows.keys()]) if (key.startsWith(`${tb.t}\u0000`)) rows.delete(key);
        for (const r of tb.rows) rows.set(`${tb.t}\u0000${r.k}`, { t: tb.t, ...r });
      }
      for (const r of upsert) rows.set(`${r.t}\u0000${r.k}`, r);
      meta = m;
    },
    legacyLoad: () => null,
    legacyClear: () => undefined,
    archiveFind: (t, col, v) => [...arc.values()].filter((r) => r.t === t && r[col] === v).map((r) => r.j),
    archiveAll: () => [...arc.values()].map((r) => ({ t: r.t, j: r.j })),
    archiveClear: () => arc.clear(),
  };
  return { rs, rows, arc };
}

test('mốc lưu trữ: giữ đủ 13 tháng tính cả tháng này', () => {
  assert.equal(archiveCutoffDay(Date.parse('2026-11-07T05:00:00Z')), '2025-11-01');
  assert.equal(archiveCutoffDay(Date.parse('2026-01-15T05:00:00Z')), '2025-01-01');
  assert.equal(archiveCutoffDay(Date.parse('2026-12-31T20:00:00Z')), '2026-01-01'); // 01/01/2027 giờ VN
});

test('đơn cũ hơn 13 tháng chuyển vào kho lưu trữ: bộ nhớ nhẹ, vẫn xem lại được, báo cáo đủ số, sao lưu đủ', async () => {
  setSampleMode(false);
  mock.timers.enable({ apis: ['setTimeout'] });
  const tick = async (ms: number) => {
    mock.timers.tick(ms);
    await new Promise((r) => setImmediate(r));
  };
  const m = memStore();
  attachRowStore(m.rs);
  const c = createDemoClient();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const p = c.rpc(name, args).then((x) => x);
    await tick(260);
    return p;
  };
  await c.auth.verifyOtp({ phone: '+84903444555', token: '123456' });
  await rpc('create_business_v1', { p_business_id: 'ba', p_business_name: 'Quán A', p_tax_code: '0312345678', p_address: 'HCM' });
  const sale = (id: string, soldAt: string, price: number) =>
    rpc('create_cash_sale_v1', { p_order_id: id, p_business_id: 'ba', p_sold_at: soldAt, p_items: [{ name: 'Cà phê', quantity: 2, unit_price: price }] });
  for (let i = 0; i < 5; i++) await sale(`old${i}`, '2024-06-15T03:00:00Z', 10000);
  await sale('mid', '2025-11-02T03:00:00Z', 7000);
  await sale('new', '2026-11-06T03:00:00Z', 5000);
  await tick(400);

  const daySum = async (day: string) =>
    ((await c.from('daily_sales').select('*').eq('business_id', 'ba').eq('sale_date', day)).data as { amount: number; orders_count: number }[])
      .reduce((t, r) => ({ amount: t.amount + r.amount, n: t.n + r.orders_count }), { amount: 0, n: 0 });
  assert.deepEqual(await daySum('2024-06-15'), { amount: 100000, n: 5 });

  const moved = archiveOldOrders(Date.parse('2026-11-07T05:00:00Z'));
  assert.equal(moved, 5);
  // Bộ nhớ chỉ còn đơn trong 13 tháng
  const inMem = (await c.from('orders').select('*').eq('business_id', 'ba')).data as { id: string }[];
  assert.deepEqual(inMem.map((o) => o.id).sort(), ['mid', 'new']);
  assert.equal([...m.rows.keys()].filter((k) => k.startsWith('orders\u0000')).length, 2, 'đã xóa khỏi bảng đang dùng');
  assert.equal([...m.arc.values()].filter((r) => r.t === 'orders').length, 5);
  assert.equal([...m.arc.values()].filter((r) => r.t === 'order_items').length, 5);

  // Báo cáo ngày cũ vẫn đủ số
  assert.deepEqual(await daySum('2024-06-15'), { amount: 100000, n: 5 });
  // Chi tiết đơn cũ + dòng đơn
  const one = await c.from('orders').select('*').eq('id', 'old3').single();
  assert.equal((one.data as { total_amount: number }).total_amount, 20000);
  const items = (await c.from('order_items').select('*').eq('order_id', 'old3')).data as unknown[];
  assert.equal(items.length, 1);
  // Danh sách đơn của ngày cũ
  const list = (await rpc('list_orders', { p_business_id: 'ba', p_from: '2024-06-01T00:00:00Z', p_to: '2024-07-01T00:00:00Z', p_limit: 3 })).data as { id: string }[];
  assert.equal(list.length, 3);
  const all = (await rpc('list_orders', { p_business_id: 'ba', p_from: '2024-01-01T00:00:00Z', p_to: '2027-01-01T00:00:00Z', p_limit: 50 })).data as { id: string }[];
  assert.equal(all.length, 7);
  assert.equal(all[0]!.id, 'new');

  // Bán tiếp sau khi lưu trữ: dòng mới đứng sau, mở lại app vẫn đúng
  await sale('after', '2026-11-07T04:00:00Z', 3000);
  await tick(400);
  persistNow(true);
  attachRowStore(m.rs);
  const again = (await c.from('orders').select('*').eq('business_id', 'ba')).data as { id: string }[];
  assert.deepEqual(again.map((o) => o.id).sort(), ['after', 'mid', 'new']);
  assert.deepEqual(await daySum('2024-06-15'), { amount: 100000, n: 5 });
  assert.equal(((await c.from('orders').select('*').eq('id', 'old0').maybeSingle()).data as { id: string } | null)?.id, 'old0');

  // Sao lưu có cả đơn đã lưu trữ; khôi phục không cộng trùng tổng
  const bk = exportBackup('ba');
  assert.equal(bk.orders, 8);
  restoreBackup(JSON.parse(JSON.stringify(bk)));
  // Khôi phục xong thì lần ghi đầu tiên chuyển lại đơn cũ vào kho lưu trữ (theo đồng hồ máy)
  archiveOldOrders(Date.parse('2026-11-07T05:00:00Z'));
  assert.equal([...m.arc.values()].filter((r) => r.t === 'orders').length, 5);
  const after = (await rpc('list_orders', { p_business_id: 'ba', p_from: '2024-01-01T00:00:00Z', p_to: '2027-01-01T00:00:00Z', p_limit: 50 })).data as unknown[];
  assert.equal(after.length, 8);
  assert.deepEqual(await daySum('2024-06-15'), { amount: 100000, n: 5 }, 'không cộng trùng tổng');
  // Chạy lại cùng ngày: không còn gì để chuyển
  assert.equal(archiveOldOrders(Date.parse('2026-11-07T06:00:00Z')), 0);
  mock.timers.reset();
  setSampleMode(true);
});
