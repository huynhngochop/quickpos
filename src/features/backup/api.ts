/**
 * Sao lưu / khôi phục dữ liệu quán bằng file (chế độ lưu trên máy, chưa có máy chủ).
 * File JSON gửi qua bảng chia sẻ của máy (Gmail, Zalo, Drive…); khôi phục bằng cách chọn lại file đó.
 */
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { exportBackup, parseBackup, restoreBackup, type BackupFile } from '../../lib/demoClient';
import { markBackedUp } from '../../lib/localStore';
import { backupFileName } from './name';
import { vnDay } from '../../lib/time';
import { vi } from '../../i18n/vi';

/** Tạo file sao lưu rồi mở bảng chia sẻ. Trả về false nếu máy không chia sẻ được. */
export async function shareBackup(businessId: string): Promise<boolean> {
  const data = exportBackup(businessId);
  const file = new File(Paths.cache, backupFileName(data.business_name, vnDay()));
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(data));
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: vi.local.fileTitle(data.business_name), UTI: 'public.json' });
  markBackedUp();
  return true;
}

/** Cho chọn file; trả về bản sao lưu đã kiểm tra, null nếu bỏ chọn. Ném 'BAD_FILE' nếu không phải file của QuickPOS. */
export async function pickBackup(): Promise<BackupFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const text = await new File(r.assets[0].uri).text();
  const f = parseBackup(text);
  if (!f) throw new Error('BAD_FILE');
  return f;
}

export function applyBackup(f: BackupFile): string {
  return restoreBackup(f).businessId;
}
