import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { fromB64, fromUtf8, toB64, utf8 } from '../src/lib/b64';
import { extendUntil, formatShopKey, planStatus, readLicense, shopKey, signLicense } from '../src/features/plan/license';

const kp = nacl.sign.keyPair();
const SECRET = toB64(kp.secretKey);
const PUB = toB64(kp.publicKey);
const BIZ = '3f9a1c2b-0000-4000-8000-000000000001';
const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

test('base64 / utf8 thuần JS', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(fromB64(toB64(bytes)), bytes);
  assert.deepEqual(fromB64(toB64(bytes, true)), bytes);
  assert.equal(toB64(utf8('Sữa tươi 🥛')), Buffer.from('Sữa tươi 🥛').toString('base64'));
  assert.equal(fromUtf8(utf8('Đồng ý — 18.000 đ')), 'Đồng ý — 18.000 đ');
  assert.throws(() => fromB64('***'));
});

test('mã kích hoạt: ký, kiểm tra, sai quán, bị sửa', () => {
  assert.equal(shopKey(BIZ), '3F9A1C2B');
  assert.equal(formatShopKey('3F9A1C2B'), '3F9A-1C2B');
  const code = signLicense(SECRET, '3F9A1C2B', '2027-11-07');
  assert.match(code, /^QP-/);
  assert.deepEqual(readLicense(code, PUB), { shop: '3F9A1C2B', expiresOn: '2027-11-07', plan: 'PRO' });
  assert.deepEqual(readLicense(`  ${code.slice(0, 20)}\n${code.slice(20)} `, PUB)?.shop, '3F9A1C2B');
  // Sửa một ký tự → sai chữ ký
  const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.equal(readLicense(bad, PUB), null);
  assert.equal(readLicense(code, toB64(nacl.sign.keyPair().publicKey)), null, 'khóa khác không nhận');
  assert.equal(readLicense('QP-abc', PUB), null);
  assert.throws(() => signLicense(SECRET, 'abc', '2027-11-07'));
});

test('gói: miễn phí → dùng thử 30 ngày → hết hạn → mua năm → gia hạn', () => {
  const t0 = at('2026-11-07T03:00:00Z');
  assert.equal(planStatus({ businessId: BIZ, now: t0, publicKey: PUB }).kind, 'FREE');
  const trial = planStatus({ businessId: BIZ, trialStartedAt: new Date(t0).toISOString(), now: t0 + 1000, publicKey: PUB });
  assert.equal(trial.kind, 'PRO_TRIAL');
  assert.equal(trial.active, true);
  assert.equal(trial.daysLeft, 30);
  const day29 = planStatus({ businessId: BIZ, trialStartedAt: new Date(t0).toISOString(), now: t0 + 29.5 * DAY, publicKey: PUB });
  assert.equal(day29.daysLeft, 1);
  const over = planStatus({ businessId: BIZ, trialStartedAt: new Date(t0).toISOString(), now: t0 + 30 * DAY + 1, publicKey: PUB });
  assert.equal(over.kind, 'PRO_EXPIRED');
  assert.equal(over.active, false);

  const code = signLicense(SECRET, shopKey(BIZ), '2027-12-06');
  const pro = planStatus({ businessId: BIZ, trialStartedAt: new Date(t0).toISOString(), licenseCode: code, now: t0 + 40 * DAY, publicKey: PUB });
  assert.equal(pro.kind, 'PRO');
  assert.equal(pro.until, '2027-12-06');
  // Hết ngày ghi trên mã (giờ Việt Nam) → hết hạn
  assert.equal(planStatus({ businessId: BIZ, licenseCode: code, now: at('2027-12-06T16:59:00Z'), publicKey: PUB }).kind, 'PRO');
  assert.equal(planStatus({ businessId: BIZ, licenseCode: code, now: at('2027-12-06T17:01:00Z'), publicKey: PUB }).kind, 'PRO_EXPIRED');
  // Mã của quán khác không có tác dụng
  const other = signLicense(SECRET, 'ABCDEFGH', '2030-01-01');
  assert.equal(planStatus({ businessId: BIZ, licenseCode: other, now: t0, publicKey: PUB }).kind, 'FREE');

  assert.equal(extendUntil('2027-12-06', 1, at('2027-01-01T00:00:00Z')), '2028-12-06', 'còn hạn: cộng tiếp');
  assert.equal(extendUntil('2026-01-01', 2, at('2026-11-07T03:00:00Z')), '2028-11-07', 'hết hạn: tính từ hôm nay');
  assert.equal(extendUntil(null, 1, at('2026-11-07T18:00:00Z')), '2027-11-08', 'ngày theo giờ Việt Nam');
});
