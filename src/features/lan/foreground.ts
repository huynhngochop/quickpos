/**
 * Dịch vụ chạy nền của máy chủ quán (Android, module trong modules/qp-foreground).
 * Có thông báo cố định nên Android không dừng app khi tắt màn hình / chuyển app; chỉ giữ CPU + Wi‑Fi thức khi có
 * máy nhân viên đang nối. iOS và bản chưa build lại (không có module) thì bỏ qua.
 */
import { requireOptionalNativeModule } from 'expo';
import { vi } from '../../i18n/vi';

interface QpForegroundNative {
  start(title: string, body: string, locks: boolean): boolean;
  stop(): boolean;
}

let native: QpForegroundNative | null | undefined;
function mod(): QpForegroundNative | null {
  if (native === undefined) {
    try {
      native = requireOptionalNativeModule<QpForegroundNative>('QpForeground');
    } catch {
      native = null;
    }
  }
  return native;
}

let last: string | null = null;

/** Bật / cập nhật thông báo theo số máy đang nối (chỉ gửi khi đổi; force: gửi lại, phòng khi hệ thống đã dừng dịch vụ) */
export function foregroundOn(connected: number, force = false) {
  const m = mod();
  if (!m) return;
  const key = `on:${connected}`;
  if (key === last && !force) return;
  try {
    if (m.start(vi.plan.fgTitle, vi.plan.fgBody(connected), connected > 0)) last = key;
  } catch {
    /* bỏ qua: lần sau thử lại */
  }
}

export function foregroundOff() {
  const m = mod();
  if (!m || last === null) return;
  try {
    m.stop();
  } catch {
    /* đã dừng */
  }
  last = null;
}
