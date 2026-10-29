/**
 * Kho bảo mật có dự phòng: dùng Keychain/Keystore (expo-secure-store); nếu máy báo lỗi truy cập
 * (máy ảo không ký, Keystore hỏng sau khi đổi khóa màn hình…), ghi sang AsyncStorage để app không bị treo.
 * Đã chuyển sang dự phòng thì giữ luôn trong phiên đó, đọc cả hai nơi để không mất dữ liệu cũ.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const FALLBACK_PREFIX = 'quickpos.fallback.';
let secureBroken = false;

function warn(op: string, err: unknown): void {
  secureBroken = true;
  console.warn(`[secureStore] ${op} lỗi, dùng kho dự phòng`, String(err));
}

export async function getItem(key: string): Promise<string | null> {
  if (!secureBroken) {
    try {
      const v = await SecureStore.getItemAsync(key);
      if (v !== null) return v;
    } catch (e) {
      warn('get', e);
    }
  }
  return AsyncStorage.getItem(FALLBACK_PREFIX + key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (!secureBroken) {
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch (e) {
      warn('set', e);
    }
  }
  await AsyncStorage.setItem(FALLBACK_PREFIX + key, value);
}

export async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    warn('delete', e);
  }
  await AsyncStorage.removeItem(FALLBACK_PREFIX + key);
}
