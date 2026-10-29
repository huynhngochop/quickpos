import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVietQr, crc16ccitt, toTransferContent } from '../supabase/functions/_shared/vietqr.ts';
import { bankBinFromName, bankDisplayName } from '../supabase/functions/_shared/banks.ts';
import { parseSepay, signSepayForTest, verifySepayApiKey, verifySepayHmac, SEPAY_ACK } from '../supabase/functions/_shared/sepay.ts';
import { decidePush } from '../supabase/functions/_shared/push.ts';

/** Đọc lại chuỗi EMVCo thành cây để kiểm tra từng trường */
function parseTlv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

test('CRC16-CCITT đúng giá trị kiểm chuẩn', () => {
  assert.equal(crc16ccitt('123456789'), '29B1');
});

test('VietQR: cấu trúc EMVCo, số tiền, nội dung, CRC', () => {
  const qr = buildVietQr({ bankBin: '970422', accountNo: '0903456789', amount: 18000, content: 'K7MP3QXA' });
  const top = parseTlv(qr);
  assert.equal(top['00'], '01');
  assert.equal(top['01'], '12');
  assert.equal(top['53'], '704');
  assert.equal(top['54'], '18000');
  assert.equal(top['58'], 'VN');
  const m = parseTlv(top['38']!);
  assert.equal(m['00'], 'A000000727');
  assert.equal(m['02'], 'QRIBFTTA');
  assert.deepEqual(parseTlv(m['01']!), { '00': '970422', '01': '0903456789' });
  assert.equal(parseTlv(top['62']!)['08'], 'K7MP3QXA');
  assert.equal(top['63'], crc16ccitt(qr.slice(0, -4)));
  assert.ok(qr.endsWith(top['63']!));

  const staticQr = parseTlv(buildVietQr({ bankBin: '970422', accountNo: '0903456789' }));
  assert.equal(staticQr['01'], '11');
  assert.equal(staticQr['54'], undefined);

  assert.throws(() => buildVietQr({ bankBin: '97042', accountNo: '1' }));
  assert.throws(() => buildVietQr({ bankBin: '970422', accountNo: '1', amount: 0 }));
  assert.throws(() => buildVietQr({ bankBin: '970422', accountNo: '1', amount: 1.5 }));
  assert.equal(toTransferContent('Cà phê sữa đá #2'), 'Ca phe sua da 2');
});

test('tên ngân hàng → BIN', () => {
  assert.equal(bankBinFromName('MBBank'), '970422');
  assert.equal(bankBinFromName('Vietcombank'), '970436');
  assert.equal(bankBinFromName('VietinBank'), '970415');
  assert.equal(bankBinFromName('TPBank'), '970423');
  assert.equal(bankBinFromName('970418'), '970418');
  assert.equal(bankBinFromName('Ngân hàng lạ'), null);
  assert.equal(bankBinFromName(null), null);
  assert.equal(bankDisplayName('970422'), 'MB Bank');
});

const sample = {
  id: 92704,
  gateway: 'MBBank',
  transactionDate: '2026-10-29 10:42:00',
  accountNumber: '0903456789',
  subAccount: '',
  code: null,
  content: 'MBVCB.123.K7MP3QXA.CT tu',
  transferType: 'in',
  description: '',
  transferAmount: 18000,
  accumulated: 0,
  referenceCode: 'FT123',
};

test('SePay: chuẩn hóa webhook', () => {
  const r = parseSepay(sample);
  assert.equal(r.kind, 'txn');
  if (r.kind !== 'txn') return;
  assert.equal(r.txn.txnId, '92704');
  assert.equal(r.txn.amount, 18000);
  assert.equal(r.txn.bankBin, '970422');
  assert.deepEqual(r.txn.accountCandidates, ['0903456789']);
  assert.match(r.txn.content, /K7MP3QXA/);

  const va = parseSepay({ ...sample, subAccount: 'VQRQA1234', code: 'K7MP3QXA' });
  assert.equal(va.kind === 'txn' && va.txn.accountCandidates.join(','), 'VQRQA1234,0903456789', 'tài khoản ảo thử trước');
  assert.equal(parseSepay({ ...sample, transferType: 'out' }).kind, 'ignore', 'tiền ra không xử lý');
  assert.equal(parseSepay({ ...sample, transferAmount: -5 }).kind, 'invalid');
  assert.equal(parseSepay({ ...sample, id: undefined }).kind, 'invalid');
  assert.equal(parseSepay('x').kind, 'invalid');
  assert.equal(SEPAY_ACK, '{"success":true}');
});

test('SePay: xác thực API key và HMAC', async () => {
  assert.ok(verifySepayApiKey('Apikey abc123', 'abc123'));
  assert.ok(!verifySepayApiKey('Apikey abc124', 'abc123'));
  assert.ok(!verifySepayApiKey('Bearer abc123', 'abc123'));
  assert.ok(!verifySepayApiKey(null, 'abc123'));
  assert.ok(!verifySepayApiKey('Apikey ', ''), 'chưa cấu hình khóa thì không cho qua');

  const body = JSON.stringify(sample);
  const ts = '1793000000';
  const sig = await signSepayForTest('s3cret', ts, body);
  assert.ok(await verifySepayHmac(sig, ts, body, 's3cret', 1793000100));
  assert.ok(!(await verifySepayHmac(sig, ts, body + ' ', 's3cret', 1793000100)), 'sửa body thì sai chữ ký');
  assert.ok(!(await verifySepayHmac(sig, ts, body, 'khac', 1793000100)));
  assert.ok(!(await verifySepayHmac(sig, ts, body, 's3cret', 1793000400)), 'quá 5 phút thì từ chối');
  assert.ok(!(await verifySepayHmac(null, ts, body, 's3cret', 1793000000)));
});

test('push-payment: chỉ báo khi tiền mới về, đến đúng máy tạo đơn', () => {
  const old = { payment_status: 'UNPAID', amount_received: 0, total_amount: 18000, created_device_id: 'dev-1', business_id: 'b' };
  const paid = { ...old, payment_status: 'PAID', amount_received: 18000 };
  assert.deepEqual(decidePush({ type: 'UPDATE', record: paid, old_record: old }), { deviceId: 'dev-1', title: 'Đã nhận 18.000 đ', body: 'Mười tám nghìn đồng' });
  assert.equal(decidePush({ type: 'UPDATE', record: paid, old_record: paid }), null);
  assert.equal(decidePush({ type: 'INSERT', record: paid, old_record: null }), null);
  assert.equal(decidePush({ type: 'UPDATE', record: { ...paid, created_device_id: null }, old_record: old }), null);
  const partial = { ...old, amount_received: 10000 };
  assert.equal(decidePush({ type: 'UPDATE', record: partial, old_record: old })?.title, 'Mới nhận 10.000 đ, còn thiếu 8.000 đ');
  const manual = { ...old, payment_status: 'PAID' };
  assert.equal(decidePush({ type: 'UPDATE', record: manual, old_record: old }), null, 'xác nhận tay không báo');
});
