/**
 * Gói sử dụng (chốt 07/11/2026):
 *  - Miễn phí: một máy, chủ quán tự bán.
 *  - Pro: nhiều nhân viên, nhiều máy nối vào máy chủ quán qua Wi‑Fi. Dùng thử 30 ngày, sau đó trả theo năm
 *    bằng mã kích hoạt (mua bằng chuyển khoản / ví / thẻ, người bán gửi mã).
 *  - Premium (sau này): đồng bộ qua máy chủ đám mây, dữ liệu lớn.
 *
 * Mã kích hoạt ký Ed25519 bằng khóa bí mật của người bán (không nằm trong app); app chỉ có khóa công khai
 * nên kiểm tra được ngay trên máy, không cần mạng. Logic thuần — kiểm thử ở tests/plan.test.ts.
 */
import nacl from 'tweetnacl';
import { fromB64, fromUtf8, toB64, utf8 } from '../../lib/b64';

/** Khóa công khai kiểm tra mã kích hoạt (khóa bí mật do chủ sản phẩm giữ). */
export const LICENSE_PUBLIC_KEY = 'nc/gsPOx4zchRWBD2o7jR2u9xu2cdiYCqPZGdkZAO6M=';
export const TRIAL_DAYS = 30;
const DAY = 86_400_000;

/** Mã quán (8 ký tự) dùng để mua mã kích hoạt: lấy từ mã quán trong máy. */
export function shopKey(businessId: string): string {
  return businessId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8).toUpperCase();
}

export function formatShopKey(k: string): string {
  return k.length === 8 ? `${k.slice(0, 4)}-${k.slice(4)}` : k;
}

export interface License {
  shop: string;
  /** Ngày hết hạn yyyy-mm-dd (dùng hết ngày đó) */
  expiresOn: string;
  plan: 'PRO';
}

const PREFIX = 'QP-';

/** Người bán cấp mã (màn "Cấp mã" ẩn trong app hoặc script). secretKeyB64 = 64 byte tweetnacl. */
export function signLicense(secretKeyB64: string, shop: string, expiresOn: string): string {
  if (!/^[0-9A-Z]{8}$/.test(shop) || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error('BAD_INPUT');
  const msg = utf8(`${shop}|${expiresOn.replace(/-/g, '')}|PRO`);
  const sig = nacl.sign.detached(msg, fromB64(secretKeyB64));
  return `${PREFIX}${toB64(msg, true)}.${toB64(sig, true)}`;
}

/** Kiểm tra mã: đúng chữ ký, đúng định dạng; trả null nếu sai. Không kiểm tra hạn ở đây. */
export function readLicense(code: string, publicKeyB64 = LICENSE_PUBLIC_KEY): License | null {
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith(PREFIX)) return null;
  const [m, s] = c.slice(PREFIX.length).split('.');
  if (!m || !s) return null;
  try {
    const msg = fromB64(m);
    const sig = fromB64(s);
    if (sig.length !== 64 || !nacl.sign.detached.verify(msg, sig, fromB64(publicKeyB64))) return null;
    const parts = /^([0-9A-Z]{8})\|(\d{4})(\d{2})(\d{2})\|PRO$/.exec(fromUtf8(msg));
    if (!parts) return null;
    return { shop: parts[1]!, expiresOn: `${parts[2]}-${parts[3]}-${parts[4]}`, plan: 'PRO' };
  } catch {
    return null;
  }
}

export type PlanKind = 'FREE' | 'PRO_TRIAL' | 'PRO' | 'PRO_EXPIRED';

export interface PlanStatus {
  kind: PlanKind;
  /** Pro đang dùng được (dùng thử hoặc đã mua) */
  active: boolean;
  daysLeft: number;
  /** Ngày cuối được dùng (yyyy-mm-dd) */
  until: string | null;
}

const ymd = (t: number) => {
  // Ngày theo giờ Việt Nam
  const d = new Date(t + 7 * 3_600_000);
  return d.toISOString().slice(0, 10);
};

/**
 * Trạng thái gói. now đã chống lùi giờ (lấy giờ lớn nhất từng thấy, xem planNow()).
 * Mã kích hoạt hợp lệ của đúng quán và còn hạn → PRO; còn trong 30 ngày dùng thử → PRO_TRIAL;
 * từng dùng thử / từng mua mà hết → PRO_EXPIRED; chưa dùng thử → FREE.
 */
export function planStatus(p: {
  businessId: string;
  trialStartedAt?: string | null;
  licenseCode?: string | null;
  now: number;
  /** Chỉ cho test */
  publicKey?: string;
}): PlanStatus {
  const today = ymd(p.now);
  const lic = p.licenseCode ? readLicense(p.licenseCode, p.publicKey) : null;
  const validLic = lic && lic.shop === shopKey(p.businessId) ? lic : null;
  if (validLic && validLic.expiresOn >= today) {
    const days = Math.round((Date.parse(`${validLic.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY) + 1;
    return { kind: 'PRO', active: true, daysLeft: days, until: validLic.expiresOn };
  }
  if (p.trialStartedAt) {
    const end = Date.parse(p.trialStartedAt) + TRIAL_DAYS * DAY;
    if (p.now < end) {
      return { kind: 'PRO_TRIAL', active: true, daysLeft: Math.max(1, Math.ceil((end - p.now) / DAY)), until: ymd(end - 1) };
    }
    return { kind: 'PRO_EXPIRED', active: false, daysLeft: 0, until: validLic?.expiresOn ?? ymd(end - 1) };
  }
  if (validLic) return { kind: 'PRO_EXPIRED', active: false, daysLeft: 0, until: validLic.expiresOn };
  return { kind: 'FREE', active: false, daysLeft: 0, until: null };
}

/** Hạn mới khi mua thêm n năm: tính tiếp từ hạn cũ nếu còn, không thì từ hôm nay. */
export function extendUntil(currentUntil: string | null, years: number, now: number): string {
  const today = ymd(now);
  const base = currentUntil && currentUntil >= today ? currentUntil : today;
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
