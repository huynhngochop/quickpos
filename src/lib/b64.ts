/**
 * Base64 thuần JS (Hermes không có Buffer; atob/btoa không chắc có trên mọi bản Android cũ).
 * Dùng cho khóa, chữ ký và gói tin mã hóa của Pro (mã kích hoạt, máy chủ quán).
 */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV: Record<string, number> = {};
for (let i = 0; i < ABC.length; i++) REV[ABC[i]!] = i;
REV['-'] = 62;
REV['_'] = 63;

export function toB64(bytes: Uint8Array, url = false): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ABC[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ABC[n & 63]! : '=';
  }
  return url ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
}

/** Nhận cả base64 thường và base64url; ký tự lạ → ném lỗi. */
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '');
  if (!/^[A-Za-z0-9+/_-]*$/.test(clean)) throw new Error('BAD_B64');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (REV[clean[i]!]! << 18) |
      ((REV[clean[i + 1] ?? 'A'] ?? 0) << 12) |
      ((REV[clean[i + 2] ?? 'A'] ?? 0) << 6) |
      (REV[clean[i + 3] ?? 'A'] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

/** Chuỗi → byte UTF-8 (TextEncoder có thể thiếu trên bản Hermes cũ). */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

export function fromUtf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    let cp: number;
    if (c < 0x80) {
      cp = c;
      i += 1;
    } else if (c < 0xe0) {
      cp = ((c & 31) << 6) | (b[i + 1]! & 63);
      i += 2;
    } else if (c < 0xf0) {
      cp = ((c & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63);
      i += 3;
    } else {
      cp = ((c & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63);
      i += 4;
    }
    s += String.fromCodePoint(cp);
  }
  return s;
}
