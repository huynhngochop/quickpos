import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { attachRowStore, createDemoClient, persistNow, setSampleMode, type RowStoreAdapter } from '../src/lib/demoClient';

/** Kho SQLite giả trong bộ nhớ, đếm số dòng mỗi lần ghi */
function memStore(legacy: string | null = null) {
  const rows = new Map<string, { t: string; k: string; n: number; j: string }>();
  let meta: string | null = null;
  let leg = legacy;
  const writes: number[] = [];
  const rs: RowStoreAdapter = {
    loadRows: () => [...rows.values()].sort((a, b) => (a.t === b.t ? a.n - b.n : a.t < b.t ? -1 : 1)),
    loadMeta: () => meta,
    apply({ replace, upsert, meta: m }) {
      let n = 0;
      for (const tb of replace) {
        for (const key of [...rows.keys()]) if (key.startsWith(`${tb.t}\u0000`)) rows.delete(key);
        for (const r of tb.rows) rows.set(`${tb.t}\u0000${r.k}`, { t: tb.t, ...r });
        n += tb.rows.length;
      }
      for (const r of upsert) rows.set(`${r.t}\u0000${r.k}`, r);
      n += upsert.length;
      meta = m;
      writes.push(n);
    },
    legacyLoad: () => leg,
    legacyClear: () => void (leg = null),
  };
  return { rs, rows, writes, legacy: () => leg };
}

test('lưu từng dòng: mỗi lần bán chỉ ghi vài dòng, mở lại app thấy đủ, chuyển từ bản lưu cũ', async () => {
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
  await c.auth.verifyOtp({ phone: '+84903222333', token: '123456' });
  await rpc('create_business_v1', { p_business_id: 'b1', p_business_name: 'Quán', p_tax_code: '0312345678', p_address: 'HCM' });
  await tick(400);
  for (let i = 0; i < 300; i++) {
    await rpc('create_cash_sale_v1', { p_order_id: `o${i}`, p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 10000 }] });
  }
  await tick(400);
  m.writes.length = 0;

  // Một đơn mới: ghi đúng đơn + dòng đơn (không ghi lại 300 đơn cũ)
  await rpc('create_cash_sale_v1', { p_order_id: 'o-new', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 2, unit_price: 5000 }] });
  await tick(400);
  assert.equal(m.writes.length, 1);
  assert.ok(m.writes[0]! <= 3, `chỉ ghi vài dòng, thực tế ${m.writes[0]}`);

  // Sửa một đơn cũ (hủy): chỉ ghi đơn đó
  await rpc('create_order_v1', { p_order_id: 'q1', p_business_id: 'b1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }] });
  await tick(400);
  m.writes.length = 0;
  await rpc('cancel_order_v1', { p_order_id: 'q1' });
  await tick(400);
  assert.deepEqual(m.writes, [1]);

  // Mở lại app: nạp từ kho → đủ đơn, đúng người đăng nhập
  persistNow(true);
  attachRowStore(m.rs);
  const orders = (await c.from('orders').select('*').eq('business_id', 'b1')).data as { id: string; payment_status: string }[];
  assert.equal(orders.length, 302);
  assert.equal(orders.find((o) => o.id === 'q1')?.payment_status, 'CANCELLED');
  assert.equal((await c.auth.getSession()).data.session?.user.id, 'demo-user-84903222333');

  // Bản lưu cả khối cũ (apk-23/24) → chuyển sang lưu từng dòng một lần, rồi xóa bản cũ
  const legacy = JSON.stringify({
    v: 1,
    user: { id: 'demo-user-1', phone: '+841' },
    db: { businesses: [{ id: 'old', business_name: 'Quán cũ', owner_id: 'demo-user-1' }], orders: [{ id: 'x1', business_id: 'old', payment_status: 'PAID', total_amount: 1, sold_at: '2026-11-01T00:00:00Z' }] },
  });
  const m2 = memStore(legacy);
  attachRowStore(m2.rs);
  assert.equal(m2.legacy(), null, 'đã xóa bản lưu cũ');
  assert.ok([...m2.rows.keys()].some((k) => k.endsWith('x1')));
  assert.equal(((await c.from('orders').select('*').eq('business_id', 'old')).data as unknown[]).length, 1);
  mock.timers.reset();
  setSampleMode(true);
});
