/**
 * Gói Pro — máy chủ quán trong Wi‑Fi (docs/roadmap.md "Giai đoạn 2").
 * Một máy giữ dữ liệu (máy chủ quán), máy nhân viên chỉ gửi lệnh tới đó → không có hai bản dữ liệu ghi đè nhau.
 *
 * Khung tin: mỗi dòng một JSON (kết thúc bằng \n) trên TCP. Mọi tin sau khi ghép máy được mã hóa + xác thực
 * bằng nacl.secretbox với khóa riêng của từng máy nhân viên; trong nội dung có số thứ tự tăng dần để chặn gửi lại.
 * Logic thuần, không phụ thuộc thư viện mạng — kiểm thử ở tests/lan.test.ts.
 */
import nacl from 'tweetnacl';
import { fromB64, fromUtf8, toB64, utf8 } from '../../lib/b64';

export const LAN_PORT = 47123;
export const PROTOCOL_VERSION = 1;
/** Mã ghép máy (trong mã QR) dùng được trong 5 phút, một lần */
export const PAIRING_TTL_MS = 5 * 60_000;
const MAX_LINE = 4 * 1024 * 1024;

/** Kết nối hai chiều theo dòng (TCP thật hoặc cặp ống giả trong test). */
export interface LineConn {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Cắt luồng chữ thành từng dòng (TCP có thể gộp hoặc cắt đôi tin). */
export class LineBuffer {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    if (this.buf.length > MAX_LINE) {
      this.buf = '';
      throw new Error('LINE_TOO_LONG');
    }
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    return lines.filter((l) => l.length > 0);
  }
}

export function randomKey(): string {
  return toB64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export function seal(obj: unknown, keyB64: string): { n: string; c: string } {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(utf8(JSON.stringify(obj)), nonce, fromB64(keyB64));
  return { n: toB64(nonce), c: toB64(box) };
}

/** Mở tin; sai khóa / bị sửa → null. */
export function open<T = unknown>(n: string, c: string, keyB64: string): T | null {
  try {
    const plain = nacl.secretbox.open(fromB64(c), fromB64(n), fromB64(keyB64));
    return plain ? (JSON.parse(fromUtf8(plain)) as T) : null;
  } catch {
    return null;
  }
}

// ---------- Mã QR ghép máy ----------
export interface PairingQr {
  /** IP và cổng của máy chủ quán trong Wi‑Fi */
  h: string;
  p: number;
  /** Mã nhận diện máy chủ quán (để dò lại khi IP đổi) */
  i: string;
  /** Khóa ghép máy dùng một lần */
  k: string;
  v: number;
}

const QR_PREFIX = 'QPLAN1:';

export function encodePairingQr(q: Omit<PairingQr, 'v'>): string {
  return QR_PREFIX + toB64(utf8(JSON.stringify({ ...q, v: PROTOCOL_VERSION })), true);
}

export function decodePairingQr(s: string): PairingQr | null {
  const t = s.trim();
  if (!t.startsWith(QR_PREFIX)) return null;
  try {
    const q = JSON.parse(fromUtf8(fromB64(t.slice(QR_PREFIX.length)))) as PairingQr;
    if (q.v !== PROTOCOL_VERSION || typeof q.h !== 'string' || !q.p || !q.i || !q.k) return null;
    return q;
  } catch {
    return null;
  }
}

// ---------- Nội dung tin ----------
export type LanRole = 'MANAGER' | 'CASHIER';

/** Lệnh từ máy nhân viên: đúng các lời gọi trong docs/api.md */
export type LanRequest =
  | { kind: 'rpc'; name: string; args: Record<string, unknown> }
  | { kind: 'select'; table: string; ops: { m: string; a: unknown[] }[] }
  | { kind: 'fn'; name: string; body: Record<string, unknown> };

export interface LanResult {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}

/** Thông tin máy nhân viên nhận được khi ghép máy (lưu trên máy nhân viên). */
export interface StaffPairing {
  hostId: string;
  hostIp: string;
  port: number;
  deviceId: string;
  key: string;
  userId: string;
  role: LanRole;
  businessId: string;
  shopName: string;
  staffName: string;
}

/** Các hàm đọc của bộ máy dữ liệu được phép gọi từ máy nhân viên */
export const SELECT_METHODS = new Set(['select', 'eq', 'is', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'single', 'maybeSingle']);
