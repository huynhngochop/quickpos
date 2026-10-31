/**
 * Quán đang dùng trên máy này. Lưu lại để mở app lúc mất mạng vẫn vào được màn hình thu tiền mặt.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRef } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Business, Role } from '../../types/api';

interface SessionState {
  userId: string | null;
  business: Business | null;
  role: Role | null;
  consentVersion: string | null;
  /** Số điện thoại lần đăng nhập gần nhất, để màn "Hết phiên" gửi lại mã nhanh */
  lastPhone: string | null;
  /** Đã từng đăng nhập trên máy này → hết phiên thì hiện "Cần đăng nhập lại" thay vì màn đăng nhập mới */
  everSignedIn: boolean;
  set: (p: Partial<Omit<SessionState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      userId: null,
      business: null,
      role: null,
      consentVersion: null,
      lastPhone: null,
      everSignedIn: false,
      set: (p) => set(p),
      reset: () => set({ userId: null, business: null, role: null, consentVersion: null }),
    }),
    { name: 'quickpos.session', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/**
 * Quán đang dùng. Khi đăng xuất / xóa tài khoản, các màn hình còn trong ngăn xếp vẫn vẽ lại một lần trước khi
 * bị gỡ: giữ mã quán cuối cùng thay vì ném lỗi (ném lỗi lúc đó làm app tắt ngang).
 */
export function useBusinessId(): string {
  const id = useSession((s) => s.business?.id);
  const last = useRef(id);
  if (id) last.current = id;
  if (!last.current) throw new Error('Chưa chọn quán');
  return last.current;
}

export function canManage(role: Role | null): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

export function canReviewMoney(role: Role | null): boolean {
  return role === 'OWNER' || role === 'MANAGER' || role === 'ACCOUNTANT';
}
