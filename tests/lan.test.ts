import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addLanMember, createDemoClient, hostExecute, onAnyOrder, removeLanMember, setSampleMode } from '../src/lib/demoClient';
import { LanHost, type LanDevice } from '../src/features/lan/host';
import { LanClient, pairWithHost } from '../src/features/lan/client';
import { createLanSupabase } from '../src/features/lan/lanSupabase';
import { LineBuffer, decodePairingQr, encodePairingQr, seal, type LineConn } from '../src/features/lan/protocol';

setSampleMode(false);

/** Cặp kết nối trong bộ nhớ (thay TCP), tin đi qua hàng đợi như mạng thật */
function pipe(): [LineConn, LineConn] {
  const mk = () => ({ lines: [] as ((l: string) => void)[], closes: [] as (() => void)[], closed: false });
  const a = mk();
  const b = mk();
  const end = (me: typeof a, other: typeof a): LineConn => ({
    send: (l) => {
      if (!me.closed) setImmediate(() => other.lines.forEach((cb) => cb(l)));
    },
    onLine: (cb) => void me.lines.push(cb),
    onClose: (cb) => void me.closes.push(cb),
    close: () => {
      if (me.closed) return;
      me.closed = other.closed = true;
      me.closes.forEach((c) => c());
      other.closes.forEach((c) => c());
    },
  });
  return [end(a, b), end(b, a)];
}

test('khung tin theo dòng: gộp và cắt đôi', () => {
  const b = new LineBuffer();
  assert.deepEqual(b.push('{"a":1}\n{"b"'), ['{"a":1}']);
  assert.deepEqual(b.push(':2}\n\n'), ['{"b":2}']);
  const q = encodePairingQr({ h: '192.168.1.5', p: 47123, i: 'host1', k: 'key' });
  assert.deepEqual(decodePairingQr(q), { h: '192.168.1.5', p: 47123, i: 'host1', k: 'key', v: 1 });
  assert.equal(decodePairingQr('xin chao'), null);
});

test('máy chủ quán + máy nhân viên: ghép máy, bán, đọc sổ, nhận tin tiền về, chặn gửi lại, hết hạn Pro, thu hồi', async () => {
  // Máy chính: chủ quán tạo quán
  const local = createDemoClient();
  await local.auth.verifyOtp({ phone: '+84903000111', token: '123456' });
  await local.rpc('create_business_v1', { p_business_id: 'biz1', p_business_name: 'Quán Cô Ba', p_tax_code: '0312345678', p_address: 'HCM' });
  await local.rpc('set_local_payment_account_v1', { p_business_id: 'biz1', p_bank_bin: '970436', p_account_no: '0071000123456', p_account_name: 'CO BA' });

  let active = true;
  let saved: LanDevice[] = [];
  const host = new LanHost({
    hostId: 'HOST1',
    shop: () => ({ businessId: 'biz1', name: 'Quán Cô Ba' }),
    planActive: () => active,
    loadDevices: () => saved,
    saveDevices: (d) => (saved = d.map((x) => ({ ...x }))),
    addMember: addLanMember,
    removeMember: removeLanMember,
    execute: (userId, req) => hostExecute(userId, req as never, (n, o) => local.functions.invoke(n, o as never) as never),
  });
  const off = onAnyOrder((row) => host.broadcastOrder(row));
  const connect = async () => {
    const [h, c] = pipe();
    host.attach(h);
    return c;
  };

  // Ghép máy: mã sai / hết hạn bị từ chối, mã đúng dùng một lần
  const qrInfo = host.startPairing('CASHIER', 'Thu ngân');
  const qr = { h: '192.168.1.5', p: 47123, i: 'HOST1', k: qrInfo.key, v: 1 };
  await assert.rejects(pairWithHost(connect, { ...qr, k: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, 'dev-a', 'Lan'), /QP_PAIRING_EXPIRED/);
  const p = await pairWithHost(connect, qr, 'dev-a', 'Lan');
  assert.equal(p.role, 'CASHIER');
  assert.equal(p.shopName, 'Quán Cô Ba');
  assert.equal(p.userId, 'lan-dev-a');
  await assert.rejects(pairWithHost(connect, qr, 'dev-b', 'Hoa'), /QP_PAIRING_EXPIRED/, 'mã dùng một lần');
  assert.equal(host.list().length, 1);

  // Máy nhân viên dùng app như bình thường
  const client = new LanClient(p, connect, async () => null);
  const sb = createLanSupabase(client, () => {});
  const members = await sb.from('business_members').select('business_id, role, business:businesses(*)').eq('user_id', p.userId);
  assert.equal(members.error, null);
  assert.equal((members.data as { role: string }[])[0]!.role, 'CASHIER');

  const pushed: Record<string, unknown>[] = [];
  const ch = sb.channel('orders').on('postgres_changes', {}, (x) => pushed.push(x.new)).subscribe();

  const cash = await sb.rpc('create_cash_sale_v1', { p_order_id: 'o1', p_business_id: 'biz1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 20000 }], p_device_id: 'dev-a' });
  assert.equal(cash.error, null);
  const qrOrder = await sb.rpc('create_order_v1', { p_order_id: 'o2', p_business_id: 'biz1', p_items: [{ name: 'Bán hàng', quantity: 1, unit_price: 18000 }], p_device_id: 'dev-a' });
  assert.equal(qrOrder.error, null);
  const qrRes = await sb.functions.invoke('qr-for-order', { body: { order_id: 'o2' } });
  assert.match(String((qrRes.data as { qr_payload: string }).qr_payload), /0071000123456/);

  // Chủ quán xác nhận trên máy chính → máy nhân viên nhận tin đẩy
  await local.rpc('confirm_transfer_manually_v1', { p_order_id: 'o2' });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(pushed.some((r) => r.id === 'o2' && r.payment_status === 'PAID'), 'máy nhân viên nhận tin đơn đã trả');

  // Đơn của máy nhân viên nằm trên máy chính
  const onHost = await local.from('orders').select('*').eq('business_id', 'biz1');
  assert.equal((onHost.data as unknown[]).length, 2);

  // Thu ngân không được đổi gói / tài khoản nhận tiền
  const forbidden = await sb.rpc('set_local_payment_account_v1', { p_business_id: 'biz1', p_bank_bin: '970422', p_account_no: '999999', p_account_name: 'KE GIAN' });
  assert.equal(forbidden.error?.message, 'QP_FORBIDDEN');
  const notMethod = await hostExecute('lan-dev-a', { kind: 'select', table: 'orders', ops: [{ m: 'constructor', a: [] }] }, async () => ({ data: null, error: null }));
  assert.equal(notMethod.error?.message, 'QP_FORBIDDEN');

  // Tin cũ gửi lại (cùng số thứ tự) bị bỏ qua; tin sai khóa bị bỏ qua
  const [h2, c2] = pipe();
  host.attach(h2);
  let replies = 0;
  c2.onLine(() => replies++);
  const oldSeq = saved[0]!.seq;
  c2.send(JSON.stringify({ t: 'req', d: 'dev-a', ...seal({ id: 'x', seq: oldSeq, req: { kind: 'rpc', name: 'day_summary', args: {} } }, p.key) }));
  c2.send(JSON.stringify({ t: 'req', d: 'dev-a', ...seal({ id: 'y', seq: oldSeq + 1e12, req: { kind: 'rpc', name: 'day_summary', args: {} } }, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(replies, 0);

  // Hết hạn Pro → máy nhân viên bị chặn, dữ liệu vẫn còn trên máy chính
  active = false;
  const blocked = await sb.rpc('day_summary', { p_business_id: 'biz1' });
  assert.equal(blocked.error?.message, 'QP_PRO_REQUIRED');
  active = true;

  // Thu hồi máy
  host.revoke('dev-a');
  assert.equal(host.list().length, 0);
  const after = await createLanSupabase(new LanClient(p, connect, async () => null), () => {}).rpc('day_summary', { p_business_id: 'biz1' });
  assert.equal(after.error?.message, 'QP_PAIRING_EXPIRED', 'máy đã thu hồi không gửi lệnh được');
  const m2 = await local.from('business_members').select('*').eq('user_id', 'lan-dev-a');
  assert.equal((m2.data as unknown[]).length, 0);

  await sb.removeChannel(ch as never);
  client.close();
  off();
});
