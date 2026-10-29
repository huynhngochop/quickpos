/**
 * Tiền VND: số nguyên, không phần lẻ. Định dạng và đọc thành chữ tiếng Việt.
 * Hàm thuần, không phụ thuộc Intl để chạy giống nhau trên mọi máy Android (Hermes) và trong test.
 */

/** Giới hạn ô nhập số tiền ở quầy: 10 chữ số (dưới 10 tỷ). Server cho tối đa 100 tỷ một dòng. */
export const MAX_AMOUNT_DIGITS = 10;

export { groupDigits, formatVND, readNumber, readVND, capitalize } from '../../supabase/functions/_shared/vnmoney';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '000' | 'del' | 'clear';

/**
 * Bàn phím số ở quầy. Trạng thái là chuỗi chữ số (không có số 0 đứng đầu).
 * Bấm quá giới hạn thì bỏ qua (không cắt số người dùng đã nhập).
 */
export function pressKey(digits: string, key: KeypadKey, maxDigits = MAX_AMOUNT_DIGITS): string {
  if (key === 'clear') return '';
  if (key === 'del') return digits.slice(0, -1);
  const next = digits + key;
  const trimmed = next.replace(/^0+/, '');
  if (trimmed.length > maxDigits) return digits;
  return trimmed;
}

export function digitsToAmount(digits: string): number {
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

/** Gợi ý tiền khách đưa: đưa đủ, rồi các mệnh giá lớn hơn số cần trả (tối đa 6 nút). */
export function cashSuggestions(due: number): number[] {
  if (due <= 0) return [];
  const out = [due];
  // Làm tròn lên mệnh giá hay gặp: 10.000, 50.000, 100.000…
  for (const step of [10_000, 50_000, 100_000]) {
    const up = Math.ceil(due / step) * step;
    if (up > due && !out.includes(up)) out.push(up);
  }
  for (const note of [20_000, 50_000, 100_000, 200_000, 500_000]) {
    if (note > due && !out.includes(note)) out.push(note);
  }
  return out.sort((a, b) => a - b).slice(0, 6);
}

/** Chuẩn hóa số điện thoại VN về E.164 cho Supabase Auth: "0903 456 789" → "+84903456789". */
export function toE164VN(input: string): string | null {
  const d = input.replace(/[^0-9+]/g, '');
  let local: string;
  if (d.startsWith('+84')) local = d.slice(3);
  else if (d.startsWith('84') && d.length === 11) local = d.slice(2);
  else if (d.startsWith('0')) local = d.slice(1);
  else return null;
  // Di động VN: 9 số sau mã quốc gia, đầu 3/5/7/8/9
  if (!/^[35789][0-9]{8}$/.test(local)) return null;
  return `+84${local}`;
}

/** "+84903456789" hoặc "0903456789" → "0903 456 789" */
export function formatPhoneVN(input: string): string {
  const e = toE164VN(input);
  if (!e) return input;
  const local = `0${e.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
