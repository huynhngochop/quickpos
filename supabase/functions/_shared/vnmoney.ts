/**
 * Định dạng và đọc số tiền VND thành chữ tiếng Việt. Một nguồn duy nhất cho app (src/lib/money.ts
 * re-export) và Edge Functions. Không import gì, không dùng Intl — chạy giống nhau trên Hermes, Deno, Node.
 */

/** 18000 → "18.000" */
export function groupDigits(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('Số tiền phải là số nguyên');
  const sign = n < 0 ? '-' : '';
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return sign + out;
}

/** 18000 → "18.000 đ" */
export function formatVND(n: number): string {
  return `${groupDigits(n)} đ`;
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const GROUPS = ['', 'nghìn', 'triệu', 'tỷ'];

/** Đọc một nhóm 3 chữ số. `full` = nhóm đứng sau nhóm khác khác 0, phải đọc đủ "không trăm", "linh". */
function readGroup(n: number, full: boolean): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const w: string[] = [];
  if (h > 0 || full) w.push(DIGITS[h]!, 'trăm');
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) w.push('linh');
  } else if (t === 1) {
    w.push('mười');
  } else {
    w.push(DIGITS[t]!, 'mươi');
  }
  if (u > 0) {
    if (u === 1 && t >= 2) w.push('mốt');
    else if (u === 5 && t >= 1) w.push('lăm');
    else w.push(DIGITS[u]!);
  }
  return w;
}

/**
 * Đọc số thành chữ: 18000 → "mười tám nghìn", 105000 → "một trăm linh năm nghìn",
 * 2050000 → "hai triệu không trăm năm mươi nghìn". Hỗ trợ tới dưới 1 triệu tỷ.
 */
export function readNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Chỉ đọc số nguyên không âm');
  if (n === 0) return 'không';
  // Tách nhóm 3 chữ số; trên "tỷ" lặp lại "nghìn tỷ", "triệu tỷ"
  const groups: number[] = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const words: string[] = [];
  let seenNonZero = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    words.push(...readGroup(g, seenNonZero));
    const unit = i < 4 ? GROUPS[i]! : `${GROUPS[i - 3]!} tỷ`;
    if (unit) words.push(unit);
    seenNonZero = true;
  }
  return words.join(' ');
}

/** 18000 → "mười tám nghìn đồng" */
export function readVND(n: number): string {
  return `${readNumber(n)} đồng`;
}

/** Viết hoa chữ đầu: "Mười tám nghìn đồng" */
export function capitalize(s: string): string {
  return s.length ? s[0]!.toLocaleUpperCase('vi') + s.slice(1) : s;
}
