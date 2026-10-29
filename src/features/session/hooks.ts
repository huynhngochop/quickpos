import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { mainPaymentAccount } from './api';
import { canReviewMoney, useSession } from './store';
import { OWNER_UNLOCK_MS, usePrefs } from '../settings/prefs';

export function useMainAccount(businessId: string) {
  return useQuery({
    queryKey: ['account', businessId],
    queryFn: () => mainPaymentAccount(businessId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Mở màn hình của chủ quán (Cài đặt, Tiền cần xem lại): qua mã PIN nếu chưa mở khóa trong 5 phút.
 */
export function openOwnerScreen(path: '/cai-dat' | '/xem-lai'): void {
  const unlocked = usePrefs.getState().ownerUnlockedUntil > Date.now();
  if (unlocked) router.push(path);
  else router.push({ pathname: '/nhap-pin', params: { next: path } });
}

export function unlockOwner(): void {
  usePrefs.getState().set({ ownerUnlockedUntil: Date.now() + OWNER_UNLOCK_MS });
}

export function useCanReview(): boolean {
  return canReviewMoney(useSession((s) => s.role));
}
