import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cashSuggestions, digitsToAmount, formatPhoneVN, formatVND, pressKey, readNumber, readVND, toE164VN } from '../src/lib/money';
import { addDays, formatDayLong, formatElapsed, formatTimeVN, vnDay, vnDayRange } from '../src/lib/time';
import { layoutFor } from '../src/theme/layout';
import { AppError, toAppError } from '../src/lib/errors';
import { callWithRetry } from '../src/lib/retry';
import { announcement, paymentView } from '../src/features/sale/paymentState';
import { flushQueue, memoryQueueStore, newQueuedSale } from '../src/features/offline/queue';
import { combineDay, nextCursor } from '../src/features/journal/summary';
import { checkPin, initialGuard, isPinTooEasy, makePinRecord } from '../src/features/settings/pinLogic';
import type { Order } from '../src/types/api';

test('định dạng VND', () => {
  assert.equal(formatVND(18000), '18.000 đ');
  assert.equal(formatVND(0), '0 đ');
  assert.equal(formatVND(2450000), '2.450.000 đ');
  assert.equal(formatVND(100), '100 đ');
});

test('đọc số tiếng Việt', () => {
  const cases: [number, string][] = [
    [0, 'không'],
    [5, 'năm'],
    [10, 'mười'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [25, 'hai mươi lăm'],
    [105, 'một trăm linh năm'],
    [110, 'một trăm mười'],
    [18000, 'mười tám nghìn'],
    [25000, 'hai mươi lăm nghìn'],
    [105000, 'một trăm linh năm nghìn'],
    [1000000, 'một triệu'],
    [1500000, 'một triệu năm trăm nghìn'],
    [2050000, 'hai triệu không trăm năm mươi nghìn'],
    [1000005, 'một triệu không trăm linh năm'],
    [2450000, 'hai triệu bốn trăm năm mươi nghìn'],
    [1_000_000_000, 'một tỷ'],
    [100_000_000_000, 'một trăm tỷ'],
    [1_000_000_000_000, 'một nghìn tỷ'],
  ];
  for (const [n, w] of cases) assert.equal(readNumber(n), w, String(n));
  assert.equal(readVND(18000), 'mười tám nghìn đồng');
  assert.throws(() => readNumber(-1));
  assert.throws(() => readNumber(1.5));
});

test('bàn phím số', () => {
  let d = '';
  for (const k of ['1', '8', '000'] as const) d = pressKey(d, k);
  assert.equal(d, '18000');
  assert.equal(digitsToAmount(d), 18000);
  assert.equal(pressKey('', '0'), '');
  assert.equal(pressKey('', '000'), '');
  assert.equal(pressKey('18000', 'del'), '1800');
  assert.equal(pressKey('18000', 'clear'), '');
  assert.equal(pressKey('999999999', '000'), '999999999', 'quá 10 số thì bỏ qua, không cắt');
  assert.equal(pressKey('999999999', '9'), '9999999999');
  assert.equal(digitsToAmount(''), 0);
});

test('gợi ý tiền khách đưa', () => {
  assert.deepEqual(cashSuggestions(18000), [18000, 20000, 50000, 100000, 200000, 500000]);
  assert.deepEqual(cashSuggestions(0), []);
  const big = cashSuggestions(450000);
  assert.equal(big[0], 450000);
  assert.ok(big.includes(500000));
  assert.ok(big.every((x) => x >= 450000));
});

test('số điện thoại', () => {
  assert.equal(toE164VN('0903 456 789'), '+84903456789');
  assert.equal(toE164VN('+84903456789'), '+84903456789');
  assert.equal(toE164VN('84903456789'), '+84903456789');
  assert.equal(toE164VN('0203456789'), null);
  assert.equal(toE164VN('090345678'), null);
  assert.equal(formatPhoneVN('+84903456789'), '0903 456 789');
});

test('ngày giờ VN không phụ thuộc múi giờ máy', () => {
  // 17:30 UTC ngày 28 = 00:30 ngày 29 ở VN
  assert.equal(vnDay(new Date('2026-10-28T17:30:00Z')), '2026-10-29');
  assert.equal(vnDay(new Date('2026-10-28T16:59:59Z')), '2026-10-28');
  assert.deepEqual(vnDayRange('2026-10-29'), { from: '2026-10-28T17:00:00.000Z', to: '2026-10-29T17:00:00.000Z' });
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(formatDayLong('2026-10-29'), 'Thứ Năm, 29/10/2026');
  assert.equal(formatTimeVN('2026-10-29T03:42:00Z'), '10:42');
  assert.equal(formatElapsed(25), '0:25');
  assert.equal(formatElapsed(100), '1:40');
});

test('bố cục theo kích thước cửa sổ', () => {
  assert.equal(layoutFor(390, 844).kind, 'single');
  assert.equal(layoutFor(360, 640).kind, 'compact');
  assert.equal(layoutFor(344, 880).kind, 'single');
  assert.equal(layoutFor(700, 840).kind, 'split');
  assert.equal(layoutFor(1280, 800).kind, 'split');
  assert.equal(layoutFor(390, 780, 2).kind, 'compact', 'chữ 200% trên máy thấp dùng bố cục gọn');
  for (const [w, h] of [[360, 640], [344, 880], [700, 840], [1280, 800], [390, 844]] as const) {
    const m = layoutFor(w, h);
    assert.ok(m.qrSize <= m.columnWidth, `QR ${m.qrSize} vừa cột ${m.columnWidth} ở ${w}×${h}`);
    assert.ok(m.keyHeight >= 56);
  }
  assert.equal(layoutFor(390, 844).lockPortrait, true);
  assert.equal(layoutFor(700, 840).lockPortrait, false);
});

test('chuẩn hóa lỗi', () => {
  assert.equal(toAppError({ message: 'QP_ORDER_NOT_CANCELLABLE', code: 'P0001' }).code, 'QP_ORDER_NOT_CANCELLABLE');
  assert.equal(toAppError({ message: 'QP_ORDER_NOT_CANCELLABLE' }).action, 'open_review');
  assert.equal(toAppError({ message: 'QP_SOMETHING_NEW' }).code, 'UNKNOWN');
  assert.equal(toAppError({ message: 'JWT expired', code: 'PGRST301' }).code, 'QP_UNAUTHENTICATED');
  assert.equal(toAppError(new TypeError('Network request failed')).code, 'NETWORK');
  assert.equal(toAppError({ name: 'AbortError', message: 'aborted' }).code, 'NETWORK');
  assert.equal(toAppError('lạ').code, 'UNKNOWN');
  assert.equal(toAppError({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }).code, 'NETWORK');
  assert.equal(toAppError({ message: 'QP_NO_PAYMENT_ACCOUNT' }).code, 'QP_NO_PAYMENT_ACCOUNT');
  const e = toAppError({ message: 'QP_FORBIDDEN' });
  assert.ok(!/QP_/.test(e.message), 'câu cho người dùng không lộ mã');
});

test('thử lại: chỉ lỗi mạng, cùng tham số, đúng nhịp', async () => {
  const waits: number[] = [];
  let calls = 0;
  const r = await callWithRetry(
    async () => {
      calls++;
      if (calls < 3) throw new TypeError('Network request failed');
      return 'ok';
    },
    { sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(r, 'ok');
  assert.deepEqual(waits, [1000, 3000]);

  calls = 0;
  await assert.rejects(
    callWithRetry(async () => {
      calls++;
      throw { message: 'QP_INVALID_ITEMS' };
    }, { sleep: async () => {} }),
    (e: AppError) => e.code === 'QP_INVALID_ITEMS',
  );
  assert.equal(calls, 1, 'lỗi nghiệp vụ không thử lại');

  calls = 0;
  await assert.rejects(
    callWithRetry(async () => {
      calls++;
      throw new TypeError('Network request failed');
    }, { sleep: async () => {} }),
    (e: AppError) => e.code === 'NETWORK',
  );
  assert.equal(calls, 4, '1 lần + 3 lần thử lại');

  await assert.rejects(
    callWithRetry(() => new Promise(() => {}), { timeoutMs: 20, delaysMs: [], sleep: async () => {} }),
    (e: AppError) => e.code === 'NETWORK',
  );
});

const baseOrder: Order = {
  id: 'o1', business_id: 'b1', order_code: 'K7MP3QXA', total_amount: 18000, amount_received: 0, overpaid_amount: 0,
  payment_method: 'VIETQR', payment_status: 'UNPAID', paid_at: null, manual_confirmed_by: null,
  manual_confirmed_at: null, manual_note: null, sold_at: '2026-10-29T03:00:00Z', client_sold_at: null,
  clock_suspect: false, created_device_id: 'dev-1', created_by: null, created_at: '', updated_at: '',
};

test('trạng thái thanh toán và câu đọc to', () => {
  assert.equal(paymentView(baseOrder).kind, 'WAITING');
  const partial = { ...baseOrder, amount_received: 10000 };
  assert.deepEqual(paymentView(partial), { kind: 'PARTIAL', total: 18000, received: 10000, missing: 8000 });
  const paid = { ...baseOrder, amount_received: 18000, payment_status: 'PAID' as const };
  assert.equal(paymentView(paid).kind, 'PAID');
  const over = { ...baseOrder, amount_received: 20000, payment_status: 'PAID' as const };
  assert.deepEqual(paymentView(over), { kind: 'OVERPAID', total: 18000, received: 20000, over: 2000 });
  const manual = { ...baseOrder, payment_status: 'PAID' as const, manual_confirmed_at: 'x' };
  assert.deepEqual(paymentView(manual), { kind: 'PAID', total: 18000, received: 0, manual: true });

  assert.equal(announcement(baseOrder, paid, 'dev-1', true), 'Đã nhận mười tám nghìn');
  assert.equal(announcement(baseOrder, paid, 'dev-2', true), null, 'máy khác im lặng');
  assert.equal(announcement(baseOrder, paid, 'dev-1', false), null, 'tắt đọc to');
  assert.equal(announcement(null, paid, 'dev-1', true), null, 'mở lại màn hình đơn cũ không đọc');
  assert.equal(announcement(paid, paid, 'dev-1', true), null, 'không đổi thì không đọc');
  assert.equal(announcement(baseOrder, partial, 'dev-1', true), 'Mới nhận mười nghìn, còn thiếu tám nghìn');
  assert.equal(announcement(baseOrder, over, 'dev-1', true), 'Đã nhận hai mươi nghìn');
  assert.equal(announcement(baseOrder, manual, 'dev-1', true), null, 'người bấm tay không cần nghe đọc');
});

test('hàng đợi tiền mặt khi mất mạng', async () => {
  const mk = (id: string, t: string) =>
    newQueuedSale({ orderId: id, businessId: 'b1', items: [{ name: 'Bán hàng', quantity: 1, unit_price: 25000 }], soldAt: t, deviceId: 'd' });
  const store = memoryQueueStore();
  await store.add(mk('a', '2026-10-29T03:00:00Z'));
  await store.add(mk('b', '2026-10-29T03:05:00Z'));
  await store.add(mk('c', '2026-10-29T03:10:00Z'));
  await store.add(mk('a', '2026-10-29T03:00:00Z'));
  assert.equal(store.items.length, 3, 'thêm trùng mã không nhân đôi');
  assert.equal(store.items[0]!.total, 25000);

  const sentIds: string[] = [];
  let net = true;
  const send = async (s: { orderId: string }) => {
    if (!net) throw new TypeError('Network request failed');
    if (s.orderId === 'b') throw { message: 'QP_INVALID_ITEMS' };
    sentIds.push(s.orderId);
  };
  net = false;
  let r = await flushQueue(store, send);
  assert.equal(r.stoppedBy, 'network');
  assert.equal(store.items.length, 3, 'mất mạng: không mất đơn');
  assert.equal(store.items.find((s) => s.orderId === 'a')!.attempts, 1);

  net = true;
  r = await flushQueue(store, send);
  assert.deepEqual(sentIds, ['a', 'c'], 'gửi theo thứ tự, bỏ qua đơn lỗi dữ liệu');
  assert.equal(r.stuck, 1);
  assert.deepEqual(store.items.map((s) => [s.orderId, s.status]), [['b', 'STUCK']], 'đơn lỗi vẫn giữ trên máy');

  r = await flushQueue(store, send);
  assert.equal(r.sent, 0, 'đơn STUCK không tự gửi lại');

  const s2 = memoryQueueStore([mk('x', '2026-10-29T03:00:00Z')]);
  r = await flushQueue(s2, async () => { throw { message: 'QP_UNAUTHENTICATED' }; });
  assert.equal(r.stoppedBy, 'relogin');
  assert.equal(s2.items[0]!.status, 'PENDING');
});

test('sổ ngày = server + hàng đợi', () => {
  const q = newQueuedSale({ orderId: 'q', businessId: 'b', items: [{ name: 'x', quantity: 2, unit_price: 10000 }], soldAt: '2026-10-29T05:00:00Z', deviceId: 'd' });
  const other = { ...q, orderId: 'q2', soldAt: '2026-10-27T05:00:00Z' };
  const t = combineDay('2026-10-29', [{ method: 'VIETQR', orders_count: 31, amount: 1980000 }, { method: 'CASH', orders_count: 7, amount: 470000 }], [q, other]);
  assert.equal(t.total, 2470000);
  assert.equal(t.count, 39);
  assert.equal(t.byMethod.CASH.amount, 490000);
  assert.equal(t.queuedCount, 1);
  assert.equal(nextCursor([{ sold_at: 'a', id: '1' }, { sold_at: 'b', id: '2' }], 2)?.id, '2');
  assert.equal(nextCursor([{ sold_at: 'a', id: '1' }], 2), undefined);
});

test('mã PIN', async () => {
  const hash = async (s: string) => `h(${s})`;
  assert.ok(isPinTooEasy('1111'));
  assert.ok(isPinTooEasy('1234'));
  assert.ok(isPinTooEasy('9876'));
  assert.ok(isPinTooEasy('12a4'));
  assert.ok(!isPinTooEasy('2580'));
  const rec = await makePinRecord('2580', 'salt', hash);
  let g = initialGuard;
  let now = 1_000_000;
  assert.equal((await checkPin('2580', rec, g, hash, now)).ok, true);
  for (let i = 1; i <= 4; i++) {
    const r = await checkPin('0000', rec, g, hash, now);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, 'wrong');
    if (!r.ok && r.reason === 'wrong') assert.equal(r.triesLeft, 5 - i);
    g = r.guard;
  }
  const locked = await checkPin('0000', rec, g, hash, now);
  assert.equal(!locked.ok && locked.reason, 'locked');
  g = locked.guard;
  const stillLocked = await checkPin('2580', rec, g, hash, now + 10_000);
  assert.equal(stillLocked.ok, false, 'đang khóa thì mã đúng cũng chờ');
  now += 31_000;
  const after = await checkPin('2580', rec, g, hash, now);
  assert.equal(after.ok, true);
  assert.deepEqual(after.guard, initialGuard);
});
