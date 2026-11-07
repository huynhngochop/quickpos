/**
 * Nơi lưu dữ liệu của chế độ "lưu trên máy" (không có máy chủ): SQLite của app (expo-sqlite/kv-store).
 * Nằm trong vùng riêng của app nên còn nguyên khi cập nhật app; chỉ mất khi gỡ app hoặc xóa dữ liệu app.
 */
import Storage from 'expo-sqlite/kv-store';

const DATA_KEY = 'quickpos.local.v1';
const LAST_BACKUP_KEY = 'quickpos.lastBackupAt';

export const localStore = {
  load: (): string | null => Storage.getItemSync(DATA_KEY),
  save: (json: string): void => Storage.setItemSync(DATA_KEY, json),
};

export function lastBackupAt(): string | null {
  try {
    return Storage.getItemSync(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function markBackedUp(at: string = new Date().toISOString()) {
  try {
    Storage.setItemSync(LAST_BACKUP_KEY, at);
  } catch {
    // không ghi được thì lần sau nhắc lại
  }
}
