/**
 * Mã máy: UUID sinh một lần, lưu trong SecureStore. Dùng cho orders.created_device_id
 * (chỉ máy tạo đơn đọc to) và device_registrations. Không dùng mã phần cứng.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from './secureStore';

const KEY = 'quickpos.device_id';
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const saved = await SecureStore.getItem(KEY);
  const id: string = saved ?? Crypto.randomUUID();
  if (!saved) await SecureStore.setItem(KEY, id);
  cached = id;
  return id;
}

/** Đã đọc ở lúc mở app (useBootstrap) nên các màn hình gọi đồng bộ được. */
export function deviceIdSync(): string {
  if (!cached) throw new Error('getDeviceId() chưa chạy');
  return cached;
}

/** Như trên nhưng không ném lỗi: dùng ở nơi có thể chạy trước khi mở app xong (Realtime). */
export function deviceIdOrNull(): string | null {
  return cached;
}

export function newId(): string {
  return Crypto.randomUUID();
}
