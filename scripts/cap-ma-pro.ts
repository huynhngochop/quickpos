/**
 * Cấp mã kích hoạt gói Pro cho một quán, chạy trên máy tính của người bán (thay cho màn ẩn trong app,
 * vì App Store / Google Play không cho app có chức năng ẩn).
 *
 *   npx tsx scripts/cap-ma-pro.ts <mã quán> <ngày hết hạn yyyy-mm-dd> <file khóa bí mật>
 *   ví dụ: npx tsx scripts/cap-ma-pro.ts ABCD-1234 2027-11-19 ~/QuickPOS-khoa-cap-ma-Pro.txt
 *
 * Mã quán là 8 ký tự chủ quán thấy ở màn "Gói sử dụng" (có hoặc không có dấu gạch).
 * File khóa bí mật chỉ người bán giữ, KHÔNG đưa vào repo.
 */
import { readFileSync } from 'node:fs';
import { readLicense, signLicense } from '../src/features/plan/license';

const [shopArg = '', expiresOn = '', keyFile = ''] = process.argv.slice(2);
if (!shopArg || !expiresOn || !keyFile) {
  console.error('Cách dùng: npx tsx scripts/cap-ma-pro.ts <mã quán> <yyyy-mm-dd> <file khóa bí mật>');
  process.exit(2);
}

const shop = shopArg.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
// Khóa bí mật là dòng base64 dài nhất trong file (64 byte → 88 ký tự)
const secret = readFileSync(keyFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^[A-Za-z0-9+/]{80,}={0,2}$/.test(line))
  .sort((a, b) => b.length - a.length)[0];
if (!secret) {
  console.error('Không tìm thấy khóa bí mật trong file');
  process.exit(1);
}

const code = signLicense(secret, shop, expiresOn);
// Kiểm tra lại bằng khóa công khai trong app: mã sai thì không đưa cho khách
const check = readLicense(code);
if (!check || check.shop !== shop || check.expiresOn !== expiresOn) {
  console.error('Khóa bí mật không khớp khóa công khai của app');
  process.exit(1);
}
console.log(code);
