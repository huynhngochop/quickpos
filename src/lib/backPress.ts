/**
 * Nút quay lại của Android (theo yêu cầu 14/11/2026):
 * - Bấm 1 lần: về màn trước (để thanh điều hướng tự xử lý).
 * - Bấm 2 lần liên tiếp (trong DOUBLE_MS): thoát app (giữ đăng nhập, như nút Thoát ở trang chính).
 * - Ở màn đầu (không còn màn trước): lần bấm đầu chỉ nhắc "Bấm quay lại lần nữa để thoát", không tự đóng app.
 * Hộp hỏi (Modal) đang mở thì Android gửi nút quay lại cho hộp (đóng hộp), không tới đây.
 */
import { useEffect } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { router, usePathname } from 'expo-router';
import { vi } from '../i18n/vi';

export const DOUBLE_MS = 600;

/** Quyết định cho một lần bấm (tách riêng để dễ kiểm tra): 'exit' | 'back' | 'hint' */
export function decideBack(now: number, lastAt: number, canGoBack: boolean): 'exit' | 'back' | 'hint' {
  if (lastAt > 0 && now - lastAt < DOUBLE_MS) return 'exit';
  return canGoBack ? 'back' : 'hint';
}

let lastAt = 0;

export function useDoubleBackExit() {
  // Android gọi người nghe đăng ký SAU CÙNG trước. Thanh điều hướng (bọc ngoài bố cục gốc) đăng ký sau bố cục gốc,
  // nên đăng ký lại mỗi lần đổi màn để luôn được gọi trước nó; trả false = để thanh điều hướng lùi màn.
  const pathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const now = Date.now();
      const action = decideBack(now, lastAt, router.canGoBack());
      lastAt = now;
      if (action === 'exit') {
        lastAt = 0;
        BackHandler.exitApp();
        return true;
      }
      if (action === 'back') return false;
      ToastAndroid.show(vi.common.backAgainToExit, ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [pathname]);
}
