import { router } from 'expo-router';
import { signOut } from './api';
import { useSession } from './store';

/**
 * Đăng xuất khỏi máy này (Cài đặt → "Đăng xuất", Trang chính → "Thoát").
 * Không cho thoát khi còn đơn tiền mặt chưa gửi (mất đơn). Trả về số đơn chặn, hoặc 0 khi đã thoát.
 */
export async function logoutHere(queued: number): Promise<number> {
  if (queued > 0) return queued;
  // Tắt cờ trước khi đăng xuất để không bị chuyển sang màn "Hết phiên"
  useSession.getState().set({ everSignedIn: false });
  await signOut();
  // Rời màn hình trước rồi mới xóa quán khỏi máy (xóa trước làm màn hình bên dưới vẽ lại khi chưa có quán)
  router.replace('/dang-nhap');
  setTimeout(() => useSession.getState().reset(), 0);
  return 0;
}
