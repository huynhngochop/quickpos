/**
 * Máy này là máy chính (giữ dữ liệu) hay máy nhân viên (nối vào máy chủ quán). Lưu trong SQLite của app.
 */
import Storage from 'expo-sqlite/kv-store';
import type { StaffPairing } from './protocol';

const MODE_KEY = 'quickpos.device.staffPairing';

export function readStaffPairing(): StaffPairing | null {
  try {
    const raw = Storage.getItemSync(MODE_KEY);
    return raw ? (JSON.parse(raw) as StaffPairing) : null;
  } catch {
    return null;
  }
}

export function saveStaffPairing(p: StaffPairing | null) {
  if (p) Storage.setItemSync(MODE_KEY, JSON.stringify(p));
  else Storage.removeItemSync(MODE_KEY);
}

const HOST_KEY = 'quickpos.lan.host';

/** Máy chủ quán: mã nhận diện cố định + danh sách máy nhân viên đã ghép */
export function readHostState<T>(): T | null {
  try {
    const raw = Storage.getItemSync(HOST_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveHostState(v: unknown) {
  Storage.setItemSync(HOST_KEY, JSON.stringify(v));
}

const MAX_SEEN_KEY = 'quickpos.plan.maxSeenAt';

/** Giờ dùng để tính hạn gói: lớn nhất từng thấy (chỉnh lùi đồng hồ máy không kéo dài được dùng thử). */
export function planNow(): number {
  const now = Date.now();
  try {
    const seen = Number(Storage.getItemSync(MAX_SEEN_KEY) ?? 0) || 0;
    if (now > seen) Storage.setItemSync(MAX_SEEN_KEY, String(now));
    return Math.max(now, seen);
  } catch {
    return now;
  }
}
